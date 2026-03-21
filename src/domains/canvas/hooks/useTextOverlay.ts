import { useCallback, useEffect } from 'react'
import { useStore } from '@/shared/store/useStore'
import type { OCRWord } from '@/domains/ocr/services/ocr'
import type { TextBox, TextFormatting } from '@/domains/canvas/components/TextOverlay'

export function useTextOverlay() {
  const {
    pages,
    currentPageIndex,
    textBoxes,
    selectedTextBoxes,
    textOverlayEnabled,
    setTextBoxes,
    updateTextBox,
    deleteTextBoxes,
    setSelectedTextBoxes,
    applyFormattingToSelected,
    setTextOverlayEnabled,
    saveTextOverlayState,
    restoreTextOverlayState,
    undoTextOverlay,
    redoTextOverlay,
    canUndoTextOverlay,
    canRedoTextOverlay
  } = useStore()

  // Initialize text boxes from OCR data when page changes
  useEffect(() => {
    const currentPage = pages[currentPageIndex]
    if (currentPage?.textOverlayData && textOverlayEnabled) {
      // Only restore SAVED overlay state (from history/page switch), NOT fresh OCR data
      setTextBoxes(currentPage.textOverlayData)
    } else if (!textOverlayEnabled) {
      setTextBoxes([])
    }
  }, [pages, currentPageIndex, textOverlayEnabled, setTextBoxes])

  // Convert OCR data to text boxes
  const initializeFromOCR = useCallback((ocrData: OCRWord[]) => {
    const boxes: TextBox[] = ocrData.map((word, index) => {
      const boxHeight = word.bbox.y1 - word.bbox.y0
      const boxWidth = word.bbox.x1 - word.bbox.x0
      const textLen = (word.text || '').length

      let autoFontSize: number
      if (word.vertical) {
        // 直排：每個 CJK 字符寬度 ≈ 欄寬，字體大小以欄寬為基準
        autoFontSize = Math.max(8, Math.min(Math.round(boxWidth * 0.9), 72))
      } else {
        // 橫排：原有邏輯
        const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(word.text || '')
        const estimatedCharWidth = hasCJK ? 1.0 : 0.6
        const widthBasedSize = textLen > 0 ? boxWidth / (textLen * estimatedCharWidth) : boxHeight * 0.7
        const heightBasedSize = boxHeight * 0.8
        autoFontSize = Math.max(8, Math.min(Math.round(Math.min(widthBasedSize, heightBasedSize)), 72))
      }

      return {
        ...word,
        id: word.id || `text-${currentPageIndex}-${index}`,
        editable: true,
        selected: false,
        formatting: {
          fontSize: autoFontSize,
          fontFamily: 'Arial, sans-serif',
          color: '#000000',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          bold: false,
          italic: false,
          writingMode: word.vertical ? 'vertical-rl' : 'horizontal-tb'
        }
      }
    })
    setTextBoxes(boxes)
  }, [currentPageIndex, setTextBoxes])

  // Select text boxes
  const selectTextBoxes = useCallback((ids: string[], multiSelect: boolean = false) => {
    const newSelection = new Set(selectedTextBoxes)

    if (multiSelect) {
      ids.forEach(id => {
        if (newSelection.has(id)) {
          newSelection.delete(id)
        } else {
          newSelection.add(id)
        }
      })
    } else {
      newSelection.clear()
      ids.forEach(id => newSelection.add(id))
    }

    setSelectedTextBoxes(newSelection)

    // Update text box selected state
    const updatedBoxes = textBoxes.map(box => ({
      ...box,
      selected: newSelection.has(box.id)
    }))
    setTextBoxes(updatedBoxes)
  }, [selectedTextBoxes, textBoxes, setSelectedTextBoxes, setTextBoxes])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedTextBoxes(new Set())
    const updatedBoxes = textBoxes.map(box => ({ ...box, selected: false }))
    setTextBoxes(updatedBoxes)
  }, [textBoxes, setSelectedTextBoxes, setTextBoxes])

  // Update text content
  const updateTextContent = useCallback((id: string, text: string) => {
    updateTextBox(id, { text })
  }, [updateTextBox])

  // Update text box position
  const updateTextPosition = useCallback((id: string, bbox: OCRWord['bbox']) => {
    updateTextBox(id, { bbox })
  }, [updateTextBox])

  // Apply formatting to selected boxes
  const applyFormatting = useCallback((formatting: Partial<TextFormatting>) => {
    applyFormattingToSelected(formatting)
  }, [applyFormattingToSelected])

  // Delete selected boxes
  const deleteSelected = useCallback(() => {
    const selectedIds = Array.from(selectedTextBoxes)
    if (selectedIds.length > 0) {
      deleteTextBoxes(selectedIds)
    }
  }, [selectedTextBoxes, deleteTextBoxes])

  // Add new text box
  const addTextBox = useCallback((bbox: OCRWord['bbox'], text: string = 'New Text') => {
    const newBox: TextBox = {
      id: `text-${currentPageIndex}-${Date.now()}`,
      text,
      bbox,
      confidence: 1.0,
      editable: true,
      selected: false,
      formatting: {
        fontSize: 14,
        fontFamily: 'Arial, sans-serif',
        color: '#000000',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        bold: false,
        italic: false
      }
    }

    setTextBoxes([...textBoxes, newBox])
  }, [currentPageIndex, textBoxes, setTextBoxes])

  // Toggle text overlay
  const toggleTextOverlay = useCallback(() => {
    setTextOverlayEnabled(!textOverlayEnabled)
  }, [textOverlayEnabled, setTextOverlayEnabled])

  // Save current state
  const saveState = useCallback(() => {
    saveTextOverlayState()
  }, [saveTextOverlayState])

  // Restore saved state
  const restoreState = useCallback(() => {
    restoreTextOverlayState()
  }, [restoreTextOverlayState])

  // Get statistics
  const getStatistics = useCallback(() => {
    const totalBoxes = textBoxes.length
    const selectedCount = selectedTextBoxes.size
    const editableBoxes = textBoxes.filter(box => box.editable).length
    const lowConfidenceBoxes = textBoxes.filter(box =>
      box.confidence !== undefined && box.confidence < 0.8
    ).length

    return {
      totalBoxes,
      selectedCount,
      editableBoxes,
      lowConfidenceBoxes
    }
  }, [textBoxes, selectedTextBoxes])

  return {
    // State
    textBoxes,
    selectedTextBoxes,
    textOverlayEnabled,

    // Actions
    initializeFromOCR,
    selectTextBoxes,
    clearSelection,
    updateTextContent,
    updateTextPosition,
    applyFormatting,
    deleteSelected,
    addTextBox,
    toggleTextOverlay,
    saveState,
    restoreState,

    // Undo/Redo
    undo: undoTextOverlay,
    redo: redoTextOverlay,
    canUndo: canUndoTextOverlay(),
    canRedo: canRedoTextOverlay(),

    // Statistics
    getStatistics
  }
}
