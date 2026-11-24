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
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function hexColorDistance(hexA: string, hexB: string): number {
  const parse = (h: string) => {
    const clean = h.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * Estimates the true local background RGB inside a text box using dominant color-bin clustering.
 * Because 60%-85% of pixels inside any text bounding box are background (gaps between strokes/letters),
 * this is immune to pill borders, adjacent icons, and dark/light themes.
 */
function estimateDominantBackground(
  data: Uint8ClampedArray,
  width: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number
): [number, number, number] {
  const bins = new Map<number, { count: number; sumR: number; sumG: number; sumB: number }>();
  const stepX = Math.max(1, Math.floor((bx1 - bx0 + 1) / 40));
  const stepY = Math.max(1, Math.floor((by1 - by0 + 1) / 24));

  for (let y = by0; y <= by1; y += stepY) {
    for (let x = bx0; x <= bx1; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // 16-level quantization per channel (4096 buckets)
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = bins.get(key);
      if (cur) {
        cur.count++;
        cur.sumR += r;
        cur.sumG += g;
        cur.sumB += b;
      } else {
        bins.set(key, { count: 1, sumR: r, sumG: g, sumB: b });
      }
    }
  }

  let bestKey = 0;
  let bestScore = -1;
  for (const [key, entry] of bins.entries()) {
    const qr = (key >> 8) & 0xf;
    const qg = (key >> 4) & 0xf;
    const qb = key & 0xf;
    // Sum immediate +-1 neighbor bins to handle smooth background gradients
    let clusterCount = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dg = -1; dg <= 1; dg++) {
        for (let db = -1; db <= 1; db++) {
          const nr = qr + dr;
          const ng = qg + dg;
          const nb = qb + db;
          if (nr < 0 || nr > 15 || ng < 0 || ng > 15 || nb < 0 || nb > 15) continue;
          const nKey = (nr << 8) | (ng << 4) | nb;
          const nEntry = bins.get(nKey);
          if (nEntry) clusterCount += nEntry.count;
        }
      }
    }
    if (clusterCount > bestScore || (clusterCount === bestScore && entry.count > (bins.get(bestKey)?.count ?? 0))) {
      bestScore = clusterCount;
      bestKey = key;
    }
  }

  const bestBin = bins.get(bestKey);
  if (!bestBin || bestBin.count === 0) return [255, 255, 255];
  const seedR = bestBin.sumR / bestBin.count;
  const seedG = bestBin.sumG / bestBin.count;
  const seedB = bestBin.sumB / bestBin.count;

  const rVals: number[] = [];
  const gVals: number[] = [];
  const bVals: number[] = [];
  for (let y = by0; y <= by1; y += stepY) {
    for (let x = bx0; x <= bx1; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (Math.hypot(r - seedR, g - seedG, b - seedB) < 28) {
        rVals.push(r);
        gVals.push(g);
        bVals.push(b);
      }
    }
  }

  if (rVals.length === 0) return [Math.round(seedR), Math.round(seedG), Math.round(seedB)];
  return [Math.round(median(rVals)), Math.round(median(gVals)), Math.round(median(bVals))];
}

/**
 * Isolates interior text glyphs from surrounding container/pill borders (such as [ NOW ], [ SOMETIME ], [ NEXT ])
 * by trimming high-fill outer border lines AND clipping at empty interior padding gaps between border arcs and glyphs.
 */
