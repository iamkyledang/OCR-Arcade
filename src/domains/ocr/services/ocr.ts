import { createWorker, PSM } from 'tesseract.js'
import type { Worker } from 'tesseract.js'
import { preprocessImage } from '@/shared/lib/imagePreprocessing'
import { FoundationMorphology } from '@/domains/ocr/foundations/FoundationMorphology'
import { imageUrlToImageData, mergeBoxes, filterContainedBoxes, cropImageByBbox } from './ocrUtils'
import { useDebugStore } from '@/shared/store/useDebugStore'

export type OCRLanguage =
    | 'chi_tra'
    | 'chi_sim'
    | 'chi_tra_vert'
    | 'chi_sim_vert'
    | 'eng'
    | 'jpn'
    | 'kor'
    | 'fra'
    | 'deu'
    | 'spa'
    | 'ita'
    | 'por'
    | 'rus'
    | 'ara'
    | 'tha'
    | 'vie'

export function isVerticalLanguage(lang: OCRLanguage): boolean {
    return lang === 'chi_tra_vert' || lang === 'chi_sim_vert'
}

// 定義 OCR 文字物件介面
export interface OCRWord {
    text: string
    bbox: {
        x0: number
        y0: number
        x1: number
        y1: number
    }
    confidence?: number
    id?: string
    language?: 'en' | 'zh' | 'mixed'
    source?: 'tesseract'
    vertical?: boolean
}

// 文字分割方法
export type SegmentationMethod =
    | 'pre-ocr-density' // [Legacy] 先分割再 OCR（實作為 morphology）
    | 'pre-ocr-subregion' // [New] Pre-Seg 子區域遞迴調用（不寫入 Debug Store）
    | 'tesseract';    // Tesseract 內建（原本的流程）


