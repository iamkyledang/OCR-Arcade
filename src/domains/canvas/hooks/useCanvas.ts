import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { fabric } from 'fabric'
import { useStore, type ActiveObjectMixedKey, type ActiveObjectProps } from '@/shared/store/useStore'
import type { OCRWord } from '@/domains/ocr/services/ocr'
import { inpaintingService } from '@/domains/canvas/services/inpaintingService'
import { OcrHotspotManager } from '@/domains/ocr/services/OcrHotspotManager'
import { VerticalTextbox } from '@/domains/canvas/fabric/VerticalTextbox'
import { computeSnap, type RectBounds } from '@/domains/canvas/services/alignmentEngine'
import { AlignmentGuideRenderer } from '@/domains/canvas/services/alignmentGuideRenderer'
import { applyAlignCommand, applyDistributeCommand, type AlignCommand, type DistributeCommand } from '@/domains/canvas/services/alignmentCommands'

const SNAP_TOLERANCE_PX = 7
const SPACING_TOLERANCE_PX = 6
const MIXED_KEYS: ActiveObjectMixedKey[] = [
    'fontSize',
    'fill',
    'backgroundColor',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'textAlign',
    'verticalAlign',
    'text',
]

export function useCanvas(containerWidth: number = 0, containerHeight: number = 0) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    // Stable container dimensions - only update when change is significant (>5px)
    const stableContainerRef = useRef({ width: 0, height: 0 })
    const fabricRef = useRef<fabric.Canvas | null>(null)
    const guideRendererRef = useRef<AlignmentGuideRenderer | null>(null)
    const lastActiveIdRef = useRef<string | null>(null)
    const wasEditingRef = useRef(false)
    const isReloadingRef = useRef(false)
    const isNormalizingMultiSelectionRef = useRef(false)
    const {
        pages,
        currentPageIndex,
        zoom,
        setCanvasState,
        canvasStates,
        setActiveObjectProperties,
        isFormatPainterActive,
        setIsFormatPainterActive,
        copiedStyle,
        setCopiedStyle,
        lastUpdateSource,
        setSelectedObjectCount,
        pendingPropertyPatch,
        clearPendingPropertyPatch
    } = useStore()

    const currentPage = pages[currentPageIndex]

    const clearAlignmentGuides = () => {
        guideRendererRef.current?.clear()
    }

    const isTextEditableObject = (obj: any) =>
        obj instanceof fabric.IText ||
        obj instanceof fabric.Textbox ||
        obj?.type === 'verticaltextbox' ||
        obj?.type === 'textbox' ||
        obj?.type === 'i-text'

    const normalizeComparableValue = (key: ActiveObjectMixedKey, value: any) => {
        if ((key === 'fill' || key === 'backgroundColor') && typeof value === 'string') {
            return value.toLowerCase()
        }
        return value
    }

    const getSelectionTextObjects = (active: fabric.Object | undefined | null): any[] => {
        if (!active) return []
        if ((active as any).type === 'activeSelection' && Array.isArray((active as any)._objects)) {
            return (active as any)._objects.filter((obj: any) => isTextEditableObject(obj))
        }
        if ((active as any).type === 'group' && Array.isArray((active as any)._objects)) {
            return (active as any)._objects.filter((obj: any) => isTextEditableObject(obj))
        }
        return isTextEditableObject(active) ? [active] : []
    }

    const buildActiveObjectProps = (objects: any[], id: string): ActiveObjectProps | null => {
        if (objects.length === 0) return null
        const first = objects[0]
        const mixed: Partial<Record<ActiveObjectMixedKey, boolean>> = {}
        const props: ActiveObjectProps = {
            id,
            visible: true,
            text: first.text,
            fontSize: first.fontSize,
            fill: first.fill as string,
            backgroundColor: first.backgroundColor as string,
            fontFamily: first.fontFamily,
            fontWeight: first.fontWeight,
            fontStyle: first.fontStyle,
            textAlign: first.textAlign,
            verticalAlign: first.verticalAlign,
        }

        if (objects.length > 1) {
            for (const key of MIXED_KEYS) {
                const values = objects.map((obj) => normalizeComparableValue(key, obj[key]))
                const allSame = values.every((value) => value === values[0])
                if (!allSame) mixed[key] = true
            }
        }

        if (Object.keys(mixed).length > 0) {
            props.mixed = mixed
        }
        return props
    }

    const getBoundsForObject = (canvas: fabric.Canvas, obj: fabric.Object): RectBounds | null => {
        const zoomLevel = canvas.getZoom() || 1
        const bounds = obj.getBoundingRect(false, false)
        if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) || bounds.width <= 0 || bounds.height <= 0) {
            return null
        }
        const left = bounds.left / zoomLevel
        const top = bounds.top / zoomLevel
        const width = bounds.width / zoomLevel
        const height = bounds.height / zoomLevel
        return {
            id: String((obj as any).id ?? (obj as any).name ?? obj.type ?? 'object'),
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height,
            centerX: left + width / 2,
            centerY: top + height / 2,
            type: 'object',
        }
    }

    const runSnapForTarget = (canvas: fabric.Canvas, target: fabric.Object) => {
        const activeBounds = getBoundsForObject(canvas, target)
        if (!activeBounds) return

        const selected = new Set<fabric.Object>()
        if (target.type === 'activeSelection' && Array.isArray((target as any)._objects)) {
            ; (target as any)._objects.forEach((obj: fabric.Object) => selected.add(obj))
        }
        selected.add(target)

        const zoomLevel = canvas.getZoom() || 1
        const canvasBounds: RectBounds = {
            id: 'canvas-bounds',
            left: 0,
            top: 0,
            right: canvas.getWidth() / zoomLevel,
            bottom: canvas.getHeight() / zoomLevel,
            width: canvas.getWidth() / zoomLevel,
            height: canvas.getHeight() / zoomLevel,
            centerX: canvas.getWidth() / (2 * zoomLevel),
            centerY: canvas.getHeight() / (2 * zoomLevel),
            type: 'canvas',
        }

        const objectCandidates = canvas
            .getObjects()
            .filter((obj) => obj.visible && !selected.has(obj) && !OcrHotspotManager.isHotspot(obj))
            .map((obj) => getBoundsForObject(canvas, obj))
            .filter((obj): obj is RectBounds => !!obj)
        const candidates = [canvasBounds, ...objectCandidates]
        const snapTolerance = SNAP_TOLERANCE_PX / zoomLevel
        const spacingTolerance = SPACING_TOLERANCE_PX / zoomLevel
        const result = computeSnap(activeBounds, candidates, snapTolerance, spacingTolerance)

        guideRendererRef.current?.setState({
            guides: result.matchedGuides,
            spacingHints: result.spacingHints,
        })

        if (result.deltaX !== 0 || result.deltaY !== 0) {
            target.set({
                left: (target.left || 0) + result.deltaX,
                top: (target.top || 0) + result.deltaY,
            })
            target.setCoords()
        }

        canvas.requestRenderAll()
    }

    // Initialize Fabric Canvas
    useEffect(() => {
        if (!canvasRef.current || fabricRef.current) return

        const canvas = new fabric.Canvas(canvasRef.current, {
            controlsAboveOverlay: true,
            preserveObjectStacking: true,
            selection: true, // Enable group selection
            // Support additive selection across common desktop conventions.
            selectionKey: ['shiftKey', 'ctrlKey', 'metaKey'],
            backgroundColor: '#f3f4f6' // Light gray background
        })

        fabricRef.current = canvas
        guideRendererRef.current = new AlignmentGuideRenderer(canvas)

        return () => {
            guideRendererRef.current?.dispose()
            guideRendererRef.current = null
            canvas.dispose()
            fabricRef.current = null
        }
    }, [])

    // Helper: attach controls & smart scaling behavior to text objects
    const attachTextObjectBehavior = (canvas: fabric.Canvas, obj: any) => {
        obj.setControlsVisibility({
            mt: true,   // middle-top (show for height adjustment)
            mb: true,   // middle-bottom (show for height adjustment)
            ml: true,   // middle-left
            mr: true,   // middle-right
            tl: false,  // top-left corner
            tr: false,  // top-right corner
            bl: false,  // bottom-left corner
            br: false,  // bottom-right corner
            mtr: false  // rotation control
        })

        // Ensure minHeight is always initialized so VerticalTextbox
        // can use it as the stable box height for vertical alignment.
        if ((obj as any).minHeight == null && obj.height != null) {
            ; (obj as any).minHeight = obj.height
        }

        // Smart scaling: convert scale to width/height + minHeight adjustments
        obj.on('scaling', function (this: any) {
            let needsUpdate = false
            const updates: any = {}
            // Horizontal scaling: Convert to width adjustment
            if (this.scaleX !== 1) {
                const newWidth = this.width * this.scaleX
                updates.width = Math.max(newWidth, 20)
                updates.scaleX = 1
                needsUpdate = true
            }

            // Vertical scaling: Convert to height adjustment
            if (this.scaleY !== 1) {
                const newHeight = this.height * this.scaleY
                const finalHeight = Math.max(newHeight, 20)
                updates.height = finalHeight
                updates.minHeight = finalHeight  // For vertical alignment
                updates.scaleY = 1
                needsUpdate = true
            }

            if (needsUpdate) {
                this.set(updates)
                canvas.requestRenderAll()
            }
        })
    }

    // Helper: after loadFromJSON, normalize any text objects so they
    // 1) always have a stable minHeight, and
    // 2) use VerticalTextbox when they support verticalAlign.
    const upgradeTextObject = (canvas: fabric.Canvas, obj: any) => {
        // If it's already our custom class, just make sure behavior/minHeight is set.
        if (obj instanceof VerticalTextbox) {
            if ((obj as any).minHeight == null && obj.height != null) {
                ; (obj as any).minHeight = obj.height
            }
            attachTextObjectBehavior(canvas, obj)
            return
        }

        if (obj.type !== 'textbox' && obj.type !== 'i-text' && obj.type !== 'verticaltextbox') return

        const hasVerticalProps =
            (obj as any).verticalAlign !== undefined ||
            (obj as any).minHeight !== undefined

        // For plain textboxes without vertical props,仍然附加 scaling 行為即可
        if (!hasVerticalProps) {
            attachTextObjectBehavior(canvas, obj)
            return
        }

        // 將支援垂直對齊的 textbox 升級為 VerticalTextbox，
        // 以便使用自訂的 _renderText。
        const objects = canvas.getObjects()
        const index = objects.indexOf(obj)

        const objectData = obj.toObject([
            'id',
            'left',
            'top',
            'width',
            'height',
            'fontSize',
            'fontFamily',
            'fontWeight',
            'fontStyle',
            'fill',
            'backgroundColor',
            'textAlign',
            'verticalAlign',
            'minHeight',
            'lockScalingX',
            'lockScalingY',
            'lockRotation',
            'lockScalingFlip',
            'lockSkewingX',
            'lockSkewingY',
            'hasControls',
            'hasBorders',
            'cornerSize',
            'transparentCorners',
            'cornerColor',
            'cornerStrokeColor',
            'borderColor',
            'borderScaleFactor'
        ]) as any

        const verticalAlign = objectData.verticalAlign || 'top'
        const minHeight =
            objectData.minHeight != null
                ? objectData.minHeight
                : objectData.height != null
                    ? objectData.height
                    : obj.height || 0

        const upgraded = new VerticalTextbox(obj.text as string, {
            ...objectData,
            verticalAlign
        } as any)

            ; (upgraded as any).minHeight = minHeight

        canvas.remove(obj)
        canvas.insertAt(upgraded, Math.max(index, 0), false)

        attachTextObjectBehavior(canvas, upgraded)
    }

    // Update stable container dimensions only when change is significant
    // This prevents micro-oscillations from triggering effectiveZoom recalculation
    // On first valid measurement, always accept the dimensions
    const isFirstMeasurement = stableContainerRef.current.width === 0 && stableContainerRef.current.height === 0

    if (
        isFirstMeasurement ||
        Math.abs(containerWidth - stableContainerRef.current.width) > 10 ||
        Math.abs(containerHeight - stableContainerRef.current.height) > 10
    ) {
        if (containerWidth > 64 && containerHeight > 64) {
            stableContainerRef.current = { width: containerWidth, height: containerHeight }
        }
    }

    const stableWidth = stableContainerRef.current.width || containerWidth
    const stableHeight = stableContainerRef.current.height || containerHeight

    // Calculate Fit Ratio using stable dimensions
    const fitRatio = (currentPage && stableWidth > 64 && stableHeight > 64) ? Math.min(
        (stableWidth - 64) / currentPage.width, // 64px padding
        (stableHeight - 64) / currentPage.height
    ) : 1

    // Effective Zoom
    const effectiveZoom = zoom * fitRatio

    // Handle Page Change & Data Loading
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas || !currentPage) return

        canvas.clear()
        clearAlignmentGuides()
        setSelectedObjectCount(0)

        // We set dimensions based on the Current Fit 
        // NOTE: Fabric needs explicit dimensions to render corrections
        canvas.setWidth(currentPage.width * effectiveZoom)
        canvas.setHeight(currentPage.height * effectiveZoom)
        canvas.setZoom(effectiveZoom)

        // Determine which image to show
        const bgImage = currentPage.imageData

        // Load State or Background
        if (canvasStates[currentPageIndex]) {
            canvas.loadFromJSON(canvasStates[currentPageIndex], () => {
                // Safety check: ensure canvas is still valid after async load
                if (!canvas.getElement() || !canvas.getContext()) return

                canvas.renderAll()
                // Re-apply zoom after load
                canvas.setZoom(effectiveZoom)

                // IMPORTANT: When loading from JSON, dimensions might be reset or need adjusting
                canvas.setWidth(currentPage.width * effectiveZoom)
                canvas.setHeight(currentPage.height * effectiveZoom)

                // CRITICAL: Re-apply control visibility and event listeners to all text objects,
                // and upgrade any textbox with vertical props into VerticalTextbox
                canvas.getObjects().forEach((obj: any) => {
                    if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'verticaltextbox') {
                        upgradeTextObject(canvas, obj)
                    }
                })

                // Force background update
                fabric.Image.fromURL(bgImage, (img) => {
                    if (!canvas.getElement() || !canvas.getContext()) return
                    canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
                        scaleX: currentPage.width / (img.width || 1),
                        scaleY: currentPage.height / (img.height || 1)
                    })
                })
            })
        } else {
            fabric.Image.fromURL(bgImage, (img) => {
                // Safety check: ensure canvas is still valid after async load
                if (!canvas.getElement() || !canvas.getContext()) return

                canvas.setBackgroundImage(img, () => {
                    // Another safety check before rendering
                    if (!canvas.getElement() || !canvas.getContext()) return
                    canvas.renderAll()
                }, {
                    scaleX: currentPage.width / (img.width || 1),
                    scaleY: currentPage.height / (img.height || 1)
                })
            })
        }
    }, [currentPageIndex, pages, setSelectedObjectCount])


    // Helper: Apply style to fabric object (supports groups)
    const applyStyleToFabricObject = (obj: any, key: string, value: any): boolean => {
        // Handle Group/Selection
        if ((obj.type === 'activeSelection' || obj.type === 'group') && obj._objects) {
            let changed = false
            obj._objects.forEach((child: any) => {
                if (applyStyleToFabricObject(child, key, value)) changed = true
            })
            return changed
        }

        // Handle Single Object
        if (obj instanceof fabric.IText || obj instanceof fabric.Textbox || obj.type === 'verticaltextbox') {
            if (obj[key] !== value) {
                obj.set(key, value)

                // Special handling
                if (key === 'verticalAlign' || key === 'backgroundColor') {
                    obj.dirty = true
                }

                // Re-calculate height if minHeight exists
                if (obj.minHeight != null) {
                    obj.set('height', obj.minHeight)
                }
                return true
            }
        }
        return false
    }

    // Handle Zoom Updates (Responsive)
    // This effect handles all zoom changes WITHOUT reloading the image
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas || !currentPage) return

        if (!canvas.getElement() || !canvas.getContext()) return

        try {
            canvas.setZoom(effectiveZoom)
            canvas.setDimensions({
                width: currentPage.width * effectiveZoom,
                height: currentPage.height * effectiveZoom
            })
            canvas.renderAll()
        } catch (e) {
        }

    }, [effectiveZoom, currentPage])

    // 明確的 Undo/Redo Reload：透過事件觸發，而不是監聽整個 canvasStates 陣列
    useEffect(() => {
        const handleReloadFromSnapshot = () => {
            const canvas = fabricRef.current
            if (!canvas) return

            const { canvasStates, currentPageIndex: idx } = useStore.getState()
            const snapshot = canvasStates[idx]
            if (!snapshot) return

            isReloadingRef.current = true
            canvas.loadFromJSON(snapshot, () => {
                canvas.setZoom(effectiveZoom)

                canvas.getObjects().forEach((obj: any) => {
                    if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'verticaltextbox') {
                        upgradeTextObject(canvas, obj)
                    }
                })

                if (lastActiveIdRef.current) {
                    const target = canvas.getObjects().find((obj: any) => obj.id === lastActiveIdRef.current)
                    if (target) {
                        canvas.setActiveObject(target)
                        if (
                            wasEditingRef.current &&
                            (target instanceof fabric.IText || target instanceof fabric.Textbox)
                        ) {
                            target.enterEditing()
                            target.selectAll()
                        }
                        setActiveObjectProperties({
                            id: (target as any).id,
                            text: (target as any).text,
                            fontSize: (target as any).fontSize,
                            fill: (target as any).fill as string,
                            backgroundColor: (target as any).backgroundColor as string,
                            visible: true,
                            fontFamily: (target as any).fontFamily,
                            textAlign: (target as any).textAlign,
                            verticalAlign: (target as any).verticalAlign
                        })
                    }
                }

                canvas.renderAll()
                isReloadingRef.current = false
            })
        }

        window.addEventListener('canvas:reloadCurrentPage', handleReloadFromSnapshot)
        return () => {
            window.removeEventListener('canvas:reloadCurrentPage', handleReloadFromSnapshot)
        }
    }, [effectiveZoom])

    // Sync Store patch updates (Properties Panel) -> Canvas
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas || !pendingPropertyPatch) return

        // Prevent echo: If the update came from the canvas itself (selection/modification), do not write back.
        if (lastUpdateSource === 'canvas') return

        const activeObj = canvas.getActiveObject()
        if (!activeObj) {
            clearPendingPropertyPatch()
            return
        }

        let needsRender = false
        for (const [rawKey, value] of Object.entries(pendingPropertyPatch)) {
            if (value === undefined) continue
            if (rawKey === 'id' || rawKey === 'visible' || rawKey === 'mixed') continue
            if (applyStyleToFabricObject(activeObj, rawKey, value)) needsRender = true
        }

        if (needsRender) {
            canvas.renderAll()
        }
        clearPendingPropertyPatch()

    }, [pendingPropertyPatch, currentPageIndex, setCanvasState, lastUpdateSource, clearPendingPropertyPatch])

    // Setup Event Listeners for Selection
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        let clearSelectionTimeout: NodeJS.Timeout | null = null

        const handleSelection = (e: any) => {
            // Clear any pending clear timeout
            if (clearSelectionTimeout) {
                clearTimeout(clearSelectionTimeout)
                clearSelectionTimeout = null
            }

            const active = canvas.getActiveObject()
            const selectedCount = active?.type === 'activeSelection' && Array.isArray((active as any)._objects)
                ? (active as any)._objects.length
                : active ? 1 : 0
            setSelectedObjectCount(selectedCount)
            const selected = e.selected?.[0] || active
            const selectionObjects = getSelectionTextObjects(active)

            if (selected && selectionObjects.length > 0) {
                if (!(selected as any).id) {
                    ; (selected as any).id = Math.random().toString(36).substr(2, 9)
                }
                lastActiveIdRef.current = (selected as any).id

                const props = buildActiveObjectProps(selectionObjects, (selected as any).id)
                setActiveObjectProperties(props)
            } else {
                setActiveObjectProperties(null)
            }
        }

        const handleCleared = () => {
            if (isReloadingRef.current) return
            // Debounce clearing to prevent flicker during drag operations
            // Only clear if selection stays cleared for 150ms
            if (clearSelectionTimeout) {
                clearTimeout(clearSelectionTimeout)
            }

            clearSelectionTimeout = setTimeout(() => {
                // Double-check that nothing is selected
                const activeObj = canvas.getActiveObject()
                if (!activeObj) {
                    setSelectedObjectCount(0)
                    setActiveObjectProperties(null)
                }
                clearSelectionTimeout = null
            }, 150)
        }

        const handleModified = () => {
            const selected = canvas.getActiveObject()
            const selectionObjects = getSelectionTextObjects(selected)
            if (selected && selectionObjects.length > 0) {
                if (!(selected as any).id) {
                    ; (selected as any).id = Math.random().toString(36).substr(2, 9)
                }
                lastActiveIdRef.current = (selected as any).id
                const props = buildActiveObjectProps(selectionObjects, (selected as any).id)
                setActiveObjectProperties(props)
            }
        }

        const handleEditingEntered = (e: any) => {
            const target = e?.target
            if (target) {
                if (!(target as any).id) {
                    (target as any).id = Math.random().toString(36).substr(2, 9)
                }
                lastActiveIdRef.current = (target as any).id
                wasEditingRef.current = true
            }
        }

        const handleEditingExited = () => {
            wasEditingRef.current = false
        }

        canvas.on('selection:created', handleSelection)
        canvas.on('selection:updated', handleSelection)
        canvas.on('selection:cleared', handleCleared)
        // canvas.on('object:modified', handleModified) // Handled by save listener? No, we need to update PROPS panel.
        canvas.on('text:changed', handleModified)
        canvas.on('text:editing:entered', handleEditingEntered)
        canvas.on('text:editing:exited', handleEditingExited)

        return () => {
            if (clearSelectionTimeout) {
                clearTimeout(clearSelectionTimeout)
            }
            canvas.off('selection:created', handleSelection)
            canvas.off('selection:updated', handleSelection)
            canvas.off('selection:cleared', handleCleared)
            // canvas.off('object:modified', handleModified)
            canvas.off('text:changed', handleModified)
            canvas.off('text:editing:entered', handleEditingEntered)
            canvas.off('text:editing:exited', handleEditingExited)
        }
    }, [setActiveObjectProperties, setSelectedObjectCount])

    // Alignment guides and snapping
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const handleMoving = (e: any) => {
            const target = e?.target as fabric.Object | undefined
            if (!target || OcrHotspotManager.isHotspot(target)) return
            runSnapForTarget(canvas, target)
        }

        const handleScaling = (e: any) => {
            const target = e?.target as fabric.Object | undefined
            if (!target || OcrHotspotManager.isHotspot(target)) return
            runSnapForTarget(canvas, target)
        }

        const handleClear = () => {
            clearAlignmentGuides()
            canvas.requestRenderAll()
        }

        canvas.on('object:moving', handleMoving)
        canvas.on('object:scaling', handleScaling)
        canvas.on('mouse:up', handleClear)
        canvas.on('selection:cleared', handleClear)
        canvas.on('object:modified', handleClear)

        return () => {
            canvas.off('object:moving', handleMoving)
            canvas.off('object:scaling', handleScaling)
            canvas.off('mouse:up', handleClear)
            canvas.off('selection:cleared', handleClear)
            canvas.off('object:modified', handleClear)
        }
    }, [])

    // Alignment commands from Properties Panel
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const handleAlignmentCommand = (event: Event) => {
            const custom = event as CustomEvent<{ type: 'align' | 'distribute', command: string }>
            const detail = custom.detail
            if (!detail) return

            if (detail.type === 'align') {
                applyAlignCommand(canvas, detail.command as AlignCommand)
            } else {
                applyDistributeCommand(canvas, detail.command as DistributeCommand)
            }
        }

        window.addEventListener('canvas:alignmentCommand', handleAlignmentCommand as EventListener)
        return () => {
            window.removeEventListener('canvas:alignmentCommand', handleAlignmentCommand as EventListener)
        }
    }, [])

    // Delete active text object (keyboard or UI)
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const deleteActiveTextObject = () => {
            const activeObj = canvas.getActiveObject() as any
            if (!activeObj) return
            if (activeObj.isEditing) return

            const type = activeObj.type
            if (type !== 'textbox' && type !== 'i-text' && type !== 'verticaltextbox') return

            canvas.remove(activeObj)
            canvas.discardActiveObject()
            canvas.requestRenderAll()
            canvas.fire('object:modified', { target: activeObj })
            setSelectedObjectCount(0)
            setActiveObjectProperties(null)
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return

            const target = e.target as HTMLElement | null
            if (target) {
                const tag = target.tagName
                if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) {
                    return
                }
            }

            deleteActiveTextObject()
        }

        const handleDeleteEvent = () => {
            deleteActiveTextObject()
        }

        const handleDeselectAll = () => {
            canvas.discardActiveObject()
            canvas.requestRenderAll()
            setSelectedObjectCount(0)
            setActiveObjectProperties(null)
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('canvas:deleteActiveObject', handleDeleteEvent)
        window.addEventListener('canvas:deselectAll', handleDeselectAll)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('canvas:deleteActiveObject', handleDeleteEvent)
            window.removeEventListener('canvas:deselectAll', handleDeselectAll)
        }
    }, [setActiveObjectProperties, setSelectedObjectCount])

    // Format Painter Logic
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        if (isFormatPainterActive) {
            canvas.defaultCursor = 'copy'
            canvas.hoverCursor = 'copy'
        } else {
            canvas.defaultCursor = 'default'
            canvas.hoverCursor = 'move'
        }

        const handleMouseDown = (e: any) => {
            if (!isFormatPainterActive || !copiedStyle || !e.target) return

            const target = e.target
            let changed = false

            // Apply styles using shared helper
            if (copiedStyle.fontSize) { if (applyStyleToFabricObject(target, 'fontSize', copiedStyle.fontSize)) changed = true }
            if (copiedStyle.fill) { if (applyStyleToFabricObject(target, 'fill', copiedStyle.fill)) changed = true }
            if (copiedStyle.fontFamily) { if (applyStyleToFabricObject(target, 'fontFamily', copiedStyle.fontFamily)) changed = true }
            if (copiedStyle.fontWeight) { if (applyStyleToFabricObject(target, 'fontWeight', copiedStyle.fontWeight)) changed = true }
            if (copiedStyle.fontStyle) { if (applyStyleToFabricObject(target, 'fontStyle', copiedStyle.fontStyle)) changed = true }
            if (copiedStyle.textAlign) { if (applyStyleToFabricObject(target, 'textAlign', copiedStyle.textAlign)) changed = true }
            if (copiedStyle.verticalAlign) { if (applyStyleToFabricObject(target, 'verticalAlign', copiedStyle.verticalAlign)) changed = true }
            if (copiedStyle.backgroundColor) { if (applyStyleToFabricObject(target, 'backgroundColor', copiedStyle.backgroundColor)) changed = true }

            if (changed) {
                target.setCoords()
                canvas.requestRenderAll()
                canvas.fire('object:modified', { target })
            }

            // Update store logic is handled by subsequent selection events or manual trigger if needed
            setIsFormatPainterActive(false)
            setCopiedStyle(null)
        }

        canvas.on('mouse:down', handleMouseDown)

        return () => {
            canvas.off('mouse:down', handleMouseDown)
            canvas.defaultCursor = 'default'
            canvas.hoverCursor = 'move'
        }
    }, [isFormatPainterActive, copiedStyle, setIsFormatPainterActive, setCopiedStyle])

    // Handle OCR Data (Hotspots) - Auto Add
    useEffect(() => {
        if (!currentPage?.ocrData || !fabricRef.current) return

        // Check if we should add hotspots.
        // If canvasStates[index] exists, we assume hotspots/edits are already there.
        // If NOT, we add them.
        if (!canvasStates[currentPageIndex]) {
            addHotspots(currentPage.ocrData)
        }
    }, [currentPage?.ocrData, currentPageIndex, canvasStates])

    // Handle Region OCR results - add directly as hotspots on the Fabric canvas
    // (same path as global OCR, giving native Fabric drag behaviour)
    useEffect(() => {
        const handler = (e: Event) => {
            const words = (e as CustomEvent).detail?.words
            if (!Array.isArray(words) || !fabricRef.current) return
            addHotspots(words)
        }
        window.addEventListener('canvas:addWords', handler)
        return () => window.removeEventListener('canvas:addWords', handler)
    }, [])


    // Helper to add hotspots
    const addHotspots = (words: OCRWord[]) => {
        const canvas = fabricRef.current
        if (!canvas) return

        // Avoid adding if already has objects (simple check)
        if (canvas.getObjects().length > 0) {
            // Check if objects are hotspots? 
            // For now, if we have objects, we assume populated.
            // return 
            // Actually, background image is not an object in getObjects().
        }

        words.forEach(word => {
            // Use OcrHotspotManager to create hotspots with proper event handling
            const rect = OcrHotspotManager.create(word, canvas)

            // Add click handler for conversion to editable text
            rect.on('mousedown', () => {
                convertToEditable(rect, word)
            })

            canvas.add(rect)
        })
        canvas.requestRenderAll()
    }

    /**
     * Auto-fit font size estimation.
     * Given text content and a bounding box, finds the largest font size
     * where the text fits within the box dimensions.
     * Uses binary search for efficiency.
     */
    const estimateBestFontSize = (
        text: string,
        boxWidth: number,
        boxHeight: number,
        fontFamily: string
    ): number => {
        if (!text || text.trim().length === 0) return 10

        // Create a reusable measurement canvas
        const measureCanvas = document.createElement('canvas')
        const measureCtx = measureCanvas.getContext('2d')
        if (!measureCtx) return Math.max(8, Math.round(boxHeight * 0.6))

        const measureAtSize = (size: number): { textWidth: number; lineHeight: number; numLines: number } => {
            measureCtx.font = `normal normal ${size}px ${fontFamily}`
            const singleLineText = text.replace(/\r?\n/g, '')
            const textWidth = measureCtx.measureText(singleLineText).width
            const lineHeight = size * 1.2 // Approximate line height

            // Estimate number of lines needed if text wraps
            const usableWidth = boxWidth - 8 // Small padding
            const numLines = usableWidth > 0 ? Math.ceil(textWidth / usableWidth) : 1

            return { textWidth, lineHeight, numLines }
        }

        // Binary search: find max fontSize where text fits in box
        let lo = 6   // Minimum readable font size
        let hi = Math.min(boxHeight, 200) // Cap at box height or 200px
        let bestSize = lo

        // Quick check: does the text content suggest single line or multi-line?
        const contentLength = text.replace(/\r?\n/g, '').length

        // For CJK characters, each char is roughly 1em wide
        const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)

        // Maximum font size heuristic: for single-line text, height-based cap
        // For multi-char text, also consider width
        if (hasCJK) {
            // CJK: each character ≈ 1em wide, so maxFontSize ≈ boxWidth / charCount
            const widthBasedMax = contentLength > 0 ? boxWidth / contentLength : boxHeight
            hi = Math.min(hi, Math.max(widthBasedMax * 1.1, boxHeight * 0.9))
        }

        while (lo <= hi) {
            const mid = Math.round((lo + hi) / 2)
            if (mid < 6) break

            const { lineHeight, numLines } = measureAtSize(mid)
            const totalHeight = lineHeight * numLines

            if (totalHeight <= boxHeight && numLines <= Math.max(1, Math.floor(boxHeight / lineHeight))) {
                bestSize = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }

        // Final clamp: never exceed box height, and have a reasonable minimum
        return Math.max(8, Math.min(bestSize, Math.round(boxHeight * 0.85)))
    }

    const convertToEditable = (rect: fabric.Rect, word: OCRWord) => {
        const canvas = fabricRef.current
        if (!canvas) return

        const boxWidth = rect.width || 50
        const boxHeight = rect.height || 12

        // --- Auto-Fit Font Size ---
        const fontFamily = 'Inter, sans-serif'
        // 直排模式：字體大小 ≈ 欄寬（每字占滿欄），不用 estimateBestFontSize（會算出錯誤的極小值）
        const fontSize = word.vertical
            ? Math.max(8, Math.min(Math.round(boxWidth * 0.9), 72))
            : estimateBestFontSize(word.text, boxWidth, boxHeight, fontFamily)

        // Generate ID
        const id = Math.random().toString(36).substr(2, 9)

        // --- Background & Style Logic ---
        let backgroundColor = '#ffffff'
        let textFill = '#4B7599' // Fallback blue
        // let textFontSize = fontSize // We started with this

        // Ensure we have access to the raw image data to sample
        const bgImageObj = canvas.backgroundImage as fabric.Image
        // @ts-ignore
        const imgElement = bgImageObj?._element as HTMLImageElement

        if (imgElement) {
            try {
                // Create a temporary canvas to draw the image and sample pixel
                const tempCanvas = document.createElement('canvas')
                tempCanvas.width = imgElement.width
                tempCanvas.height = imgElement.height
                const ctx = tempCanvas.getContext('2d', { willReadFrequently: true })

                if (ctx) {
                    ctx.drawImage(imgElement, 0, 0)

                    const bbox = {
                        x0: rect.left || 0,
                        y0: rect.top || 0,
                        x1: (rect.left || 0) + (rect.width || 0),
                        y1: (rect.top || 0) + (rect.height || 0)
                    }


                    // 1. Get Background Color (Median of Edges)
                    backgroundColor = inpaintingService.getBackgroundMaskColor(ctx, bbox)

                    // CRITICAL FIX: Check if sampled color is blue (OCR hotspot color)
                    // OCR hotspots use rgba(74, 158, 255, ...) which might be sampled
                    // Convert hex to RGB and check if it's bluish
                    const hexToRgb = (hex: string) => {
                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
                        return result ? {
                            r: parseInt(result[1], 16),
                            g: parseInt(result[2], 16),
                            b: parseInt(result[3], 16)
                        } : null
                    }

                    const rgb = hexToRgb(backgroundColor)
                    if (rgb) {
                        // Check if color is bluish (b > r && b > g) and relatively saturated
                        const isBlue = rgb.b > rgb.r && rgb.b > rgb.g && (rgb.b - Math.max(rgb.r, rgb.g)) > 30
                        if (isBlue) {
                            // Replace with white
                            backgroundColor = '#ffffff'
                        }
                    }

                    // 2. Get Text Style (Darkest pixel analysis)
                    const style = inpaintingService.getTextStyle(ctx, bbox, fontSize)
                    textFill = style.fill
                    // We can also use style.fontSize if we implement better heuristics later
                }
            } catch (e) {
            }
        }

        // --- Create Textbox with Background Mask ---
        // 直排模式：寬度 = fontSize + 小 padding，讓每字一行形成直書視覺
        // 橫排模式：從 OCR bbox + buffer 開始，再依實際文字寬度展開
        const effectiveWidth = word.vertical
            ? Math.round(fontSize * 1.1) + 8
            : Math.max(rect.width || 0, 50) + 20
        const measureTextWidthAtSize = (content: string, sizePx: number, family: string) => {
            if (typeof document === 'undefined') return 0
            const measurementCanvas = document.createElement('canvas')
            const measurementCtx = measurementCanvas.getContext('2d')
            if (!measurementCtx) return 0
            measurementCtx.font = `normal normal ${sizePx}px ${family}`
            return measurementCtx.measureText((content || '').replace(/\r?\n/g, '')).width
        }

        const text = new VerticalTextbox(word.text, {
            left: rect.left,
            top: rect.top,
            width: effectiveWidth,
            fontSize: (fontSize || 10),
            fontFamily: fontFamily,
            fill: textFill,
            backgroundColor: backgroundColor,
            id,
            splitByGrapheme: true,
            textAlign: 'center',
            verticalAlign: 'middle',

            // CRITICAL: Allow both horizontal and vertical scaling, but convert to width/height via event handler
            lockScalingX: false,  // Allow horizontal scaling to trigger event handler
            lockScalingY: false,  // Allow vertical scaling to trigger event handler (will convert to height)
            lockRotation: true,
            lockScalingFlip: true,
            lockSkewingX: true,
            lockSkewingY: true,

            // Visual styling
            hasControls: true,
            hasBorders: true,
            cornerSize: 10,
            transparentCorners: false,
            cornerColor: '#4A9EFF',
            cornerStrokeColor: '#ffffff',
            borderColor: '#4A9EFF',
            borderScaleFactor: 2
        } as any)

        if (word.vertical) {
            // 直排：鎖定欄高為 minHeight，寬度已設為一字寬，不展開
            ; (text as any).minHeight = boxHeight
            ; (text as any).height = boxHeight
            ; (text as any).initDimensions?.()
            text.setCoords()
        } else {
            // 橫排：依測量文字寬度展開 textbox
            const measuredWidth = measureTextWidthAtSize(word.text || '', (fontSize || 10), fontFamily)
            const horizontalPadding = 28
            const unzoomedCanvasWidth = currentPage?.width || (canvas.getWidth() / (canvas.getZoom() || 1))
            const maxTextboxWidth = Math.max(80, unzoomedCanvasWidth - 8)
            const targetWidth = Math.min(
                maxTextboxWidth,
                Math.max(effectiveWidth, Math.ceil(measuredWidth + horizontalPadding))
            )

            if (targetWidth > effectiveWidth) {
                const originalLeft = rect.left || 0
                const originalCenterX = originalLeft + (effectiveWidth / 2)
                const maxLeft = Math.max(0, maxTextboxWidth - targetWidth)
                const adjustedLeft = Math.min(Math.max(0, originalCenterX - (targetWidth / 2)), maxLeft)
                text.set({
                    width: targetWidth,
                    left: adjustedLeft
                })
                    ; (text as any).initDimensions?.()
                text.setCoords()
            }

            // Initialize minHeight based on initial height to preserve user-visible box height
            ; (text as any).minHeight = text.height || (rect.height || 0)
        }

        // Attach standard controls & scaling behavior
        attachTextObjectBehavior(canvas, text)

        canvas.remove(rect)

        // Add text only (Mask is now part of text)
        canvas.add(text)

        canvas.setActiveObject(text)
        setCanvasState(currentPageIndex, canvas.toJSON(['id', 'name', 'width', 'height', 'minHeight', 'verticalAlign']))

        // Trigger property update immediately
        setActiveObjectProperties({
            id,
            text: word.text,
            fontSize,
            fill: textFill,
            visible: true,
            fontFamily: 'Inter, sans-serif',
            textAlign: 'center',
            verticalAlign: 'middle'
        })
    }

    // Normalize multi-selection scaling for text objects:
    // convert scale to width/height so text reflows instead of being stretched.
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const SCALE_EPSILON = 1e-3
        const MIN_TEXT_BOX_SIZE = 20

        const handleMultiSelectionModified = (e: any) => {
            if (isNormalizingMultiSelectionRef.current) return

            const target = e?.target as any
            if (!target || target.type !== 'activeSelection' || !Array.isArray(target._objects)) return

            const sx = Number(target.scaleX ?? 1)
            const sy = Number(target.scaleY ?? 1)
            if (Math.abs(sx - 1) < SCALE_EPSILON && Math.abs(sy - 1) < SCALE_EPSILON) return

            const selected = target._objects.slice().filter(Boolean)
            if (selected.length === 0) return
            if (!selected.some((obj: any) => isTextEditableObject(obj))) return

            isNormalizingMultiSelectionRef.current = true
            try {
                // Realize ActiveSelection transform onto child objects in canvas coordinates.
                canvas.discardActiveObject()

                selected.forEach((obj: any) => {
                    if (!obj) return

                    if (isTextEditableObject(obj)) {
                        const currentScaleX = Number(obj.scaleX ?? 1)
                        const currentScaleY = Number(obj.scaleY ?? 1)
                        const baseWidth = Number(obj.width ?? 0)
                        const baseHeight = Number(obj.minHeight ?? obj.height ?? 0)

                        const newWidth = Math.max(MIN_TEXT_BOX_SIZE, baseWidth * currentScaleX)
                        const newHeight = Math.max(MIN_TEXT_BOX_SIZE, baseHeight * currentScaleY)

                        obj.set({
                            width: newWidth,
                            height: newHeight,
                            minHeight: newHeight,
                            scaleX: 1,
                            scaleY: 1
                        })
                        obj.setCoords?.()
                        return
                    }

                    // Non-text objects keep Fabric's default scaling result.
                    obj.setCoords?.()
                })

                const reselection = new fabric.ActiveSelection(selected, { canvas })
                canvas.setActiveObject(reselection)
                reselection.setCoords()
                canvas.requestRenderAll()
            } finally {
                isNormalizingMultiSelectionRef.current = false
            }
        }

        canvas.on('object:modified', handleMultiSelectionModified)
        return () => {
            canvas.off('object:modified', handleMultiSelectionModified)
        }
    }, [])

    // Save state listener
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const normalizeTextStyles = (obj: any) => {
            if (!(obj instanceof fabric.IText || obj instanceof fabric.Textbox)) return
            const styles = (obj as any).styles
            if (styles && Object.keys(styles).length > 0) {
                obj.set('styles', {})
                obj.dirty = true
            }
        }

        const save = () => {
            const activeObj = canvas.getActiveObject()

            // Use flushSync to確保在 React 18 批次更新下，
            // Canvas 狀態快照會立即寫入 store（提供穩定的 Undo/Redo）

            if (activeObj) {
                normalizeTextStyles(activeObj)
            }

            flushSync(() => {
                // Save canvas state - this will complete before flushSync returns
                setCanvasState(currentPageIndex, canvas.toJSON(['id', 'name', 'width', 'height', 'minHeight', 'verticalAlign']))
            })

            // Update properties panel if object is selected
            // DO NOT call setActiveObject or requestRenderAll - causes flicker
            if (activeObj) {
                // Update properties panel to reflect current state
                if (!(activeObj as any).id) {
                    (activeObj as any).id = Math.random().toString(36).substr(2, 9)
                }

                setActiveObjectProperties({
                    id: (activeObj as any).id,
                    text: (activeObj as any).text,
                    fontSize: (activeObj as any).fontSize,
                    fill: (activeObj as any).fill as string,
                    backgroundColor: (activeObj as any).backgroundColor as string,
                    visible: true,
                    fontFamily: (activeObj as any).fontFamily,
                    textAlign: (activeObj as any).textAlign,
                    verticalAlign: (activeObj as any).verticalAlign
                })
            }
        }

        canvas.on('object:modified', save)
        canvas.on('text:changed', save)

        return () => {
            canvas.off('object:modified', save)
            canvas.off('text:changed', save)
        }
    }, [currentPageIndex, setCanvasState])

    // Force save snapshot on demand (e.g., before export)
    useEffect(() => {
        const canvas = fabricRef.current
        if (!canvas) return

        const handleSaveCurrentPage = () => {
            if (!canvas.getElement() || !canvas.getContext()) return
            setCanvasState(currentPageIndex, canvas.toJSON(['id', 'name', 'width', 'height', 'minHeight', 'verticalAlign']))
        }

        window.addEventListener('canvas:saveCurrentPage', handleSaveCurrentPage)
        return () => {
            window.removeEventListener('canvas:saveCurrentPage', handleSaveCurrentPage)
        }
    }, [currentPageIndex, setCanvasState])

    return {
        canvasRef,
        fabricRef,
        addHotspots
    }
}

