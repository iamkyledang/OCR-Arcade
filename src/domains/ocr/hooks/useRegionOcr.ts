import { useCallback, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { useToastStore } from '@/shared/store/feedbackStore'
import { imageAnalysisService } from '@/domains/ocr/services/imageAnalysisFacade'
import { useTranslation } from 'react-i18next'

export type RegionOcrStatus = 'idle' | 'processing' | 'done' | 'error'

export interface RegionBBox {
    x0: number
    y0: number
    x1: number
    y1: number
}

export function useRegionOcr() {
    const { t } = useTranslation()
    const { pages, currentPageIndex, ocrLanguage } = useStore()
    const { addToast } = useToastStore()
    const [status, setStatus] = useState<RegionOcrStatus>('idle')

    const runRegionOcr = useCallback(async (region: RegionBBox) => {
        const currentPage = pages[currentPageIndex]
        if (!currentPage) return
        if (region.x1 - region.x0 < 10 || region.y1 - region.y0 < 10) return

        setStatus('processing')
        try {
            // 1. Crop the selected region
            const croppedDataUrl = await cropImageRegion(currentPage.imageData, region)

            // 2. Run through the exact same pipeline as global OCR
            //    (imageAnalysisFacade → ocrServiceManager → pre-ocr-ai)
            const words = await imageAnalysisService.processImage(croppedDataUrl, ocrLanguage, 'tesseract')

            if (words.length === 0) {
                addToast(t('toasts.regionOcrNoText'), 'info')
                setStatus('idle')
                return
            }

            // 3. Offset bounding boxes from crop-space back to page-space
            const offsetWords = words.map((w, i) => ({
                ...w,
                id: `region-${Date.now()}-${i}`,
                bbox: {
                    x0: w.bbox.x0 + region.x0,
                    y0: w.bbox.y0 + region.y0,
                    x1: w.bbox.x1 + region.x0,
                    y1: w.bbox.y1 + region.y0,
                }
            }))

            // 4. Add as Fabric hotspots — same rendering path as global OCR
            window.dispatchEvent(new CustomEvent('canvas:addWords', { detail: { words: offsetWords } }))

            addToast(t('toasts.regionOcrSuccess', { count: offsetWords.length }), 'success')
            setStatus('done')
            setTimeout(() => setStatus('idle'), 2000)
        } catch {
            setStatus('error')
            addToast(t('toasts.regionOcrFail'), 'error')
            setTimeout(() => setStatus('idle'), 2000)
        }
    }, [pages, currentPageIndex, ocrLanguage, addToast, t])

    return { runRegionOcr, status }
}

async function cropImageRegion(imageDataUrl: string, region: RegionBBox): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const w = region.x1 - region.x0
            const h = region.y1 - region.y0
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) { reject(new Error('Cannot get 2D context')); return }
            ctx.drawImage(img, region.x0, region.y0, w, h, 0, 0, w, h)
            resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('Image load failed'))
        img.src = imageDataUrl
    })
}
