import type { GraphicElement, SplitGranularity } from '../types/slide';
import { inpaintSolidPatchOnImageData, loadImageElement } from './inpaintEngine';

interface SegBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
  parentBg: [number, number, number];
}

function findPerimeterBg(
  data: Uint8ClampedArray,
  width: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  inset = 3
): [number, number, number] {
  const xA = Math.min(rx1 - 1, rx0 + inset);
  const yA = Math.min(ry1 - 1, ry0 + inset);
  const xB = Math.max(xA + 1, rx1 - 1 - inset);
  const yB = Math.max(yA + 1, ry1 - 1 - inset);

  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const addSample = (px: number, py: number) => {
    const idx = (py * width + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = bins.get(k);
    if (cur) {
      cur.count++;
      cur.r += r;
      cur.g += g;
      cur.b += b;
    } else {
      bins.set(k, { count: 1, r, g, b });
    }
  };

  // Weight top header area higher because container header bars sit above inner sub-cards
  const yHeader = Math.min(ry1 - 1, yA + Math.max(2, Math.floor((ry1 - ry0) * 0.08)));
  for (let x = xA; x < xB; x += 2) {
    addSample(x, yA);
    addSample(x, yHeader);
    addSample(x, yB);
  }
  for (let y = yA; y < yB; y += 2) {
    addSample(xA, y);
    addSample(xB, y);
  }

  let bestKey = -1;
  let bestCount = -1;
  for (const [k, v] of bins.entries()) {
    if (v.count > bestCount) {
      bestCount = v.count;
      bestKey = k;
    }
  }
  const win = bins.get(bestKey);
  if (!win || win.count === 0) return [15, 35, 75];
  return [
    Math.round(win.r / win.count),
    Math.round(win.g / win.count),
    Math.round(win.b / win.count),
  ];
}

function splitByValleys(
  data: Uint8ClampedArray,
  width: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  bg: [number, number, number],
  depth: number
): [number, number, number, number][] {
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const [bgR, bgG, bgB] = bg;
  const minGap = depth > 0 ? 1 : 3;
  const vTol = depth > 0 ? 0.12 : 0.14;
  const hTol = 0.09;

  const colFg = new Float32Array(rw);
  for (let lx = 0; lx < rw; lx++) {
    let fg = 0;
    for (let ly = 2; ly < rh - 2; ly++) {
      const idx = ((ry0 + ly) * width + (rx0 + lx)) * 4;
      if (Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB) > 35) {
        fg++;
      }
    }
    colFg[lx] = fg / Math.max(1, rh - 4);
  }

  const vCuts: [number, number][] = [];
  let inGap = false;
  let gStart = 0;
  const xStart = Math.floor(rw * 0.05);
  const xEnd = Math.floor(rw * 0.95);
  for (let lx = xStart; lx < xEnd; lx++) {
    if (colFg[lx] < vTol) {
      if (!inGap) {
        inGap = true;
        gStart = lx;
      }
    } else {
      if (inGap && lx - gStart >= minGap) {
        vCuts.push([gStart, lx]);
      }
      inGap = false;
    }
  }
  if (inGap && xEnd - gStart >= minGap) {
    vCuts.push([gStart, xEnd]);
  }

  if (vCuts.length > 0) {
    const parts: [number, number, number, number][] = [];
    let prevX = 0;
    for (const [gs, ge] of vCuts) {
      if (gs - prevX >= 22) {
        parts.push([rx0 + prevX, ry0, rx0 + gs, ry1]);
      }
      prevX = ge;
    }
    if (rw - prevX >= 22) {
      parts.push([rx0 + prevX, ry0, rx1, ry1]);
    }
    if (parts.length > 1) return parts;
  }

  const rowFg = new Float32Array(rh);
  for (let ly = 0; ly < rh; ly++) {
    let fg = 0;
    for (let lx = 2; lx < rw - 2; lx++) {
      const idx = ((ry0 + ly) * width + (rx0 + lx)) * 4;
      if (Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB) > 35) {
        fg++;
      }
    }
    rowFg[ly] = fg / Math.max(1, rw - 4);
  }

  const hCuts: [number, number][] = [];
  inGap = false;
  gStart = 0;
  const yStart = Math.floor(rh * 0.08);
  const yEnd = Math.floor(rh * 0.92);
  for (let ly = yStart; ly < yEnd; ly++) {
    if (rowFg[ly] < hTol) {
      if (!inGap) {
        inGap = true;
        gStart = ly;
      }
    } else {
      if (inGap && ly - gStart >= minGap) {
        hCuts.push([gStart, ly]);
      }
      inGap = false;
    }
  }
  if (inGap && yEnd - gStart >= minGap) {
    hCuts.push([gStart, yEnd]);
  }

  if (hCuts.length > 0) {
    const parts: [number, number, number, number][] = [];
    let prevY = 0;
    for (const [gs, ge] of hCuts) {
      if (gs - prevY >= 18) {
        parts.push([rx0, ry0 + prevY, rx1, ry0 + gs]);
      }
      prevY = ge;
    }
    if (rh - prevY >= 18) {
      parts.push([rx0, ry0 + prevY, rx1, ry1]);
    }
    if (parts.length > 1) return parts;
  }

  return [[rx0, ry0, rx1, ry1]];
}

