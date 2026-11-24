import type { ErasePatch, TextRegion } from '../types/slide';

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface SampledColors {
  fgHex: string;
  bgHex: string;
  isDarkBg: boolean;
}

/**
 * Samples surrounding background color and dominant high-contrast foreground text stroke color
 * within a pixel bounding box on the slide canvas.
 */
export function sampleRegionColors(
  imageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): SampledColors {
  const { width, height, data } = imageData;
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(width - 1, Math.ceil(x1));
  const by1 = Math.min(height - 1, Math.ceil(y1));

  const ringOut = 4;
  const rx0 = Math.max(0, bx0 - ringOut);
  const ry0 = Math.max(0, by0 - ringOut);
  const rx1 = Math.min(width - 1, bx1 + ringOut);
  const ry1 = Math.min(height - 1, by1 + ringOut);

  const bgR: number[] = [];
  const bgG: number[] = [];
  const bgB: number[] = [];

  const pushPixel = (px: number, py: number) => {
    const idx = (py * width + px) * 4;
    bgR.push(data[idx]);
    bgG.push(data[idx + 1]);
    bgB.push(data[idx + 2]);
  };

  for (let x = rx0; x <= rx1; x += 2) {
    pushPixel(x, ry0);
    pushPixel(x, ry1);
  }
  for (let y = ry0; y <= ry1; y += 2) {
    pushPixel(rx0, y);
    pushPixel(rx1, y);
  }

  const medBgR = median(bgR);
  const medBgG = median(bgG);
  const medBgB = median(bgB);

  const bgLum = 0.299 * medBgR + 0.587 * medBgG + 0.114 * medBgB;
  const isDarkBg = bgLum < 128;

  // Sample interior pixels and collect top contrast candidates (actual character strokes)
  const candidates: { dist: number; r: number; g: number; b: number }[] = [];
  const stepX = Math.max(1, Math.floor((bx1 - bx0) / 48));
  const stepY = Math.max(1, Math.floor((by1 - by0) / 24));

  for (let y = by0; y <= by1; y += stepY) {
    for (let x = bx0; x <= bx1; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const dist = Math.hypot(r - medBgR, g - medBgG, b - medBgB);
      if (dist > 34) {
        candidates.push({ dist, r, g, b });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      fgHex: isDarkBg ? '#F8FAFC' : '#182026',
      bgHex: rgbToHex(medBgR, medBgG, medBgB),
      isDarkBg,
    };
  }

  // Keep upper 45% highest-contrast stroke pixels to avoid anti-aliased edge dilution
  candidates.sort((a, b) => b.dist - a.dist);
  const topCount = Math.max(1, Math.ceil(candidates.length * 0.45));
  const topSlice = candidates.slice(0, topCount);

  const fgR = median(topSlice.map((c) => c.r));
  const fgG = median(topSlice.map((c) => c.g));
  const fgB = median(topSlice.map((c) => c.b));

  return {
    fgHex: rgbToHex(fgR, fgG, fgB),
    bgHex: rgbToHex(medBgR, medBgG, medBgB),
    isDarkBg,
  };
}

/**
 * Inpaints a rectangular region using bilinear boundary interpolation.
 * When `selectiveTextMask` is true, only pixels deviating from the interpolated background
 * (plus a 2px dilation halo for anti-aliased fringes) are replaced, preserving nearby borders/shapes.
 * When `selectiveTextMask` is false (manual eraser/watermark removal), replaces the full patch smoothly.
 */
function inpaintRectOnBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  selectiveTextMask: boolean
): void {
  const pad = selectiveTextMask ? 4 : 2;
  const rx0 = Math.max(1, Math.floor(x0 - pad));
  const ry0 = Math.max(1, Math.floor(y0 - pad));
  const rx1 = Math.min(width - 2, Math.ceil(x1 + pad));
  const ry1 = Math.min(height - 2, Math.ceil(y1 + pad));

  const rw = rx1 - rx0 + 1;
  const rh = ry1 - ry0 + 1;
  if (rw <= 2 || rh <= 2) return;

  const getRgb = (px: number, py: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(width - 1, px));
    const cy = Math.max(0, Math.min(height - 1, py));
    const i = (cy * width + cx) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // Pre-compute interpolated background RGB for every pixel inside [rx0..rx1, ry0..ry1]
  const bgBuf = new Float32Array(rw * rh * 3);
  const rawMask = new Uint8Array(rw * rh);

  for (let ly = 0; ly < rh; ly++) {
    const py = ry0 + ly;
    const ty = rh > 1 ? ly / (rh - 1) : 0.5;
    const leftRgb = getRgb(rx0 - 1, py);
    const rightRgb = getRgb(rx1 + 1, py);

    for (let lx = 0; lx < rw; lx++) {
      const px = rx0 + lx;
      const tx = rw > 1 ? lx / (rw - 1) : 0.5;
      const topRgb = getRgb(px, ry0 - 1);
      const botRgb = getRgb(px, ry1 + 1);

      // Distance-weighted blend of vertical & horizontal boundary scanlines
      const wHoriz = 1 / (Math.min(tx, 1 - tx) + 0.08);
      const wVert = 1 / (Math.min(ty, 1 - ty) + 0.08);
      const wSum = wHoriz + wVert;

      const hR = leftRgb[0] * (1 - tx) + rightRgb[0] * tx;
      const hG = leftRgb[1] * (1 - tx) + rightRgb[1] * tx;
      const hB = leftRgb[2] * (1 - tx) + rightRgb[2] * tx;

      const vR = topRgb[0] * (1 - ty) + botRgb[0] * ty;
      const vG = topRgb[1] * (1 - ty) + botRgb[1] * ty;
      const vB = topRgb[2] * (1 - ty) + botRgb[2] * ty;

      const estR = (hR * wHoriz + vR * wVert) / wSum;
      const estG = (hG * wHoriz + vG * wVert) / wSum;
      const estB = (hB * wHoriz + vB * wVert) / wSum;

      const mIdx = ly * rw + lx;
      const bIdx = mIdx * 3;
      bgBuf[bIdx] = estR;
      bgBuf[bIdx + 1] = estG;
      bgBuf[bIdx + 2] = estB;

      if (!selectiveTextMask) {
        rawMask[mIdx] = 1;
      } else {
        const pIdx = (py * width + px) * 4;
        const diff = Math.hypot(
          data[pIdx] - estR,
          data[pIdx + 1] - estG,
          data[pIdx + 2] - estB
        );
        if (diff > 18) {
          rawMask[mIdx] = 1;
        }
      }
    }
  }

  // Dilate mask by 2px when selective so anti-aliased glyph halos disappear completely
  const dilated = new Uint8Array(rw * rh);
  if (selectiveTextMask) {
    const radius = 2;
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        if (rawMask[ly * rw + lx] === 1) {
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = ly + dy;
            if (ny < 0 || ny >= rh) continue;
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = lx + dx;
              if (nx < 0 || nx >= rw) continue;
              dilated[ny * rw + nx] = 1;
            }
          }
        }
      }
    }
  } else {
    dilated.fill(1);
  }

  // Write interpolated background pixels back to canvas buffer
  for (let ly = 0; ly < rh; ly++) {
    const py = ry0 + ly;
    for (let lx = 0; lx < rw; lx++) {
      const mIdx = ly * rw + lx;
      if (dilated[mIdx] === 0) continue;

      const px = rx0 + lx;
      const pIdx = (py * width + px) * 4;
      const bIdx = mIdx * 3;

      // Soft feather near outer 2px border of manual erase patches
      let alpha = 1;
      if (!selectiveTextMask) {
        const edgeDist = Math.min(lx, rw - 1 - lx, ly, rh - 1 - ly);
        if (edgeDist < 3) alpha = (edgeDist + 1) / 4;
      }

      data[pIdx] = Math.round(data[pIdx] * (1 - alpha) + bgBuf[bIdx] * alpha);
      data[pIdx + 1] = Math.round(data[pIdx + 1] * (1 - alpha) + bgBuf[bIdx + 1] * alpha);
      data[pIdx + 2] = Math.round(data[pIdx + 2] * (1 - alpha) + bgBuf[bIdx + 2] * alpha);
    }
  }
}

export async function generateCleanedBackground(
  originalDataUrl: string,
  regions: TextRegion[],
  manualPatches: ErasePatch[]
): Promise<string> {
  const img = await loadImageElement(originalDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return originalDataUrl;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = imageData;

  for (const reg of regions) {
    const x0 = (reg.xPct / 100) * width;
    const y0 = (reg.yPct / 100) * height;
    const x1 = ((reg.xPct + reg.wPct) / 100) * width;
    const y1 = ((reg.yPct + reg.hPct) / 100) * height;
    inpaintRectOnBuffer(data, width, height, x0, y0, x1, y1, true);
  }

  for (const patch of manualPatches) {
    const x0 = (patch.xPct / 100) * width;
    const y0 = (patch.yPct / 100) * height;
    const x1 = ((patch.xPct + patch.wPct) / 100) * width;
    const y1 = ((patch.yPct + patch.hPct) / 100) * height;
    inpaintRectOnBuffer(data, width, height, x0, y0, x1, y1, false);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}