function isolateGlyphInterior(
  data: Uint8ClampedArray,
  width: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
  bgR: number,
  bgG: number,
  bgB: number
): { ix0: number; iy0: number; ix1: number; iy1: number } {
  let ix0 = bx0;
  let iy0 = by0;
  let ix1 = bx1;
  let iy1 = by1;

  const boxW = bx1 - bx0 + 1;
  const boxH = by1 - by0 + 1;
  if (boxW < 8 || boxH < 8) return { ix0, iy0, ix1, iy1 };

  const maxTrimY = Math.floor(boxH * 0.36);
  const maxTrimX = Math.min(5, Math.floor(boxW * 0.07));

  // Measure horizontal row ink across central 72% width (ignores curved pill left/right end-caps!)
  const cx0 = bx0 + Math.floor(boxW * 0.14);
  const cx1 = Math.max(cx0 + 2, bx1 - Math.floor(boxW * 0.14));
  const centralW = cx1 - cx0 + 1;

  const centralRowRatio = (y: number) => {
    let fg = 0;
    for (let x = cx0; x <= cx1; x++) {
      const i = (y * width + x) * 4;
      if (Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB) > 30) fg++;
    }
    return fg / centralW;
  };

  // Trim outer top/bottom border bands
  while (iy0 - by0 < maxTrimY && iy1 - iy0 > 6 && centralRowRatio(iy0) > 0.58) iy0++;
  while (by1 - iy1 < maxTrimY && iy1 - iy0 > 6 && centralRowRatio(iy1) > 0.58) iy1--;

  // If there is an empty background gap separating an outer border residual from the central text band,
  // step inward past the empty gap to isolate only the central text band!
  const midY = Math.floor((iy0 + iy1) / 2);
  let scanTop = midY;
  while (scanTop > iy0 && centralRowRatio(scanTop) > 0.02) scanTop--;
  if (
    scanTop > iy0 + 1 &&
    centralRowRatio(scanTop) === 0 &&
    centralRowRatio(scanTop - 1) === 0
  ) {
    iy0 = scanTop + 1;
  }

  let scanBot = midY;
  while (scanBot < iy1 && centralRowRatio(scanBot) > 0.02) scanBot++;
  if (
    scanBot < iy1 - 1 &&
    centralRowRatio(scanBot) === 0 &&
    centralRowRatio(scanBot + 1) === 0
  ) {
    iy1 = scanBot - 1;
  }

  // Measure vertical column ink strictly within [iy0..iy1] to strip outer vertical border lines ONLY
  const innerH = Math.max(1, iy1 - iy0 + 1);
  const colRatio = (x: number) => {
    let fg = 0;
    for (let y = iy0; y <= iy1; y++) {
      const i = (y * width + x) * 4;
      if (Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB) > 30) fg++;
    }
    return fg / innerH;
  };

  while (ix0 - bx0 < maxTrimX && ix1 - ix0 > 6 && colRatio(ix0) > 0.68) ix0++;
  while (bx1 - ix1 < maxTrimX && ix1 - ix0 > 6 && colRatio(ix1) > 0.68) ix1--;

  return { ix0, iy0, ix1, iy1 };
}

export interface RefinedBoxAnalysis {
  fgHex: string;
  bgHex: string;
  isDarkBg: boolean;
  tightX0: number;
  tightY0: number;
  tightX1: number;
  tightY1: number;
  glyphHeightPx: number;
  tiltSlope: number;
  slantSpanRatio: number;
  inkDensity: number;
}

/**
 * Analyzes a raw OCR bounding box to extract:
 * 1) Exact tight glyph ink pixel coordinates (stripping OCR padding & pill/card borders),
 * 2) True column glyph height & baseline tilt slope (detects 3D perspective tilted graphics!),
 * 3) True foreground stroke hex color & background hex color.
 */