function segmentRectRecursive(
  data: Uint8ClampedArray,
  sw: number,
  sh: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  depth: number,
  maxDepth: number
): SegBox[] {
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (rw < 18 || rh < 16) return [];

  const parentBg = findPerimeterBg(data, sw, rx0, ry0, rx1, ry1, depth === 0 ? 2 : 4);
  const [bgR, bgG, bgB] = parentBg;
  const gradThresh = depth === 0 ? 28 : 42;
  const cDistThresh = depth === 0 ? 36 : 38;

  const barrier = new Uint8Array(rw * rh);
  for (let ly = 1; ly < rh - 1; ly++) {
    const y = ry0 + ly;
    for (let lx = 1; lx < rw - 1; lx++) {
      const x = rx0 + lx;
      const idx = (y * sw + x) * 4;
      const cDist = Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB);
      if (depth === 0) {
        const iL = (y * sw + (x - 1)) * 4;
        const iR = (y * sw + (x + 1)) * 4;
        const iU = ((y - 1) * sw + x) * 4;
        const iD = ((y + 1) * sw + x) * 4;
        const gx = Math.max(
          Math.abs(data[iR] - data[iL]),
          Math.abs(data[iR + 1] - data[iL + 1]),
          Math.abs(data[iR + 2] - data[iL + 2])
        );
        const gy = Math.max(
          Math.abs(data[iD] - data[iU]),
          Math.abs(data[iD + 1] - data[iU + 1]),
          Math.abs(data[iD + 2] - data[iU + 2])
        );
        if (gx + gy > gradThresh || cDist > cDistThresh) {
          barrier[ly * rw + lx] = 1;
        }
      } else if (cDist > cDistThresh) {
        barrier[ly * rw + lx] = 1;
      }
    }
  }

  let dil = barrier;
  if (depth === 0) {
    dil = new Uint8Array(rw * rh);
    for (let ly = 1; ly < rh - 1; ly++) {
      for (let lx = 1; lx < rw - 1; lx++) {
        const i = ly * rw + lx;
        if (
          barrier[i] ||
          barrier[i - 1] ||
          barrier[i + 1] ||
          barrier[i - rw] ||
          barrier[i + rw]
        ) {
          dil[i] = 1;
        }
      }
    }
  }

  const ext = new Uint8Array(rw * rh);
  const qX = new Int32Array(rw * rh);
  const qY = new Int32Array(rw * rh);
  let qHead = 0;
  let qTail = 0;

  const pushSeed = (lx: number, ly: number) => {
    const i = ly * rw + lx;
    if (!dil[i] && !ext[i]) {
      ext[i] = 1;
      qX[qTail] = lx;
      qY[qTail] = ly;
      qTail++;
    }
  };

  for (let lx = 0; lx < rw; lx++) {
    pushSeed(lx, 0);
    pushSeed(lx, 1);
    pushSeed(lx, rh - 2);
    pushSeed(lx, rh - 1);
  }
  for (let ly = 0; ly < rh; ly++) {
    pushSeed(0, ly);
    pushSeed(1, ly);
    pushSeed(rw - 2, ly);
    pushSeed(rw - 1, ly);
  }

  for (let ly = 3; ly < rh - 3; ly += 4) {
    for (let lx = 3; lx < rw - 3; lx += 4) {
      const i = ly * rw + lx;
      if (!dil[i] && !ext[i]) {
        const pIdx = ((ry0 + ly) * sw + (rx0 + lx)) * 4;
        if (Math.hypot(data[pIdx] - bgR, data[pIdx + 1] - bgG, data[pIdx + 2] - bgB) < 20) {
          if (
            !dil[(ly - 1) * rw + lx] &&
            !dil[(ly + 1) * rw + lx] &&
            !dil[ly * rw + (lx - 1)] &&
            !dil[ly * rw + (lx + 1)]
          ) {
            pushSeed(lx, ly);
          }
        }
      }
    }
  }

  while (qHead < qTail) {
    const cx = qX[qHead];
    const cy = qY[qHead];
    qHead++;
    if (cx > 0) pushSeed(cx - 1, cy);
    if (cx < rw - 1) pushSeed(cx + 1, cy);
    if (cy > 0) pushSeed(cx, cy - 1);
    if (cy < rh - 1) pushSeed(cx, cy + 1);
  }

  const vis = new Uint8Array(rw * rh);
  const cX = new Int32Array(rw * rh);
  const cY = new Int32Array(rw * rh);
  const results: SegBox[] = [];

  for (let ly = 0; ly < rh; ly++) {
    for (let lx = 0; lx < rw; lx++) {
      const startIdx = ly * rw + lx;
      if (ext[startIdx] || vis[startIdx]) continue;

      vis[startIdx] = 1;
      let cHead = 0;
      let cTail = 0;
      cX[cTail] = lx;
      cY[cTail] = ly;
      cTail++;

      let x0 = lx;
      let x1 = lx;
      let y0 = ly;
      let y1 = ly;
      let area = 0;

      while (cHead < cTail) {
        const px = cX[cHead];
        const py = cY[cHead];
        cHead++;
        area++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;

        const tryNeighbor = (nx: number, ny: number) => {
          if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) return;
          const ni = ny * rw + nx;
          if (!ext[ni] && !vis[ni]) {
            vis[ni] = 1;
            cX[cTail] = nx;
            cY[cTail] = ny;
            cTail++;
          }
        };
        tryNeighbor(px - 1, py);
        tryNeighbor(px + 1, py);
        tryNeighbor(px, py - 1);
        tryNeighbor(px, py + 1);
      }

      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      const fillRatio = area / Math.max(1, bw * bh);
      if (bw < 13 || bh < 13 || area < 90 || fillRatio < 0.22) continue;

      const gx0 = rx0 + x0;
      const gy0 = ry0 + y0;
      const gx1 = rx0 + x1 + 1;
      const gy1 = ry0 + y1 + 1;

      const isWholeContainer = bw > rw * 0.94 && bh > rh * 0.94;
      const subParts =
        isWholeContainer || bw > sw * 0.2 || bh > sh * 0.28
          ? splitByValleys(data, sw, gx0, gy0, gx1, gy1, parentBg, depth)
          : [[gx0, gy0, gx1, gy1] as [number, number, number, number]];

      for (const [rawPx0, rawPy0, rawPx1, rawPy1] of subParts) {
        // Undo the 1px dilation at depth 0 so bounding boxes hug the real object edges tightly
        const shrink = depth === 0 ? 1 : 0;
        const px0 = rawPx0 + shrink;
        const py0 = rawPy0 + shrink;
        const px1 = rawPx1 - shrink;
        const py1 = rawPy1 - shrink;
        const pw = px1 - px0;
        const ph = py1 - py0;
        if (pw < 13 || ph < 13) continue;

        const stillWhole = pw > rw * 0.94 && ph > rh * 0.94;
        const isHollowOuterPanel = depth === 0 && pw > sw * 0.6 && ph > sh * 0.5;
        const isSkinnySliver =
          Math.min(pw, ph) < 26 && Math.max(pw / Math.max(1, ph), ph / Math.max(1, pw)) > 8;

        // Verify the region has genuine visual contrast against its parent background (not a faint gradient smudge)
        if (!stillWhole && !isHollowOuterPanel && !isSkinnySliver) {
          let contrastHits = 0;
          let sampleTotal = 0;
          const stepX = Math.max(1, Math.floor(pw / 16));
          const stepY = Math.max(1, Math.floor(ph / 12));
          for (let sy = py0; sy < py1; sy += stepY) {
            for (let sx = px0; sx < px1; sx += stepX) {
              const si = (sy * sw + sx) * 4;
              const d = Math.hypot(data[si] - bgR, data[si + 1] - bgG, data[si + 2] - bgB);
              if (d > 26) contrastHits++;
              sampleTotal++;
            }
          }
          if (sampleTotal > 0 && contrastHits / sampleTotal < 0.14) continue;

          results.push({ x0: px0, y0: py0, x1: px1, y1: py1, depth, parentBg });
        }

        if (
          depth < maxDepth &&
          !isSkinnySliver &&
          pw * ph > sw * sh * 0.012 &&
          pw > 52 &&
          ph > 30
        ) {
          const pad = stillWhole || isHollowOuterPanel ? 6 : 3;
          const children = segmentRectRecursive(
            data,
            sw,
            sh,
            px0 + pad,
            py0 + pad,
            px1 - pad,
            py1 - pad,
            depth + 1,
            maxDepth
          );
          results.push(...children);
        }
      }
    }
  }

  return results;
}

