import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '@/shared/store/useStore'
import { useTextOverlay } from '@/domains/canvas/hooks/useTextOverlay'
import type { OCRWord } from '@/domains/ocr/services/ocr'
import { cn } from '@/shared/lib/utils'
import { Type, Bold, Italic, Trash2 } from 'lucide-react'
import { ConfidenceIndicator } from '@/domains/canvas/components/ConfidenceIndicator'
import { useTranslation } from 'react-i18next'

export interface TextBox extends OCRWord {
  id: string
  editable: boolean
  selected: boolean
  formatting: TextFormatting
  isEditing?: boolean
}

export interface TextFormatting {
  fontSize: number
  fontFamily: string
  color: string
  backgroundColor?: string
  bold: boolean
  italic: boolean
  writingMode?: 'horizontal-tb' | 'vertical-rl'
}

interface TextOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  visible?: boolean
}

export function TextOverlay({ canvasRef, visible = true }: TextOverlayProps) {
  const { t } = useTranslation()
  const { pages, currentPageIndex } = useStore()
  const {
    textBoxes,
    selectedTextBoxes,
    selectTextBoxes,
    clearSelection,
    updateTextContent,
    updateTextPosition,
    applyFormatting,
    deleteSelected
  } = useTextOverlay()

  const [dragState, setDragState] = useState<{
    isDragging: boolean
    dragType: 'move' | 'resize'
    startPos: { x: number; y: number }
    initialBoxes: Map<string, OCRWord['bbox']> // Store initial positions of ALL dragged boxes
    initialBox?: TextBox // Keep for resize reference
    resizeHandle?: 'e' | 'w' // Only horizontal resize to prevent text deformation
  }>({
    isDragging: false,
    dragType: 'move',
    startPos: { x: 0, y: 0 },
    initialBoxes: new Map()
  })
  const [clearSelectionDebounce, setClearSelectionDebounce] = useState<NodeJS.Timeout | null>(null)
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null)
  const [showFormatPanel, setShowFormatPanel] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const currentPage = pages[currentPageIndex]

  // Get canvas position and dimensions
  const getCanvasRect = useCallback(() => {
    if (!canvasRef.current) return null
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      width: canvas.width,
      height: canvas.height,
      displayWidth: rect.width,
      displayHeight: rect.height
    }
  }, [canvasRef])

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = useCallback((x: number, y: number) => {
    const canvasRect = getCanvasRect()
    if (!canvasRect || !currentPage || currentPage.width <= 0 || currentPage.height <= 0) {
      return { x: 0, y: 0 }
    }

    // Convert from page-space (OCR bbox) to screen-space.
    // The Fabric canvas element size already reflects effective zoom (fitRatio * zoom),
    // so map using the original page dimensions.
    const scaleX = canvasRect.displayWidth / currentPage.width
    const scaleY = canvasRect.displayHeight / currentPage.height

    return {
      x: x * scaleX,
      y: y * scaleY
    }
  }, [getCanvasRect, currentPage])

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((x: number, y: number) => {
    const canvasRect = getCanvasRect()
    if (!canvasRect || !currentPage || currentPage.width <= 0 || currentPage.height <= 0) {
      return { x: 0, y: 0 }
    }

    const scaleX = canvasRect.displayWidth / currentPage.width
    const scaleY = canvasRect.displayHeight / currentPage.height

    return {
      x: (x - canvasRect.left) / scaleX,
      y: (y - canvasRect.top) / scaleY
    }
  }, [getCanvasRect, currentPage])

  // Handle text box selection
  const handleBoxSelect = useCallback((boxId: string, multiSelect: boolean = false) => {
    selectTextBoxes([boxId], multiSelect)
  }, [selectTextBoxes])

  // Handle text editing
  const handleTextEdit = useCallback((boxId: string) => {
    setEditingBoxId(boxId)
  }, [])

  // Save text edit
  const handleTextSave = useCallback((boxId: string, newText: string) => {
    updateTextContent(boxId, newText)
    setEditingBoxId(null)
  }, [updateTextContent])

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent, boxId: string, dragType: 'move' | 'resize', resizeHandle?: string) => {
    e.preventDefault()
    e.stopPropagation() // Prevent event bubbling

    const box = textBoxes.find(b => b.id === boxId)
    if (!box) return

    const canvasPos = screenToCanvas(e.clientX, e.clientY)

    // Capture initial positions for ALL selected boxes (or just this one if not selected)
    const initialPositions = new Map<string, OCRWord['bbox']>()

    // Determine which boxes we are dragging
    const draggingIds = selectedTextBoxes.has(boxId)
      ? Array.from(selectedTextBoxes)
      : [boxId]

    // Capture state snippet
    draggingIds.forEach(id => {
      const b = textBoxes.find(item => item.id === id)
      if (b) {
        // DEEP COPY the bbox to prevent reference mutation issues
        initialPositions.set(id, { ...b.bbox })
      }
    })

    // Also select the box if not already selected
    if (!selectedTextBoxes.has(boxId)) {
      handleBoxSelect(boxId, e.ctrlKey || e.metaKey)
    }

    setDragState({
      isDragging: true,
      dragType,
      startPos: canvasPos,
      initialBoxes: initialPositions,
      initialBox: { ...box, bbox: { ...box.bbox } }, // Deep copy for resize logic
      resizeHandle: resizeHandle as any
    })

  }, [textBoxes, selectedTextBoxes, screenToCanvas, handleBoxSelect])

  // Handle drag move
  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!dragState.isDragging) return

    const canvasPos = screenToCanvas(e.clientX, e.clientY)
    const deltaX = canvasPos.x - dragState.startPos.x
    const deltaY = canvasPos.y - dragState.startPos.y

    if (dragState.dragType === 'move') {
      // Move - Iterate via stored INITIAL positions
      dragState.initialBoxes.forEach((initialBbox, boxId) => {
        const newBbox = {
          x0: initialBbox.x0 + deltaX,
          y0: initialBbox.y0 + deltaY,
          x1: initialBbox.x1 + deltaX,
          y1: initialBbox.y1 + deltaY
        }
        updateTextPosition(boxId, newBbox)
      })

    } else if (dragState.dragType === 'resize' && dragState.initialBox) {
      // Resize - Only horizontal to prevent text deformation (like Google Slides)
      const box = dragState.initialBox
      const handle = dragState.resizeHandle

      let newBbox = { ...box.bbox }

      // Only allow horizontal resizing to prevent text stretching
      switch (handle) {
        case 'e':
          newBbox.x1 = Math.max(box.bbox.x1 + deltaX, box.bbox.x0 + 20)
          break
        case 'w':
          newBbox.x0 = Math.min(box.bbox.x0 + deltaX, box.bbox.x1 - 20)
          break
      }

      updateTextPosition(box.id, newBbox)
    }
  }, [dragState, screenToCanvas, updateTextPosition])

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      dragType: 'move',
      startPos: { x: 0, y: 0 },
      initialBoxes: new Map()
    })
    // DO NOT clear selection here - this causes the properties panel to flicker
    // Selection should only be cleared when user explicitly clicks on empty space
  }, [])

  // Mouse event handlers
  useEffect(() => {
    if (dragState.isDragging) {
      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('mouseup', handleDragEnd)

      return () => {
        document.removeEventListener('mousemove', handleDragMove)
        document.removeEventListener('mouseup', handleDragEnd)
      }
    }
  }, [dragState.isDragging, handleDragMove, handleDragEnd])

  // Delete selected text boxes (keyboard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) {
          return
        }
      }
      deleteSelected()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelected])

  // Apply formatting to selected boxes
  const handleApplyFormatting = useCallback((formatting: Partial<TextFormatting>) => {
    applyFormatting(formatting)
  }, [applyFormatting])

  // Delete selected boxes
  const handleDeleteSelected = useCallback(() => {
    deleteSelected()
  }, [deleteSelected])

  // Clear selection with debounce to prevent flicker during rapid operations
  const handleClearSelection = useCallback(() => {
    // Clear any existing debounce timer
    if (clearSelectionDebounce) {
      clearTimeout(clearSelectionDebounce)
    }

    // Set a small debounce to prevent flicker when dragging
    const timer = setTimeout(() => {
      clearSelection()
      setClearSelectionDebounce(null)
    }, 100)

    setClearSelectionDebounce(timer)
  }, [clearSelection, clearSelectionDebounce])

  // Handle overlay click (clear selection)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClearSelection()
    }
  }, [handleClearSelection])

  if (!visible || textBoxes.length === 0) return null

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-10"
      onClick={handleOverlayClick}
    >
      {/* Text Boxes */}
      {textBoxes.map(box => {
        const screenPos = canvasToScreen(box.bbox.x0, box.bbox.y0)
        const screenSize = canvasToScreen(box.bbox.x1 - box.bbox.x0, box.bbox.y1 - box.bbox.y0)

        return (
          <TextBoxComponent
            key={box.id}
            box={box}
            position={screenPos}
            size={screenSize}
            isEditing={editingBoxId === box.id}
            onSelect={handleBoxSelect}
            onEdit={handleTextEdit}
            onSave={handleTextSave}
            onDragStart={handleDragStart}
          />
        )
      })}

      {/* Format Panel */}
      {selectedTextBoxes.size > 0 && (
        <FormatPanel
          tSelectedCount={t('textOverlay.selectedCount', { count: selectedTextBoxes.size })}
          onApplyFormatting={handleApplyFormatting}
          onDelete={handleDeleteSelected}
          onTogglePanel={() => setShowFormatPanel(!showFormatPanel)}
          isExpanded={showFormatPanel}
        />
      )}
    </div>
  )
}