export function analyzeTextBoxPixels(
  imageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): RefinedBoxAnalysis {
  const { width, height, data } = imageData;
  const bx0 = Math.max(0, Math.floor(x0));
  const by0 = Math.max(0, Math.floor(y0));
  const bx1 = Math.min(width - 1, Math.ceil(x1));
  const by1 = Math.min(height - 1, Math.ceil(y1));

  const [bgR, bgG, bgB] = estimateDominantBackground(data, width, bx0, by0, bx1, by1);
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const isDarkBg = bgLum < 128;

  const { ix0, iy0, ix1, iy1 } = isolateGlyphInterior(
    data,
    width,
    bx0,
    by0,
    bx1,
    by1,
    bgR,
    bgG,
    bgB
  );

  let tightX0 = ix1;
  let tightY0 = iy1;
  let tightX1 = ix0;
  let tightY1 = iy0;
  let strokeCount = 0;

  const candidates: { dist: number; r: number; g: number; b: number }[] = [];
  const colSpans: number[] = [];
  const colCenters: { x: number; cy: number }[] = [];

  for (let x = ix0; x <= ix1; x++) {
    let cMinY = iy1 + 1;
    let cMaxY = iy0 - 1;
    for (let y = iy0; y <= iy1; y++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dist > 38) {
        strokeCount++;
        if (x < tightX0) tightX0 = x;
        if (x > tightX1) tightX1 = x;
        if (y < tightY0) tightY0 = y;
        if (y > tightY1) tightY1 = y;
        if (y < cMinY) cMinY = y;
        if (y > cMaxY) cMaxY = y;
        candidates.push({ dist, r, g, b });
      }
    }
    if (cMaxY >= cMinY) {
      colSpans.push(cMaxY - cMinY + 1);
      colCenters.push({ x, cy: (cMinY + cMaxY) / 2 });
    }
  }

  if (candidates.length === 0 || tightX1 <= tightX0 || tightY1 <= tightY0) {
    const fallbackH = Math.max(4, iy1 - iy0 + 1);
    return {
      fgHex: isDarkBg ? '#F8FAFC' : '#182026',
      bgHex: rgbToHex(bgR, bgG, bgB),
      isDarkBg,
      tightX0: ix0,
      tightY0: iy0,
      tightX1: ix1,
      tightY1: iy1,
      glyphHeightPx: fallbackH,
      tiltSlope: 0,
      slantSpanRatio: 1,
      inkDensity: 0.2,
    };
  }

  // Linear regression slope of column vertical centers to detect 3D isometric slanted text
  let tiltSlope = 0;
  if (colCenters.length >= 6 && tightX1 - tightX0 >= 16) {
    const meanX = colCenters.reduce((s, p) => s + p.x, 0) / colCenters.length;
    const meanY = colCenters.reduce((s, p) => s + p.cy, 0) / colCenters.length;
    let num = 0;
    let den = 0;
    for (const p of colCenters) {
      const dx = p.x - meanX;
      num += dx * (p.cy - meanY);
      den += dx * dx;
    }
    if (den > 1) tiltSlope = num / den;
  }

  const sortedSpans = [...colSpans].sort((a, b) => a - b);
  const medSpan = Math.max(1, sortedSpans[Math.floor(sortedSpans.length * 0.5)]);
  const p82 = sortedSpans[Math.min(sortedSpans.length - 1, Math.floor(sortedSpans.length * 0.82))];
  const rawSpanH = tightY1 - tightY0 + 1;
  const slantSpanRatio = rawSpanH / medSpan;
  const glyphHeightPx =
    slantSpanRatio > 1.65 || Math.abs(tiltSlope) > 0.07 ? p82 : Math.min(rawSpanH, Math.max(p82, rawSpanH * 0.9));

  candidates.sort((a, b) => b.dist - a.dist);
  const topCount = Math.max(1, Math.ceil(candidates.length * 0.42));
  const topSlice = candidates.slice(0, topCount);

  const fgHex = rgbToHex(
    median(topSlice.map((c) => c.r)),
    median(topSlice.map((c) => c.g)),
    median(topSlice.map((c) => c.b))
  );

  const tightArea = Math.max(1, (tightX1 - tightX0 + 1) * (tightY1 - tightY0 + 1));
  const inkDensity = strokeCount / tightArea;

  return {
    fgHex,
    bgHex: rgbToHex(bgR, bgG, bgB),
    isDarkBg,
    tightX0,
    tightY0,
    tightX1,
    tightY1,
    glyphHeightPx,
    tiltSlope,
    slantSpanRatio,
    inkDensity,
  };
}

export function sampleRegionColors(
  imageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const res = analyzeTextBoxPixels(imageData, x0, y0, x1, y1);
  return {
    fgHex: res.fgHex,
    bgHex: res.bgHex,
    isDarkBg: res.isDarkBg,
  };
}

/**
 * Erases text strokes (or manual rectangular patches) using:
 * 1) Dominant-mode local background classification + border protection,
 * 2) 2px halo dilation to capture anti-aliased subpixel fringes,
 * 3) Multi-pass 8-neighbor inward wavefront propagation from adjacent background pixels,
 * 4) 8 iterations of Gauss-Seidel harmonic (Laplacian) smoothing so gradients & cards stay seamless.
 */
