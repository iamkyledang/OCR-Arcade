import { create } from 'zustand'
import type { OCRWord, OCRLanguage, SegmentationMethod } from '@/domains/ocr/services/ocr'
import type { TextBox, TextFormatting } from '@/domains/canvas/components/TextOverlay'
import type { ScreenSize } from '@/domains/layout/services/ResponsiveLayoutManager'

export interface PageData {
    imageData: string // Data URL
    width: number
    height: number
    ocrData?: OCRWord[] // Added optional OCR results
    textOverlayData?: TextBox[] // Added optional text overlay data
}

export type ActiveObjectMixedKey =
    | 'fontSize'
    | 'fill'
    | 'backgroundColor'
    | 'fontFamily'
    | 'fontWeight'
    | 'fontStyle'
    | 'textAlign'
    | 'verticalAlign'
    | 'text'

interface AppState {
    // Data
    pages: PageData[]
    canvasStates: any[] // Fabric JSON
    currentPageIndex: number

    // History Stack for Undo/Redo
    history: {
        past: any[][]
        future: any[][]
    }

    // UI State
    isLoading: boolean
    loadingText: string
    loadingProgress: number
    layout: 'topbar' | 'sidebar'
    isSidebarCollapsed: boolean
    zoom: number
    ocrLanguage: OCRLanguage
    ocrSegmentation: SegmentationMethod
    ocrHasTriggered: boolean
    ocrPromptDismissed: boolean
    ocrStatus: 'idle' | 'processing' | 'completed' | 'error'
    ocrProgress: number

    // Responsive Layout State
    screenSize: ScreenSize
    isToolbarCompact: boolean
    isSidebarOverlayMode: boolean
    selectedObjectCount: number



    // Text Overlay State
    textOverlayEnabled: boolean
    textBoxes: TextBox[]
    selectedTextBoxes: Set<string>
    textOverlayHistory: {
        past: TextBox[][]
        future: TextBox[][]
    }

    // Actions
    setPages: (pages: PageData[]) => void
    setPageOCRData: (index: number, data: OCRWord[]) => void
    setCurrentPageIndex: (index: number) => void
    setCanvasState: (index: number, state: any) => void
    setLoading: (isLoading: boolean, text?: string, progress?: number) => void
    setLayout: (layout: 'topbar' | 'sidebar') => void
    toggleSidebar: () => void
    isPropertiesPanelCollapsed: boolean
    togglePropertiesPanel: () => void
    setPropertiesPanelCollapsed: (collapsed: boolean) => void
    setZoom: (zoom: number) => void
    setOcrLanguage: (lang: OCRLanguage) => void
    setOcrSegmentation: (seg: SegmentationMethod) => void
    setOcrPromptDismissed: (dismissed: boolean) => void
    markOcrTriggered: () => void
    setOcrStatus: (status: 'idle' | 'processing' | 'completed' | 'error') => void
    setOcrProgress: (progress: number) => void
    reset: () => void

    // Responsive Layout Actions
    setScreenSize: (size: ScreenSize) => void
    setToolbarCompact: (compact: boolean) => void
    setSidebarOverlayMode: (overlay: boolean) => void
    toggleSidebarOverlay: () => void
    setSelectedObjectCount: (count: number) => void


    // Format Painter
    copiedStyle: Record<string, any> | null
    isFormatPainterActive: boolean
    setCopiedStyle: (style: Record<string, any> | null) => void
    setIsFormatPainterActive: (active: boolean) => void
    activeObjectProperties: ActiveObjectProps | null
    pendingPropertyPatch: Partial<ActiveObjectProps> | null
    lastUpdateSource: 'user' | 'canvas' | null
    setActiveObjectProperties: (props: ActiveObjectProps | null, source?: 'user' | 'canvas') => void
    updateActiveObjectProperty: (key: keyof ActiveObjectProps, value: any) => void
    setPendingPropertyPatch: (patch: Partial<ActiveObjectProps>) => void
    clearPendingPropertyPatch: () => void

    // Text Overlay Actions
    setTextOverlayEnabled: (enabled: boolean) => void
    setTextBoxes: (boxes: TextBox[]) => void
    updateTextBox: (id: string, updates: Partial<TextBox>) => void
    deleteTextBoxes: (ids: string[]) => void
    setSelectedTextBoxes: (ids: Set<string>) => void
    applyFormattingToSelected: (formatting: Partial<TextFormatting>) => void
    saveTextOverlayState: () => void
    restoreTextOverlayState: () => void

    // Undo/Redo
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    undoTextOverlay: () => void
    redoTextOverlay: () => void
    canUndoTextOverlay: () => boolean
    canRedoTextOverlay: () => boolean
}

export interface ActiveObjectProps {
    id?: string
    text?: string
    fontSize?: number
    fill?: string
    backgroundColor?: string
    visible: boolean
    fontFamily?: string
    fontWeight?: string | number
    fontStyle?: string
    textAlign?: string
    verticalAlign?: 'top' | 'middle' | 'bottom'  // 新增垂直對齊
    mixed?: Partial<Record<ActiveObjectMixedKey, boolean>>
}

