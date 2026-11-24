import {
  PaddleOcrService,
  V6_MEDIUM_MODEL,
  V6_SMALL_MODEL,
  type FlattenedPaddleOcrResult,
} from 'ppu-paddle-ocr/web';
import type { OcrLang, TextRegion } from '../types/slide';
import { analyzeTextBoxPixels, hexColorDistance } from './inpaintEngine';

type ModelTier = 'v6-small' | 'v6-medium';

let cachedService: PaddleOcrService | null = null;
let cachedTier: ModelTier | null = null;
let initPromise: Promise<PaddleOcrService> | null = null;

function openModelCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('slideunlock-ocr-cache', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('models')) {
        req.result.createObjectStore('models');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetBuffer(key: string): Promise<ArrayBuffer | undefined> {
  const db = await openModelCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readonly');
    const req = tx.objectStore('models').get(key);
    req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSetBuffer(key: string, val: ArrayBuffer): Promise<void> {
  const db = await openModelCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    const req = tx.objectStore('models').put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function fetchAndCacheModelResource(
  url: string,
  cacheKey: string,
  onBytes?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  try {
    const existing = await idbGetBuffer(cacheKey);
    if (existing && existing.byteLength > 1024) {
      if (onBytes) onBytes(existing.byteLength, existing.byteLength);
      return existing;
    }
  } catch {
    // IndexedDB unavailable in private/sandboxed context; fall through to fetch
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`無法載入 OCR 模型檔案 (${res.status}): ${url}`);
  }

  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !onBytes || total === 0) {
    const buf = await res.arrayBuffer();
    try {
      await idbSetBuffer(cacheKey, buf);
    } catch {
      // Ignore quota errors
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onBytes(received, total);
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }

  const buf = combined.buffer;
  try {
    await idbSetBuffer(cacheKey, buf);
  } catch {
    // Ignore quota errors
  }
  return buf;
}

function resolveTier(lang: OcrLang): ModelTier {
  return lang === 'v6-medium' ? 'v6-medium' : 'v6-small';
}

async function getPaddleOcrService(
  tier: ModelTier,
  onProgress?: (pct: number, statusText: string) => void
): Promise<PaddleOcrService> {
  if (cachedService && cachedTier === tier && cachedService.isInitialized()) {
    return cachedService;
  }
  if (initPromise && cachedTier === tier) {
    return initPromise;
  }

  if (cachedService) {
    await cachedService.destroy();
    cachedService = null;
  }

  cachedTier = tier;
  initPromise = (async () => {
    const urls = tier === 'v6-medium' ? V6_MEDIUM_MODEL : V6_SMALL_MODEL;
    onProgress?.(8, '載入本地 PP-OCRv6 神經網路偵測與多語系辨識模型...');

    const detBuf = await fetchAndCacheModelResource(
      urls.detection,
      `ppocr-det-${tier}-v1`,
      (loaded, total) => {
        const pct = 5 + Math.round((loaded / Math.max(1, total)) * 28);
        onProgress?.(pct, '下載並快取文字區域偵測模型 (首次執行)...');
      }
    );

    const recBuf = await fetchAndCacheModelResource(
      urls.recognition,
      `ppocr-rec-${tier}-v1`,
      (loaded, total) => {
        const pct = 33 + Math.round((loaded / Math.max(1, total)) * 42);
        onProgress?.(pct, '下載並快取繁中/英/日多語系神經辨識模型 (首次執行)...');
      }
    );

    const dictBuf = await fetchAndCacheModelResource(
      urls.charactersDictionary,
      `ppocr-dict-${tier}-v1`
    );

    onProgress?.(78, '初始化 WebAssembly / WebGPU 推論引擎...');

    const service = new PaddleOcrService({
      model: {
        detection: detBuf,
        recognition: recBuf,
        charactersDictionary: dictBuf,
      },
      detection: {
        maxSideLength: 1920,
        paddingVertical: 0.3,
        paddingHorizontal: 0.35,
        minimumAreaThreshold: 24,
      },
      recognition: {
        strategy: 'per-box',
        minimumConfidence: 0.56,
        spaceRecovery: true,
        rotateVerticalCrops: false,
        charactersDictionary: [],
      },
    });

    await service.initialize();
    cachedService = service;
    initPromise = null;
    return service;
  })().catch((err) => {
    initPromise = null;
    cachedService = null;
    throw err;
  });

  return initPromise;
}

interface EnrichedDetection {
  text: string;
  confidence: number;
  tightX0: number;
  tightY0: number;
  tightX1: number;
  tightY1: number;
  glyphHeightPx: number;
  fgHex: string;
  bgHex: string;
  inkDensity: number;
}

/**
 * Cleans extra spaces strictly between CJK characters while keeping CJK-to-English spacing crisp.
 */
export function cleanSlideText(raw: string): string {
  return raw
    .replace(
      /([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef])\s+([\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef])/g,
      '$1$2'
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function detectSlideTextWithOcr(
  canvas: HTMLCanvasElement,
  lang: OcrLang,
  onProgress?: (pct: number, statusText: string) => void
): Promise<TextRegion[]> {
  const tier = resolveTier(lang);
  const service = await getPaddleOcrService(tier, onProgress);

  onProgress?.(84, '正在進行神經網路版面文字偵測與字元辨識...');

  const ocrRes = (await service.recognize(canvas, {
    flatten: true,
    strategy: 'per-box',
    minimumConfidence: 0.52,
    spaceRecovery: true,
    rotateVerticalCrops: false,
  })) as FlattenedPaddleOcrResult;

  onProgress?.(95, '正在計算精準字級、取樣字色與智慧去字修補...');

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx ? ctx.getImageData(0, 0, width, height) : null;

  const items: EnrichedDetection[] = [];

  for (const det of ocrRes.results ?? []) {
    let cleaned = cleanSlideText(det.text || '');
    if (!cleaned) continue;
    if (det.confidence < 0.52) continue;

    // Strip leading false-read circled checkmark symbol when followed by real text (e.g. "② Telemetry" -> "Telemetry")
    if (/^[①②③④⑤⑥⑦⑧⑨⑩©®]\s+[A-Za-z\u4e00-\u9fff]/.test(cleaned) && det.confidence < 0.9) {
      cleaned = cleaned.replace(/^[①②③④⑤⑥⑦⑧⑨⑩©®]\s+/, '');
    }

    // Filter out standalone 1-character icons (gears, checkmarks, chevrons 》, power buttons, badge icons)
    // while keeping numeric page numbers (0-9).
    if (cleaned.length === 1) {
      const isDigit = /^[0-9]$/.test(cleaned);
      if (!isDigit && det.confidence < 0.95) continue;
      if (isDigit && det.confidence < 0.78) continue;
    }
    if (cleaned.length <= 2 && !/[0-9A-Za-z\u4e00-\u9fff]/.test(cleaned)) {
      continue;
    }

    const bx0 = det.box.x;
    const by0 = det.box.y;
    const bx1 = det.box.x + det.box.width;
    const by1 = det.box.y + det.box.height;

    const analysis = imageData
      ? analyzeTextBoxPixels(imageData, bx0, by0, bx1, by1)
      : {
          fgHex: '#182026',
          bgHex: '#FFFFFF',
          isDarkBg: false,
          tightX0: bx0,
          tightY0: by0,
          tightX1: bx1,
          tightY1: by1,
          glyphHeightPx: by1 - by0,
          tiltSlope: 0,
          slantSpanRatio: 1,
          inkDensity: 0.25,
        };

    const tightW = analysis.tightX1 - analysis.tightX0 + 1;
    const tightH = analysis.tightY1 - analysis.tightY0 + 1;
    if (tightW < 4 || tightH < 5) continue;

    // Skip 3D isometric perspective-tilted decorative text inside illustrations
    if (
      (Math.abs(analysis.tiltSlope) > 0.07 || analysis.slantSpanRatio > 1.75) &&
      det.confidence < 0.92
    ) {
      continue;
    }

    // Skip large square icon badges misread as a single CJK/Latin letter (e.g. document/power icon)
    if (
      cleaned.length === 1 &&
      !/^[0-9]$/.test(cleaned) &&
      tightH > height * 0.032 &&
      tightW / Math.max(1, tightH) > 0.65 &&
      tightW / Math.max(1, tightH) < 1.45
    ) {
      continue;
    }

    items.push({
      text: cleaned,
      confidence: det.confidence,
      tightX0: analysis.tightX0,
      tightY0: analysis.tightY0,
      tightX1: analysis.tightX1,
      tightY1: analysis.tightY1,
      glyphHeightPx: analysis.glyphHeightPx,
      fgHex: analysis.fgHex,
      bgHex: analysis.bgHex,
      inkDensity: analysis.inkDensity,
    });
  }

  // Sort top-to-bottom by vertical center, then left-to-right
  items.sort((a, b) => {
    const cyA = (a.tightY0 + a.tightY1) / 2;
    const cyB = (b.tightY0 + b.tightY1) / 2;
    const avgH = (a.glyphHeightPx + b.glyphHeightPx) / 2;
    if (Math.abs(cyA - cyB) < avgH * 0.5) {
      return a.tightX0 - b.tightX0;
    }
    return cyA - cyB;
  });

  // Merge horizontally adjacent word fragments on the EXACT same line ONLY when:
  // 1) Vertical centers match closely,
  // 2) Glyph heights match closely,
  // 3) Horizontal gap is small (< 1.2 * glyphHeight, never bridging across columns or cards!),
  // 4) Foreground & background colors match closely.
  const mergedLines: EnrichedDetection[] = [];
  for (const item of items) {
    const prev = mergedLines[mergedLines.length - 1];
    if (prev) {
      const hPrev = prev.glyphHeightPx;
      const hCur = item.glyphHeightPx;
      const avgH = (hPrev + hCur) / 2;
      const cyPrev = (prev.tightY0 + prev.tightY1) / 2;
      const cyCur = (item.tightY0 + item.tightY1) / 2;
      const gapX = item.tightX0 - prev.tightX1;
      const hRatio = Math.max(hPrev, hCur) / Math.max(1, Math.min(hPrev, hCur));
      const colorDiff = hexColorDistance(prev.fgHex, item.fgHex);
      const bgDiff = hexColorDistance(prev.bgHex, item.bgHex);

      if (
        Math.abs(cyPrev - cyCur) <= avgH * 0.42 &&
        hRatio <= 1.32 &&
        gapX >= -avgH * 0.35 &&
        gapX <= avgH * 1.2 &&
        colorDiff < 52 &&
        bgDiff < 42
      ) {
        const needsSpace =
          gapX > avgH * 0.14 &&
          !/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]$/.test(prev.text) &&
          !/^[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(item.text);
        prev.text = `${prev.text}${needsSpace ? ' ' : ''}${item.text}`;
        prev.tightX0 = Math.min(prev.tightX0, item.tightX0);
        prev.tightY0 = Math.min(prev.tightY0, item.tightY0);
        prev.tightX1 = Math.max(prev.tightX1, item.tightX1);
        prev.tightY1 = Math.max(prev.tightY1, item.tightY1);
        prev.glyphHeightPx = Math.max(prev.glyphHeightPx, item.glyphHeightPx);
        prev.confidence = (prev.confidence + item.confidence) / 2;
        prev.inkDensity = (prev.inkDensity + item.inkDensity) / 2;
        continue;
      }
    }
    mergedLines.push({ ...item });
  }

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const slideHeightPt = 540; // 7.5 inches * 72 pt/in

  return mergedLines.map((ln, idx) => {
    const tightW = ln.tightX1 - ln.tightX0 + 1;
    const tightH = ln.tightY1 - ln.tightY0 + 1;
    const glyphH = Math.max(4, ln.glyphHeightPx);

    const hasCjk = /[\u3400-\u9fff]/.test(ln.text);
    const hasCapOrAscender = /[A-Z0-9bdfghjklpqty()/[\]+%]/.test(ln.text);

    // Convert true glyph ink height to CSS/PPTX em size in pixels
    const inkToEmFactor = hasCjk ? 0.9 : hasCapOrAscender ? 0.78 : 0.57;
    let emPx = glyphH / inkToEmFactor;

    const isBold = emPx >= height * 0.034 || (emPx >= height * 0.022 && ln.inkDensity > 0.32);

    // Measure rendered width using exact web font stack and guarantee renderedWidth <= tightW * 1.02
    let renderedWidthPx = tightW;
    if (measureCtx) {
      const fontStack = `"Plus Jakarta Sans", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
      measureCtx.font = `${isBold ? '700' : '400'} ${emPx.toFixed(2)}px ${fontStack}`;
      renderedWidthPx = measureCtx.measureText(ln.text).width;
      if (renderedWidthPx > tightW * 1.03 && ln.text.length >= 3) {
        const fitScale = Math.max(0.76, (tightW * 1.0) / renderedWidthPx);
        emPx *= fitScale;
        measureCtx.font = `${isBold ? '700' : '400'} ${emPx.toFixed(2)}px ${fontStack}`;
        renderedWidthPx = measureCtx.measureText(ln.text).width;
      }
    }

    const fontSizePt = Math.max(
      6.5,
      Math.min(54, Math.round(((emPx / height) * slideHeightPt) * 2) / 2)
    );

    // Vertically center the rendered line over the tight ink bounds
    const tightCenterY = (ln.tightY0 + ln.tightY1) / 2;
    const renderedLineH = emPx * 1.22;
    const boxTopPx = Math.max(0, tightCenterY - renderedLineH * 0.5);
    const boxWidthPx = Math.max(tightW, renderedWidthPx) + emPx * 1.1;
    const boxHeightPx = Math.max(tightH, renderedLineH);

    const xPct = Math.max(0, (ln.tightX0 / width) * 100);
    const yPct = Math.max(0, (boxTopPx / height) * 100);
    const wPct = Math.min(100 - xPct, (boxWidthPx / width) * 100);
    const hPct = Math.min(100 - yPct, (boxHeightPx / height) * 100);

    // Exact tight erase bounds on original image so inpainting never touches nearby borders or icons
    const eraseXPct = Math.max(0, (ln.tightX0 / width) * 100);
    const eraseYPct = Math.max(0, (ln.tightY0 / height) * 100);
    const eraseWPct = Math.min(100 - eraseXPct, (tightW / width) * 100);
    const eraseHPct = Math.min(100 - eraseYPct, (tightH / height) * 100);

    const role: TextRegion['role'] =
      fontSizePt >= 24
        ? 'title'
        : fontSizePt >= 15
          ? 'heading'
          : fontSizePt <= 10
            ? 'caption'
            : 'body';

    return {
      id: `ocr-${Date.now()}-${idx}`,
      text: ln.text,
      xPct,
      yPct,
      wPct,
      hPct,
      eraseXPct,
      eraseYPct,
      eraseWPct,
      eraseHPct,
      fontSizePt,
      fontFamily: 'Microsoft JhengHei',
      color: ln.fgHex,
      bgColor: 'transparent',
      bold: isBold,
      italic: false,
      align: 'left',
      role,
      confidence: Math.round(ln.confidence * 100),
    };
  });
}
