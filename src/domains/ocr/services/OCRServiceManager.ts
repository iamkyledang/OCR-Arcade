/**
 * OCR Service Manager
 * 
 * Global singleton to manage OCR service initialization and prevent
 * duplicate initialization in React Strict Mode or multiple components.
 */

import { ocrService } from './ocr';
import type { OCRLanguage, SegmentationMethod } from './ocr';
import { logger } from '@/shared/lib/Logger';

export type OCRServiceStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface OCRServiceState {
  status: OCRServiceStatus;
  error?: string;
  initializationPromise?: Promise<void>;
}

class OCRServiceManager {
  private state: OCRServiceState = { status: 'idle' };
  private listeners: Set<(state: OCRServiceState) => void> = new Set();
  private language: OCRLanguage = 'chi_tra';

  /**
   * Get current service state
   */
  getState(): OCRServiceState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: OCRServiceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Update state and notify listeners
   */
  private setState(newState: Partial<OCRServiceState>) {
    this.state = { ...this.state, ...newState };
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Initialize OCR service (singleton pattern)
   */
  async initialize(): Promise<void> {
    // If already ready, return immediately
    if (this.state.status === 'ready') {
      logger.info('OCRServiceManager', 'Service already ready');
      return;
    }

    // If currently initializing, return the existing promise
    if (this.state.status === 'initializing' && this.state.initializationPromise) {
      logger.info('OCRServiceManager', 'Initialization already in progress, waiting...');
      return this.state.initializationPromise;
    }

    // Start new initialization
    logger.info('OCRServiceManager', 'Starting OCR service initialization...');
    this.setState({ status: 'initializing', error: undefined });

    const initPromise = this._performInitialization();
    this.setState({ initializationPromise: initPromise });

    try {
      await initPromise;
      this.setState({
        status: 'ready',
        error: undefined,
        initializationPromise: undefined
      });
      logger.info('OCRServiceManager', '✓ OCR service initialization completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setState({
        status: 'error',
        error: errorMessage,
        initializationPromise: undefined
      });
      logger.error('OCRServiceManager', 'OCR service initialization failed:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Internal initialization logic
   */
  private async _performInitialization(): Promise<void> {
    await ocrService.init(this.language);
  }

  /**
   * Get service status information
   */
  async getServiceInfo() {
    if (this.state.status !== 'ready') {
      return {
        ready: false
      };
    }

    return {
      ready: true
    };
  }

  /**
   * Process image using the managed service
   */
  async processImage(imageDataUrl: string, segmentation: SegmentationMethod = 'pre-ocr-ai') {
    if (this.state.status !== 'ready') {
      await this.initialize();
    }

    const startTime = performance.now();
    const words = await ocrService.recognize(
      imageDataUrl,
      this.language,
      undefined,
      true,
      [],
      undefined,
      segmentation
    );
    const processingTime = performance.now() - startTime;

    return {
      words,
      processingTime,
      engineUsed: 'pre-ocr-ai' as const,
      executionProvider: 'webgl-wasm-fallback' as const
    };
  }

  /**
   * Update service configuration
   */
  updateConfig(config: { language?: OCRLanguage }) {
    if (config.language) {
      this.language = config.language;
      if (this.state.status === 'ready') {
        // Re-init worker with new language if already initialized
        ocrService.init(this.language).catch((error) => {
          logger.error('OCRServiceManager', 'Failed to re-init worker for new language:', error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }

  /**
   * Dispose of resources (only call on app shutdown)
   */
  async dispose(): Promise<void> {
    logger.info('OCRServiceManager', 'Disposing OCR service manager...');

    try {
      await ocrService.terminate();
      this.setState({ status: 'idle', error: undefined, initializationPromise: undefined });
      this.listeners.clear();
      logger.info('OCRServiceManager', '✓ OCR service manager disposed');
    } catch (error) {
      logger.error('OCRServiceManager', 'Error disposing OCR service manager:', error instanceof Error ? error : new Error(String(error)));
    }
  }
}

// Export singleton instance
export const ocrServiceManager = new OCRServiceManager();

