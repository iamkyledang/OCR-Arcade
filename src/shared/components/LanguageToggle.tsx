import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/utils'

type LanguageToggleProps = {
  className?: string
  variant?: 'default' | 'compact'
}

const languageShortLabels: Record<string, string> = {
  'zh-TW': 'ZH-TW',
  'zh-CN': 'ZH',
  en: 'EN',
  es: 'ES',
  ar: 'AR',
  'pt-BR': 'PT',
  fr: 'FR',
  ja: 'JA',
  de: 'DE',
  ru: 'RU',
}

const languageOptions = [
  { code: 'zh-TW', key: 'language.zh' },
  { code: 'zh-CN', key: 'language.zhCN' },
  { code: 'en', key: 'language.en' },
  { code: 'es', key: 'language.es' },
  { code: 'ar', key: 'language.ar' },
  { code: 'pt-BR', key: 'language.ptBR' },
  { code: 'fr', key: 'language.fr' },
  { code: 'ja', key: 'language.ja' },
  { code: 'de', key: 'language.de' },
  { code: 'ru', key: 'language.ru' },
] as const

export function LanguageToggle({ className, variant = 'default' }: LanguageToggleProps) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage || i18n.language
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const shortLabel = languageShortLabels[current] ?? current
  const options = useMemo(() => languageOptions.map((opt) => ({
    ...opt,
    label: t(opt.key)
  })), [t])

  const handleOpen = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      })
    }
    setOpen(prev => !prev)
  }

  useEffect(() => {
    if (variant !== 'compact') return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (containerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [variant])

  const setLanguage = (code: string) => {
    i18n.changeLanguage(code)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('i18nextLng', code)
    }
  }

  if (variant === 'compact') {
    return (
      <div
        ref={containerRef}
        className={cn("relative flex items-center border-2 border-border bg-card px-2 py-1 shadow-[3px_3px_0_rgba(2,6,23,0.45)] max-w-[100px]", className)}
      >
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-900 dark:text-white"
          onClick={handleOpen}
          aria-label={t('language.label')}
        >
          <span className="truncate max-w-[60px]">{shortLabel}</span>
          <span className="text-[10px] text-foreground/70">▾</span>
        </button>
        {open && createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-44 max-h-60 overflow-y-auto bg-card border-2 border-border shadow-[4px_4px_0_rgba(2,6,23,0.45)]"
            style={{ top: dropdownPos.top, right: dropdownPos.right }}
          >
            {options.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  setLanguage(opt.code)
                  setOpen(false)
                }}
                className={cn(
                  "w-full text-left px-3 py-2 text-[12px] font-normal text-slate-900 dark:text-slate-100 hover:bg-primary/10 transition-colors",
                  current === opt.code && "bg-primary/20"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-1 border-2 border-border bg-card px-1 py-1 shadow-[3px_3px_0_rgba(2,6,23,0.45)]", className)}>
      {languageOptions.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setLanguage(opt.code)}
          className={cn(
            "px-2 py-1 text-[10px] uppercase tracking-widest transition-all",
            current === opt.code ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"
          )}
        >
          {t(opt.key)}
        </button>
      ))}
    </div>
  )
}
