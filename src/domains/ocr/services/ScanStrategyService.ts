import { ocrService, type OCRWord, type OCRLanguage } from './ocr';

export type OCRStrategy = 'tesseract_morph';

export interface OCRProcessingResult {
    words: OCRWord[];
    processingTime: number;
    engineUsed: 'tesseract';
    executionProvider: 'wasm';
}

/**
 * Service to handle advanced OCR strategies using segmentation logic
 */
export class ScanStrategyService {
    /**
     * Executes the OCR process based on the selected strategy.
     */
    public async execute(
        _strategy: OCRStrategy,
        imageDataUrl: string,
        lang: OCRLanguage = 'chi_tra'
    ): Promise<OCRProcessingResult> {
        const startTime = performance.now();

        const allWords = await ocrService.recognize(
            imageDataUrl,
            lang,
            undefined,
            true,
            [],
            undefined,
            'tesseract'
        );

        const endTime = performance.now();
        const processingTime = endTime - startTime;

        // Construct result compatible with OCRProcessingResult
        return {
            words: allWords,
            processingTime: processingTime,
            engineUsed: 'tesseract',
            executionProvider: 'wasm'
        };
    }
}

export const scanStrategyService = new ScanStrategyService();
