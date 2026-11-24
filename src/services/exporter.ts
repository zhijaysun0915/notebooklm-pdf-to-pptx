import { jsPDF } from 'jspdf';
import PptxGenJS from 'pptxgenjs';
import type { SlideItem } from '../types/slide';
import { loadImageElement } from './inpaintEngine';

function stripHash(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase();
}

/**
 * Exports all included slides as a native multi-layer editable PowerPoint (.pptx):
 * Layer 0: Clean Base Backdrop
 * Layer 1..N: Independent Movable Graphic Elements (cards, banners, sub-cards, icons, servers)
 * Top Layer: Native PowerPoint Tables & Editable Text Boxes
 */
export async function exportSlidesToPptx(
  slides: SlideItem[],
  fileNameBase = 'NotebookLM-Editable-Deck'
): Promise<void> {
  const activeSlides = slides.filter((s) => s.included);
  if (activeSlides.length === 0) return;

  const pptx = new PptxGenJS();
  pptx.author = 'SlideUnlock Studio';
  pptx.company = 'Open Source Local Converter';
  pptx.subject = 'Converted Multi-Layer Editable Presentation';
  pptx.title = fileNameBase;

  const ratio = activeSlides[0].aspectRatio || 16 / 9;
  const slideHeightIn = 7.5;
  const slideWidthIn = Number((slideHeightIn * ratio).toFixed(3));

  if (Math.abs(ratio - 16 / 9) < 0.04) {
    pptx.layout = 'LAYOUT_WIDE'; // 13.333" x 7.5"
  } else {
    pptx.defineLayout({
      name: 'CUSTOM_RATIO',
      width: slideWidthIn,
      height: slideHeightIn,
    });
    pptx.layout = 'CUSTOM_RATIO';
  }

  const effectiveW = Math.abs(ratio - 16 / 9) < 0.04 ? 13.333 : slideWidthIn;
  const effectiveH = slideHeightIn;

  for (const item of activeSlides) {
    const slide = pptx.addSlide();
    const hasSplitElements =
      item.backgroundMode === 'cleaned' &&
      item.elements &&
      item.elements.length > 0 &&
      Boolean(item.baseBackdropDataUrl);

    // 1. Base Slide Backdrop
    if (item.backgroundMode === 'solid') {
      slide.background = { color: stripHash(item.solidBgHex || '#FAF8F5') };
    } else {
      const bgImg =
        item.backgroundMode === 'original'
          ? item.originalDataUrl
          : hasSplitElements
            ? item.baseBackdropDataUrl!
            : item.cleanedDataUrl;
      slide.addImage({
        data: bgImg,
        x: 0,
        y: 0,
        w: effectiveW,
        h: effectiveH,
      });
    }

    // 2. Independent Movable Graphic Elements (sorted back-to-front by zIndex)
    if (item.backgroundMode !== 'original' && item.elements && item.elements.length > 0) {
      const sortedElements = [...item.elements].sort((a, b) => a.zIndex - b.zIndex);
      for (const el of sortedElements) {
        const xIn = Number(((el.xPct / 100) * effectiveW).toFixed(3));
        const yIn = Number(((el.yPct / 100) * effectiveH).toFixed(3));
        const wIn = Number((Math.max(0.15, (el.wPct / 100) * effectiveW)).toFixed(3));
        const hIn = Number((Math.max(0.15, (el.hPct / 100) * effectiveH)).toFixed(3));
        slide.addImage({
          data: el.dataUrl,
          x: xIn,
          y: yIn,
          w: wIn,
          h: hIn,
        });
      }
    }

    // 3. Native PowerPoint Tables (from NotebookLM Markdown tables)
    if (item.tables && item.tables.length > 0) {
      for (const tbl of item.tables) {
        const headerCells: PptxGenJS.TableCell[] = tbl.headers.map((h) => ({
          text: h,
          options: {
            bold: true,
            fill: { color: 'E8E4DD' },
            color: '182026',
            fontSize: 12,
            fontFace: 'Microsoft JhengHei',
          },
        }));
        const bodyRows: PptxGenJS.TableCell[][] = tbl.rows.map((r) =>
          r.map((cell) => ({
            text: cell,
            options: {
              fill: { color: 'FFFFFF' },
              color: '2F3B46',
              fontSize: 11,
              fontFace: 'Microsoft JhengHei',
            },
          }))
        );

        slide.addTable([headerCells, ...bodyRows], {
          x: (tbl.xPct / 100) * effectiveW,
          y: (tbl.yPct / 100) * effectiveH,
          w: (tbl.wPct / 100) * effectiveW,
          border: { type: 'solid', pt: 0.75, color: 'CBD5E1' },
          autoPage: false,
        });
      }
    }

    // 4. Editable PowerPoint Text Boxes
    for (const reg of item.regions) {
      if (!reg.text.trim()) continue;
      const xIn = Number(((reg.xPct / 100) * effectiveW).toFixed(3));
      const yIn = Number(((reg.yPct / 100) * effectiveH).toFixed(3));
      const wIn = Number((Math.max(0.4, (reg.wPct / 100) * effectiveW)).toFixed(3));
      const hIn = Number((Math.max(0.22, (reg.hPct / 100) * effectiveH)).toFixed(3));

      const hasFill = reg.bgColor && reg.bgColor !== 'transparent';

      slide.addText(reg.text, {
        x: xIn,
        y: yIn,
        w: wIn,
        h: hIn,
        fontSize: reg.fontSizePt,
        fontFace: reg.fontFamily || 'Microsoft JhengHei',
        color: stripHash(reg.color || '#182026'),
        bold: reg.bold,
        italic: reg.italic,
        align: reg.align,
        valign: 'top',
        margin: 0,
        fill: hasFill ? { color: stripHash(reg.bgColor) } : undefined,
        breakLine: reg.text.includes('\n'),
      });
    }

    if (item.speakerNotes) {
      slide.addNotes(item.speakerNotes);
    }
  }

  const safeName = fileNameBase.replace(/\.[^/.]+$/, '') || 'NotebookLM-Slides';
  await pptx.writeFile({ fileName: `${safeName}-editable.pptx` });
}