function inpaintRectHarmonic(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  selectiveTextMask: boolean
): void {
  const pad = selectiveTextMask ? 3 : 2;
  let rx0 = Math.max(1, Math.floor(x0 - pad));
  let ry0 = Math.max(1, Math.floor(y0 - pad));
  let rx1 = Math.min(width - 2, Math.ceil(x1 + pad));
  let ry1 = Math.min(height - 2, Math.ceil(y1 + pad));

  if (rx1 - rx0 < 2 || ry1 - ry0 < 2) return;

  if (selectiveTextMask) {
    const [bgR, bgG, bgB] = estimateDominantBackground(data, width, rx0, ry0, rx1, ry1);
    const trimmed = isolateGlyphInterior(data, width, rx0, ry0, rx1, ry1, bgR, bgG, bgB);
    rx0 = trimmed.ix0;
    ry0 = trimmed.iy0;
    rx1 = trimmed.ix1;
    ry1 = trimmed.iy1;

    const rw = rx1 - rx0 + 1;
    const rh = ry1 - ry0 + 1;
    if (rw < 2 || rh < 2) return;

    const rawMask = new Uint8Array(rw * rh);
    for (let ly = 0; ly < rh; ly++) {
      const py = ry0 + ly;
      for (let lx = 0; lx < rw; lx++) {
        const px = rx0 + lx;
        const pIdx = (py * width + px) * 4;
        const dist = Math.hypot(data[pIdx] - bgR, data[pIdx + 1] - bgG, data[pIdx + 2] - bgB);
        if (dist > 20) {
          rawMask[ly * rw + lx] = 1;
        }
      }
    }

    // Dilate mask by 2px so anti-aliased fringes & subpixel halos around bright text vanish completely
    const mask = new Uint8Array(rw * rh);
    const radius = 2;
    let maskedCount = 0;
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        if (rawMask[ly * rw + lx] === 1) {
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = ly + dy;
            if (ny < 0 || ny >= rh) continue;
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = lx + dx;
              if (nx < 0 || nx >= rw) continue;
              const mi = ny * rw + nx;
              if (mask[mi] === 0) {
                mask[mi] = 1;
                maskedCount++;
              }
            }
          }
        }
      }
    }

    if (maskedCount === 0) return;
    diffuseAndSmoothPatch(data, width, height, rx0, ry0, rw, rh, mask, bgR, bgG, bgB);
  } else {
    // Manual eraser patch: build a 1px outer known ring around [rx0..rx1, ry0..ry1] and diffuse inward
    const ox0 = Math.max(0, rx0 - 1);
    const oy0 = Math.max(0, ry0 - 1);
    const ox1 = Math.min(width - 1, rx1 + 1);
    const oy1 = Math.min(height - 1, ry1 + 1);
    const rw = ox1 - ox0 + 1;
    const rh = oy1 - oy0 + 1;
    const mask = new Uint8Array(rw * rh);
    for (let ly = 1; ly < rh - 1; ly++) {
      for (let lx = 1; lx < rw - 1; lx++) {
        mask[ly * rw + lx] = 1;
      }
    }
    const [bgR, bgG, bgB] = estimateDominantBackground(data, width, ox0, oy0, ox1, oy1);
    diffuseAndSmoothPatch(data, width, height, ox0, oy0, rw, rh, mask, bgR, bgG, bgB);
  }
}

