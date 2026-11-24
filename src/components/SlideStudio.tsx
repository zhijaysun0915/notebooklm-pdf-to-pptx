import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  CheckSquare,
  Copy,
  Download,
  Eraser,
  FileDown,
  Italic,
  Layers,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { translations, type Locale } from '../i18n/translations';
import {
  autoSegmentSlideElements,
  sliceManualElementFromBackdrop,
} from '../services/elementSegmenter';
import { exportSlidesToPdf, exportSlidesToPptx } from '../services/exporter';
import { generateCleanedBackground } from '../services/inpaintEngine';
import type {
  ErasePatch,
  GraphicElement,
  SlideItem,
  SplitGranularity,
  TextRegion,
} from '../types/slide';

interface SlideStudioProps {
  locale: Locale;
  deckName: string;
  slides: SlideItem[];
  onChangeSlides: React.Dispatch<React.SetStateAction<SlideItem[]>>;
  onBack: () => void;
}

type ViewLayerMode = 'editable' | 'cleaned' | 'original';
type CanvasTool = 'select' | 'eraser' | 'slice';

interface FollowerOffset {
  id: string;
  origX: number;
  origY: number;
}

export const SlideStudio: React.FC<SlideStudioProps> = ({
  locale,
  deckName,
  slides,
  onChangeSlides,
  onBack,
}) => {
  const t = translations[locale];
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewLayerMode>('editable');
  const [showBounds, setShowBounds] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [groupDrag, setGroupDrag] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [artboardHeight, setArtboardHeight] = useState(495);

  const artboardRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    mode:
      | 'move-text'
      | 'resize-text'
      | 'move-element'
      | 'resize-element'
      | 'erase'
      | 'slice';
    targetId?: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    childRegions?: FollowerOffset[];
    childElements?: FollowerOffset[];
    curX?: number;
    curY?: number;
    curW?: number;
    curH?: number;
  } | null>(null);

  const currentSlide = slides[activeSlideIdx] || slides[0];
  const selectedRegion =
    currentSlide?.regions.find((r) => r.id === selectedRegionId) || null;
  const selectedElement =
    currentSlide?.elements?.find((el) => el.id === selectedElementId) || null;

  const updateCurrentSlide = useCallback(
    (updater: (slide: SlideItem) => SlideItem) => {
      onChangeSlides((prev) =>
        prev.map((s, idx) => (idx === activeSlideIdx ? updater(s) : s))
      );
    },
    [activeSlideIdx, onChangeSlides]
  );

  const updateRegion = useCallback(
    (regionId: string, patch: Partial<TextRegion>) => {
      updateCurrentSlide((s) => ({
        ...s,
        regions: s.regions.map((r) => (r.id === regionId ? { ...r, ...patch } : r)),
      }));
    },
    [updateCurrentSlide]
  );

  const updateElement = useCallback(
    (elementId: string, patch: Partial<GraphicElement>) => {
      updateCurrentSlide((s) => ({
        ...s,
        elements: s.elements.map((el) => (el.id === elementId ? { ...el, ...patch } : el)),
      }));
    },
    [updateCurrentSlide]
  );

  const handleDeleteRegion = useCallback(
    async (regionId: string) => {
      if (!currentSlide) return;
      const nextRegions = currentSlide.regions.filter((r) => r.id !== regionId);
      setSelectedRegionId(null);
      setEditingRegionId(null);
      const cleanedDataUrl =
        currentSlide.sourceType === 'notebooklm-md'
          ? currentSlide.cleanedDataUrl
          : await generateCleanedBackground(
              currentSlide.originalDataUrl,
              nextRegions,
              currentSlide.manualErasePatches
            );
      updateCurrentSlide((s) => ({
        ...s,
        regions: nextRegions,
        cleanedDataUrl,
      }));
    },
    [currentSlide, updateCurrentSlide]
  );

  const handleDeleteElement = useCallback(
    (elementId: string) => {
      setSelectedElementId(null);
      updateCurrentSlide((s) => ({
        ...s,
        elements: s.elements.filter((el) => el.id !== elementId),
      }));
    },
    [updateCurrentSlide]
  );

  const handleDuplicateElement = () => {
    if (!selectedElement) return;
    const copy: GraphicElement = {
      ...selectedElement,
      id: `el-dup-${Date.now()}`,
      xPct: Math.min(94, selectedElement.xPct + 2.5),
      yPct: Math.min(94, selectedElement.yPct + 2.5),
      zIndex: Math.min(8, selectedElement.zIndex + 1),
    };
    updateCurrentSlide((s) => ({
      ...s,
      elements: [...s.elements, copy],
    }));
    setSelectedElementId(copy.id);
  };

  const handleShiftElementZ = (delta: number) => {
    if (!selectedElement) return;
    updateElement(selectedElement.id, {
      zIndex: Math.max(1, Math.min(9, selectedElement.zIndex + delta)),
    });
  };

  const handleResegmentSlide = async (mode: SplitGranularity | 'flat') => {
    if (!currentSlide) return;
    setSelectedElementId(null);
    if (mode === 'flat') {
      updateCurrentSlide((s) => ({
        ...s,
        elements: [],
        baseBackdropDataUrl: undefined,
      }));
      return;
    }
    setBusyAction('segment');
    try {
      const { baseBackdropDataUrl, elements } = await autoSegmentSlideElements(
        currentSlide.cleanedDataUrl,
        mode
      );
      updateCurrentSlide((s) => ({
        ...s,
        baseBackdropDataUrl,
        elements,
      }));
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    const el = artboardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 40) {
          setArtboardHeight(entry.contentRect.height);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentSlide?.id]);

  // Keyboard Delete / Backspace for selected text box OR selected graphic element
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingRegionId) {
        if (selectedRegionId) {
          e.preventDefault();
          void handleDeleteRegion(selectedRegionId);
        } else if (selectedElementId) {
          e.preventDefault();
          handleDeleteElement(selectedElementId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedRegionId,
    selectedElementId,
    editingRegionId,
    handleDeleteRegion,
    handleDeleteElement,
  ]);

  const handleAddTextBox = () => {
    const newBox: TextRegion = {
      id: `manual-${Date.now()}`,
      text: locale === 'zh-Hant' ? '雙擊編輯文字內容' : 'Double-click to edit text',
      xPct: 28,
      yPct: 42,
      wPct: 44,
      hPct: 10,
      fontSizePt: 20,
      fontFamily: 'Microsoft JhengHei',
      color: '#FFFFFF',
      bgColor: 'transparent',
      bold: true,
      italic: false,
      align: 'center',
      role: 'heading',
    };
    updateCurrentSlide((s) => ({
      ...s,
      regions: [...s.regions, newBox],
    }));
    setViewMode('editable');
    setActiveTool('select');
    setSelectedElementId(null);
    setSelectedRegionId(newBox.id);
  };

  const handleRemoveCornerWatermarkAll = async () => {
    setBusyAction('watermark');
    try {
      const updated: SlideItem[] = [];
      for (const s of slides) {
        const watermarkPatch: ErasePatch = {
          id: `wm-${Date.now()}-${s.index}`,
          xPct: 86.5,
          yPct: 92.5,
          wPct: 13,
          hPct: 7,
        };
        const filteredRegions = s.regions.filter(
          (r) => !(r.xPct > 82 && r.yPct > 89 && /notebooklm|gemini/i.test(r.text))
        );
        const filteredElements = (s.elements || []).filter(
          (el) => !(el.xPct > 84 && el.yPct > 90)
        );
        const nextPatches = [...s.manualErasePatches, watermarkPatch];
        const cleanedDataUrl = await generateCleanedBackground(
          s.originalDataUrl,
          filteredRegions,
          nextPatches
        );
        let baseBackdropDataUrl = s.baseBackdropDataUrl;
        if (filteredElements.length > 0 && baseBackdropDataUrl) {
          const seg = await autoSegmentSlideElements(cleanedDataUrl, 'detailed');
          baseBackdropDataUrl = seg.baseBackdropDataUrl;
        }
        updated.push({
          ...s,
          regions: filteredRegions,
          elements: filteredElements,
          manualErasePatches: nextPatches,
          cleanedDataUrl,
          baseBackdropDataUrl,
        });
      }
      onChangeSlides(updated);
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearManualPatches = async () => {
    if (!currentSlide) return;
    setBusyAction('reclean');
    try {
      const cleanedDataUrl = await generateCleanedBackground(
        currentSlide.originalDataUrl,
        currentSlide.regions,
        []
      );
      const { baseBackdropDataUrl, elements } = await autoSegmentSlideElements(
        cleanedDataUrl,
        'detailed'
      );
      updateCurrentSlide((s) => ({
        ...s,
        manualErasePatches: [],
        cleanedDataUrl,
        baseBackdropDataUrl,
        elements,
      }));
    } finally {
      setBusyAction(null);
    }
  };

  const handleArtboardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const board = artboardRef.current;
    if (!board) return;

    if (activeTool === 'eraser' || activeTool === 'slice') {
      const rect = board.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      setDragState({
        mode: activeTool === 'eraser' ? 'erase' : 'slice',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: xPct,
        origY: yPct,
        origW: 0,
        origH: 0,
        curX: xPct,
        curY: yPct,
        curW: 0,
        curH: 0,
      });
      return;
    }

    if (e.target === board || (e.target as HTMLElement).classList.contains('slide-bg-img')) {
      setSelectedRegionId(null);
      setSelectedElementId(null);
      setEditingRegionId(null);
    }
  };

  useEffect(() => {
    if (!dragState) return;

    const onMouseMove = (e: MouseEvent) => {
      const board = artboardRef.current;
      if (!board) return;
      const rect = board.getBoundingClientRect();
      const dxPct = ((e.clientX - dragState.startClientX) / rect.width) * 100;
      const dyPct = ((e.clientY - dragState.startClientY) / rect.height) * 100;

      if (dragState.mode === 'move-text' && dragState.targetId) {
        const nx = Math.max(0, Math.min(100 - dragState.origW, dragState.origX + dxPct));
        const ny = Math.max(0, Math.min(100 - dragState.origH, dragState.origY + dyPct));
        updateRegion(dragState.targetId, { xPct: nx, yPct: ny });
      } else if (dragState.mode === 'resize-text' && dragState.targetId) {
        const nw = Math.max(3, Math.min(100 - dragState.origX, dragState.origW + dxPct));
        const nh = Math.max(2.5, Math.min(100 - dragState.origY, dragState.origH + dyPct));
        updateRegion(dragState.targetId, { wPct: nw, hPct: nh });
      } else if (dragState.mode === 'move-element' && dragState.targetId) {
        const clampedDx = Math.max(
          -dragState.origX,
          Math.min(100 - dragState.origW - dragState.origX, dxPct)
        );
        const clampedDy = Math.max(
          -dragState.origY,
          Math.min(100 - dragState.origH - dragState.origY, dyPct)
        );

        const childRegMap = new Map(
          (dragState.childRegions || []).map((c) => [c.id, c])
        );
        const childElMap = new Map(
          (dragState.childElements || []).map((c) => [c.id, c])
        );

        updateCurrentSlide((s) => ({
          ...s,
          elements: s.elements.map((el) => {
            if (el.id === dragState.targetId) {
              return {
                ...el,
                xPct: dragState.origX + clampedDx,
                yPct: dragState.origY + clampedDy,
              };
            }
            const child = childElMap.get(el.id);
            if (child) {
              return {
                ...el,
                xPct: Math.max(0, Math.min(100 - el.wPct, child.origX + clampedDx)),
                yPct: Math.max(0, Math.min(100 - el.hPct, child.origY + clampedDy)),
              };
            }
            return el;
          }),
          regions:
            childRegMap.size > 0
              ? s.regions.map((r) => {
                  const child = childRegMap.get(r.id);
                  if (!child) return r;
                  return {
                    ...r,
                    xPct: Math.max(0, Math.min(100 - r.wPct, child.origX + clampedDx)),
                    yPct: Math.max(0, Math.min(100 - r.hPct, child.origY + clampedDy)),
                  };
                })
              : s.regions,
        }));
      } else if (dragState.mode === 'resize-element' && dragState.targetId) {
        const nw = Math.max(2, Math.min(100 - dragState.origX, dragState.origW + dxPct));
        const nh = Math.max(2, Math.min(100 - dragState.origY, dragState.origH + dyPct));
        updateElement(dragState.targetId, { wPct: nw, hPct: nh });
      } else if (dragState.mode === 'erase' || dragState.mode === 'slice') {
        const curX = Math.max(0, Math.min(100, dragState.origX + Math.min(0, dxPct)));
        const curY = Math.max(0, Math.min(100, dragState.origY + Math.min(0, dyPct)));
        const curW = Math.min(100 - curX, Math.abs(dxPct));
        const curH = Math.min(100 - curY, Math.abs(dyPct));
        setDragState((prev) => (prev ? { ...prev, curX, curY, curW, curH } : null));
      }
    };

    const onMouseUp = async () => {
      const finished = dragState;
      setDragState(null);

      if (
        finished.mode === 'erase' &&
        (finished.curW || 0) > 1.2 &&
        (finished.curH || 0) > 1.2 &&
        currentSlide
      ) {
        setBusyAction('erase');
        try {
          const newPatch: ErasePatch = {
            id: `patch-${Date.now()}`,
            xPct: finished.curX || 0,
            yPct: finished.curY || 0,
            wPct: finished.curW || 2,
            hPct: finished.curH || 2,
          };
          const nextPatches = [...currentSlide.manualErasePatches, newPatch];
          const filteredRegions = currentSlide.regions.filter((r) => {
            const cx = r.xPct + r.wPct / 2;
            const cy = r.yPct + r.hPct / 2;
            return !(
              cx >= newPatch.xPct &&
              cx <= newPatch.xPct + newPatch.wPct &&
              cy >= newPatch.yPct &&
              cy <= newPatch.yPct + newPatch.hPct
            );
          });
          const filteredElements = (currentSlide.elements || []).filter((el) => {
            const cx = el.xPct + el.wPct / 2;
            const cy = el.yPct + el.hPct / 2;
            return !(
              cx >= newPatch.xPct &&
              cx <= newPatch.xPct + newPatch.wPct &&
              cy >= newPatch.yPct &&
              cy <= newPatch.yPct + newPatch.hPct
            );
          });
          const cleanedDataUrl = await generateCleanedBackground(
            currentSlide.originalDataUrl,
            filteredRegions,
            nextPatches
          );
          let baseBackdropDataUrl = currentSlide.baseBackdropDataUrl;
          if (baseBackdropDataUrl) {
            const seg = await autoSegmentSlideElements(cleanedDataUrl, 'detailed');
            baseBackdropDataUrl = seg.baseBackdropDataUrl;
          }
          updateCurrentSlide((s) => ({
            ...s,
            regions: filteredRegions,
            elements: filteredElements,
            manualErasePatches: nextPatches,
            cleanedDataUrl,
            baseBackdropDataUrl,
          }));
        } finally {
          setBusyAction(null);
          setActiveTool('select');
        }
      } else if (
        finished.mode === 'slice' &&
        (finished.curW || 0) > 1.2 &&
        (finished.curH || 0) > 1.2 &&
        currentSlide
      ) {
        setBusyAction('slice');
        try {
          const sx = finished.curX || 0;
          const sy = finished.curY || 0;
          const sw = finished.curW || 3;
          const sh = finished.curH || 3;

          const sourceBg =
            currentSlide.elements.length > 0 && currentSlide.baseBackdropDataUrl
              ? currentSlide.cleanedDataUrl
              : currentSlide.cleanedDataUrl;

          const { nextBackdropDataUrl, element } = await sliceManualElementFromBackdrop(
            sourceBg,
            sx,
            sy,
            sw,
            sh,
            true
          );

          // Heal the current base backdrop too if split elements are already active
          let updatedBackdrop = nextBackdropDataUrl;
          if (currentSlide.baseBackdropDataUrl) {
            const healedBase = await sliceManualElementFromBackdrop(
              currentSlide.baseBackdropDataUrl,
              sx,
              sy,
              sw,
              sh,
              false
            );
            updatedBackdrop = healedBase.nextBackdropDataUrl;
          }

          updateCurrentSlide((s) => ({
            ...s,
            baseBackdropDataUrl: updatedBackdrop,
            elements: [...(s.elements || []), element],
          }));
          setSelectedRegionId(null);
          setSelectedElementId(element.id);
        } finally {
          setBusyAction(null);
          setActiveTool('select');
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState, currentSlide, updateCurrentSlide, updateRegion, updateElement]);

  const handleExportPptx = async () => {
    setBusyAction('pptx');
    try {
      await exportSlidesToPptx(slides, deckName);
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportPdf = async () => {
    setBusyAction('pdf');
    try {
      await exportSlidesToPdf(slides, deckName);
    } finally {
      setBusyAction(null);
    }
  };

  if (!currentSlide) return null;

  const hasSplitElements =
    currentSlide.backgroundMode === 'cleaned' &&
    currentSlide.elements &&
    currentSlide.elements.length > 0 &&
    Boolean(currentSlide.baseBackdropDataUrl);

  const displayedBgSrc =
    viewMode === 'original' || currentSlide.backgroundMode === 'original'
      ? currentSlide.originalDataUrl
      : hasSplitElements
        ? currentSlide.baseBackdropDataUrl!
        : currentSlide.cleanedDataUrl;

  const sortedElements = [...(currentSlide.elements || [])].sort(
    (a, b) => a.zIndex - b.zIndex
  );

  return (
    <div className="studio-layout">
      {/* Left Filmstrip */}
      <aside className="filmstrip-panel" aria-label={t.studioSlidesCount}>
        <div className="panel-header">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onBack}
            id="btn-studio-back"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            <ArrowLeft size={15} />
            {t.studioBack}
          </button>
          <span>
            {slides.filter((s) => s.included).length} / {slides.length}
          </span>
        </div>

        <div className="filmstrip-list">
          {slides.map((s, idx) => (
            <div
              key={s.id}
              className={`thumb-card ${idx === activeSlideIdx ? 'active' : ''} ${
                !s.included ? 'excluded' : ''
              }`}
              onClick={() => {
                setActiveSlideIdx(idx);
                setSelectedRegionId(null);
                setSelectedElementId(null);
                setEditingRegionId(null);
              }}
              id={`slide-thumb-${idx + 1}`}
            >
              <div className="thumb-preview" style={{ aspectRatio: `${s.aspectRatio}` }}>
                {s.backgroundMode === 'solid' ? (
                  <div style={{ width: '100%', height: '100%', background: s.solidBgHex }} />
                ) : (
                  <img src={s.cleanedDataUrl} alt={`Slide ${idx + 1}`} loading="lazy" />
                )}
              </div>
              <div className="thumb-meta">
                <span style={{ fontWeight: 600 }}>#{idx + 1}</span>
                <span style={{ fontSize: '0.66rem', opacity: 0.85 }}>
                  {s.elements?.length || 0} {locale === 'zh-Hant' ? '圖塊' : 'objs'} ·{' '}
                  {s.regions.length} {locale === 'zh-Hant' ? '字框' : 'txt'}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ border: 'none', padding: 2, display: 'inline-flex' }}
                  title={locale === 'zh-Hant' ? '勾選是否匯出此頁' : 'Include slide in export'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeSlides((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, included: !item.included } : item
                      )
                    );
                  }}
                  id={`btn-toggle-slide-${idx + 1}`}
                >
                  {s.included ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Center Artboard Stage */}
      <section className="canvas-stage-col">
        <div className="stage-toolbar">
          <div className="toolbar-group">
            <div className="segmented-tabs">
              <button
                type="button"
                className={`segmented-tab ${viewMode === 'editable' ? 'active' : ''}`}
                onClick={() => setViewMode('editable')}
                id="btn-view-editable"
                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
              >
                {t.viewEditable}
              </button>
              <button
                type="button"
                className={`segmented-tab ${viewMode === 'cleaned' ? 'active' : ''}`}
                onClick={() => setViewMode('cleaned')}
                id="btn-view-cleaned"
                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
              >
                {locale === 'zh-Hant' ? '純圖塊/去字層' : t.viewCleaned}
              </button>
              <button
                type="button"
                className={`segmented-tab ${viewMode === 'original' ? 'active' : ''}`}
                onClick={() => setViewMode('original')}
                id="btn-view-original"
                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
              >
                {t.viewOriginal}
              </button>
            </div>

            <button
              type="button"
              className={`btn btn-sm ${showBounds ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setShowBounds((b) => !b)}
              id="btn-toggle-bounds"
            >
              {locale === 'zh-Hant' ? '顯示框線' : 'Show Bounds'}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleAddTextBox}
              id="btn-add-textbox"
            >
              <Plus size={14} />
              {t.addTextbox}
            </button>

            <button
              type="button"
              className={`btn btn-sm ${activeTool === 'slice' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setActiveTool((cur) => (cur === 'slice' ? 'select' : 'slice'));
                setSelectedRegionId(null);
                setSelectedElementId(null);
              }}
              id="btn-slice-tool"
              title={
                locale === 'zh-Hant'
                  ? '在畫布拖曳框選任意圖形／卡片／圖示，自動切出獨立可移動圖層並修補原底圖'
                  : 'Drag over any card, icon, or diagram block to slice it into a movable layer'
              }
            >
              <Scissors size={14} />
              {locale === 'zh-Hant' ? '框選切出元件' : 'Slice Object'}
            </button>

            <button
              type="button"
              className={`btn btn-sm ${activeTool === 'eraser' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setActiveTool((cur) => (cur === 'eraser' ? 'select' : 'eraser'));
                setSelectedRegionId(null);
                setSelectedElementId(null);
              }}
              id="btn-eraser-tool"
              title={
                locale === 'zh-Hant'
                  ? '在投影片上拖曳框選區域，立即智慧抹除殘字或浮水印'
                  : 'Drag a rectangle over any region to inpaint & erase'
              }
            >
              <Eraser size={14} />
              {t.eraserTool}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRemoveCornerWatermarkAll}
              disabled={busyAction !== null}
              id="btn-remove-watermark-all"
            >
              <Sparkles size={14} />
              {t.removeWatermarkAll}
            </button>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportPdf}
              disabled={busyAction !== null}
              id="btn-export-pdf"
            >
              <FileDown size={14} />
              {busyAction === 'pdf' ? '...' : t.exportPdf}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleExportPptx}
              disabled={busyAction !== null}
              id="btn-export-pptx"
            >
              <Download size={14} />
              {busyAction === 'pptx' ? '...' : t.exportPptx}
            </button>
          </div>
        </div>

        <div className="stage-viewport">
          <div
            ref={artboardRef}
            className={`slide-artboard ${
              activeTool !== 'select' ? 'eraser-cursor' : ''
            } ${showBounds ? 'show-bounds' : ''}`}
            style={{
              aspectRatio: `${currentSlide.aspectRatio}`,
              background:
                currentSlide.backgroundMode === 'solid' && viewMode !== 'original'
                  ? currentSlide.solidBgHex
                  : '#ffffff',
            }}
            onMouseDown={handleArtboardMouseDown}
            id="studio-slide-artboard"
          >
            {(currentSlide.backgroundMode !== 'solid' || viewMode === 'original') && (
              <img
                src={displayedBgSrc}
                alt={`Slide ${activeSlideIdx + 1}`}
                className="slide-bg-img"
                draggable={false}
              />
            )}

            {/* Movable Segmented Graphic Elements (Cards, Banners, Sub-Cards, Icons, Servers) */}
            {viewMode !== 'original' &&
              currentSlide.backgroundMode !== 'original' &&
              sortedElements.map((el) => {
                const isSelected = el.id === selectedElementId;
                return (
                  <div
                    key={el.id}
                    className={`graphic-element-box ${isSelected ? 'selected' : ''}`}
                    style={{
                      left: `${el.xPct}%`,
                      top: `${el.yPct}%`,
                      width: `${el.wPct}%`,
                      height: `${el.hPct}%`,
                      zIndex: isSelected ? 9 : el.zIndex,
                    }}
                    onMouseDown={(e) => {
                      if (activeTool !== 'select') return;
                      e.stopPropagation();
                      setSelectedRegionId(null);
                      setEditingRegionId(null);
                      setSelectedElementId(el.id);

                      // When groupDrag is enabled, find contained child elements & text regions to move together
                      let childRegions: FollowerOffset[] = [];
                      let childElements: FollowerOffset[] = [];
                      if (groupDrag) {
                        const ex0 = el.xPct - 0.4;
                        const ey0 = el.yPct - 0.4;
                        const ex1 = el.xPct + el.wPct + 0.4;
                        const ey1 = el.yPct + el.hPct + 0.4;

                        childRegions = currentSlide.regions
                          .filter((r) => {
                            const cx = r.xPct + r.wPct * 0.35;
                            const cy = r.yPct + r.hPct * 0.5;
                            return cx >= ex0 && cx <= ex1 && cy >= ey0 && cy <= ey1;
                          })
                          .map((r) => ({ id: r.id, origX: r.xPct, origY: r.yPct }));

                        childElements = currentSlide.elements
                          .filter((other) => {
                            if (other.id === el.id) return false;
                            if (other.wPct * other.hPct >= el.wPct * el.hPct) return false;
                            const cx = other.xPct + other.wPct / 2;
                            const cy = other.yPct + other.hPct / 2;
                            return cx >= ex0 && cx <= ex1 && cy >= ey0 && cy <= ey1;
                          })
                          .map((other) => ({
                            id: other.id,
                            origX: other.xPct,
                            origY: other.yPct,
                          }));
                      }

                      setDragState({
                        mode: 'move-element',
                        targetId: el.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: el.xPct,
                        origY: el.yPct,
                        origW: el.wPct,
                        origH: el.hPct,
                        childRegions,
                        childElements,
                      });
                    }}
                  >
                    <img src={el.dataUrl} alt="" draggable={false} />
                    {isSelected && (
                      <div
                        className="resize-handle-teal"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            mode: 'resize-element',
                            targetId: el.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            origX: el.xPct,
                            origY: el.yPct,
                            origW: el.wPct,
                            origH: el.hPct,
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}

            {/* Native Markdown Tables Preview */}
            {viewMode === 'editable' &&
              currentSlide.tables?.map((tbl) => (
                <div
                  key={tbl.id}
                  className="slide-table-overlay"
                  style={{
                    left: `${tbl.xPct}%`,
                    top: `${tbl.yPct}%`,
                    width: `${tbl.wPct}%`,
                    height: `${tbl.hPct}%`,
                  }}
                >
                  <table>
                    <thead>
                      <tr>
                        {tbl.headers.map((h, hi) => (
                          <th key={hi}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.rows.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((cell, ci) => (
                            <td key={ci}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {/* Editable Text Region Overlays */}
            {viewMode === 'editable' &&
              currentSlide.regions.map((reg) => {
                const isSelected = reg.id === selectedRegionId;
                const isEditing = reg.id === editingRegionId;
                const scaledPx = Math.max(
                  5.5,
                  Number(((reg.fontSizePt / 540) * artboardHeight).toFixed(2))
                );

                return (
                  <div
                    key={reg.id}
                    className={`region-box ${isSelected ? 'selected' : ''}`}
                    style={{
                      left: `${reg.xPct}%`,
                      top: `${reg.yPct}%`,
                      width: `${reg.wPct}%`,
                      minHeight: `${reg.hPct}%`,
                      backgroundColor:
                        reg.bgColor && reg.bgColor !== 'transparent'
                          ? reg.bgColor
                          : undefined,
                    }}
                    onMouseDown={(e) => {
                      if (activeTool !== 'select') return;
                      e.stopPropagation();
                      setSelectedElementId(null);
                      setSelectedRegionId(reg.id);
                      if (isEditing) return;
                      setDragState({
                        mode: 'move-text',
                        targetId: reg.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: reg.xPct,
                        origY: reg.yPct,
                        origW: reg.wPct,
                        origH: reg.hPct,
                      });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelectedElementId(null);
                      setSelectedRegionId(reg.id);
                      setEditingRegionId(reg.id);
                    }}
                  >
                    {isEditing ? (
                      <textarea
                        autoFocus
                        className="region-inline-textarea"
                        style={{
                          fontSize: `${scaledPx}px`,
                          fontWeight: reg.bold ? 700 : 400,
                          fontStyle: reg.italic ? 'italic' : 'normal',
                          textAlign: reg.align,
                        }}
                        value={reg.text}
                        onChange={(e) => updateRegion(reg.id, { text: e.target.value })}
                        onBlur={() => setEditingRegionId(null)}
                      />
                    ) : (
                      <div
                        className="region-text-display"
                        style={{
                          fontSize: `${scaledPx}px`,
                          fontFamily: `"Plus Jakarta Sans", "${reg.fontFamily}", "Noto Sans TC", sans-serif`,
                          color: reg.color,
                          fontWeight: reg.bold ? 700 : 400,
                          fontStyle: reg.italic ? 'italic' : 'normal',
                          textAlign: reg.align,
                          whiteSpace: reg.text.includes('\n') ? 'pre-wrap' : 'nowrap',
                        }}
                      >
                        {reg.text}
                      </div>
                    )}

                    {isSelected && !isEditing && (
                      <div
                        className="resize-handle"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            mode: 'resize-text',
                            targetId: reg.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            origX: reg.xPct,
                            origY: reg.yPct,
                            origW: reg.wPct,
                            origH: reg.hPct,
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}

            {/* Live Rubberband Selection for Inpaint Eraser OR Manual Slice */}
            {(dragState?.mode === 'erase' || dragState?.mode === 'slice') && (
              <div
                className="erase-selection-rect"
                style={{
                  left: `${dragState.curX || 0}%`,
                  top: `${dragState.curY || 0}%`,
                  width: `${dragState.curW || 0}%`,
                  height: `${dragState.curH || 0}%`,
                  borderColor:
                    dragState.mode === 'slice' ? 'var(--accent-primary)' : 'var(--teal-primary)',
                  background:
                    dragState.mode === 'slice'
                      ? 'rgba(217, 78, 40, 0.16)'
                      : 'rgba(24, 119, 108, 0.18)',
                }}
              />
            )}
          </div>
        </div>
      </section>

      {/* Right Property Inspector */}
      <aside className="inspector-panel">
        <div className="inspector-section">
          <span className="inspector-label">
            {locale === 'zh-Hant' ? '背景與圖形元件拆解' : 'Background & Object Layers'}
          </span>

          <select
            className="select-control"
            value={currentSlide.backgroundMode}
            onChange={(e) =>
              updateCurrentSlide((s) => ({
                ...s,
                backgroundMode: e.target.value as SlideItem['backgroundMode'],
              }))
            }
            id="select-bg-mode"
          >
            <option value="cleaned">{t.bgModeCleaned}</option>
            <option value="original">{t.bgModeOriginal}</option>
            <option value="solid">{t.bgModeSolid}</option>
          </select>

          {currentSlide.backgroundMode === 'solid' && (
            <div className="prop-row">
              <span>{locale === 'zh-Hant' ? '背景底色' : 'Slide Color'}</span>
              <input
                type="color"
                className="color-swatch-input"
                value={currentSlide.solidBgHex}
                onChange={(e) =>
                  updateCurrentSlide((s) => ({ ...s, solidBgHex: e.target.value }))
                }
                id="input-slide-solid-color"
              />
            </div>
          )}

          {currentSlide.sourceType !== 'notebooklm-md' && (
            <>
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--teal-primary)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <Layers size={14} />
                {locale === 'zh-Hant'
                  ? `已切出 ${currentSlide.elements?.length || 0} 個可移動圖形區塊`
                  : `${currentSlide.elements?.length || 0} movable graphic layers`}
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleResegmentSlide('detailed')}
                  disabled={busyAction !== null}
                  id="btn-split-detailed"
                  style={{ flex: 1 }}
                >
                  {locale === 'zh-Hant' ? '細分卡片+圖示' : 'Split All'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleResegmentSlide('blocks')}
                  disabled={busyAction !== null}
                  id="btn-split-blocks"
                  style={{ flex: 1 }}
                >
                  {locale === 'zh-Hant' ? '僅切大區塊' : 'Blocks Only'}
                </button>
                {(currentSlide.elements?.length || 0) > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleResegmentSlide('flat')}
                    disabled={busyAction !== null}
                    id="btn-merge-flat"
                    style={{ width: '100%' }}
                  >
                    {locale === 'zh-Hant' ? '合併回單張背景' : 'Flatten to Single Bg'}
                  </button>
                )}
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  color: 'var(--ink-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={groupDrag}
                  onChange={(e) => setGroupDrag(e.target.checked)}
                  id="checkbox-group-drag"
                />
                <span>
                  {locale === 'zh-Hant'
                    ? '拖曳區塊時連動內部文字與子圖示'
                    : 'Move contained text & icons with card'}
                </span>
              </label>
            </>
          )}

          {currentSlide.manualErasePatches.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleClearManualPatches}
              disabled={busyAction !== null}
              id="btn-reset-patches"
            >
              <RotateCcw size={13} />
              {t.clearPatches} ({currentSlide.manualErasePatches.length})
            </button>
          )}
        </div>

        {/* Selected Graphic Element Inspector OR Selected Text Region Inspector */}
        <div className="inspector-section" style={{ flex: 1 }}>
          {selectedElement ? (
            <>
              <span className="inspector-label">
                {locale === 'zh-Hant' ? '選取圖形元件屬性' : 'Selected Graphic Layer'}
              </span>

              <div
                style={{
                  background: 'var(--bg-canvas-well)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '0.5rem',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  maxHeight: '110px',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={selectedElement.dataUrl}
                  alt="Selected layer"
                  style={{ maxWidth: '100%', maxHeight: '94px', objectFit: 'contain' }}
                />
              </div>

              <div className="prop-row">
                <span>{locale === 'zh-Hant' ? '圖層順序' : 'Layer Z-Order'}</span>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginRight: 4 }}>
                    Z:{selectedElement.zIndex}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleShiftElementZ(1)}
                    title={locale === 'zh-Hant' ? '上移一層' : 'Bring Forward'}
                    id="btn-el-forward"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleShiftElementZ(-1)}
                    title={locale === 'zh-Hant' ? '下移一層' : 'Send Backward'}
                    id="btn-el-backward"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDuplicateElement}
                id="btn-duplicate-element"
              >
                <Copy size={14} />
                {locale === 'zh-Hant' ? '複製此圖形元件' : 'Duplicate Graphic Layer'}
              </button>

              <button
                type="button"
                className="btn btn-danger-ghost btn-sm"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => handleDeleteElement(selectedElement.id)}
                id="btn-delete-element"
              >
                <Trash2 size={14} />
                {locale === 'zh-Hant' ? '刪除此圖形元件' : 'Delete Graphic Layer'}
              </button>
            </>
          ) : (
            <>
              <span className="inspector-label">{t.inspectorTextSection}</span>

              {!selectedRegion ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: 0 }}>
                  {locale === 'zh-Hant'
                    ? '可直接點擊並拖曳畫布上的「卡片、橫幅、子方塊、伺服器圖示」自由移動位置，或點擊文字修改內容；亦可使用上方「框選切出元件」自訂切圖！匯出 .pptx 後每個區塊皆為獨立可移動物件。'
                    : 'Click and drag any card, banner, icon, or text box on the slide to move or resize it, or use "Slice Object" to cut custom blocks. Every layer exports as an independent movable object in PowerPoint!'}
                </p>
              ) : (
                <>
                  <textarea
                    className="inspector-textarea"
                    value={selectedRegion.text}
                    onChange={(e) => updateRegion(selectedRegion.id, { text: e.target.value })}
                    id="inspector-text-content"
                  />

                  <div className="prop-row">
                    <span>{t.fontFamily}</span>
                    <select
                      className="select-control"
                      value={selectedRegion.fontFamily}
                      onChange={(e) =>
                        updateRegion(selectedRegion.id, { fontFamily: e.target.value })
                      }
                      id="select-font-family"
                    >
                      <option value="Microsoft JhengHei">微軟正黑體 (JhengHei)</option>
                      <option value="Noto Sans TC">Noto Sans TC</option>
                      <option value="Arial">Arial</option>
                      <option value="Calibri">Calibri</option>
                      <option value="Georgia">Georgia</option>
                    </select>
                  </div>

                  <div className="prop-grid-2">
                    <div className="prop-row">
                      <span>{t.fontSize}</span>
                      <input
                        type="number"
                        min={6}
                        max={80}
                        step={0.5}
                        className="input-control"
                        style={{ width: '68px' }}
                        value={selectedRegion.fontSizePt}
                        onChange={(e) =>
                          updateRegion(selectedRegion.id, {
                            fontSizePt: Math.max(
                              6,
                              Math.min(80, Number(e.target.value) || 14)
                            ),
                          })
                        }
                        id="input-font-size"
                      />
                    </div>

                    <div className="prop-row">
                      <span>{t.textColor}</span>
                      <input
                        type="color"
                        className="color-swatch-input"
                        value={selectedRegion.color}
                        onChange={(e) =>
                          updateRegion(selectedRegion.id, { color: e.target.value })
                        }
                        id="input-text-color"
                      />
                    </div>
                  </div>

                  <div className="prop-row">
                    <span>{locale === 'zh-Hant' ? '樣式與對齊' : 'Style & Align'}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className={`icon-btn ${selectedRegion.bold ? 'active' : ''}`}
                        onClick={() =>
                          updateRegion(selectedRegion.id, { bold: !selectedRegion.bold })
                        }
                        aria-label="Bold"
                        id="btn-prop-bold"
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn ${selectedRegion.italic ? 'active' : ''}`}
                        onClick={() =>
                          updateRegion(selectedRegion.id, { italic: !selectedRegion.italic })
                        }
                        aria-label="Italic"
                        id="btn-prop-italic"
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn ${selectedRegion.align === 'left' ? 'active' : ''}`}
                        onClick={() => updateRegion(selectedRegion.id, { align: 'left' })}
                        aria-label="Align Left"
                        id="btn-prop-align-left"
                      >
                        <AlignLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn ${
                          selectedRegion.align === 'center' ? 'active' : ''
                        }`}
                        onClick={() => updateRegion(selectedRegion.id, { align: 'center' })}
                        aria-label="Align Center"
                        id="btn-prop-align-center"
                      >
                        <AlignCenter size={14} />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn ${selectedRegion.align === 'right' ? 'active' : ''}`}
                        onClick={() => updateRegion(selectedRegion.id, { align: 'right' })}
                        aria-label="Align Right"
                        id="btn-prop-align-right"
                      >
                        <AlignRight size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="prop-row">
                    <span>{t.boxFill}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <select
                        className="select-control"
                        value={
                          selectedRegion.bgColor === 'transparent' ? 'transparent' : 'solid'
                        }
                        onChange={(e) =>
                          updateRegion(selectedRegion.id, {
                            bgColor:
                              e.target.value === 'transparent' ? 'transparent' : '#FFFFFF',
                          })
                        }
                        id="select-box-fill"
                      >
                        <option value="transparent">{t.transparent}</option>
                        <option value="solid">{t.solidFill}</option>
                      </select>
                      {selectedRegion.bgColor !== 'transparent' && (
                        <input
                          type="color"
                          className="color-swatch-input"
                          value={selectedRegion.bgColor}
                          onChange={(e) =>
                            updateRegion(selectedRegion.id, { bgColor: e.target.value })
                          }
                          id="input-box-fill-color"
                        />
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    style={{ marginTop: '0.4rem', justifyContent: 'flex-start' }}
                    onClick={() => handleDeleteRegion(selectedRegion.id)}
                    id="btn-delete-textbox"
                  >
                    <Trash2 size={14} />
                    {t.deleteBox}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
