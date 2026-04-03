import React, { useMemo, useState } from 'react';
import type { OCRButtonProps } from './types';
import type { OCRLanguage, SegmentationMethod } from '@/domains/ocr/services/ocr';
import { ScanText, Loader2, CheckCircle2, AlertCircle, ChevronDown, Check, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { useTranslation } from 'react-i18next';

/**
 * OCRButton - Split button with main action and strategy selector
 */
export const OCRButton: React.FC<OCRButtonProps> = ({
  onOCRStart,
  status,
  progress = 0,
  compact = false,
  selectedLanguage = 'chi_tra',
  onLanguageChange,
  selectedSegmentation = 'pre-ocr-ai',
  onSegmentationChange
}) => {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const segmentationOptions: Array<{ value: SegmentationMethod; label: string; desc: string }> = [
    { value: 'pre-ocr-ai',      label: t('ocr.engineAI'),    desc: t('ocr.engineAIDesc') },
    { value: 'tesseract',       label: t('ocr.engineFast'),  desc: t('ocr.engineFastDesc') },
    { value: 'pre-ocr-density', label: t('ocr.engineMorph'), desc: t('ocr.engineMorphDesc') },
  ];
  const languageOptions = useMemo<Array<{ value: OCRLanguage; short: string; label: string }>>(() => ([
    { value: 'chi_tra', short: t('ocr.languageShort.chi_tra'), label: t('ocr.languageLabel.chi_tra') },
    { value: 'chi_sim', short: t('ocr.languageShort.chi_sim'), label: t('ocr.languageLabel.chi_sim') },
    { value: 'chi_tra_vert', short: t('ocr.languageShort.chi_tra_vert'), label: t('ocr.languageLabel.chi_tra_vert') },
    { value: 'chi_sim_vert', short: t('ocr.languageShort.chi_sim_vert'), label: t('ocr.languageLabel.chi_sim_vert') },
    { value: 'eng', short: t('ocr.languageShort.eng'), label: t('ocr.languageLabel.eng') },
    { value: 'jpn', short: t('ocr.languageShort.jpn'), label: t('ocr.languageLabel.jpn') },
    { value: 'kor', short: t('ocr.languageShort.kor'), label: t('ocr.languageLabel.kor') },
    { value: 'fra', short: t('ocr.languageShort.fra'), label: t('ocr.languageLabel.fra') },
    { value: 'deu', short: t('ocr.languageShort.deu'), label: t('ocr.languageLabel.deu') },
    { value: 'spa', short: t('ocr.languageShort.spa'), label: t('ocr.languageLabel.spa') },
    { value: 'ita', short: t('ocr.languageShort.ita'), label: t('ocr.languageLabel.ita') },
    { value: 'por', short: t('ocr.languageShort.por'), label: t('ocr.languageLabel.por') },
    { value: 'rus', short: t('ocr.languageShort.rus'), label: t('ocr.languageLabel.rus') },
    { value: 'ara', short: t('ocr.languageShort.ara'), label: t('ocr.languageLabel.ara') },
    { value: 'tha', short: t('ocr.languageShort.tha'), label: t('ocr.languageLabel.tha') },
    { value: 'vie', short: t('ocr.languageShort.vie'), label: t('ocr.languageLabel.vie') }
  ]), [t]);
  // Use props instead of local state
  // const [selectedStrategy, setSelectedStrategy] = useState('standard');

  const handleClick = () => {
    if (status === 'idle' || status === 'completed' || status === 'error') {
      onOCRStart();
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'processing':
        return <Loader2 size={18} className="animate-spin" />;
      case 'completed':
        return <CheckCircle2 size={18} />;
      case 'error':
        return <AlertCircle size={18} />;
      default:
        return <ScanText size={18} />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'processing':
        return t('ocr.processing');
      case 'completed':
        return t('ocr.completed');
      case 'error':
        return t('ocr.error');
      default:
        return t('ocr.label');
    }
  };

  const getLanguageLabel = () => {
    return languageOptions.find((item) => item.value === selectedLanguage)?.short ?? t('ocr.languageShort.chi_tra');
  };

  const getLanguageFullLabel = () => {
    return languageOptions.find((item) => item.value === selectedLanguage)?.label ?? t('ocr.languageLabel.chi_tra');
  };

  const getAriaLabel = () => {
    switch (status) {
      case 'processing':
        return t('ocr.progress', { progress });
      case 'completed':
        return t('ocr.tooltipCompleted');
      case 'error':
        return t('ocr.tooltipError');
      default:
        return t('ocr.tooltipStart');
    }
  };

  const baseButtonClasses = cn(
    "relative flex items-center justify-center transition-all border overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/50",
    status === 'idle' && "idle bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/10 shadow-sm dark:shadow-none",
    status === 'processing' && "processing bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 cursor-not-allowed border-slate-200 dark:border-white/5",
    status === 'completed' && "completed bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20",
    status === 'error' && "error bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20"
  );

  return (
    <div className="flex items-center" role="group" aria-label={t('ocr.controls')}>
      {/* Main Action Button */}
      <button
        className={cn(
          baseButtonClasses,
          "ocr-button", // Test marker
          "rounded-l-lg rounded-r-none border-r-0",
          "px-3 py-1.5 text-sm font-medium gap-2",
          compact && "compact aspect-square justify-center p-2 rounded-r-none"
        )}
        onClick={handleClick}
        disabled={status === 'processing'}
        data-testid="ocr-button"
        aria-label={getAriaLabel()}
        aria-busy={status === 'processing'}
        title={compact ? getAriaLabel() : undefined}
      >
        {status === 'processing' && (
          <div
            className="absolute bottom-0 left-0 w-full h-1 bg-slate-200 dark:bg-white/10"
          >
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              data-testid="ocr-progress"
            />
          </div>
        )}

        <span className="flex items-center justify-center shrink-0">
          {getStatusIcon()}
        </span>
        {!compact && (
          <span className="truncate flex items-center gap-2">
            <span>{getStatusText()}</span>
            <span
              className="text-[11px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300"
              title={getLanguageFullLabel()}
            >
              {getLanguageLabel()}
            </span>
          </span>
        )}
      </button>

      {/* Dropdown Trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              baseButtonClasses,
              "rounded-r-lg rounded-l-none border-l",
              "px-1.5 py-1.5",
              compact && "rounded-l-none h-full"
            )}
            disabled={status === 'processing'}
            aria-label={t('ocr.selectLanguage')}
            data-testid="ocr-strategy-trigger"
          >
            <ChevronDown size={14} className={status === 'processing' ? 'opacity-50' : ''} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="mt-1 w-[180px] max-h-72 overflow-y-auto">
          {languageOptions.map((option, index) => {
            const cleanLabel = option.label.replace(/\s*\([^)]*\)\s*/g, '').trim();
            const isFirstVert = option.value === 'chi_tra_vert';
            return (
            <React.Fragment key={option.value}>
              {isFirstVert && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => onLanguageChange?.(option.value)}
                className="flex items-center justify-between gap-2 cursor-pointer"
                data-index={index}
              >
                <span className="truncate">{cleanLabel}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{option.short}</span>
                {selectedLanguage === option.value && <Check size={14} className="shrink-0" />}
              </DropdownMenuItem>
            </React.Fragment>
          )})}

          {/* Advanced engine selector — hidden by default */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.preventDefault(); setShowAdvanced(v => !v); }}
            className="flex items-center gap-1.5 cursor-pointer text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-[11px]"
          >
            <Settings2 size={11} />
            <span>{t('ocr.advanced')}</span>
            <ChevronDown size={10} className={cn('ml-auto transition-transform', showAdvanced && 'rotate-180')} />
          </DropdownMenuItem>
          {showAdvanced && segmentationOptions.map(opt => (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => onSegmentationChange?.(opt.value)}
              className="flex items-center justify-between gap-2 cursor-pointer pl-5 text-[11px]"
            >
              <span className="truncate">{opt.label}</span>
              {selectedSegmentation === opt.value && <Check size={12} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

