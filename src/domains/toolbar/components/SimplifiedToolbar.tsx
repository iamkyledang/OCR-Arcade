import React, { useState, useEffect, useCallback } from 'react';

import type { SimplifiedToolbarProps } from './types';
import { useViewportWidth } from './ResponsiveContainer';
import { OCRButton } from './OCRButton';
import { ExportButton } from './ExportButton';
import { ArcadeLogo } from '@/shared/components/ArcadeLogo';

import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { LanguageToggle } from '@/shared/components/LanguageToggle';
import { MobileHeaderMenu } from '@/shared/components/MobileHeaderMenu';
import { useStore } from '@/shared/store/useStore';
import { useToastStore } from '@/shared/store/feedbackStore';
import { exportToPPTX, exportToPNG } from '@/domains/export/services/pptx';
import { Undo, Redo } from 'lucide-react';
import { useOcrRunner } from '@/domains/ocr/hooks/useOcrRunner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';



export const SimplifiedToolbar: React.FC<SimplifiedToolbarProps> = ({
  className = '',
  variant = 'default'
}) => {
  const { t } = useTranslation();
  const { currentBreakpoint, isDesktop, isTablet, isMobile } = useViewportWidth();

  // Store state
  const {
    pages,
    currentPageIndex,
    canvasStates,
    undo,
    redo,
    canUndo,
    canRedo,
    ocrLanguage,
    setOcrLanguage,
    ocrSegmentation,
    setOcrSegmentation,
    ocrStatus,
    ocrProgress,
    ocrHasTriggered,
    ocrPromptDismissed,
  } = useStore();

  const { addToast } = useToastStore();

  const { startOcr } = useOcrRunner()

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  // Settings state


  // Determine the effective variant based on responsive state
  const effectiveVariant = variant === 'default'
    ? (isMobile ? 'minimal' : isTablet ? 'compact' : 'default')
    : variant;

  const showOcrAttention = ocrPromptDismissed && !ocrHasTriggered

  // Handle Export
  const handleExport = useCallback(async (format: 'pptx-editable' | 'pptx-image' | 'png') => {
    if (pages.length === 0) {
      addToast(t('toasts.nothingToExport'), 'info');
      return;
    }

    try {
      setIsExporting(true);
      addToast(t('toasts.startExport'), 'info');

      // Ensure latest canvas edits are saved before export
      window.dispatchEvent(new Event('canvas:saveCurrentPage'));
      const latestState = useStore.getState();

      if (format === 'png') {
        // Export current page as PNG with Canvas rendering (includes user edits)
        const currentPage = latestState.pages[latestState.currentPageIndex];
        const currentState = latestState.canvasStates[latestState.currentPageIndex];
        await exportToPNG(
          currentPage,
          currentState,
          t('exportFile.pageName', { index: latestState.currentPageIndex + 1 })
        );
        addToast(t('toasts.pngExportSuccess'), 'success');
      } else {
        // Export as PPTX
        const mode = format === 'pptx-editable' ? 'editable' : 'image';
        await exportToPPTX({
          pages: latestState.pages,
          canvasStates: latestState.canvasStates,
          mode
        });
        addToast(t('toasts.pptxExportSuccess'), 'success');
      }
    } catch (error) {
      addToast(t('toasts.exportFail'), 'error');
    } finally {
      setIsExporting(false);
    }
  }, [pages, currentPageIndex, canvasStates, addToast, t]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) {
          return
        }
      }
      // Undo: Cmd/Ctrl + Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
          window.dispatchEvent(new Event('canvas:reloadCurrentPage'));
        }
      }
      // Redo: Cmd/Ctrl + Shift + Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (canRedo()) {
          redo();
          window.dispatchEvent(new Event('canvas:reloadCurrentPage'));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  return (
    <div
      className={`h-14 px-4 flex items-center justify-between gap-4 transition-all duration-300 ${className}`}
      data-testid="simplified-toolbar"
      data-breakpoint={currentBreakpoint}
      data-variant={effectiveVariant}
    >
      {/* Left Section - Branding & Actions */}
      <div className="flex items-center gap-4 flex-1">
        {isDesktop && (
          <div className="mr-4">
            <ArcadeLogo linkTo="/" />
          </div>
        )}

        <div className={cn(
          "flex items-center gap-1 bg-card shrink-0",
          isMobile
            ? "p-0.5 rounded-md border border-slate-200 dark:border-white/10"
            : "p-1 border-2 border-border shadow-[3px_3px_0_rgba(2,6,23,0.45)]"
        )}>
          <button
            onClick={() => {
              undo();
              window.dispatchEvent(new Event('canvas:reloadCurrentPage'));
            }}
            disabled={!canUndo()}
            className={`p-2 transition-all ${canUndo()
              ? 'text-slate-700 dark:text-slate-200 hover:bg-primary/15 hover:text-slate-900 dark:hover:text-white cursor-pointer active:translate-y-[1px]'
              : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
              }`}
            title={t('toolbar.undo')}
          >
            <Undo size={18} strokeWidth={2} />
          </button>
          <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
          <button
            onClick={() => {
              redo();
              window.dispatchEvent(new Event('canvas:reloadCurrentPage'));
            }}
            disabled={!canRedo()}
            className={`p-2 transition-all ${canRedo()
              ? 'text-slate-700 dark:text-slate-200 hover:bg-primary/15 hover:text-slate-900 dark:hover:text-white cursor-pointer active:translate-y-[1px]'
              : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
              }`}
            title={t('toolbar.redo')}
          >
            <Redo size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="h-8 w-px bg-slate-200 dark:bg-white/10 hidden md:block" />

        <div className={`ocr-button-container ${showOcrAttention ? 'ocr-button-attention' : ''}`}>
          <OCRButton
            onOCRStart={startOcr}
            status={ocrStatus}
            progress={ocrProgress}
            compact={!isDesktop}
            selectedLanguage={ocrLanguage}
            onLanguageChange={(lang) => setOcrLanguage(lang)}
            selectedSegmentation={ocrSegmentation}
            onSegmentationChange={(seg) => setOcrSegmentation(seg)}
          />
        </div>
      </div>

      {/* Center Section - Navigation */}
      <div className={cn("flex items-center justify-center", !isMobile && "min-w-[200px]")}>
        {pages.length > 0 && (
          <div className={cn(
            "flex items-center",
            isMobile
              ? "px-3 py-1 bg-slate-100 dark:bg-white/10 rounded-full gap-1 border border-slate-200 dark:border-white/5"
              : "px-4 py-1.5 bg-card border-2 border-border gap-3 shadow-[3px_3px_0_rgba(2,6,23,0.45)]"
          )}>
            {!isMobile && <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-widest">{t('toolbar.page')}</span>}
            <span className={cn("font-semibold text-slate-900 dark:text-white whitespace-nowrap shrink-0", isMobile ? "text-xs font-mono" : "text-sm")}>
              {currentPageIndex + 1} <span className="text-slate-400 dark:text-slate-600 mx-1">/</span> {pages.length}
            </span>
          </div>
        )}
      </div>

      {/* Right Section - Output & Settings */}
      <div className="flex items-center justify-end gap-3 flex-1">
        {/* Desktop / Tablet Export Button */}
        <div className="hidden sm:block">
          <ExportButton
            onExport={handleExport}
            isExporting={isExporting}
            compact={!isDesktop}
          />
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
          <ThemeToggle />
          <LanguageToggle variant="compact" />
        </div>

        {/* Mobile Menu Action (hidden on desktop) */}
        <MobileHeaderMenu>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('toolbar.export')}</span>
            <ExportButton
              onExport={handleExport}
              isExporting={isExporting}
              compact={true}
            />
          </div>
        </MobileHeaderMenu>
      </div>
    </div>
  );
};