/**
 * Extracts a rectangular patch from `sourceImageData` into a crisp PNG data URL,
 * flood-filling exterior corner/perimeter background pixels matching `parentBg` with alpha = 0
 * so icons, rounded cards, chevron banners, and server illustrations have clean transparent exteriors!
 */
export function extractAlphaCutoutPng(
  sourceImageData: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  makeExteriorTransparent = true
): string {
  const { width, height, data } = sourceImageData;
  const cx0 = Math.max(0, Math.floor(x0));
  const cy0 = Math.max(0, Math.floor(y0));
  const cx1 = Math.min(width, Math.ceil(x1));
  const cy1 = Math.min(height, Math.ceil(y1));
  const cw = Math.max(1, cx1 - cx0);
  const ch = Math.max(1, cy1 - cy0);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = cw;
  outCanvas.height = ch;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(cw, ch);
  const outData = outImg.data;

  for (let ly = 0; ly < ch; ly++) {
    for (let lx = 0; lx < cw; lx++) {
      const sIdx = ((cy0 + ly) * width + (cx0 + lx)) * 4;
      const dIdx = (ly * cw + lx) * 4;
      outData[dIdx] = data[sIdx];
      outData[dIdx + 1] = data[sIdx + 1];
      outData[dIdx + 2] = data[sIdx + 2];
      outData[dIdx + 3] = 255;
    }
  }

  if (makeExteriorTransparent && cw >= 8 && ch >= 8) {
    // Sample outer 1px border ring just outside [cx0..cx1, cy0..cy1] to get exact local backdrop color
    const [bgR, bgG, bgB] = findPerimeterBg(
      data,
      width,
      Math.max(0, cx0 - 2),
      Math.max(0, cy0 - 2),
      Math.min(width, cx1 + 2),
      Math.min(height, cy1 + 2),
      0
    );

    const visited = new Uint8Array(cw * ch);
    const qX = new Int32Array(cw * ch);
    const qY = new Int32Array(cw * ch);
    let head = 0;
    let tail = 0;

    const trySeed = (lx: number, ly: number) => {
      const i = ly * cw + lx;
      if (visited[i]) return;
      const dIdx = i * 4;
      const dist = Math.hypot(
        outData[dIdx] - bgR,
        outData[dIdx + 1] - bgG,
        outData[dIdx + 2] - bgB
      );
      if (dist < 28) {
        visited[i] = 1;
        outData[dIdx + 3] = 0;
        qX[tail] = lx;
        qY[tail] = ly;
        tail++;
      }
    };

    for (let lx = 0; lx < cw; lx++) {
      trySeed(lx, 0);
      trySeed(lx, ch - 1);
    }
    for (let ly = 0; ly < ch; ly++) {
      trySeed(0, ly);
      trySeed(cw - 1, ly);
    }

    while (head < tail) {
      const lx = qX[head];
      const ly = qY[head];
      head++;

      const neighbors = [
        [lx - 1, ly],
        [lx + 1, ly],
        [lx, ly - 1],
        [lx, ly + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
        const ni = ny * cw + nx;
        if (visited[ni]) continue;
        const dIdx = ni * 4;
        const dist = Math.hypot(
          outData[dIdx] - bgR,
          outData[dIdx + 1] - bgG,
          outData[dIdx + 2] - bgB
        );
        if (dist < 25) {
          visited[ni] = 1;
          outData[dIdx + 3] = 0;
          qX[tail] = nx;
          qY[tail] = ny;
          tail++;
        } else if (dist < 42) {
          // Soft anti-aliased edge feathering on the object boundary
          outData[dIdx + 3] = Math.min(outData[dIdx + 3], Math.round(((dist - 25) / 17) * 255));
        }
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas.toDataURL('image/png');
}

/**
 * Automatically decomposes a text-cleaned slide background into:
 * 1) Independent movable GraphicElements (peeled innermost-first so parent bars/cards underneath have NO holes!),
 * 2) A clean inpainted baseBackdropDataUrl with all extracted GraphicElements seamlessly removed!
 */
export async function autoSegmentSlideElements(
  cleanedDataUrl: string,
  granularity: SplitGranularity = 'detailed'
): Promise<{ baseBackdropDataUrl: string; elements: GraphicElement[] }> {
  const img = await loadImageElement(cleanedDataUrl);
  const fullW = img.naturalWidth || img.width;
  const fullH = img.naturalHeight || img.height;

  // Run segmentation grid at ~900px max side for instant (<120ms) multi-level analysis
  const segScale = Math.min(1, 900 / Math.max(fullW, fullH));
  const sw = Math.max(32, Math.round(fullW * segScale));
  const sh = Math.max(32, Math.round(fullH * segScale));

  const segCanvas = document.createElement('canvas');
  segCanvas.width = sw;
  segCanvas.height = sh;
  const segCtx = segCanvas.getContext('2d')!;
  segCtx.drawImage(img, 0, 0, sw, sh);
  const segData = segCtx.getImageData(0, 0, sw, sh).data;

  const maxDepth = granularity === 'detailed' ? 2 : 1;
  const rawBoxes = segmentRectRecursive(segData, sw, sh, 0, 0, sw, sh, 0, maxDepth);

  // Deduplicate nearly identical nested boxes (IoU > 0.86 -> keep the tighter inner box)
  const deduped: SegBox[] = [];
  for (const b of rawBoxes) {
    let duplicateIdx = -1;
    for (let i = 0; i < deduped.length; i++) {
      const ex = deduped[i];
      const ix0 = Math.max(b.x0, ex.x0);
      const iy0 = Math.max(b.y0, ex.y0);
      const ix1 = Math.min(b.x1, ex.x1);
      const iy1 = Math.min(b.y1, ex.y1);
      if (ix1 > ix0 && iy1 > iy0) {
        const inter = (ix1 - ix0) * (iy1 - iy0);
        const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
        const areaEx = (ex.x1 - ex.x0) * (ex.y1 - ex.y0);
        const iou = inter / Math.max(1, areaB + areaEx - inter);
        if (iou > 0.84) {
          duplicateIdx = i;
          break;
        }
      }
    }
    if (duplicateIdx >= 0) {
      // Prefer tighter child box
      if (b.depth > deduped[duplicateIdx].depth) {
        deduped[duplicateIdx] = b;
      }
    } else {
      deduped.push(b);
    }
  }

  // Sort innermost-first (highest depth / smallest area peeled first!)
  // That way child sub-cards & icons are extracted first and healed into their parent colored bar,
  // BEFORE the parent colored bar is extracted as a clean, hole-free container layer!
  deduped.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
    const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
    return areaA - areaB;
  });

  const workCanvas = document.createElement('canvas');
  workCanvas.width = fullW;
  workCanvas.height = fullH;
  const workCtx = workCanvas.getContext('2d')!;
  workCtx.drawImage(img, 0, 0);
  const workImageData = workCtx.getImageData(0, 0, fullW, fullH);

  const elements: GraphicElement[] = [];

  for (let i = 0; i < deduped.length; i++) {
    const b = deduped[i];
    const fx0 = Math.max(0, Math.round(b.x0 / segScale) - 1);
    const fy0 = Math.max(0, Math.round(b.y0 / segScale) - 1);
    const fx1 = Math.min(fullW, Math.round(b.x1 / segScale) + 1);
    const fy1 = Math.min(fullH, Math.round(b.y1 / segScale) + 1);

    // 1. Cut out PNG from current working canvas (children already cleanly healed out of parent!)
    const pngUrl = extractAlphaCutoutPng(workImageData, fx0, fy0, fx1, fy1, true);

    // 2. Smoothly heal/inpaint this object out of the working canvas so its parent / backdrop has zero ghost!
    inpaintSolidPatchOnImageData(workImageData, fx0, fy0, fx1, fy1);

    const xPct = (fx0 / fullW) * 100;
    const yPct = (fy0 / fullH) * 100;
    const wPct = ((fx1 - fx0) / fullW) * 100;
    const hPct = ((fy1 - fy0) / fullH) * 100;

    // Deeper / smaller items sit at higher zIndex so sub-cards & icons always stay visible above parent bars
    const zIndex = b.depth >= 2 ? 3 : b.depth === 1 ? 2 : 1;

    elements.push({
      id: `el-${Date.now()}-${i}`,
      dataUrl: pngUrl,
      xPct,
      yPct,
      wPct,
      hPct,
      origXPct: xPct,
      origYPct: yPct,
      origWPct: wPct,
      origHPct: hPct,
      zIndex,
    });
  }

  // Sort back-to-front (lowest zIndex / largest area first) for natural DOM & PowerPoint rendering order
  elements.sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return b.wPct * b.hPct - a.wPct * a.hPct;
  });

  workCtx.putImageData(workImageData, 0, 0);
  const baseBackdropDataUrl = workCanvas.toDataURL('image/jpeg', 0.93);

  return { baseBackdropDataUrl, elements };
}

