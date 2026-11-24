import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  ConversionProgress,
  EngineMode,
  OcrLang,
  SlideItem,
  TextRegion,
} from '../types/slide';
import { detectSlideTextWithGemini } from './geminiVisionEngine';
import { generateCleanedBackground, loadImageElement, sampleRegionColors } from './inpaintEngine';
import { detectSlideTextWithOcr } from './ocrEngine';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ProcessOptions {
  engineMode: EngineMode;
  ocrLang: OcrLang;
  geminiApiKey: string;
  onProgress: (prog: ConversionProgress) => void;
}

interface PdfVectorRun {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontPx: number;
}

function extractNativePdfRegions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textItems: any[],
  viewport: pdfjsLib.PageViewport,
  canvas: HTMLCanvasElement
): TextRegion[] {
  const runs: PdfVectorRun[] = [];

  for (const item of textItems) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    if (!str.trim()) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontPx = Math.max(8, Math.hypot(tx[2], tx[3]));
    const x0 = tx[4];
    const baselineY = tx[5];
    const y0 = baselineY - fontPx * 0.88;
    const widthPx = Math.max(fontPx * 0.5, (item.width || 0) * viewport.scale);
    const x1 = x0 + widthPx;
    const y1 = baselineY + fontPx * 0.22;

    runs.push({ text: str, x0, y0, x1, y1, fontPx });
  }

  if (runs.length === 0) return [];

  // Sort top-to-bottom, then left-to-right
  runs.sort((a, b) => (Math.abs(a.y0 - b.y0) < 6 ? a.x0 - b.x0 : a.y0 - b.y0));

  // Merge horizontal runs on the same baseline
  const lines: PdfVectorRun[] = [];
  for (const r of runs) {
    const prev = lines[lines.length - 1];
    if (
      prev &&
      Math.abs(r.y0 - prev.y0) < prev.fontPx * 0.45 &&
      r.x0 - prev.x1 < prev.fontPx * 1.8 &&
      r.x0 >= prev.x0 - 4
    ) {
      const needsSpace =
        r.x0 - prev.x1 > prev.fontPx * 0.22 &&
        /[A-Za-z0-9]$/.test(prev.text) &&
        /^[A-Za-z0-9]/.test(r.text);
      prev.text += (needsSpace ? ' ' : '') + r.text;
      prev.x1 = Math.max(prev.x1, r.x1);
      prev.y0 = Math.min(prev.y0, r.y0);
      prev.y1 = Math.max(prev.y1, r.y1);
      prev.fontPx = Math.max(prev.fontPx, r.fontPx);
    } else {
      lines.push({ ...r });
    }
  }

  // Group tightly stacked paragraph lines with matching font height & left alignment
  const blocks: { lines: PdfVectorRun[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const ln of lines) {
    const isBullet = /^[•·\-*▪▸►0-9]+[.)、]?\s+/.test(ln.text.trim());
    const prev = blocks[blocks.length - 1];
    if (prev && !isBullet) {
      const last = prev.lines[prev.lines.length - 1];
      const vGap = ln.y0 - last.y1;
      const sameFont = Math.abs(ln.fontPx - last.fontPx) <= last.fontPx * 0.18;
      const sameLeft = Math.abs(ln.x0 - prev.x0) < canvas.width * 0.018;
      if (vGap >= -4 && vGap <= last.fontPx * 0.65 && sameFont && sameLeft) {
        prev.lines.push(ln);
        prev.x0 = Math.min(prev.x0, ln.x0);
        prev.y0 = Math.min(prev.y0, ln.y0);
        prev.x1 = Math.max(prev.x1, ln.x1);
        prev.y1 = Math.max(prev.y1, ln.y1);
        continue;
      }
    }
    blocks.push({ lines: [ln], x0: ln.x0, y0: ln.y0, x1: ln.x1, y1: ln.y1 });
  }

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx ? ctx.getImageData(0, 0, width, height) : null;
  const slideHeightPt = 540;

  return blocks.map((b, idx) => {
    const avgFontPx =
      b.lines.reduce((s, l) => s + l.fontPx, 0) / Math.max(1, b.lines.length);
    const fontSizePt = Math.max(
      9,
      Math.min(54, Math.round((avgFontPx / height) * slideHeightPt * 0.85))
    );
    const sampled = imageData
      ? sampleRegionColors(imageData, b.x0, b.y0, b.x1, b.y1)
      : { fgHex: '#182026', bgHex: '#FFFFFF', isDarkBg: false };

    const xPct = Math.max(0, (b.x0 / width) * 100);
    const yPct = Math.max(0, (b.y0 / height) * 100);
    const wPct = Math.min(100 - xPct, ((b.x1 - b.x0) / width) * 100 + 2.2);
    const hPct = Math.min(100 - yPct, ((b.y1 - b.y0) / height) * 100 + 1.2);

    return {
      id: `vec-${Date.now()}-${idx}`,
      text: b.lines.map((l) => l.text.trim()).join('\n'),
      xPct,
      yPct,
      wPct,
      hPct,
      fontSizePt,
      fontFamily: 'Microsoft JhengHei',
      color: sampled.fgHex,
      bgColor: 'transparent',
      bold: fontSizePt >= 20,
      italic: false,
      align: 'left',
      role: fontSizePt >= 26 ? 'title' : fontSizePt >= 18 ? 'heading' : 'body',
      confidence: 100,
    };
  });
}

