// 使用完整 onnxruntime-web（支援 HardSigmoid 的 WASM backend）。
// JSEP (WebGPU) 嘗試載入時會得到 404，ort 內部 try/catch 會靜默略過，不影響 WASM 執行。
import * as ort from 'onnxruntime-web';
import type { IOcrFoundation, BBox } from './types';

const modelUrl = `${import.meta.env.BASE_URL}assets/models/det.onnx`;

ort.env.wasm.wasmPaths = import.meta.env.BASE_URL;
ort.env.wasm.numThreads = 1;

export class FoundationAI implements IOcrFoundation {
    name = "Deep Learning DBNet";
    description = "Uses an ONNX Text Detection model (DBNet) to precisely extract text bounding boxes using CPU (WASM).";

    private session: ort.InferenceSession | null = null;

    async initSession() {
        if (!this.session) {
            this.session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm']
            });
            console.log('ONNX Session initialized with WASM!');
        }
    }

    async detect(imageData: ImageData, _vertical = false): Promise<BBox[]> {
        await this.initSession();
        if (!this.session) throw new Error("ONNX model failed to initialize");

        const targetSize = 2500;
        let scale = 1.0;
        let pHeight = imageData.height;
        let pWidth = imageData.width;

        if (Math.max(pHeight, pWidth) > targetSize) {
            scale = targetSize / Math.max(pHeight, pWidth);
        }

        const newWidth = Math.round(pWidth * scale / 32) * 32;
        const newHeight = Math.round(pHeight * scale / 32) * 32;

        const floatData = this.preprocess(imageData, newWidth, newHeight);

        const inputName = this.session.inputNames[0];
        const tensor = new ort.Tensor('float32', floatData, [1, 3, newHeight, newWidth]);

        const feeds: Record<string, ort.Tensor> = {};
        feeds[inputName] = tensor;

        const results = await this.session.run(feeds);

        const outputName = this.session.outputNames[0];
        const outputTensor = results[outputName];
        const mask = outputTensor.data as Float32Array;

        // Debug: 全圖 heatmap 最大值
        let maxVal = 0;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] > maxVal) maxVal = mask[i];
        }
        console.log(`[DBNet] heatmap max: ${maxVal.toFixed(4)}, total pixels: ${mask.length}`);

        const boxes = this.findBoxesFromHeatmap(mask, newWidth, newHeight);
        console.log(`[DBNet] boxes found: ${boxes.length}`);

        const expandRatio = 1.1; // cropImageByBbox 已有 10px padding，1.1 已足夠
        const scaledBoxes = boxes.map(b => {
            const bxWidth = b.x1 - b.x0;
            const bxHeight = b.y1 - b.y0;
            const dx = Math.round(bxWidth * (expandRatio - 1.0) / 2);
            const dy = Math.round(bxHeight * (expandRatio - 1.0) / 2);

            return {
                x0: Math.max(0, Math.floor((b.x0 - dx) / (newWidth / pWidth))),
                y0: Math.max(0, Math.floor((b.y0 - dy) / (newHeight / pHeight))),
                x1: Math.min(pWidth, Math.ceil((b.x1 + dx) / (newWidth / pWidth))),
                y1: Math.min(pHeight, Math.ceil((b.y1 + dy) / (newHeight / pHeight)))
            };
        });

        return scaledBoxes;
    }

    private preprocess(imageData: ImageData, tWidth: number, tHeight: number): Float32Array {
        const tensorData = new Float32Array(3 * tWidth * tHeight);

        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(imageData, 0, 0);

        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = tWidth;
        scaledCanvas.height = tHeight;
        const sCtx = scaledCanvas.getContext('2d')!;

        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = 'high';
        sCtx.drawImage(canvas, 0, 0, tWidth, tHeight);

        const newImgData = sCtx.getImageData(0, 0, tWidth, tHeight);
        const data = newImgData.data;

        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];
        const csize = tHeight * tWidth;

        for (let y = 0; y < tHeight; y++) {
            for (let x = 0; x < tWidth; x++) {
                const idx = (y * tWidth + x) * 4;
                const r = data[idx] / 255.0;
                const g = data[idx + 1] / 255.0;
                const b = data[idx + 2] / 255.0;

                tensorData[y * tWidth + x] = (r - mean[0]) / std[0];
                tensorData[csize + y * tWidth + x] = (g - mean[1]) / std[1];
                tensorData[csize * 2 + y * tWidth + x] = (b - mean[2]) / std[2];
            }
        }
        return tensorData;
    }

    private findBoxesFromHeatmap(heatmap: Float32Array, width: number, height: number): BBox[] {
        const threshold = 0.2;
        const binaryMap = new Uint8Array(width * height);

        for (let i = 0; i < heatmap.length; i++) {
            if (heatmap[i] > threshold) {
                binaryMap[i] = 1;
            }
        }

        const visited = new Uint8Array(binaryMap.length);
        const boxes: BBox[] = [];
        const stack: number[] = [];

        for (let i = 0; i < binaryMap.length; i++) {
            if (binaryMap[i] === 1 && visited[i] === 0) {
                let minX = width, maxX = 0, minY = height, maxY = 0;

                stack.push(i);
                visited[i] = 1;

                while (stack.length > 0) {
                    const idx = stack.pop()!;
                    const cx = idx % width;
                    const cy = Math.floor(idx / width);

                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;

                    const neighbors = [
                        idx - 1, idx + 1, idx - width, idx + width
                    ];

                    for (const n of neighbors) {
                        if (n >= 0 && n < binaryMap.length && binaryMap[n] === 1 && visited[n] === 0) {
                            if (Math.abs((n % width) - cx) > 1) continue;
                            visited[n] = 1;
                            stack.push(n);
                        }
                    }
                }

                const bw = maxX - minX;
                const bh = maxY - minY;
                // 過濾極端長寬比（純線條、噪點），高度至少 8px
                if (bw > 1 && bh > 1 && bh >= 8 && (bw / bh) < 40 && (bh / bw) < 40) {
                    boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
                }
            }
        }

        return boxes;
    }
}