// Individual Text Box Component
interface TextBoxComponentProps {
  box: TextBox
  position: { x: number; y: number }
  size: { x: number; y: number }
  isEditing: boolean
  onSelect: (id: string, multiSelect: boolean) => void
  onEdit: (id: string) => void
  onSave: (id: string, text: string) => void
  onDragStart: (e: React.MouseEvent, id: string, type: 'move' | 'resize', handle?: string) => void
}

function TextBoxComponent({
  box,
  position,
  size,
  isEditing,
  onSelect,
  onEdit,
  onSave,
  onDragStart
}: TextBoxComponentProps) {
  const [editText, setEditText] = useState(box.text)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(box.id, e.ctrlKey || e.metaKey)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(box.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSave(box.id, editText)
    } else if (e.key === 'Escape') {
      setEditText(box.text)
      onSave(box.id, box.text)
    }
  }

  const handleBlur = () => {
    onSave(box.id, editText)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text/plain')
    const target = e.target as HTMLTextAreaElement
    const selectionStart = target.selectionStart ?? editText.length
    const selectionEnd = target.selectionEnd ?? editText.length
    const nextValue = `${editText.slice(0, selectionStart)}${pastedText}${editText.slice(selectionEnd)}`
    setEditText(nextValue)
  }

  return (
    <div
      className={cn(
        "absolute pointer-events-auto border-2 transition-all duration-200",
        box.selected
          ? "border-blue-500 shadow-lg"
          : "border-transparent hover:border-blue-300"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: Math.max(size.x, 20),
        height: Math.max(size.y, 20),
        backgroundColor: box.formatting.backgroundColor
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={(e) => onDragStart(e, box.id, 'move')}
    >
      {/* Text Content */}
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          className="w-full h-full resize-none border-none outline-none bg-transparent"
          style={{
            fontSize: box.formatting.fontSize,
            fontFamily: box.formatting.fontFamily,
            color: box.formatting.color,
            fontWeight: box.formatting.bold ? 'bold' : 'normal',
            fontStyle: box.formatting.italic ? 'italic' : 'normal',
            writingMode: box.formatting.writingMode ?? 'horizontal-tb'
          }}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-center p-1 cursor-move overflow-hidden"
          style={{
            fontSize: box.formatting.fontSize,
            fontFamily: box.formatting.fontFamily,
            color: box.formatting.color,
            fontWeight: box.formatting.bold ? 'bold' : 'normal',
            fontStyle: box.formatting.italic ? 'italic' : 'normal',
            lineHeight: 1.2,
            wordBreak: box.formatting.writingMode === 'vertical-rl' ? 'normal' : 'break-all',
            writingMode: box.formatting.writingMode ?? 'horizontal-tb'
          }}
        >
          {box.text}
        </div>
      )}

      {/* Resize Handles - Only horizontal to prevent text deformation */}
      {box.selected && !isEditing && (
        <>
          {/* Only show left and right handles for width adjustment */}
          <div
            className="absolute -left-1 top-1/2 transform -translate-y-1/2 w-2 h-8 bg-blue-500 border border-white cursor-w-resize rounded-sm"
            onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, box.id, 'resize', 'w') }}
          />
          <div
            className="absolute -right-1 top-1/2 transform -translate-y-1/2 w-2 h-8 bg-blue-500 border border-white cursor-e-resize rounded-sm"
            onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, box.id, 'resize', 'e') }}
          />
        </>
      )}

      {/* Confidence indicator - Requirement 6.4 */}
      {box.confidence !== undefined && (
        <div className="absolute -top-2 -right-2">
          <ConfidenceIndicator
            confidence={box.confidence}
            size="sm"
          />
        </div>
      )}
    </div>
  )
}