export async function processPdfFile(
  file: File,
  opts: ProcessOptions
): Promise<SlideItem[]> {
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const totalPages = Math.min(pdf.numPages, 50);
  const slides: SlideItem[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    opts.onProgress({
      active: true,
      currentSlide: pageNum,
      totalSlides: totalPages,
      stageLabel: `正在渲染並解析第 ${pageNum} / ${totalPages} 頁...`,
      percent: Math.round(((pageNum - 1) / totalPages) * 100),
    });

    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetScale = Math.min(2.2, 2100 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(1.5, targetScale) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    const originalDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    let regions: TextRegion[] = [];
    let sourceType: SlideItem['sourceType'] = 'pdf-ocr';

    if (opts.engineMode === 'gemini') {
      regions = await detectSlideTextWithGemini(canvas, opts.geminiApiKey);
      sourceType = 'gemini-vision';
    } else if (opts.engineMode === 'auto') {
      const textContent = await page.getTextContent();
      const charCount = textContent.items.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, it: any) => sum + (typeof it?.str === 'string' ? it.str.trim().length : 0),
        0
      );
      if (charCount >= 14) {
        regions = extractNativePdfRegions(textContent.items, viewport, canvas);
        sourceType = 'pdf-vector';
      } else {
        regions = await detectSlideTextWithOcr(canvas, opts.ocrLang, (subPct) => {
          opts.onProgress({
            active: true,
            currentSlide: pageNum,
            totalSlides: totalPages,
            stageLabel: `第 ${pageNum} / ${totalPages} 頁本地 OCR 辨識中 (${subPct}%)...`,
            percent: Math.round(((pageNum - 1 + subPct / 100) / totalPages) * 100),
          });
        });
        sourceType = 'pdf-ocr';
      }
    } else {
      regions = await detectSlideTextWithOcr(canvas, opts.ocrLang, (subPct) => {
        opts.onProgress({
          active: true,
          currentSlide: pageNum,
          totalSlides: totalPages,
          stageLabel: `第 ${pageNum} / ${totalPages} 頁強制本地 OCR 辨識中 (${subPct}%)...`,
          percent: Math.round(((pageNum - 1 + subPct / 100) / totalPages) * 100),
        });
      });
      sourceType = 'pdf-ocr';
    }

    const cleanedDataUrl = await generateCleanedBackground(originalDataUrl, regions, []);

    slides.push({
      id: `slide-${Date.now()}-${pageNum}`,
      index: pageNum - 1,
      included: true,
      widthPx: canvas.width,
      heightPx: canvas.height,
      aspectRatio: canvas.width / canvas.height,
      originalDataUrl,
      cleanedDataUrl,
      backgroundMode: 'cleaned',
      solidBgHex: '#FAF8F5',
      regions,
      manualErasePatches: [],
      sourceType,
    });
  }

  return slides;
}

export async function processImageFiles(
  files: File[],
  opts: ProcessOptions
): Promise<SlideItem[]> {
  const total = Math.min(files.length, 50);
  const slides: SlideItem[] = [];

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const objUrl = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(objUrl);
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      // Upscale low-res screenshots (e.g. 800-1366px) up to ~1800px so 9px CJK strokes stay sharp for DBNet
      const scale =
        longest < 1600
          ? Math.min(2.2, 1800 / Math.max(1, longest))
          : Math.min(1, 2200 / longest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const originalDataUrl = canvas.toDataURL('image/jpeg', 0.92);

      opts.onProgress({
        active: true,
        currentSlide: i + 1,
        totalSlides: total,
        stageLabel: `正在辨識圖片 ${i + 1} / ${total} (${file.name})...`,
        percent: Math.round((i / total) * 100),
      });

      let regions: TextRegion[] = [];
      let sourceType: SlideItem['sourceType'] = 'image-ocr';

      if (opts.engineMode === 'gemini') {
        regions = await detectSlideTextWithGemini(canvas, opts.geminiApiKey);
        sourceType = 'gemini-vision';
      } else {
        regions = await detectSlideTextWithOcr(canvas, opts.ocrLang, (subPct) => {
          opts.onProgress({
            active: true,
            currentSlide: i + 1,
            totalSlides: total,
            stageLabel: `圖片 ${i + 1} / ${total} 本地 OCR 辨識中 (${subPct}%)...`,
            percent: Math.round(((i + subPct / 100) / total) * 100),
          });
        });
      }

      const cleanedDataUrl = await generateCleanedBackground(originalDataUrl, regions, []);

      slides.push({
        id: `img-slide-${Date.now()}-${i}`,
        index: i,
        included: true,
        widthPx: canvas.width,
        heightPx: canvas.height,
        aspectRatio: canvas.width / canvas.height,
        originalDataUrl,
        cleanedDataUrl,
        backgroundMode: 'cleaned',
        solidBgHex: '#FAF8F5',
        regions,
        manualErasePatches: [],
        sourceType,
      });
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }

  return slides;
}
