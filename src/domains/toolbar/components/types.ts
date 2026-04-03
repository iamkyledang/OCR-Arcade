import type { OCRLanguage, SegmentationMethod } from '@/domains/ocr/services/ocr';

// Core interfaces for SimplifiedToolbar component system

export interface ToolbarState {
  // Layout state
  isCompact: boolean;
  showOverflowMenu: boolean;

  // OCR state
  ocrStatus: 'idle' | 'processing' | 'completed' | 'error';
  ocrProgress: number;
  lastOCRResult?: OCRResult;



  // Export state
  exportMenuOpen: boolean;
  isExporting: boolean;
  exportFormat?: ExportFormat;
}

export interface OCRResult {
  totalRegions: number;
  processingTime: number;
  confidence: number;
  language: string;
  engine: string;
  timestamp: Date;
}



export type ExportFormat = 'pptx-editable' | 'pptx-image' | 'png';

// Component prop interfaces

export interface SimplifiedToolbarProps {
  className?: string;
  variant?: 'default' | 'compact' | 'minimal';
}

export interface OCRButtonProps {
  onOCRStart: () => void;
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress?: number;
  compact?: boolean;
  selectedLanguage?: OCRLanguage;
  onLanguageChange?: (language: OCRLanguage) => void;
  selectedSegmentation?: SegmentationMethod;
  onSegmentationChange?: (seg: SegmentationMethod) => void;
}



export interface ExportButtonProps {
  onExport: (format: ExportFormat) => void;
  isExporting: boolean;
  compact?: boolean;
}

export interface ResponsiveContainerProps {
  children: React.ReactNode;
  breakpoint: 'desktop' | 'tablet' | 'mobile';
  fallback?: React.ReactNode;
}

// Responsive breakpoint type
export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