// Format Panel Component
interface FormatPanelProps {
  tSelectedCount: string
  onApplyFormatting: (formatting: Partial<TextFormatting>) => void
  onDelete: () => void
  onTogglePanel: () => void
  isExpanded: boolean
}

function FormatPanel({
  tSelectedCount,
  onApplyFormatting,
  onDelete,
  onTogglePanel,
  isExpanded
}: FormatPanelProps) {
  const { t } = useTranslation()
  const [fontSize, setFontSize] = useState(14)
  const [textColor, setTextColor] = useState('#000000')
  const [backgroundColor, setBackgroundColor] = useState('#ffffff')

  return (
    <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg border pointer-events-auto z-50 max-w-xs">
      <div className="p-2 border-b flex items-center justify-between">
        <span className="text-xs font-medium">
          {tSelectedCount}
        </span>
        <button
          onClick={onTogglePanel}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <Type size={12} />
        </button>
      </div>

      {isExpanded && (
        <div className="p-2 space-y-2">
          {/* Font Size */}
          <div>
            <label className="block text-[10px] font-medium mb-1">{t('textOverlay.fontSize')}</label>
            <input
              type="range"
              min="8"
              max="32"
              value={fontSize}
              onChange={(e) => {
                const size = parseInt(e.target.value)
                setFontSize(size)
                onApplyFormatting({ fontSize: size })
              }}
              className="w-full h-1"
            />
            <span className="text-[10px] text-gray-500">{fontSize}px</span>
          </div>

          {/* Text Color */}
          <div>
            <label className="block text-[10px] font-medium mb-1">{t('textOverlay.textColor')}</label>
            <input
              type="color"
              value={textColor}
              onChange={(e) => {
                setTextColor(e.target.value)
                onApplyFormatting({ color: e.target.value })
              }}
              className="w-full h-6 rounded border"
            />
          </div>

          {/* Background Color */}
          <div>
            <label className="block text-[10px] font-medium mb-1">{t('textOverlay.backgroundColor')}</label>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => {
                const color = e.target.value
                setBackgroundColor(color)
                onApplyFormatting({ backgroundColor: `${color}CC` }) // Add transparency
              }}
              className="w-full h-6 rounded border"
            />
          </div>

          {/* Style Buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => onApplyFormatting({ bold: true })}
              className="flex-1 p-1.5 border rounded hover:bg-gray-50 flex items-center justify-center"
            >
              <Bold size={10} />
            </button>
            <button
              onClick={() => onApplyFormatting({ italic: true })}
              className="flex-1 p-1.5 border rounded hover:bg-gray-50 flex items-center justify-center"
            >
              <Italic size={10} />
            </button>
            <button
              onClick={onDelete}
              className="flex-1 p-1.5 border rounded hover:bg-red-50 text-red-600 flex items-center justify-center"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