export const useStore = create<AppState>((set, get) => ({
    pages: [],
    canvasStates: [],
    currentPageIndex: 0,

    history: {
        past: [],
        future: []
    },

    isLoading: false,
    loadingText: '',
    loadingProgress: 0,
    layout: 'topbar',
    isSidebarCollapsed: false,
    zoom: 1.0,
    ocrLanguage: 'chi_tra',
    ocrSegmentation: 'tesseract',
    ocrHasTriggered: false,
    ocrPromptDismissed: false,
    ocrStatus: 'idle',
    ocrProgress: 0,

    // Responsive Layout Defaults
    screenSize: 'desktop' as ScreenSize,
    isToolbarCompact: false,
    isSidebarOverlayMode: false,
    selectedObjectCount: 0,



    // Text Overlay Defaults
    textOverlayEnabled: true,
    textBoxes: [],
    selectedTextBoxes: new Set(),
    textOverlayHistory: {
        past: [],
        future: []
    },

    setPages: (pages) => {
        const hasOcrData = pages.some((page) => !!page.ocrData && page.ocrData.length > 0)
        set({
            pages,
            canvasStates: new Array(pages.length).fill(null),
            currentPageIndex: 0,
            ocrHasTriggered: hasOcrData,
            ocrPromptDismissed: false,
            ocrStatus: 'idle',
            ocrProgress: 0,
            pendingPropertyPatch: null
        })
    },

    setPageOCRData: (index, data) => set((state) => {
        const newPages = [...state.pages]
        if (newPages[index]) {
            newPages[index] = { ...newPages[index], ocrData: data }
        }
        return { pages: newPages }
    }),

    setCurrentPageIndex: (index) => set({ currentPageIndex: index }),

    setCanvasState: (index, state) => set((prev) => {
        const newStates = [...prev.canvasStates]
        newStates[index] = state

        // Push current state to history before updating
        const newPast = [...prev.history.past, prev.canvasStates]
        // Limit history to last 20 states
        const limitedPast = newPast.slice(-20)

        return {
            canvasStates: newStates,
            history: {
                past: limitedPast,
                future: [] // Clear future when new change is made
            }
        }
    }),

    setLoading: (isLoading, text = '', progress = 0) => set({
        isLoading,
        loadingText: text,
        loadingProgress: progress
    }),

    setLayout: (layout) => set({ layout }),

    toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

    isPropertiesPanelCollapsed: false,
    togglePropertiesPanel: () => set((state) => ({ isPropertiesPanelCollapsed: !state.isPropertiesPanelCollapsed })),
    setPropertiesPanelCollapsed: (collapsed) => set({ isPropertiesPanelCollapsed: collapsed }),

    setZoom: (zoom) => set({ zoom }),
    setOcrLanguage: (lang) => set({ ocrLanguage: lang }),
    setOcrSegmentation: (seg) => set({ ocrSegmentation: seg }),
    setOcrPromptDismissed: (dismissed) => set({ ocrPromptDismissed: dismissed }),
    markOcrTriggered: () => set({ ocrHasTriggered: true }),
    setOcrStatus: (status) => set({ ocrStatus: status }),
    setOcrProgress: (progress) => set({ ocrProgress: progress }),

    reset: () => set({
        pages: [],
        canvasStates: [],
        currentPageIndex: 0,
        zoom: 1.0,
        isLoading: false,
        ocrHasTriggered: false,
        ocrPromptDismissed: false,
        ocrStatus: 'idle',
        ocrProgress: 0,
        selectedObjectCount: 0,
        pendingPropertyPatch: null,
        isPropertiesPanelCollapsed: false,

        textOverlayEnabled: true,
        textBoxes: [],
        selectedTextBoxes: new Set(),
        textOverlayHistory: { past: [], future: [] }
    }),



    // Format Painter
    copiedStyle: null,
    isFormatPainterActive: false,
    setCopiedStyle: (style) => set({ copiedStyle: style }),
    setIsFormatPainterActive: (active) => set({ isFormatPainterActive: active }),
    activeObjectProperties: null,
    pendingPropertyPatch: null,
    lastUpdateSource: null,
    setActiveObjectProperties: (props, source = 'canvas') => set({ activeObjectProperties: props, lastUpdateSource: source }),
    updateActiveObjectProperty: (key, value) =>
        set((state) => {
            if (!state.activeObjectProperties) return {}
            return {
                activeObjectProperties: { ...state.activeObjectProperties, [key]: value },
                pendingPropertyPatch: { [key]: value },
                lastUpdateSource: 'user'
            }
        }),
    setPendingPropertyPatch: (patch) => set({ pendingPropertyPatch: patch, lastUpdateSource: 'user' }),
    clearPendingPropertyPatch: () => set({ pendingPropertyPatch: null }),




    // Undo/Redo Implementation
    undo: () => {
        const state = get()
        if (state.history.past.length === 0) return

        const previous = state.history.past[state.history.past.length - 1]
        const newPast = state.history.past.slice(0, -1)

        set({
            canvasStates: previous,
            history: {
                past: newPast,
                future: [state.canvasStates, ...state.history.future]
            }
        })
    },

    redo: () => {
        const state = get()
        if (state.history.future.length === 0) return

        const next = state.history.future[0]
        const newFuture = state.history.future.slice(1)

        set({
            canvasStates: next,
            history: {
                past: [...state.history.past, state.canvasStates],
                future: newFuture
            }
        })
    },

    canUndo: () => {
        return get().history.past.length > 0
    },

    canRedo: () => {
        return get().history.future.length > 0
    },

    // Text Overlay Actions
    setTextOverlayEnabled: (enabled) => set({ textOverlayEnabled: enabled }),

    setTextBoxes: (boxes) => {
        const state = get()
        set({
            textBoxes: boxes,
            textOverlayHistory: {
                past: [...state.textOverlayHistory.past, state.textBoxes],
                future: []
            }
        })
    },

    updateTextBox: (id, updates) => {
        const state = get()
        const newBoxes = state.textBoxes.map(box =>
            box.id === id ? { ...box, ...updates } : box
        )
        set({
            textBoxes: newBoxes,
            textOverlayHistory: {
                past: [...state.textOverlayHistory.past, state.textBoxes].slice(-20),
                future: []
            }
        })
    },

    deleteTextBoxes: (ids) => {
        const state = get()
        const newBoxes = state.textBoxes.filter(box => !ids.includes(box.id))
        const newSelection = new Set([...state.selectedTextBoxes].filter(id => !ids.includes(id)))

        set({
            textBoxes: newBoxes,
            selectedTextBoxes: newSelection,
            textOverlayHistory: {
                past: [...state.textOverlayHistory.past, state.textBoxes].slice(-20),
                future: []
            }
        })
    },

    setSelectedTextBoxes: (ids) => set({ selectedTextBoxes: ids }),

    applyFormattingToSelected: (formatting) => {
        const state = get()
        const selectedIds = Array.from(state.selectedTextBoxes)
        const newBoxes = state.textBoxes.map(box =>
            selectedIds.includes(box.id)
                ? { ...box, formatting: { ...box.formatting, ...formatting } }
                : box
        )

        set({
            textBoxes: newBoxes,
            textOverlayHistory: {
                past: [...state.textOverlayHistory.past, state.textBoxes].slice(-20),
                future: []
            }
        })
    },

    saveTextOverlayState: () => {
        const state = get()
        // Save current text overlay state to page data
        const newPages = [...state.pages]
        if (newPages[state.currentPageIndex]) {
            newPages[state.currentPageIndex] = {
                ...newPages[state.currentPageIndex],
                textOverlayData: state.textBoxes
            }
        }
        set({ pages: newPages })
    },

    restoreTextOverlayState: () => {
        const state = get()
        const currentPage = state.pages[state.currentPageIndex]
        if (currentPage?.textOverlayData) {
            set({ textBoxes: currentPage.textOverlayData })
        }
    },

    // Text Overlay Undo/Redo
    undoTextOverlay: () => {
        const state = get()
        if (state.textOverlayHistory.past.length === 0) return

        const previous = state.textOverlayHistory.past[state.textOverlayHistory.past.length - 1]
        const newPast = state.textOverlayHistory.past.slice(0, -1)

        set({
            textBoxes: previous,
            textOverlayHistory: {
                past: newPast,
                future: [state.textBoxes, ...state.textOverlayHistory.future]
            }
        })
    },

    redoTextOverlay: () => {
        const state = get()
        if (state.textOverlayHistory.future.length === 0) return

        const next = state.textOverlayHistory.future[0]
        const newFuture = state.textOverlayHistory.future.slice(1)

        set({
            textBoxes: next,
            textOverlayHistory: {
                past: [...state.textOverlayHistory.past, state.textBoxes],
                future: newFuture
            }
        })
    },

    canUndoTextOverlay: () => {
        return get().textOverlayHistory.past.length > 0
    },

    canRedoTextOverlay: () => {
        return get().textOverlayHistory.future.length > 0
    },

    // Responsive Layout Actions
    setScreenSize: (size) => set((state) => {
        // Auto-collapse sidebar for mobile/tablet
        const shouldCollapse = size === 'mobile' || size === 'tablet'
        const shouldCompact = size === 'mobile'

        return {
            screenSize: size,
            isSidebarCollapsed: shouldCollapse ? true : state.isSidebarCollapsed,
            isToolbarCompact: shouldCompact,
            isSidebarOverlayMode: false // Reset overlay mode on size change
        }
    }),

    setToolbarCompact: (compact) => set({ isToolbarCompact: compact }),

    setSidebarOverlayMode: (overlay) => set({ isSidebarOverlayMode: overlay }),

    toggleSidebarOverlay: () => set((state) => ({
        isSidebarOverlayMode: !state.isSidebarOverlayMode
    })),

    setSelectedObjectCount: (count) => set({ selectedObjectCount: count })
}))
