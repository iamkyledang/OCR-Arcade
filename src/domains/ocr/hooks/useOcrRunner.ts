import { useCallback } from 'react'
import { useStore } from '@/shared/store/useStore'
import { useToastStore } from '@/shared/store/feedbackStore'
import { imageAnalysisService } from '@/domains/ocr/services/imageAnalysisFacade'
import { useTranslation } from 'react-i18next'

export function useOcrRunner() {
  const { t } = useTranslation()
  const {
    pages,
    currentPageIndex,
    ocrLanguage,
    ocrSegmentation,
    setPageOCRData,
    markOcrTriggered,
    setOcrStatus,
    setOcrProgress
  } = useStore()
  const { addToast } = useToastStore()

  const startOcr = useCallback(async () => {
    const currentPage = pages[currentPageIndex]
    if (!currentPage) {
      addToast(t('toasts.needLoadImage'), 'info')
      return
    }

    if (currentPage.ocrData) {
      const confirmed = confirm(t('toasts.confirmReocr'))
      if (!confirmed) return
    }

    markOcrTriggered()

    let progressInterval: ReturnType<typeof setInterval> | null = null
    try {
      setOcrStatus('processing')
      setOcrProgress(0)
      addToast(t('toasts.startOcr'), 'info')

      progressInterval = setInterval(() => {
        const currentProgress = useStore.getState().ocrProgress
        setOcrProgress(Math.min(currentProgress + 10, 90))
      }, 200)

      const words = await imageAnalysisService.processImage(
        currentPage.imageData,
        ocrLanguage,
        ocrSegmentation
      )

      if (progressInterval) clearInterval(progressInterval)
      setOcrProgress(100)

      setPageOCRData(currentPageIndex, words)

      setOcrStatus('completed')
      addToast(t('toasts.ocrSuccess', { count: words.length }), 'success')

      setTimeout(() => {
        setOcrStatus('idle')
        setOcrProgress(0)
      }, 2000)
    } catch (error) {
      if (progressInterval) clearInterval(progressInterval)
      setOcrStatus('error')
      addToast(t('toasts.ocrFail'), 'error')

      setTimeout(() => {
        setOcrStatus('idle')
        setOcrProgress(0)
      }, 2000)
    }
  }, [
    pages,
    currentPageIndex,
    ocrLanguage,
    ocrSegmentation,
    setPageOCRData,
    markOcrTriggered,
    setOcrStatus,
    setOcrProgress,
    addToast,
    t
  ])

  return { startOcr }
}
