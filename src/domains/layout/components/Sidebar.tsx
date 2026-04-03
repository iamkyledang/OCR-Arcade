import { useRef, useEffect, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { ScanText, CheckCircle2, Loader2, PanelLeft, PanelLeftClose, X } from 'lucide-react'
import { imageAnalysisService } from '@/domains/ocr/services/imageAnalysisFacade'
import { useLoadingStore, useToastStore } from '@/shared/store/feedbackStore'
import { useResponsiveLayout } from '@/domains/layout/hooks/useResponsiveLayout'
import { useTranslation } from 'react-i18next'

export function Sidebar() {
    const { t } = useTranslation()
    const { pages, currentPageIndex, setCurrentPageIndex, setPageOCRData, isSidebarOverlayMode, ocrLanguage, ocrSegmentation, isSidebarCollapsed, toggleSidebar, markOcrTriggered } = useStore()
    const { setLoading } = useLoadingStore()
    const { addToast } = useToastStore()
    const { isMobile, isTablet, toggleSidebarOverlay } = useResponsiveLayout()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [processingPages, setProcessingPages] = useState<Set<number>>(new Set())

    const isOverlayMode = isSidebarOverlayMode && (isMobile || isTablet)

    useEffect(() => {
        // Scroll active thumbnail into view
        if (scrollRef.current) {
            const activeEl = scrollRef.current.children[currentPageIndex] as HTMLElement
            if (activeEl) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }, [currentPageIndex])

    const handleScanPage = async (pageIndex: number, e: React.MouseEvent) => {
        e.stopPropagation() // Prevent page selection

        const page = pages[pageIndex]
        if (!page || page.ocrData || processingPages.has(pageIndex)) return

        setProcessingPages(prev => new Set(prev).add(pageIndex))
        markOcrTriggered()

        try {
            const words = await imageAnalysisService.processImage(page.imageData, ocrLanguage, ocrSegmentation)
            setPageOCRData(pageIndex, words)
            addToast(t('toasts.pageOcrDone', { page: pageIndex + 1 }), 'success')
        } catch (e) {
            addToast(t('toasts.ocrFailed'), 'error')
        } finally {
            setProcessingPages(prev => {
                const next = new Set(prev)
                next.delete(pageIndex)
                return next
            })
        }
    }

    const handleScanAll = async () => {
        const unprocessedPages = pages.filter(p => !p.ocrData)
        if (unprocessedPages.length === 0) {
            addToast(t('toasts.allPagesDone'), 'info')
            return
        }

        setLoading(true, t('toasts.recognizeAll'), 0)
        markOcrTriggered()

        try {
            for (let i = 0; i < pages.length; i++) {
                if (pages[i].ocrData) continue
                setLoading(true, t('toasts.recognizePage', { current: i + 1, total: pages.length }), (i / pages.length) * 100)
                const words = await imageAnalysisService.processImage(pages[i].imageData, ocrLanguage, ocrSegmentation)
                setPageOCRData(i, words)
            }
            addToast(t('toasts.allDone', { count: pages.length }), 'success')
        } catch (e) {
            addToast(t('toasts.ocrFailed'), 'error')
        } finally {
            setLoading(false)
        }
    }

    if (!isOverlayMode && isSidebarCollapsed) {
        return (
            <div className={cn(
                "glass-panel border-r border-white/5 flex flex-col h-full shrink-0 z-10 w-10 transition-all duration-300"
            )}>
                <button
                    onClick={toggleSidebar}
                    className="h-16 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
                    title={t('properties.expand')}
                >
                    <PanelLeft size={18} />
                </button>
            </div>
        )
    }

    return (
        <div className={cn(
            "h-full flex flex-col glass-panel shrink-0 transition-all duration-300 z-10 bg-white/40 dark:bg-white/5",
            // Responsive width - full width in overlay mode, normal width otherwise
            isOverlayMode ? "w-[280px] shadow-2xl" : "w-full"
        )}>
            {/* Header with close button for overlay mode */}
            <div className="p-4 border-b border-slate-200 dark:border-stranger-red/30 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider dark:text-stranger-red dark:font-stranger dark:text-shadow-stranger-sm animate-stranger-flicker">{t('sidebar.pages')}</h2>
                {isOverlayMode ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleSidebarOverlay}
                        className="h-6 w-6 text-muted-foreground hover:text-white"
                    >
                        <X size={14} />
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleSidebar}
                        className="h-6 w-6 text-muted-foreground hover:text-white"
                    >
                        <PanelLeftClose size={14} />
                    </Button>
                )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {pages.map((page, i) => {
                    const hasOCR = !!page.ocrData
                    const isProcessing = processingPages.has(i)

                    return (
                        <div key={i} className="space-y-1.5">
                            <div
                                onClick={() => setCurrentPageIndex(i)}
                                className={cn(
                                    "relative aspect-video rounded-lg cursor-pointer transition-all duration-300 border-2 group mx-1",
                                    i === currentPageIndex
                                        ? "border-primary/60 ring-2 ring-primary/20 shadow-[0_0_8px_rgba(249,115,22,0.18)] z-10"
                                        : "border-transparent hover:border-slate-300/70 dark:hover:border-white/15 opacity-60 hover:opacity-100"
                                )}
                            >
                                <img
                                    src={page.imageData}
                                    alt={t('sidebar.pageAlt', { index: i + 1 })}
                                    className="w-full h-full object-contain rounded-md"
                                />

                                {/* Page Number */}
                                <div className="absolute bottom-1 right-1 bg-black/60 backdrop-blur-sm px-1.5 rounded text-[10px] font-mono text-white">
                                    {i + 1}
                                </div>

                                {/* OCR Status Badge */}
                                {hasOCR && (
                                    <div className="absolute top-1 right-1 bg-green-500/90 backdrop-blur-sm p-1 rounded">
                                        <CheckCircle2 size={12} className="text-white" />
                                    </div>
                                )}
                            </div>

                            {/* OCR Trigger Button */}
                            {!hasOCR && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => handleScanPage(i, e)}
                                    disabled={isProcessing}
                                    className="w-full h-7 text-xs gap-1.5 hover:bg-primary/20 hover:text-primary transition-colors"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 size={12} className="animate-spin" />
                                            <span>{t('sidebar.processing')}</span>
                                        </>
                                    ) : (
                                        <>
                                            <ScanText size={12} />
                                            <span>{t('sidebar.recognize')}</span>
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Scan All Button */}
            {pages.length > 0 && pages.some(p => !p.ocrData) && (
                <div className="p-3 border-t border-white/10">
                    <Button
                        size="sm"
                        onClick={handleScanAll}
                        className="w-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
                    >
                        <ScanText size={14} className="mr-1.5" />
                        {t('sidebar.recognizeAll')}
                    </Button>
                </div>
            )}
        </div>
    )
}

