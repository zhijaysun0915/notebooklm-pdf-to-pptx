import { createWorker, type Worker } from 'tesseract.js';
import type { OcrLang, TextRegion } from '../types/slide';
import { sampleRegionColors } from './inpaintEngine';

let cachedWorker: Worker | null = null;
let cachedLang: OcrLang | null = null;

/**
 * Cleans extra spaces inserted between CJK characters by Tesseract while keeping English word spaces.
 */
export function cleanCjkSpacing(raw: string): string {
  return raw
    .replace(
      /([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef])\s+([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef])/g,
      '$1$2'
    )
    .replace(
      /([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef])\s+([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef])/g,
      '$1$2'
    )
    .trim();
}

async function getOcrWorker(
  lang: OcrLang,
  onProgress?: (pct: number, statusText: string) => void
): Promise<Worker> {
  if (cachedWorker && cachedLang === lang) {
    return cachedWorker;
  }
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }

  cachedWorker = await createWorker(lang, undefined, {
    logger: (msg) => {
      if (onProgress && typeof msg.progress === 'number') {
        onProgress(Math.round(msg.progress * 100), msg.status || 'OCR');
      }
    },
  });
  cachedLang = lang;
  return cachedWorker;
}

interface RawLineItem {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

export async function detectSlideTextWithOcr(
  canvas: HTMLCanvasElement,
  lang: OcrLang,
  onProgress?: (pct: number, statusText: string) => void
): Promise<TextRegion[]> {
  const worker = await getOcrWorker(lang, onProgress);
  // IMPORTANT: Tesseract.js v7 requires { text: true, blocks: true } in the 3rd arg to populate blocks/lines!
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx ? ctx.getImageData(0, 0, width, height) : null;

  const rawLines: RawLineItem[] = [];
  const blocks = result.data.blocks ?? [];

  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const cleaned = cleanCjkSpacing(line.text || '');
        if (!cleaned) continue;
        const bw = line.bbox.x1 - line.bbox.x0;
        const bh = line.bbox.y1 - line.bbox.y0;
        if (bw < 6 || bh < 6) continue;
        // Filter out stray low-confidence 1-character noise specks from icons/illustrations
        if (line.confidence < 38 && cleaned.length <= 2 && !/[0-9A-Za-z\u4e00-\u9fff]/.test(cleaned)) {
          continue;
        }
        if (line.confidence < 26 && cleaned.length <= 1) {
          continue;
        }
        rawLines.push({
          text: cleaned,
          x0: line.bbox.x0,
          y0: line.bbox.y0,
          x1: line.bbox.x1,
          y1: line.bbox.y1,
          confidence: line.confidence,
        });
      }
    }
  }

  // Group vertically adjacent lines that clearly belong to the same paragraph block
  // while keeping titles, separate bullet items, and multi-column cards independent.
  const mergedGroups: {
    lines: RawLineItem[];
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }[] = [];

  for (const ln of rawLines) {
    const lnH = ln.y1 - ln.y0;
    const isBulletStart = /^[•·\-*▪▸►0-9]+[.)、]?\s*/.test(ln.text);
    const prev = mergedGroups[mergedGroups.length - 1];

    if (prev && !isBulletStart) {
      const prevLast = prev.lines[prev.lines.length - 1];
      const prevH = prevLast.y1 - prevLast.y0;
      const vGap = ln.y0 - prevLast.y1;
      const heightRatio = Math.max(lnH, prevH) / Math.max(1, Math.min(lnH, prevH));
      const leftDiff = Math.abs(ln.x0 - prev.x0);
      const centerDiff = Math.abs((ln.x0 + ln.x1) / 2 - (prev.x0 + prev.x1) / 2);

      if (
        vGap >= -lnH * 0.25 &&
        vGap <= prevH * 0.65 &&
        heightRatio <= 1.28 &&
        (leftDiff < width * 0.025 || centerDiff < width * 0.02)
      ) {
        prev.lines.push(ln);
        prev.x0 = Math.min(prev.x0, ln.x0);
        prev.y0 = Math.min(prev.y0, ln.y0);
        prev.x1 = Math.max(prev.x1, ln.x1);
        prev.y1 = Math.max(prev.y1, ln.y1);
        continue;
      }
    }

    mergedGroups.push({
      lines: [ln],
      x0: ln.x0,
      y0: ln.y0,
      x1: ln.x1,
      y1: ln.y1,
    });
  }

  const slideHeightPt = 540; // 7.5 inches * 72 pt/inch

  return mergedGroups.map((grp, idx) => {
    const avgLinePx =
      grp.lines.reduce((acc, l) => acc + (l.y1 - l.y0), 0) / Math.max(1, grp.lines.length);
    const rawPt = (avgLinePx / height) * slideHeightPt * 0.78;
    const fontSizePt = Math.max(9, Math.min(54, Math.round(rawPt)));

    const sampled = imageData
      ? sampleRegionColors(imageData, grp.x0, grp.y0, grp.x1, grp.y1)
      : { fgHex: '#182026', bgHex: '#FFFFFF', isDarkBg: false };

    const isCentered =
      grp.lines.length >= 1 &&
      Math.abs((grp.x0 + grp.x1) / 2 - width / 2) < width * 0.06 &&
      grp.x0 > width * 0.14;

    const role: TextRegion['role'] =
      fontSizePt >= 26
        ? 'title'
        : fontSizePt >= 18
          ? 'heading'
          : fontSizePt <= 11
            ? 'caption'
            : 'body';

    const avgConf =
      grp.lines.reduce((acc, l) => acc + l.confidence, 0) / Math.max(1, grp.lines.length);

    // Add slight width buffer (2.5%) so PowerPoint text boxes don't prematurely wrap CJK lines
    const xPct = Math.max(0, (grp.x0 / width) * 100);
    const yPct = Math.max(0, (grp.y0 / height) * 100);
    const wPct = Math.min(100 - xPct, ((grp.x1 - grp.x0) / width) * 100 + 2.5);
    const hPct = Math.min(100 - yPct, ((grp.y1 - grp.y0) / height) * 100 + 1.2);

    return {
      id: `ocr-${Date.now()}-${idx}`,
      text: grp.lines.map((l) => l.text).join('\n'),
      xPct,
      yPct,
      wPct,
      hPct,
      fontSizePt,
      fontFamily: 'Microsoft JhengHei',
      color: sampled.fgHex,
      bgColor: 'transparent',
      bold: fontSizePt >= 19,
      italic: false,
      align: isCentered ? 'center' : 'left',
      role,
      confidence: Math.round(avgConf),
    };
  });
}