function diffuseAndSmoothPatch(
  data: Uint8ClampedArray,
  width: number,
  _height: number,
  rx0: number,
  ry0: number,
  rw: number,
  rh: number,
  mask: Uint8Array,
  fallbackR: number,
  fallbackG: number,
  fallbackB: number
): void {
  const total = rw * rh;
  const bufR = new Float32Array(total);
  const bufG = new Float32Array(total);
  const bufB = new Float32Array(total);
  const known = new Uint8Array(total);

  let knownCount = 0;
  for (let ly = 0; ly < rh; ly++) {
    const py = ry0 + ly;
    for (let lx = 0; lx < rw; lx++) {
      const px = rx0 + lx;
      const mIdx = ly * rw + lx;
      const pIdx = (py * width + px) * 4;
      bufR[mIdx] = data[pIdx];
      bufG[mIdx] = data[pIdx + 1];
      bufB[mIdx] = data[pIdx + 2];
      if (mask[mIdx] === 0) {
        known[mIdx] = 1;
        knownCount++;
      }
    }
  }

  // If the entire box was somehow solid ink with zero background pixels, fill with fallback
  if (knownCount === 0) {
    for (let ly = 0; ly < rh; ly++) {
      const py = ry0 + ly;
      for (let lx = 0; lx < rw; lx++) {
        const px = rx0 + lx;
        const pIdx = (py * width + px) * 4;
        data[pIdx] = fallbackR;
        data[pIdx + 1] = fallbackG;
        data[pIdx + 2] = fallbackB;
      }
    }
    return;
  }

  // Phase 1: Inward 8-neighbor wavefront propagation from known clean background pixels
  const dirs = [
    [-1, 0, 1.0],
    [1, 0, 1.0],
    [0, -1, 1.0],
    [0, 1, 1.0],
    [-1, -1, 0.7],
    [1, -1, 0.7],
    [-1, 1, 0.7],
    [1, 1, 0.7],
  ] as const;

  const newlyKnown: number[] = [];
  let maxPasses = Math.max(rw, rh) + 4;

  while (knownCount < total && maxPasses-- > 0) {
    newlyKnown.length = 0;
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const idx = ly * rw + lx;
        if (known[idx] === 1) continue;

        let wSum = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;

        for (const [dx, dy, w] of dirs) {
          const nx = lx + dx;
          const ny = ly + dy;
          if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
          const nIdx = ny * rw + nx;
          if (known[nIdx] === 1) {
            wSum += w;
            rSum += bufR[nIdx] * w;
            gSum += bufG[nIdx] * w;
            bSum += bufB[nIdx] * w;
          }
        }

        if (wSum > 0) {
          bufR[idx] = rSum / wSum;
          bufG[idx] = gSum / wSum;
          bufB[idx] = bSum / wSum;
          newlyKnown.push(idx);
        }
      }
    }

    if (newlyKnown.length === 0) break;
    for (const idx of newlyKnown) {
      known[idx] = 1;
      knownCount++;
    }
  }

  // Phase 2: 8 iterations of Gauss-Seidel harmonic smoothing on masked pixels
  for (let iter = 0; iter < 8; iter++) {
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const idx = ly * rw + lx;
        if (mask[idx] === 0) continue;

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        if (lx > 0) {
          const ni = idx - 1;
          rSum += bufR[ni];
          gSum += bufG[ni];
          bSum += bufB[ni];
          count++;
        }
        if (lx < rw - 1) {
          const ni = idx + 1;
          rSum += bufR[ni];
          gSum += bufG[ni];
          bSum += bufB[ni];
          count++;
        }
        if (ly > 0) {
          const ni = idx - rw;
          rSum += bufR[ni];
          gSum += bufG[ni];
          bSum += bufB[ni];
          count++;
        }
        if (ly < rh - 1) {
          const ni = idx + rw;
          rSum += bufR[ni];
          gSum += bufG[ni];
          bSum += bufB[ni];
          count++;
        }

        if (count > 0) {
          bufR[idx] = rSum / count;
          bufG[idx] = gSum / count;
          bufB[idx] = bSum / count;
        }
      }
    }
  }

  // Write smoothly reconstructed background pixels back to ImageData
  for (let ly = 0; ly < rh; ly++) {
    const py = ry0 + ly;
    for (let lx = 0; lx < rw; lx++) {
      const idx = ly * rw + lx;
      if (mask[idx] === 0) continue;
      const px = rx0 + lx;
      const pIdx = (py * width + px) * 4;
      data[pIdx] = Math.round(bufR[idx]);
      data[pIdx + 1] = Math.round(bufG[idx]);
      data[pIdx + 2] = Math.round(bufB[idx]);
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
    // Use tight erase bounds if stored, else compute from region box
    const eX = reg.eraseXPct ?? reg.xPct;
    const eY = reg.eraseYPct ?? reg.yPct;
    const eW = reg.eraseWPct ?? reg.wPct;
    const eH = reg.eraseHPct ?? reg.hPct;
    const x0 = (eX / 100) * width;
    const y0 = (eY / 100) * height;
    const x1 = ((eX + eW) / 100) * width;
    const y1 = ((eY + eH) / 100) * height;
    inpaintRectHarmonic(data, width, height, x0, y0, x1, y1, true);
  }

  for (const patch of manualPatches) {
    const x0 = (patch.xPct / 100) * width;
    const y0 = (patch.yPct / 100) * height;
    const x1 = ((patch.xPct + patch.wPct) / 100) * width;
    const y1 = ((patch.yPct + patch.hPct) / 100) * height;
    inpaintRectHarmonic(data, width, height, x0, y0, x1, y1, false);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.94);
}