/**
 * Slices a user-drawn rectangle out of the current slide backdrop into a new movable GraphicElement
 * and heals the underlying backdrop so moving it leaves no duplicate ghost behind.
 */
export async function sliceManualElementFromBackdrop(
  currentBackdropUrl: string,
  xPct: number,
  yPct: number,
  wPct: number,
  hPct: number,
  transparentBg = true
): Promise<{ nextBackdropDataUrl: string; element: GraphicElement }> {
  const img = await loadImageElement(currentBackdropUrl);
  const fullW = img.naturalWidth || img.width;
  const fullH = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = fullW;
  canvas.height = fullH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, fullW, fullH);

  const fx0 = Math.max(0, Math.round((xPct / 100) * fullW));
  const fy0 = Math.max(0, Math.round((yPct / 100) * fullH));
  const fx1 = Math.min(fullW, Math.round(((xPct + wPct) / 100) * fullW));
  const fy1 = Math.min(fullH, Math.round(((yPct + hPct) / 100) * fullH));

  const dataUrl = extractAlphaCutoutPng(imageData, fx0, fy0, fx1, fy1, transparentBg);
  inpaintSolidPatchOnImageData(imageData, fx0, fy0, fx1, fy1);

  ctx.putImageData(imageData, 0, 0);
  const nextBackdropDataUrl = canvas.toDataURL('image/jpeg', 0.93);

  return {
    nextBackdropDataUrl,
    element: {
      id: `slice-${Date.now()}`,
      dataUrl,
      xPct,
      yPct,
      wPct,
      hPct,
      origXPct: xPct,
      origYPct: yPct,
      origWPct: wPct,
      origHPct: hPct,
      zIndex: 4,
    },
  };
}
