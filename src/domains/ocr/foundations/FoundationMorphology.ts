import type { IOcrFoundation, BBox } from './types';

/**
 * Foundation A: 純視覺膨脹 (Morphological Dilation)
 *
 * 原理：
 * 忽略文字內容，直接對二值化圖像進行數學形態學「膨脹」操作。
 * 這會讓相鄰的文字筆畫黏合在一起，形成大的連通區域。
 * 最後偵測這些連通區域的邊界框 (Bounding Box)。
 *
 * 優點：對任何語言通用，不依賴 OCR 引擎。
 * 缺點：對參數（膨脹核大小）敏感，容易把不同行的字黏在一起。
 */
export class FoundationMorphology implements IOcrFoundation {
    name = "Morphological Dilation";
    description = "Smears text pixels together to form blocks using morphological operations.";

    async detect(imageData: ImageData, vertical = false): Promise<BBox[]> {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        // 1. 二值化 (Binarization)
        // 使用 Otsu's 方法自動確定閾值，而非固定 128
        const binaryMap = new Uint8Array(width * height);
        const threshold = this.otsuThreshold(data, width * height);

        for (let i = 0; i < width * height; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            binaryMap[i] = gray < threshold ? 1 : 0; // 1 = Foreground (Text)
        }

        // 2. 膨脹 (Dilation)
        // 根據圖片解析度自適應核大小
        // 標準公式: kernelSize 正比於解析度，除以一個基準值
        const baseResolution = 1000; // 基準解析度
        const scaleFactor = Math.max(width, height) / baseResolution;
        // 直排模式：kX 窄（不跨欄）、kY 寬（連接同欄文字）
        // 橫排模式：kX 寬（連接同行文字）、kY 窄（不跨行）
        const kernelX = vertical
            ? Math.max(2, Math.min(6, Math.round(2 * scaleFactor)))   // 直排：窄水平
            : Math.max(5, Math.min(20, Math.round(8 * scaleFactor)));  // 橫排：寬水平
        const kernelY = vertical
            ? Math.max(5, Math.min(20, Math.round(8 * scaleFactor)))   // 直排：寬垂直
            : Math.max(2, Math.min(6, Math.round(2 * scaleFactor)));   // 橫排：窄垂直

        const dilatedMap = this.dilate(binaryMap, width, height, kernelX, kernelY);

        // 3. 連通區域分析 (CCA) 找 BBox
        const boxes = this.findConnectedComponents(dilatedMap, width, height);

        return boxes;
    }

    private dilate(input: Uint8Array, width: number, height: number, kX: number, kY: number): Uint8Array {
        const output = new Uint8Array(input.length);

        // 簡化版膨脹：只要核內有一個 1，中心就是 1
        // 這裡用分離卷積思路加速：先水平擴張，再垂直擴張

        const temp = new Uint8Array(input.length);

        // Horizontal Pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (input[y * width + x] === 1) {
                    const start = Math.max(0, x - kX);
                    const end = Math.min(width - 1, x + kX);
                    for (let k = start; k <= end; k++) {
                        temp[y * width + k] = 1;
                    }
                }
            }
        }

        // Vertical Pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (temp[y * width + x] === 1) {
                    const start = Math.max(0, y - kY);
                    const end = Math.min(height - 1, y + kY);
                    for (let k = start; k <= end; k++) {
                        output[k * width + x] = 1;
                    }
                }
            }
        }

        return output;
    }

    private findConnectedComponents(map: Uint8Array, width: number, height: number): BBox[] {
        const visited = new Uint8Array(map.length);
        const boxes: BBox[] = [];

        const stack: number[] = [];

        for (let i = 0; i < map.length; i++) {
            if (map[i] === 1 && visited[i] === 0) {
                // Found a new component
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

                    // Check 4-neighbors
                    const neighbors = [
                        idx - 1, // Left
                        idx + 1, // Right
                        idx - width, // Up
                        idx + width // Down
                    ];

                    for (const n of neighbors) {
                        if (n >= 0 && n < map.length && map[n] === 1 && visited[n] === 0) {
                            // Boundary checks for left/right wrapping
                            if (Math.abs((n % width) - cx) > 1) continue;

                            visited[n] = 1;
                            stack.push(n);
                        }
                    }
                }

                // Filter tiny noise
                if (maxX - minX > 5 && maxY - minY > 5) {
                    boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
                }
            }
        }

        return boxes;
    }

    /**
     * Otsu's Method: 自動計算最佳二值化閾值
     * 找到使前景和背景的類間方差最大化的閾值
     */
    private otsuThreshold(data: Uint8ClampedArray, pixelCount: number): number {
        // 建立灰度直方圖
        const histogram = new Array(256).fill(0);
        for (let i = 0; i < pixelCount; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            histogram[gray]++;
        }

        let sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += i * histogram[i];
        }

        let sumB = 0;
        let wB = 0;
        let wF = 0;
        let maxVariance = 0;
        let threshold = 128; // fallback

        for (let t = 0; t < 256; t++) {
            wB += histogram[t];
            if (wB === 0) continue;

            wF = pixelCount - wB;
            if (wF === 0) break;

            sumB += t * histogram[t];

            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;

            const variance = wB * wF * (mB - mF) * (mB - mF);

            if (variance > maxVariance) {
                maxVariance = variance;
                threshold = t;
            }
        }

        return threshold;
    }
}
