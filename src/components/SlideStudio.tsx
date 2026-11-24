import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  CheckSquare,
  Download,
  Eraser,
  FileDown,
  Italic,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { translations, type Locale } from '../i18n/translations';
import { exportSlidesToPdf, exportSlidesToPptx } from '../services/exporter';
import { generateCleanedBackground } from '../services/inpaintEngine';
import type { ErasePatch, SlideItem, TextRegion } from '../types/slide';

interface SlideStudioProps {
  locale: Locale;
  deckName: string;
  slides: SlideItem[];
  onChangeSlides: React.Dispatch<React.SetStateAction<SlideItem[]>>;
  onBack: () => void;
}

type ViewLayerMode = 'editable' | 'cleaned' | 'original';

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
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewLayerMode>('editable');
  const [showBounds, setShowBounds] = useState(false);
  const [eraserActive, setEraserActive] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [artboardHeight, setArtboardHeight] = useState(495);

  const artboardRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    mode: 'move' | 'resize' | 'erase';
    regionId?: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    curX?: number;
    curY?: number;
    curW?: number;
    curH?: number;
  } | null>(null);

  const currentSlide = slides[activeSlideIdx] || slides[0];
  const selectedRegion =
    currentSlide?.regions.find((r) => r.id === selectedRegionId) || null;

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

  // Observe artboard DOM height for accurate WYSIWYG point-to-pixel font scaling
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

  // Keyboard shortcut to delete selected region when not typing inline
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegionId && !editingRegionId) {
        e.preventDefault();
        void handleDeleteRegion(selectedRegionId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedRegionId, editingRegionId, handleDeleteRegion]);

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
      color: '#182026',
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
    setEraserActive(false);
    setSelectedRegionId(newBox.id);
  };

  // One-click remove bottom-right NotebookLM watermark across ALL slides!
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
        const nextPatches = [...s.manualErasePatches, watermarkPatch];
        const cleanedDataUrl = await generateCleanedBackground(
          s.originalDataUrl,
          filteredRegions,
          nextPatches
        );
        updated.push({
          ...s,
          regions: filteredRegions,
          manualErasePatches: nextPatches,
          cleanedDataUrl,
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
      updateCurrentSlide((s) => ({
        ...s,
        manualErasePatches: [],
        cleanedDataUrl,
      }));
    } finally {
      setBusyAction(null);
    }
  };

  // Pointer interactions on Artboard
  const handleArtboardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const board = artboardRef.current;
    if (!board) return;

    if (eraserActive) {
      const rect = board.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      setDragState({
        mode: 'erase',
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

      if (dragState.mode === 'move' && dragState.regionId) {
        const nx = Math.max(0, Math.min(100 - dragState.origW, dragState.origX + dxPct));
        const ny = Math.max(0, Math.min(100 - dragState.origH, dragState.origY + dyPct));
        updateRegion(dragState.regionId, { xPct: nx, yPct: ny });
      } else if (dragState.mode === 'resize' && dragState.regionId) {
        const nw = Math.max(4, Math.min(100 - dragState.origX, dragState.origW + dxPct));
        const nh = Math.max(3, Math.min(100 - dragState.origY, dragState.origH + dyPct));
        updateRegion(dragState.regionId, { wPct: nw, hPct: nh });
      } else if (dragState.mode === 'erase') {
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
          // Also remove any OCR boxes fully inside the erased rectangle
          const filteredRegions = currentSlide.regions.filter((r) => {
            const cx = r.xPct + r.wPct / 2;
            const cy = r.yPct + r.hPct / 2;
            const inside =
              cx >= newPatch.xPct &&
              cx <= newPatch.xPct + newPatch.wPct &&
              cy >= newPatch.yPct &&
              cy <= newPatch.yPct + newPatch.hPct;
            return !inside;
          });
          const cleanedDataUrl = await generateCleanedBackground(
            currentSlide.originalDataUrl,
            filteredRegions,
            nextPatches
          );
          updateCurrentSlide((s) => ({
            ...s,
            regions: filteredRegions,
            manualErasePatches: nextPatches,
            cleanedDataUrl,
          }));
        } finally {
          setBusyAction(null);
          setEraserActive(false);
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState, currentSlide, updateCurrentSlide, updateRegion]);

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

  const displayedBgSrc =
    viewMode === 'original' || currentSlide.backgroundMode === 'original'
      ? currentSlide.originalDataUrl
      : currentSlide.cleanedDataUrl;

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
                <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>
                  {s.regions.length} {locale === 'zh-Hant' ? '文字框' : 'boxes'}
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
                {t.viewCleaned}
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
              className={`btn btn-sm ${eraserActive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setEraserActive((v) => !v);
                setSelectedRegionId(null);
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
            className={`slide-artboard ${eraserActive ? 'eraser-cursor' : ''} ${
              showBounds ? 'show-bounds' : ''
            }`}
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
                      if (eraserActive) return;
                      e.stopPropagation();
                      setSelectedRegionId(reg.id);
                      if (isEditing) return;
                      setDragState({
                        mode: 'move',
                        regionId: reg.id,
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
                            mode: 'resize',
                            regionId: reg.id,
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

            {/* Live Rubberband Selection for Inpaint Eraser */}
            {dragState?.mode === 'erase' && (
              <div
                className="erase-selection-rect"
                style={{
                  left: `${dragState.curX || 0}%`,
                  top: `${dragState.curY || 0}%`,
                  width: `${dragState.curW || 0}%`,
                  height: `${dragState.curH || 0}%`,
                }}
              />
            )}
          </div>
        </div>
      </section>

      {/* Right Property Inspector */}
      <aside className="inspector-panel">
        <div className="inspector-section">
          <span className="inspector-label">{t.inspectorSlideSection}</span>
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

        <div className="inspector-section" style={{ flex: 1 }}>
          <span className="inspector-label">{t.inspectorTextSection}</span>

          {!selectedRegion ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--ink-secondary)', margin: 0 }}>
              {t.noSelectionHint}
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
                    min={8}
                    max={80}
                    className="input-control"
                    style={{ width: '68px' }}
                    value={selectedRegion.fontSizePt}
                    onChange={(e) =>
                      updateRegion(selectedRegion.id, {
                        fontSizePt: Math.max(8, Math.min(80, Number(e.target.value) || 14)),
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
                    className={`icon-btn ${selectedRegion.align === 'center' ? 'active' : ''}`}
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
                    value={selectedRegion.bgColor === 'transparent' ? 'transparent' : 'solid'}
                    onChange={(e) =>
                      updateRegion(selectedRegion.id, {
                        bgColor: e.target.value === 'transparent' ? 'transparent' : '#FFFFFF',
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
        </div>
      </aside>
    </div>
  );
};