/**
 * Exports all included slides as a cleaned & edited high-resolution PDF,
 * compositing the base backdrop, moved/resized graphic layers, and updated text boxes.
 */
export async function exportSlidesToPdf(
  slides: SlideItem[],
  fileNameBase = 'NotebookLM-Edited-Deck'
): Promise<void> {
  const activeSlides = slides.filter((s) => s.included);
  if (activeSlides.length === 0) return;

  const first = activeSlides[0];
  const orientation = first.aspectRatio >= 1 ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [first.widthPx, first.heightPx],
    compress: true,
  });

  for (let i = 0; i < activeSlides.length; i++) {
    const item = activeSlides[i];
    if (i > 0) {
      pdf.addPage(
        [item.widthPx, item.heightPx],
        item.aspectRatio >= 1 ? 'landscape' : 'portrait'
      );
    }

    const canvas = document.createElement('canvas');
    canvas.width = item.widthPx;
    canvas.height = item.heightPx;
    const ctx = canvas.getContext('2d')!;

    const hasSplitElements =
      item.backgroundMode === 'cleaned' &&
      item.elements &&
      item.elements.length > 0 &&
      Boolean(item.baseBackdropDataUrl);

    if (item.backgroundMode === 'solid') {
      ctx.fillStyle = item.solidBgHex || '#FAF8F5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const bgUrl =
        item.backgroundMode === 'original'
          ? item.originalDataUrl
          : hasSplitElements
            ? item.baseBackdropDataUrl!
            : item.cleanedDataUrl;
      const img = await loadImageElement(bgUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    if (item.backgroundMode !== 'original' && item.elements && item.elements.length > 0) {
      const sortedElements = [...item.elements].sort((a, b) => a.zIndex - b.zIndex);
      for (const el of sortedElements) {
        const elImg = await loadImageElement(el.dataUrl);
        ctx.drawImage(
          elImg,
          (el.xPct / 100) * canvas.width,
          (el.yPct / 100) * canvas.height,
          (el.wPct / 100) * canvas.width,
          (el.hPct / 100) * canvas.height
        );
      }
    }

    for (const reg of item.regions) {
      if (!reg.text.trim()) continue;
      const x = (reg.xPct / 100) * canvas.width;
      const y = (reg.yPct / 100) * canvas.height;
      const w = (reg.wPct / 100) * canvas.width;
      const h = (reg.hPct / 100) * canvas.height;

      if (reg.bgColor && reg.bgColor !== 'transparent') {
        ctx.fillStyle = reg.bgColor;
        ctx.fillRect(x, y, w, h);
      }

      const fontPx = Math.round((reg.fontSizePt / 540) * canvas.height * 1.04);
      ctx.font = `${reg.italic ? 'italic ' : ''}${reg.bold ? '700 ' : '400 '}${fontPx}px "${
        reg.fontFamily || 'Noto Sans TC'
      }", sans-serif`;
      ctx.fillStyle = reg.color || '#182026';
      ctx.textBaseline = 'top';

      const paragraphs = reg.text.split('\n');
      let curY = y + 1;
      for (const p of paragraphs) {
        const drawX =
          reg.align === 'center'
            ? x + w / 2
            : reg.align === 'right'
              ? x + w
              : x;
        ctx.textAlign = reg.align;
        ctx.fillText(p, drawX, curY, w);
        curY += fontPx * 1.24;
      }
    }

    const pageJpg = canvas.toDataURL('image/jpeg', 0.93);
    pdf.addImage(pageJpg, 'JPEG', 0, 0, item.widthPx, item.heightPx);
  }

  const safeName = fileNameBase.replace(/\.[^/.]+$/, '') || 'NotebookLM-Slides';
  pdf.save(`${safeName}-edited.pdf`);
}