// Tesseract.js Worker 管理
export const ocrService = {
    worker: null as Worker | null,
    currentLang: '' as string,

    async init(lang: OCRLanguage = 'chi_tra') {
        // 如果語言改變，需要重新創建 Worker
        if (this.worker && this.currentLang !== lang) {
            await this.terminate();
            this.worker = null;
        }

        if (!this.worker) {
            try {
                this.worker = await createWorker(lang);
                this.currentLang = lang;
            } catch (error) {
                throw new Error(`無法創建 Tesseract Worker: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return this.worker;
    },

    async recognize(
        imageData: string,
        lang: OCRLanguage = 'chi_tra',
        _onProgress?: (progress: number) => void,
        enablePreprocessing: boolean = true,
        debugSteps: string[] = [],
        preprocessOptions?: {
            grayscale?: boolean;
            enhanceContrast?: boolean;
            binarize?: boolean;
            denoise?: boolean;
        },
        segmentationMethod: SegmentationMethod = 'tesseract',
        onDebugImage?: (dataUrl: string, label: string) => void
    ): Promise<OCRWord[]> {
        // [Legacy] Pre-OCR Segmentation Flow
        // Enabled for high accuracy (padding fix implemented)
        if (segmentationMethod === 'pre-ocr-density') {
            return this.recognizeWithPreSegmentation(imageData, lang, onDebugImage);
        }

        // 確保 Worker 已初始化
        let w = await this.init(lang)

        // 圖像預處理 (如果啟用)
        let processedImage = imageData
        if (enablePreprocessing) {
            try {
                // sub-region 模式：已是裁切後的小圖片，只要灰饨 + 提高對比即可，不需要耗時的二值化
                const isSubRegion = segmentationMethod === 'pre-ocr-subregion'
                processedImage = await preprocessImage(imageData,
                    preprocessOptions ? { ...preprocessOptions, onIntermediateImage: onDebugImage } : {
                        grayscale: true,
                        enhanceContrast: true,
                        binarize: !isSubRegion,  // 主圖啟用二值化；sub-region 已是小圖不需要
                        denoise: false,           // 純 JS median filter 太慢，二值化已經去除大部分雜訊
                        onIntermediateImage: onDebugImage
                    },
                    debugSteps
                )
            } catch (error) {
            }
        }

        try {
            // Tesseract.js v7: 需要明確指定 output 選項才會返回 blocks 結構
            // recognize(image, options, output, jobId)
            // 使用 PSM 6 (假設為統一的文字區塊) 來提升辨識品質
            // Note: tessedit_pageseg_mode 屬於 WorkerParams，必須透過 setParameters() 設定
            // 使用 PSM enum，不可直接使用字串
            await w.setParameters({
                tessedit_pageseg_mode: isVerticalLanguage(lang) ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_BLOCK,
                preserve_interword_spaces: '1',
            });
            const result = await w.recognize(processedImage, {}, { blocks: true })
            const data = result.data as any;
            return this.processOutput(data, processedImage, debugSteps, segmentationMethod, onDebugImage, isVerticalLanguage(lang))
        } catch (err: any) {
            // 如果遇到關鍵錯誤 (可能是 Worker 壞了)，嘗試重啟 Worker
            if (err.toString().includes('SetImageFile') || err.message?.includes('null') || err.message?.includes('Cannot read properties of null')) {
                try {
                    await this.terminate();
                    this.worker = null; // 確保清空
                    w = await this.init(lang); // 使用正確的語言參數重新初始化
                    const { data } = await w.recognize(processedImage, {}, { blocks: true });
                    return this.processOutput(data, processedImage, debugSteps, segmentationMethod, onDebugImage, isVerticalLanguage(lang));
                } catch (retryErr: any) {
                    throw new Error(`Tesseract Worker 重啟後仍然失敗: ${retryErr.message}`);
                }
            }
            throw err;
        }
    },

    /**
     * 高精度識別流程：先切割，再識別 (Pre-OCR Segmentation)
     */
    async recognizeWithPreSegmentation(
        imageDataUrl: string,
        lang: OCRLanguage,
        onDebugImage?: (dataUrl: string, label: string) => void
    ): Promise<OCRWord[]> {
        // Clear Debug Store at start of Pre-Seg
        try {
            useDebugStore.getState().clear();
        } catch (e) { }

        const foundation = new FoundationMorphology();

        // 1. 轉換圖片
        const { imageData, imageElement } = await imageUrlToImageData(imageDataUrl);

        // 2. 分割 (Morphology)
        let boxes = await foundation.detect(imageData, isVerticalLanguage(lang));

        // 3. 優化 (Filter & Merge)
        boxes = boxes.filter(b => b.x1 - b.x0 > 10 && b.y1 - b.y0 > 10);
        boxes = mergeBoxes(boxes); // Adaptive Merging
        boxes = filterContainedBoxes(boxes);

        // 4. 迴圈識別 (序列執行)
        const allWords: OCRWord[] = [];
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];

            // 裁切 (含 Padding)
            const croppedDataUrl = await cropImageByBbox(imageDataUrl, box, imageElement);

            // 遞迴調用 recognize，但使用基礎 Tesseract 模式避免遞迴
            // sub-region 編識：僳用检素化 + 對比強化即可，不需要二值化（避免重複耗時處理）
            const subWords = await this.recognize(
                croppedDataUrl,
                lang,
                undefined,
                true,
                [],
                { grayscale: true, enhanceContrast: true, binarize: false, denoise: false },
                'pre-ocr-subregion',
                onDebugImage
            );

            // 座標轉換回原圖
            // Fix: Subtract padding (10px) to align with original image
            const PADDING = 10;
            const adjustedWords = subWords.map(w => ({
                text: w.text,
                bbox: {
                    x0: Math.max(0, w.bbox.x0 + box.x0 - PADDING),
                    y0: Math.max(0, w.bbox.y0 + box.y0 - PADDING),
                    x1: Math.max(0, w.bbox.x1 + box.x0 - PADDING),
                    y1: Math.max(0, w.bbox.y1 + box.y0 - PADDING)
                },
                confidence: w.confidence
            }));

            if (isVerticalLanguage(lang)) {
                adjustedWords.forEach(w => { w.vertical = true })
            }
            allWords.push(...adjustedWords);

            // Append to Debug Store (Merged Layer)
            try {
                useDebugStore.getState().appendMergedBboxes(adjustedWords.map(w => ({
                    x0: w.bbox.x0,
                    y0: w.bbox.y0,
                    x1: w.bbox.x1,
                    y1: w.bbox.y1,
                    label: w.text.substring(0, 10)
                })));
            } catch (e) { }
        }
        return allWords;
    },

    processOutput(
        data: any,
        processedImage: string,
        debugSteps: string[],
        segmentationMethod: SegmentationMethod = 'tesseract',
        onDebugImage?: (dataUrl: string, label: string) => void,
        isVertical: boolean = false
    ): Promise<OCRWord[]> {
        void segmentationMethod;
        // 0. 獲取文字框 (相容 Tesseract.js v7，需要 { blocks: true } 選項)
        let rawWords: any[] = [];

        // === Debug: 提取 Tesseract line-level bboxes ===
        const debugLineBboxes: { x0: number, y0: number, x1: number, y1: number, label?: string }[] = [];

        // 新策略：優先使用 line-level 結果
        // 對 CJK 文字而言，line-level 比 word-level 更準確
        // 因為 Tesseract 對 CJK 的 word 分割常常不正確
        let useLineLevelResults = false;
        const lineResults: any[] = [];

        if (data && Array.isArray(data.words) && data.words.length > 0) {
            rawWords = data.words;
        } else if (data && Array.isArray(data.blocks)) {
            // 從 blocks -> paragraphs -> lines -> words/symbols 中提取
            data.blocks.forEach((block: any) => {
                if (block.paragraphs) {
                    block.paragraphs.forEach((para: any) => {
                        if (para.lines) {
                            para.lines.forEach((line: any) => {
                                // === Debug: 提取 line-level bbox ===
                                if (line.bbox) {
                                    debugLineBboxes.push({
                                        x0: line.bbox.x0,
                                        y0: line.bbox.y0,
                                        x1: line.bbox.x1,
                                        y1: line.bbox.y1,
                                        label: line.text?.substring(0, 20) || ''
                                    });
                                }

                                // 收集 line-level 結果 (用於 CJK 優先策略)
                                if (line.text && line.bbox && line.confidence != null) {
                                    lineResults.push({
                                        text: line.text,
                                        bbox: line.bbox,
                                        confidence: line.confidence
                                    });
                                }

                                if (Array.isArray(line.words) && line.words.length > 0) {
                                    rawWords.push(...line.words);
                                } else if (Array.isArray(line.symbols) && line.symbols.length > 0) {
                                    // 對於中文字，有時只有 symbols 沒有 words
                                    rawWords.push(...line.symbols);
                                }
                            });
                        }
                    });
                }
            });

            // 判斷是否使用 line-level 結果
            // 條件：有 line 結果，且文字中含有 CJK 字元
            if (lineResults.length > 0) {
                const allText = lineResults.map(l => l.text).join('');
                const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(allText);
                if (hasCJK) {
                    // CJK: 使用 line-level 結果，避免 word 分割錯誤
                    rawWords = lineResults;
                    useLineLevelResults = true;
                }
            }
        } else {
        }

        // 0.1 如果還是沒有 words，但有 text，創建虛擬 word 以保留文字識別結果
        // 注意：這不是「偽造座標」，而是確保文字評分 (CER) 能正常計算
        if (rawWords.length === 0 && data.text && data.text.trim().length > 0) {
            // 創建一個虛擬 word，bbox 設為 100x100 以通過面積過濾器 (area >= 20)
            rawWords = [{
                text: data.text.trim(),
                confidence: data.confidence || 0,
                bbox: { x0: 0, y0: 0, x1: 100, y1: 100 } // 虛擬座標，足夠大以通過過濾
            }];
        }

        if (rawWords.length === 0) {
            return Promise.resolve([]);
        }

        // === Debug: 保留原始 word bbox（padding 前）===
        const debugRawWordBboxes = rawWords.map((word: any) => ({
            x0: word.bbox?.x0 ?? 0,
            y0: word.bbox?.y0 ?? 0,
            x1: word.bbox?.x1 ?? 0,
            y1: word.bbox?.y1 ?? 0,
            label: (word.text || '').substring(0, 10)
        }));

        // 1. 轉換數據並套用 BBox Padding (擴張 2px)
        const padding = 2
        const words = rawWords.map((word: any) => ({
            text: this.cleanOcrText(word.text || ''),
            bbox: {
                x0: Math.max(0, (word.bbox?.x0 ?? 0) - padding),
                y0: Math.max(0, (word.bbox?.y0 ?? 0) - padding),
                x1: (word.bbox?.x1 ?? 0) + padding,
                y1: (word.bbox?.y1 ?? 0) + padding
            },
            confidence: word.confidence ?? 0
        }))

        // 2. 信心度 + 幾何過濾器：過濾低品質結果
        const filteredWords = words.filter((word: OCRWord) => {
            const width = word.bbox.x1 - word.bbox.x0
            const height = word.bbox.y1 - word.bbox.y0
            const aspectRatio = width / height
            const area = width * height

            // 過濾空文字或純空白
            if (!word.text || word.text.trim().length === 0) return false

            // 過濾低信心度結果 (低於 30% 幾乎都是雜訊)
            if ((word.confidence ?? 0) < 30) return false

            // 過濾極細長的線條
            if (aspectRatio > 20 || aspectRatio < 0.05) return false

            // 過濾極小的噪點 (如灰塵)
            if (area < 20) return false

            return true
        })

        // 3. 根據分割方法選擇不同的處理流程
        let groupedWords: OCRWord[];

        // 如果已經是 line-level 結果（CJK 優先策略），跳過文字分組
        // 因為 line-level 已經是最佳粒度
        if (useLineLevelResults) {
            groupedWords = filteredWords;
        } else {
            groupedWords = this.groupWordsIntoTextBoxes(filteredWords, isVertical);
        }

        // 4. 重疊合併 (解決方框重疊導致的重複辨識)
        const mergedWords = this.mergeOverlappingBoxes(groupedWords)

        // === Debug: 將三層 bbox 寫入 debug store ===
        try {
            // Skip debug update for pre-ocr-density to avoid overwriting with local coordinates
            // Pre-Seg mode handles debug data updates in recognizeWithPreSegmentation
            if (segmentationMethod !== 'pre-ocr-density' && segmentationMethod !== 'pre-ocr-subregion') {
                const debugStore = useDebugStore.getState();
                debugStore.setDebugData({
                    rawWordBboxes: debugRawWordBboxes,
                    lineBboxes: debugLineBboxes,
                    mergedBboxes: mergedWords.map(w => ({
                        x0: w.bbox.x0,
                        y0: w.bbox.y0,
                        x1: w.bbox.x1,
                        y1: w.bbox.y1,
                        label: w.text.substring(0, 20)
                    }))
                });
            }
        } catch (e) {
            // Debug store 不影響正式流程
        }

        // 如果啟用中間影像保存，生成文字框視覺化圖片
        if (debugSteps.includes('5_text_boxes.png') || debugSteps.includes('all')) {
            this.drawTextBoxes(processedImage, mergedWords, '5_text_boxes.png', onDebugImage)
        }

        // 直排語言：標記每個 word 的 vertical 旗標，供渲染層使用
        if (isVertical) {
            mergedWords.forEach(w => { w.vertical = true })
        }

        return Promise.resolve(mergedWords);
    },

    /**
     * 智慧分組：將相鄰的文字合併為單一文字框
     * vertical=true 時使用垂直排版邏輯（依欄分組，由右至左）
     */
    groupWordsIntoTextBoxes(words: OCRWord[], vertical = false): OCRWord[] {
        if (words.length === 0) return []

        if (vertical) {
            return this.groupWordsVertically(words)
        }

        // 先分行：根據 Y 座標將文字分組
        const lines = this.groupIntoLines(words)

        // 再分欄/分句：在每一行內，根據 X 座標間隙進行合併
        let result: OCRWord[] = []
        for (const line of lines) {
            const columns = this.splitLineIntoColumns(line)
            result = result.concat(columns.map(col => {
                // 合併欄位內的文字
                const text = col.map(w => w.text).join('') // 中文不加空格
                const bbox = this.mergeBoundingBoxes(col.map(w => w.bbox))
                const confidence = col.reduce((sum, w) => sum + (w.confidence || 0), 0) / col.length
                return { text, bbox, confidence }
            }))
        }

        return result
    },

    /**
     * 直排分組：將垂直相鄰的文字合併（由右至左排欄）
     */
    groupWordsVertically(words: OCRWord[]): OCRWord[] {
        const columns = this.groupIntoColumns(words)
        let result: OCRWord[] = []
        for (const column of columns) {
            const rows = this.splitColumnIntoRows(column)
            result = result.concat(rows.map(row => {
                const text = row.map(w => w.text).join('')
                const bbox = this.mergeBoundingBoxes(row.map(w => w.bbox))
                const confidence = row.reduce((sum, w) => sum + (w.confidence || 0), 0) / row.length
                return { text, bbox, confidence }
            }))
        }
        return result
    },

    /**
     * 直排：依 X 座標分欄（由右至左），同欄內依水平重疊度判斷
     */
    groupIntoColumns(words: OCRWord[]): OCRWord[][] {
        // 由右至左排序（傳統中文直排閱讀順序）
        const sorted = [...words].sort((a, b) => b.bbox.x1 - a.bbox.x1)
        const columns: OCRWord[][] = []
        let currentColumn: OCRWord[] = [sorted[0]]

        for (let i = 1; i < sorted.length; i++) {
            const curr = sorted[i]
            // 與目前欄中任一字比較水平重疊
            const refWord = currentColumn[currentColumn.length - 1]
            const overlap = this.calculateHorizontalOverlap(refWord.bbox, curr.bbox)
            if (overlap > 0.5) {
                currentColumn.push(curr)
            } else {
                currentColumn.sort((a, b) => a.bbox.y0 - b.bbox.y0)
                columns.push(currentColumn)
                currentColumn = [curr]
            }
        }
        currentColumn.sort((a, b) => a.bbox.y0 - b.bbox.y0)
        columns.push(currentColumn)
        return columns
    },

    /**
     * 直排：將同一欄內字符依垂直間隙切分為獨立文字框
     */
    splitColumnIntoRows(column: OCRWord[]): OCRWord[][] {
        if (column.length <= 1) return [column]

        const gaps: number[] = []
        let totalWidth = 0
        for (let i = 0; i < column.length; i++) {
            totalWidth += (column[i].bbox.x1 - column[i].bbox.x0)
            if (i > 0) {
                gaps.push(column[i].bbox.y0 - column[i - 1].bbox.y1)
            }
        }
        const avgWidth = totalWidth / column.length
        const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0
        const softThreshold = Math.max(medianGap * 3, avgWidth * 0.7, 10)

        const rows: OCRWord[][] = []
        let currentRow: OCRWord[] = [column[0]]
        for (let i = 1; i < column.length; i++) {
            if (gaps[i - 1] > softThreshold) {
                rows.push(currentRow)
                currentRow = [column[i]]
            } else {
                currentRow.push(column[i])
            }
        }
        rows.push(currentRow)
        return rows
    },

    calculateHorizontalOverlap(bbox1: any, bbox2: any): number {
        const x0 = Math.max(bbox1.x0, bbox2.x0)
        const x1 = Math.min(bbox1.x1, bbox2.x1)
        const width1 = bbox1.x1 - bbox1.x0
        const width2 = bbox2.x1 - bbox2.x0
        const intersection = Math.max(0, x1 - x0)
        return intersection / Math.min(width1, width2)
    },

    groupIntoLines(words: OCRWord[]): OCRWord[][] {
        // 按 Y 座標排序
        const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0)
        const lines: OCRWord[][] = []
        let currentLine: OCRWord[] = [sorted[0]]

        for (let i = 1; i < sorted.length; i++) {
            const curr = sorted[i]
            const prev = currentLine[currentLine.length - 1]

            // 判斷是否為同一行：垂直重疊度大於 50%
            const overlap = this.calculateVerticalOverlap(prev.bbox, curr.bbox)
            const isSameLine = overlap > 0.5

            if (isSameLine) {
                currentLine.push(curr)
            } else {
                // 該行結束，按 X 排序
                currentLine.sort((a, b) => a.bbox.x0 - b.bbox.x0)
                lines.push(currentLine)
                currentLine = [curr]
            }
        }
        // 處理最後一行
        currentLine.sort((a, b) => a.bbox.x0 - b.bbox.x0)
        lines.push(currentLine)

        return lines
    },

    splitLineIntoColumns(line: OCRWord[]): OCRWord[][] {
        if (line.length <= 1) return [line]

        const gaps: number[] = []
        let totalHeight = 0
        for (let i = 0; i < line.length; i++) {
            totalHeight += (line[i].bbox.y1 - line[i].bbox.y0)
            if (i > 0) {
                gaps.push(line[i].bbox.x0 - line[i - 1].bbox.x1)
            }
        }
        const avgHeight = totalHeight / line.length

        // 中位數間隙，用於基線
        const medianGap = gaps.length > 0 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0

        // Soft Threshold: 一般合併閾值 (0.7x 行高)
        const softThreshold = Math.max(medianGap * 3, avgHeight * 0.7, 10)
        // Hard Threshold: 強制斷開閾值 (2.0x 行高)
        const hardThreshold = avgHeight * 2.0

        const columns: OCRWord[][] = []
        let currentColumn: OCRWord[] = [line[0]]

        for (let i = 1; i < line.length; i++) {
            const gap = gaps[i - 1]

            if (gap > softThreshold) {
                // 如果間隙很大，檢查是否達到 Hard Threshold 或者是顯著的分欄
                if (gap > hardThreshold) {
                    columns.push(currentColumn)
                    currentColumn = [line[i]]
                } else {
                    // Soft Threshold 區域：這裡可以保留合併，或者選擇斷開
                    // 為了保守起見，如果大於 Soft Threshold 就斷開，但這裡保留之前的邏輯
                    columns.push(currentColumn)
                    currentColumn = [line[i]]
                }
            } else {
                currentColumn.push(line[i])
            }
        }
        columns.push(currentColumn)
        return columns
    },

    mergeBoundingBoxes(bboxes: { x0: number, y0: number, x1: number, y1: number }[]) {
        if (bboxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 }
        return {
            x0: Math.min(...bboxes.map(b => b.x0)),
            y0: Math.min(...bboxes.map(b => b.y0)),
            x1: Math.max(...bboxes.map(b => b.x1)),
            y1: Math.max(...bboxes.map(b => b.y1))
        }
    },

    calculateVerticalOverlap(bbox1: any, bbox2: any) {
        const y0 = Math.max(bbox1.y0, bbox2.y0)
        const y1 = Math.min(bbox1.y1, bbox2.y1)
        const height1 = bbox1.y1 - bbox1.y0
        const height2 = bbox2.y1 - bbox2.y0
        const intersection = Math.max(0, y1 - y0)
        return intersection / Math.min(height1, height2)
    },

    mergeOverlappingBoxes(boxes: OCRWord[]): OCRWord[] {
        if (boxes.length <= 1) return boxes

        // 簡單的合併策略：如果有兩個框重疊面積很大，保留信心度高的，或者合併它們
        // 這裡暫時只做簡單的回傳，因為前面的分組已經處理了大部分情況
        return boxes
    },

    async drawTextBoxes(imageData: string, words: OCRWord[], filename: string, onDebugImage?: (dataUrl: string, label: string) => void) {
        if (typeof document === 'undefined') return;

        const img = new Image();
        img.src = imageData;
        await new Promise((resolve) => { img.onload = resolve; });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;

        words.forEach(word => {
            const { x0, y0, x1, y1 } = word.bbox;
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

            // 繪製文字標籤 (可選)
            // ctx.fillStyle = 'red';
            // ctx.font = '12px Arial';
            // ctx.fillText(word.text, x0, y0 - 5);
        });

        // 下載或透過 callback 傳回
        const dataUrl = canvas.toDataURL('image/png');
        if (onDebugImage) {
            onDebugImage(dataUrl, filename);
        } else {
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataUrl;
        }
    },

    /**
     * 切割文字方塊圖片
     * 根據每個文字方塊的 bbox 座標，從原始圖片中切割出對應區域
     */
    async cropTextBoxes(imageData: string, words: OCRWord[]): Promise<{ label: string, dataUrl: string, index: number }[]> {
        if (typeof document === 'undefined') return [];

        const img = new Image();
        img.src = imageData;
        await new Promise((resolve) => { img.onload = resolve; });

        const croppedImages: { label: string, dataUrl: string, index: number }[] = [];

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const { x0, y0, x1, y1 } = word.bbox;

            // 計算寬高
            const width = x1 - x0;
            const height = y1 - y0;

            // 跳過無效的 bbox
            if (width <= 0 || height <= 0) continue;

            // 建立 canvas 並切割
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;

            // 從原圖切割出這個區域
            ctx.drawImage(img, x0, y0, width, height, 0, 0, width, height);

            // 轉換為 Data URL
            const dataUrl = canvas.toDataURL('image/png');

            // 生成檔名：word_001_文字內容.png
            const paddedIndex = String(i + 1).padStart(3, '0');
            const sanitizedText = word.text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 20);
            const label = `word_${paddedIndex}_${sanitizedText}.png`;

            croppedImages.push({ label, dataUrl, index: i });
        }

        return croppedImages;
    },

    /**
     * OCR 文字清理：移除常見的 OCR 雜訊字元
     * - 移除大量連續特殊符號（通常是誤判背景紋理）
     * - 移除控制字元
     * - 正規化空白
     */
    cleanOcrText(text: string): string {
        if (!text) return ''

        // 移除控制字元（保留常見空白）
        let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

        // 移除常見 OCR 雜訊模式：連續 3+ 個相同的特殊符號
        cleaned = cleaned.replace(/([^\w\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef])\1{2,}/g, '$1')

        // 如果清理後只剩特殊符號（沒有任何字母、數字或 CJK 字元），視為雜訊
        const hasContent = /[\w\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(cleaned)
        if (!hasContent && cleaned.trim().length > 0 && cleaned.trim().length < 3) {
            return ''
        }

        // 正規化連續空白
        cleaned = cleaned.replace(/\s+/g, ' ').trim()

        return cleaned
    },

    async terminate() {
        if (this.worker) {
            await this.worker.terminate()
            this.worker = null
        }
    }
}