/**
 * Fast O(W*H) seamless rectangular patch healer using smoothed perimeter boundary strips
 * weighted by true pixel distance. Used when peeling segmented cards, bars, icons, and manual slices.
 */
export function inpaintSolidPatchOnImageData(
  imageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  const { width, height, data } = imageData;
  const rx0 = Math.max(1, Math.floor(x0 - 2));
  const ry0 = Math.max(1, Math.floor(y0 - 2));
  const rx1 = Math.min(width - 2, Math.ceil(x1 + 2));
  const ry1 = Math.min(height - 2, Math.ceil(y1 + 2));

  const rw = rx1 - rx0 + 1;
  const rh = ry1 - ry0 + 1;
  if (rw < 2 || rh < 2) return;

  // Build smoothed 1D RGB boundary arrays along top, bottom, left, and right outer 1px borders
  const sampleSmoothedH = (py: number): Float32Array => {
    const arr = new Float32Array(rw * 3);
    const cy = Math.max(0, Math.min(height - 1, py));
    for (let lx = 0; lx < rw; lx++) {
      let rS = 0,
        gS = 0,
        bS = 0,
        cnt = 0;
      for (let d = -4; d <= 4; d += 2) {
        const cx = Math.max(0, Math.min(width - 1, rx0 + lx + d));
        const idx = (cy * width + cx) * 4;
        rS += data[idx];
        gS += data[idx + 1];
        bS += data[idx + 2];
        cnt++;
      }
      arr[lx * 3] = rS / cnt;
      arr[lx * 3 + 1] = gS / cnt;
      arr[lx * 3 + 2] = bS / cnt;
    }
    return arr;
  };

  const sampleSmoothedV = (px: number): Float32Array => {
    const arr = new Float32Array(rh * 3);
    const cx = Math.max(0, Math.min(width - 1, px));
    for (let ly = 0; ly < rh; ly++) {
      let rS = 0,
        gS = 0,
        bS = 0,
        cnt = 0;
      for (let d = -4; d <= 4; d += 2) {
        const cy = Math.max(0, Math.min(height - 1, ry0 + ly + d));
        const idx = (cy * width + cx) * 4;
        rS += data[idx];
        gS += data[idx + 1];
        bS += data[idx + 2];
        cnt++;
      }
      arr[ly * 3] = rS / cnt;
      arr[ly * 3 + 1] = gS / cnt;
      arr[ly * 3 + 2] = bS / cnt;
    }
    return arr;
  };

  const topStrip = sampleSmoothedH(ry0 - 1);
  const botStrip = sampleSmoothedH(ry1 + 1);
  const leftStrip = sampleSmoothedV(rx0 - 1);
  const rightStrip = sampleSmoothedV(rx1 + 1);

  for (let ly = 0; ly < rh; ly++) {
    const py = ry0 + ly;
    const dTop = ly + 1;
    const dBot = rh - ly;
    const wTop = 1 / (dTop * dTop);
    const wBot = 1 / (dBot * dBot);

    const lR = leftStrip[ly * 3];
    const lG = leftStrip[ly * 3 + 1];
    const lB = leftStrip[ly * 3 + 2];
    const rR = rightStrip[ly * 3];
    const rG = rightStrip[ly * 3 + 1];
    const rB = rightStrip[ly * 3 + 2];

    for (let lx = 0; lx < rw; lx++) {
      const px = rx0 + lx;
      const dLeft = lx + 1;
      const dRight = rw - lx;
      const wLeft = 1 / (dLeft * dLeft);
      const wRight = 1 / (dRight * dRight);
      const wSum = wTop + wBot + wLeft + wRight;

      const tIdx = lx * 3;
      const outR =
        (topStrip[tIdx] * wTop + botStrip[tIdx] * wBot + lR * wLeft + rR * wRight) / wSum;
      const outG =
        (topStrip[tIdx + 1] * wTop +
          botStrip[tIdx + 1] * wBot +
          lG * wLeft +
          rG * wRight) /
        wSum;
      const outB =
        (topStrip[tIdx + 2] * wTop +
          botStrip[tIdx + 2] * wBot +
          lB * wLeft +
          rB * wRight) /
        wSum;

      const pIdx = (py * width + px) * 4;
      data[pIdx] = Math.round(outR);
      data[pIdx + 1] = Math.round(outG);
      data[pIdx + 2] = Math.round(outB);
    }
  }
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
