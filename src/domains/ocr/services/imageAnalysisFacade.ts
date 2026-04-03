import { ImageAnalyzer } from './imageAnalyzer';
import { ocrServiceManager } from './OCRServiceManager';
import type { OCRWord, OCRLanguage, SegmentationMethod } from './ocr';


export class ImageAnalysisFacade {
    private analyzer: ImageAnalyzer;

    constructor() {
        this.analyzer = new ImageAnalyzer();
    }

    public async processImage(imageDataUrl: string, language: OCRLanguage = 'chi_tra', segmentation: SegmentationMethod = 'pre-ocr-ai'): Promise<OCRWord[]> {
        // const store = useStore.getState();

        // Convert Data URL to ImageData for analysis
        const imageData = await this.loadImageData(imageDataUrl);

        // Use analyzer for pre-OCR analysis
        await this.analyzer.analyze(imageData);

        // Use the managed OCR service for optimal performance
        try {
            ocrServiceManager.updateConfig({ language });
            const result = await ocrServiceManager.processImage(imageDataUrl, segmentation);
            return result.words;
        } catch (error) {
            throw error; // Propagate error directly without fallback
        }
    }

    private async loadImageData(src: string): Promise<ImageData> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, img.width, img.height));
            };
            img.onerror = reject;
            img.src = src;
        });
    }



    /**
     * Get the current OCR service status for debugging
     */
    public async getServiceStatus(): Promise<{
        integrationServiceReady: boolean;
        availableEngines: string[];
    }> {
        try {
            const serviceInfo = await ocrServiceManager.getServiceInfo();
            return {
                integrationServiceReady: serviceInfo.ready,
                availableEngines: ['tesseract']
            };
        } catch (error) {
            return {
                integrationServiceReady: false,
                availableEngines: ['tesseract']
            };
        }
    }

    /**
     * Dispose of all services and clean up resources
     * Note: This should only be called on app shutdown
     */
    public async dispose(): Promise<void> {
        try {
            // Don't dispose the service manager here as it's a singleton
            // Only dispose on app shutdown
        } catch (error) {
        }
    }
}

export const imageAnalysisService = new ImageAnalysisFacade();
