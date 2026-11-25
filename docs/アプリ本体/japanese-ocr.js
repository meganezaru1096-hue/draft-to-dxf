// Offline CAD Japanese OCR powered by ONNX Runtime Web (WASM) + PP-OCRv6 small (Apache-2.0).
// Runs entirely in a self-contained Blob Web Worker with zero external/network requests.
window.DraftJapaneseOcr = {
  promise: null,
  worker: null,
  urls: [],
  generation: 0,
  _reqId: 0,
  _pending: new Map(),

  cancel() {
    this.generation++;
  },

  _workerSource() {
    return `'use strict';
let detSession = null, recSession = null, detInName = '', recInName = '', vocab = [];
let wasmBytesLocal = null;

// Strictly block any external HTTP(S) network access inside the OCR worker.
const _nativeFetch = self.fetch ? self.fetch.bind(self) : null;
self.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : (input && input.url) || '');
  if (url.endsWith('ort-wasm-simd-threaded.wasm') && wasmBytesLocal) {
    return new Response(wasmBytesLocal, { status: 200, headers: { 'content-type': 'application/wasm' } });
  }
  if (/^(blob:|data:)/.test(url) && _nativeFetch) return _nativeFetch(input, init);
  throw new Error('OCR external request blocked: ' + url);
};

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Strictly safe 1-to-1 Simplified Chinese -> Japanese JIS Kanji normalization.
const SIMP_TO_JIS = {
  '压':'圧','侧':'側','黑':'黒','负':'負','载':'載','图':'図',
  '检':'検','备':'備','确':'確','认':'認','机':'機','调':'調',
  '节':'節','规':'規','钢':'鋼','铁':'鉄','铝':'鋁','铜':'銅',
  '动':'動','轮':'輪','轴':'軸','壳':'殻','盖':'蓋','阀':'閥',
  '关':'関','开':'開','门':'門','间':'間','电':'電','气':'気',
  '线':'線','组':'組','设':'設','计':'計','标':'標','准':'準',
  '质':'質','长':'長','圆':'円','单':'単','两':'両','无':'無',
  '时':'時','应':'応','总':'総','结':'結','构':'構','报':'報',
  '见':'見','视':'視','觉':'覚','热':'熱','处':'処','镀':'鍍',
  '涂':'塗','层':'層','离':'離','许':'許','级':'級','风':'風',
  '块':'塊','头':'頭','盘':'盤','柜':'櫃','车':'車','转':'転',
  '进':'進','紧':'緊','锁':'鎖','带':'帯','齿':'歯','弹':'弾',
  '钉':'釘','键':'鍵','环':'環','绿':'緑','页':'頁','张':'張',
  '项':'項','专':'専','业':'業','产':'産','达':'達','运':'運',
  '输':'輸','过':'過','连':'連','选':'選','择':'択','变':'変',
  '换':'換','补':'補','减':'減','增':'増','损':'損','坏':'壊',
  '险':'険','护':'護','卫':'衛','噪':'騒','冲':'衝','击':'撃',
  '铸':'鋳','锻':'鍛','焊':'溶','滤':'濾','净':'浄','干':'乾',
  '传':'伝','仪':'儀','显':'顕','丝':'糸','网':'網','绳':'縄',
  '软':'軟','银':'銀'
};

function normalizeCadText(text) {
  // Preserve OCR output literally. Leading zeroes, ON/OFF and Japanese kanji
  // must not be semantically rewritten without explicit user confirmation.
  return String(text || '').trim();
}

function legacyNormalizeCadTextUnused(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(/^\\|+|\\|+$/g, '').trim();
  let mapped = '';
  for (const ch of t) mapped += SIMP_TO_JIS[ch] || ch;
  t = mapped.replace(/[øØ∅]/g, 'φ');
  t = t.replace(/([\\u3040-\\u30ff\\u4e00-\\u9fffー])\\s+(?=[\\u3040-\\u30ff\\u4e00-\\u9fffー])/g, '$1');
  t = t.replace(/(?<![0-9A-Za-z])0FF(?![0-9A-Za-z])/g, 'OFF');
  t = t.replace(/(?<![0-9A-Za-z])0N(?![0-9A-Za-z])/g, 'ON');
  t = t.replace(/\\(0D\\)/g, '(OD)');
  t = t.replace(/(?<![0-9A-Za-z])E\\.0\\.NO(?![0-9A-Za-z])/g, 'E.O.NO');
  t = t.replace(/^\\$(\\d{2,4}(?:\\.\\d+)?(?:\\([A-Z]{2}\\))?)$/, 'φ$1');
  t = t.replace(/^#(\\d{3,4}(?:\\.\\d+)?(?:\\([A-Z]{2}\\))?)$/, 'φ$1');
  t = t.replace(/^0([1-9]\\d{2,3}(?:\\.\\d+)?(?:\\([A-Z]{2}\\))?)$/, 'φ$1');
  t = t.replace(/([\\u30a1-\\u30f6])[-−一](?=[\\u30a1-\\u30f6\\u4e00-\\u9fff])/g, '$1ー');
  t = t.replace(/工(?=ア[ー\\-一])/g, 'エ');
  return t;
}

// --- 2D Geometry: Convex Hull & Minimum-Area Bounding Rectangle (exact cv2.minAreaRect equivalent) ---
function convexHull(pts) {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const s = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (let i = 0; i < n; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], s[i]) <= 0) lower.pop();
    lower.push(s[i]);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], s[i]) <= 0) upper.pop();
    upper.push(s[i]);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function minAreaRectFromHull(hull) {
  const m = hull.length;
  if (m === 0) return null;
  if (m === 1) return { cx: hull[0][0], cy: hull[0][1], ux: 1, uy: 0, vx: 0, vy: 1, w: 1, h: 1, pts: [hull[0], hull[0], hull[0], hull[0]] };
  let bestArea = Infinity, best = null;
  for (let i = 0; i < m; i++) {
    const a = hull[i], b = hull[(i + 1) % m];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const elen = Math.hypot(ex, ey);
    if (elen < 1e-6) continue;
    const ux = ex / elen, uy = ey / elen;
    const vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let j = 0; j < m; j++) {
      const px = hull[j][0], py = hull[j][1];
      const pu = px * ux + py * uy;
      const pv = px * vx + py * vy;
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
    }
    const w = maxU - minU, h = maxV - minV;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = { ux, uy, vx, vy, minU, maxU, minV, maxV, w, h };
    }
  }
  if (!best) return null;
  const { ux, uy, vx, vy, minU, maxU, minV, maxV, w, h } = best;
  const pt = (u, v) => [u * ux + v * vx, u * uy + v * vy];
  const pts = [pt(minU, minV), pt(maxU, minV), pt(maxU, maxV), pt(minU, maxV)];
  return { ux, uy, vx, vy, minU, maxU, minV, maxV, w, h, pts };
}

function pickOriented(pairs, isVertical) {
  for (const [q0, q1, q2, q3] of pairs) {
    let p0 = q0, p1 = q1, p2 = q2, p3 = q3;
    let ux = p1[0] - p0[0], uy = p1[1] - p0[1];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1];
    if (ux * vy - uy * vx < 0) {
      const t0 = p0, t1 = p1; p0 = p3; p1 = p2; p2 = t1; p3 = t0;
      ux = p1[0] - p0[0]; uy = p1[1] - p0[1];
    }
    const ok = isVertical ? (uy < 0) : (ux >= 0);
    if (ok) return [p0, p1, p2, p3];
  }
  return pairs[0];
}

function orderQuadWithAlt(pts) {
  const e01x = pts[1][0] - pts[0][0], e01y = pts[1][1] - pts[0][1];
  const e12x = pts[2][0] - pts[1][0], e12y = pts[2][1] - pts[1][1];
  const l01 = Math.hypot(e01x, e01y), l12 = Math.hypot(e12x, e12y);
  const hs01 = Math.abs(e01x) / Math.max(1e-6, l01);
  const hs12 = Math.abs(e12x) / Math.max(1e-6, l12);
  let hLen, vLen, hPairs, vPairs;
  if (hs01 >= hs12) {
    hLen = l01; vLen = l12;
    hPairs = [[pts[0], pts[1], pts[2], pts[3]], [pts[2], pts[3], pts[0], pts[1]]];
    vPairs = [[pts[1], pts[2], pts[3], pts[0]], [pts[3], pts[0], pts[1], pts[2]]];
  } else {
    hLen = l12; vLen = l01;
    hPairs = [[pts[1], pts[2], pts[3], pts[0]], [pts[3], pts[0], pts[1], pts[2]]];
    vPairs = [[pts[0], pts[1], pts[2], pts[3]], [pts[2], pts[3], pts[0], pts[1]]];
  }
  const ratio = vLen / Math.max(1, hLen);
  const hq = pickOriented(hPairs, false);
  const vq = pickOriented(vPairs, true);
  if (ratio > 1.55) return { primary: vq, alt: null };
  if (ratio >= 1.15) return { primary: hq, alt: vq };
  return { primary: hq, alt: null };
}

// --- Image sampling & CAD crop cleanup ---
function extractDetTensor(rgba, imgW, x0, y0, tw, th, rw, rh) {
  const plane = rw * rh;
  const data = new Float32Array(3 * plane);
  const scaleX = tw / rw, scaleY = th / rh;
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(th - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const iy0 = sy | 0, iy1 = Math.min(th - 1, iy0 + 1), fy = sy - iy0;
    const row0 = (y0 + iy0) * imgW, row1 = (y0 + iy1) * imgW;
    const outRow = y * rw;
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(tw - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const ix0 = sx | 0, ix1 = Math.min(tw - 1, ix0 + 1), fx = sx - ix0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (row0 + x0 + ix0) * 4, i10 = (row0 + x0 + ix1) * 4;
      const i01 = (row1 + x0 + ix0) * 4, i11 = (row1 + x0 + ix1) * 4;
      const r = rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11;
      const g = rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11;
      const b = rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11;
      const oi = outRow + x;
      // PP-OCRv6 expects BGR order normalized to [-1, 1]
      data[oi] = b * (2 / 255) - 1;
      data[plane + oi] = g * (2 / 255) - 1;
      data[2 * plane + oi] = r * (2 / 255) - 1;
    }
  }
  return data;
}

function warpCrop(rgba, imgW, imgH, quad, expandL, expandR, expandS) {
  let [p0, p1, p2, p3] = quad;
  const ux0 = p1[0] - p0[0], uy0 = p1[1] - p0[1];
  const vx0 = p3[0] - p0[0], vy0 = p3[1] - p0[1];
  const w0 = Math.max(4, Math.hypot(ux0, uy0));
  const h0 = Math.max(4, Math.hypot(vx0, vy0));
  const unx = ux0 / w0, uny = uy0 / w0, vnx = vx0 / h0, vny = vy0 / h0;
  const dl = expandL > 0 ? Math.min(22, h0 * expandL) : 0;
  const dr = expandR > 0 ? Math.min(14, h0 * expandR) : 0;
  const ds = expandS > 0 ? Math.min(5, h0 * expandS) : 0;
  const ax = p0[0] - unx * dl - vnx * ds, ay = p0[1] - uny * dl - vny * ds;
  const bx = p1[0] + unx * dr - vnx * ds, by = p1[1] + uny * dr - vny * ds;
  const dx = p3[0] - unx * dl + vnx * ds, dy = p3[1] - uny * dl + vny * ds;
  const nw = Math.max(4, Math.round(Math.hypot(bx - ax, by - ay)));
  const nh = Math.max(4, Math.round(Math.hypot(dx - ax, dy - ay)));
  const dux = (bx - ax) / nw, duy = (by - ay) / nw;
  const dvx = (dx - ax) / nh, dvy = (dy - ay) / nh;
  const rgb = new Uint8Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) {
    const ry = y + 0.5;
    for (let x = 0; x < nw; x++) {
      const rx = x + 0.5;
      const sx = ax + rx * dux + ry * dvx;
      const sy = ay + rx * duy + ry * dvy;
      const oi = (y * nw + x) * 3;
      if (sx < 0 || sy < 0 || sx >= imgW - 1 || sy >= imgH - 1) {
        if (sx >= -0.5 && sy >= -0.5 && sx < imgW && sy < imgH) {
          const ix = Math.max(0, Math.min(imgW - 1, Math.round(sx)));
          const iy = Math.max(0, Math.min(imgH - 1, Math.round(sy)));
          const si = (iy * imgW + ix) * 4;
          rgb[oi] = rgba[si]; rgb[oi + 1] = rgba[si + 1]; rgb[oi + 2] = rgba[si + 2];
        } else {
          rgb[oi] = 255; rgb[oi + 1] = 255; rgb[oi + 2] = 255;
        }
        continue;
      }
      const ix0 = sx | 0, iy0 = sy | 0, fx = sx - ix0, fy = sy - iy0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (iy0 * imgW + ix0) * 4, i10 = i00 + 4, i01 = i00 + imgW * 4, i11 = i01 + 4;
      rgb[oi] = Math.round(rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11);
      rgb[oi + 1] = Math.round(rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11);
      rgb[oi + 2] = Math.round(rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11);
    }
  }
  return { data: rgb, w: nw, h: nh };
}

function cubicWeight(x) {
  // OpenCV INTER_CUBIC (Catmull-Rom with A = -0.75) preserves crisp 1-2px CAD text strokes.
  const a = -0.75, ax = Math.abs(x);
  if (ax <= 1) return ((a + 2) * ax - (a + 3)) * ax * ax + 1;
  if (ax < 2) return (((a * ax - 5 * a) * ax) + 8 * a) * ax - 4 * a;
  return 0;
}

function resizeRgb(src, dstW, dstH) {
  const { data, w, h } = src;
  if (dstW === w && dstH === h) return { data: new Uint8Array(data), w, h };
  // Separable 2-pass Catmull-Rom bicubic (upscale / near-1x) or area-averaged downscale
  const tmp = new Float32Array(dstW * h * 3);
  const sxScale = w / dstW;
  for (let x = 0; x < dstW; x++) {
    const sx = (x + 0.5) * sxScale - 0.5;
    if (sxScale > 1.5) {
      const a = Math.max(0, Math.floor(x * sxScale));
      const b = Math.min(w - 1, Math.ceil((x + 1) * sxScale) - 1);
      const cnt = Math.max(1, b - a + 1);
      for (let y = 0; y < h; y++) {
        let r = 0, g = 0, bl = 0;
        const row = y * w;
        for (let k = a; k <= b; k++) { const i = (row + k) * 3; r += data[i]; g += data[i + 1]; bl += data[i + 2]; }
        const oi = (y * dstW + x) * 3;
        tmp[oi] = r / cnt; tmp[oi + 1] = g / cnt; tmp[oi + 2] = bl / cnt;
      }
    } else {
      const ix = Math.floor(sx), fx = sx - ix;
      const w0 = cubicWeight(fx + 1), w1 = cubicWeight(fx), w2 = cubicWeight(fx - 1), w3 = cubicWeight(fx - 2);
      const ws = w0 + w1 + w2 + w3 || 1;
      const k0 = Math.max(0, Math.min(w - 1, ix - 1)), k1 = Math.max(0, Math.min(w - 1, ix));
      const k2 = Math.max(0, Math.min(w - 1, ix + 1)), k3 = Math.max(0, Math.min(w - 1, ix + 2));
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const i0 = (row + k0) * 3, i1 = (row + k1) * 3, i2 = (row + k2) * 3, i3 = (row + k3) * 3;
        const oi = (y * dstW + x) * 3;
        tmp[oi]     = (data[i0] * w0 + data[i1] * w1 + data[i2] * w2 + data[i3] * w3) / ws;
        tmp[oi + 1] = (data[i0 + 1] * w0 + data[i1 + 1] * w1 + data[i2 + 1] * w2 + data[i3 + 1] * w3) / ws;
        tmp[oi + 2] = (data[i0 + 2] * w0 + data[i1 + 2] * w1 + data[i2 + 2] * w2 + data[i3 + 2] * w3) / ws;
      }
    }
  }
  const out = new Uint8Array(dstW * dstH * 3);
  const syScale = h / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = (y + 0.5) * syScale - 0.5;
    if (syScale > 1.5) {
      const a = Math.max(0, Math.floor(y * syScale));
      const b = Math.min(h - 1, Math.ceil((y + 1) * syScale) - 1);
      const cnt = Math.max(1, b - a + 1);
      for (let x = 0; x < dstW; x++) {
        let r = 0, g = 0, bl = 0;
        for (let k = a; k <= b; k++) { const i = (k * dstW + x) * 3; r += tmp[i]; g += tmp[i + 1]; bl += tmp[i + 2]; }
        const oi = (y * dstW + x) * 3;
        out[oi] = Math.max(0, Math.min(255, Math.round(r / cnt)));
        out[oi + 1] = Math.max(0, Math.min(255, Math.round(g / cnt)));
        out[oi + 2] = Math.max(0, Math.min(255, Math.round(bl / cnt)));
      }
    } else {
      const iy = Math.floor(sy), fy = sy - iy;
      const w0 = cubicWeight(fy + 1), w1 = cubicWeight(fy), w2 = cubicWeight(fy - 1), w3 = cubicWeight(fy - 2);
      const ws = w0 + w1 + w2 + w3 || 1;
      const k0 = Math.max(0, Math.min(h - 1, iy - 1)), k1 = Math.max(0, Math.min(h - 1, iy));
      const k2 = Math.max(0, Math.min(h - 1, iy + 1)), k3 = Math.max(0, Math.min(h - 1, iy + 2));
      for (let x = 0; x < dstW; x++) {
        const i0 = (k0 * dstW + x) * 3, i1 = (k1 * dstW + x) * 3, i2 = (k2 * dstW + x) * 3, i3 = (k3 * dstW + x) * 3;
        const oi = (y * dstW + x) * 3;
        const r = (tmp[i0] * w0 + tmp[i1] * w1 + tmp[i2] * w2 + tmp[i3] * w3) / ws;
        const g = (tmp[i0 + 1] * w0 + tmp[i1 + 1] * w1 + tmp[i2 + 1] * w2 + tmp[i3 + 1] * w3) / ws;
        const bl = (tmp[i0 + 2] * w0 + tmp[i1 + 2] * w1 + tmp[i2 + 2] * w2 + tmp[i3 + 2] * w3) / ws;
        out[oi] = r < 0 ? 0 : (r > 255 ? 255 : Math.round(r));
        out[oi + 1] = g < 0 ? 0 : (g > 255 ? 255 : Math.round(g));
        out[oi + 2] = bl < 0 ? 0 : (bl > 255 ? 255 : Math.round(bl));
      }
    }
  }
  return { data: out, w: dstW, h: dstH };
}

function borderCleanCrop(crop, stretchX, smooth) {
  const { w, h } = crop;
  if (h < 8 || w < 8) return crop;
  const out = new Uint8Array(crop.data);
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const gray = 0.299 * out[p] + 0.587 * out[p + 1] + 0.114 * out[p + 2];
    if (gray < 190) dark[i] = 1;
  }
  // 1. Margin-only horizontal table/frame/underline erasure (preserving character strokes crossing inward)
  const topBand = Math.max(2, Math.floor(0.25 * h));
  const botBand = h - Math.max(2, Math.floor(0.25 * h));
  for (let y = 0; y < h; y++) {
    if (y >= topBand && y < botBand) continue;
    let cnt = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) cnt += dark[row + x];
    if (cnt / w > 0.58) {
      const inward = y < topBand ? 1 : -1;
      for (let x = 0; x < w; x++) {
        const y1 = y + inward * 2, y2 = y + inward * 3;
        const keep = (y1 >= 0 && y1 < h && dark[y1 * w + x]) && (y2 >= 0 && y2 < h && dark[y2 * w + x]);
        if (!keep) {
          const p = (row + x) * 3;
          out[p] = 255; out[p + 1] = 255; out[p + 2] = 255;
        }
      }
    }
  }
  // 2. Margin-only vertical cell/frame wall erasure (strictly outermost 2px so Kanji boxes like 図 stay intact)
  const sideBand = Math.min(2, Math.max(1, Math.floor(0.05 * w)));
  for (let x = 0; x < w; x++) {
    if (x >= sideBand && x < w - sideBand) continue;
    let cnt = 0;
    for (let y = 0; y < h; y++) cnt += dark[y * w + x];
    if (cnt / h > 0.76) {
      for (let y = 0; y < h; y++) {
        const p = (y * w + x) * 3;
        out[p] = 255; out[p + 1] = 255; out[p + 2] = 255;
      }
    }
  }
  // 3. Trim outer all-white rows/cols
  let y0 = h, y1 = -1, x0 = w, x1 = -1, ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3;
      const g = 0.299 * out[p] + 0.587 * out[p + 1] + 0.114 * out[p + 2];
      if (g < 225) {
        ink++;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
      }
    }
  }
  let cur;
  if (ink > 4) {
    y0 = Math.max(0, y0 - 1); y1 = Math.min(h - 1, y1 + 1);
    x0 = Math.max(0, x0 - 1); x1 = Math.min(w - 1, x1 + 1);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const sub = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) {
      const srcOff = ((y0 + y) * w + x0) * 3;
      sub.set(out.subarray(srcOff, srcOff + cw * 3), y * cw * 3);
    }
    cur = { data: sub, w: cw, h: ch };
  } else {
    cur = { data: out, w, h };
  }
  if (stretchX !== 1) {
    cur = resizeRgb(cur, Math.max(4, Math.round(cur.w * stretchX)), cur.h);
  }
  if (smooth && cur.w >= 3 && cur.h >= 3) {
    // Mild Gaussian anti-aliasing (sigma ~0.8) removes harsh nearest-neighbor aliasing from PDF.js 1-bit scans.
    const sw = cur.w, sh = cur.h, s = cur.data;
    const dst = new Uint8Array(s.length);
    dst.set(s);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = (y * sw + x) * 3;
        for (let c = 0; c < 3; c++) {
          const blur = (
            s[i - sw * 3 - 3 + c] + 2 * s[i - sw * 3 + c] + s[i - sw * 3 + 3 + c] +
            2 * s[i - 3 + c] + 4 * s[i + c] + 2 * s[i + 3 + c] +
            s[i + sw * 3 - 3 + c] + 2 * s[i + sw * 3 + c] + s[i + sw * 3 + 3 + c]
          ) / 16;
          const v = Math.round(0.20 * s[i + c] + 0.80 * blur);
          dst[i + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
      }
    }
    cur = { data: dst, w: sw, h: sh };
  }
  // 4. Add 5px white pad on all 4 sides
  const pad = 5, pw = cur.w + 2 * pad, ph = cur.h + 2 * pad;
  const padded = new Uint8Array(pw * ph * 3);
  padded.fill(255);
  for (let y = 0; y < cur.h; y++) {
    padded.set(cur.data.subarray(y * cur.w * 3, (y + 1) * cur.w * 3), ((y + pad) * pw + pad) * 3);
  }
  return { data: padded, w: pw, h: ph };
}

function isCrosshairOrBoltCrop(crop) {
  const { w, h, data } = crop;
  if (Math.max(w, h) > 95 || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 1.7) return false;
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 185) dark[i] = 1;
  }
  let maxV = 0;
  for (let x = Math.floor(0.25 * w); x < Math.min(w, Math.floor(0.75 * w)); x++) {
    let c = 0; for (let y = 0; y < h; y++) c += dark[y * w + x];
    if (c / h > maxV) maxV = c / h;
  }
  if (maxV <= 0.78) return false;
  let maxH = 0;
  for (let y = Math.floor(0.25 * h); y < Math.min(h, Math.floor(0.75 * h)); y++) {
    let c = 0; for (let x = 0; x < w; x++) c += dark[y * w + x];
    if (c / w > maxH) maxH = c / w;
  }
  return maxH > 0.78;
}

function hasVerticalSpanLine(crop, thresh) {
  const { w, h, data } = crop;
  if (h <= 14) return false;
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 3;
      if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 185) c++;
    }
    if (c / h > thresh) return true;
  }
  return false;
}

function hasHorizontalSpanLine(crop, thresh) {
  const { w, h, data } = crop;
  if (w <= 14) return false;
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 3;
      if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 185) c++;
    }
    if (c / w > thresh) return true;
  }
  return false;
}

function countDarkPixels(crop, thresh) {
  const { w, h, data } = crop;
  let c = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < thresh) c++;
  }
  return c;
}

function isBoltOrSymbolFp(text, score, detScore, quad, rawCrop, cleanCrop) {
  const t = String(text || '').trim();
  if (!t || score < 0.65) return true;
  // Reject pure line/punctuation symbol repeats (e.g. parallel hatch or double walls read as ||, //, --, ==, []).
  if (/^[|\\-\\/\\\\=+\\[\\]():.;,._~*]+$/.test(t)) return true;
  const ux = quad[1][0] - quad[0][0], uy = quad[1][1] - quad[0][1];
  const vx = quad[3][0] - quad[0][0], vy = quad[3][1] - quad[0][1];
  const w = Math.hypot(ux, uy), h = Math.hypot(vx, vy);
  const ang = Math.abs(Math.atan2(uy, ux) * 180 / Math.PI);
  const chars = Array.from(t);
  const hasKanaCjk = /[\\u3040-\\u30ff\\u4e00-\\u9fff]/.test(t);

  if (chars.length === 1) {
    if ('0oO@©C〇・.一丨|/-+×*()[]{}日申中令φΦ⌀'.includes(t)) return true;
    if (/^[0-9A-Za-z]$/.test(t)) {
      if ((ang > 12 && Math.abs(ang - 90) > 12) || score < 0.98 || detScore < 0.65 || Math.max(w, h) < 35) return true;
    }
    if (isCrosshairOrBoltCrop(rawCrop)) return true;
    if (detScore < 0.52 || score < 0.90) return true;
    if (detScore < 0.62 && Math.max(w, h) < 55) return true;
  }
  if ((['lo','l0','Io','I0','1o','1O','TO','±1','II','ll','lI','Il'].includes(t) && (score < 0.995 || detScore < 0.65)) || (t === '11' && score < 0.85)) {
    if ((hasVerticalSpanLine(rawCrop, 0.58) || hasHorizontalSpanLine(rawCrop, 0.58)) && Math.max(w, h) < 120) return true;
  }
  if (chars.length <= 2 && !hasKanaCjk && score < 0.78 && (hasVerticalSpanLine(rawCrop, 0.68) || hasHorizontalSpanLine(rawCrop, 0.68))) {
    return true;
  }
  if (['lo','l0','Io'].includes(t) && Math.max(w, h) < 75) return true;
  if (chars.length <= 2 && isCrosshairOrBoltCrop(rawCrop) && score < 0.97) return true;
  if (countDarkPixels(cleanCrop, 205) < 10) return true;
  return false;
}

// --- DBNet tile detector ---
async function detectTile(rgba, imgW, x0, y0, tw, th, scale, thresh, boxThresh, unclipRatio) {
  const rw = Math.max(32, Math.round(tw * scale / 32) * 32);
  const rh = Math.max(32, Math.round(th * scale / 32) * 32);
  const inp = extractDetTensor(rgba, imgW, x0, y0, tw, th, rw, rh);
  const tensor = new ort.Tensor('float32', inp, [1, 3, rh, rw]);
  const outMap = await detSession.run({ [detInName]: tensor });
  const prob = outMap[detSession.outputNames[0]].data;

  // Threshold + 2x2 dilation matching RapidOCR/OpenCV
  const bin = new Uint8Array(rw * rh);
  for (let i = 0; i < rw * rh; i++) if (prob[i] > thresh) bin[i] = 1;
  const mask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const row = y * rw, row1 = Math.min(rh - 1, y + 1) * rw;
    for (let x = 0; x < rw; x++) {
      const x1 = Math.min(rw - 1, x + 1);
      if (bin[row + x] || bin[row + x1] || bin[row1 + x] || bin[row1 + x1]) mask[row + x] = 1;
    }
  }

  // BFS connected components (8-connectivity) -> convex hull -> minAreaRect -> unclip
  const visited = new Uint8Array(rw * rh);
  const queue = new Int32Array(rw * rh);
  const sx = tw / rw, sy = th / rh;
  const boxes = [];
  const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1], dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];

  for (let start = 0; start < rw * rh; start++) {
    if (!mask[start] || visited[start]) continue;
    let qh = 0, qt = 0;
    queue[qt++] = start;
    visited[start] = 1;
    const boundary = [];
    let count = 0;
    while (qh < qt) {
      const cur = queue[qh++];
      count++;
      const cx = cur % rw, cy = (cur - cx) / rw;
      let isBorder = (cx === 0 || cy === 0 || cx === rw - 1 || cy === rh - 1);
      for (let k = 0; k < 8; k++) {
        const nx = cx + dx8[k], ny = cy + dy8[k];
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const ni = ny * rw + nx;
        if (mask[ni]) {
          if (!visited[ni]) { visited[ni] = 1; queue[qt++] = ni; }
        } else {
          isBorder = true;
        }
      }
      if (isBorder) boundary.push([cx, cy]);
    }
    if (count < 6 || boundary.length < 4) continue;
    const hull = convexHull(boundary);
    const rect = minAreaRectFromHull(hull);
    if (!rect || Math.min(rect.w, rect.h) < 3.0) continue;

    // Mean probability inside oriented rectangle
    let xmin = rw, xmax = -1, ymin = rh, ymax = -1;
    for (const p of rect.pts) {
      if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0];
      if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1];
    }
    xmin = Math.max(0, Math.floor(xmin)); xmax = Math.min(rw - 1, Math.ceil(xmax));
    ymin = Math.max(0, Math.floor(ymin)); ymax = Math.min(rh - 1, Math.ceil(ymax));
    let sumP = 0, cntP = 0;
    const { ux, uy, vx, vy, minU, maxU, minV, maxV } = rect;
    for (let py = ymin; py <= ymax; py++) {
      const rOff = py * rw;
      for (let px = xmin; px <= xmax; px++) {
        const pu = px * ux + py * uy;
        if (pu < minU - 0.5 || pu > maxU + 0.5) continue;
        const pv = px * vx + py * vy;
        if (pv < minV - 0.5 || pv > maxV + 0.5) continue;
        sumP += prob[rOff + px];
        cntP++;
      }
    }
    const score = cntP > 0 ? sumP / cntP : 0;
    if (score < boxThresh) continue;

    // Exact rectangle unclipping: distance = area * unclipRatio / perimeter
    const dist = (rect.w * rect.h * unclipRatio) / Math.max(1e-6, 2 * (rect.w + rect.h));
    const u0 = minU - dist, u1 = maxU + dist, v0 = minV - dist, v1 = maxV + dist;
    if (Math.min(u1 - u0, v1 - v0) < 4.5) continue;
    const pt = (u, v) => [
      Math.max(0, Math.min(tw, (u * ux + v * vx) * sx)),
      Math.max(0, Math.min(th, (u * uy + v * vy) * sy))
    ];
    const epts = [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)];
    const ordered = orderQuadWithAlt(epts);
    boxes.push({ primary: ordered.primary, alt: ordered.alt, score });
    if (boxes.length >= 1500) break;
  }
  return boxes;
}

// --- SVTR/CTC batch recognizer ---
async function recBatch(crops, batchSize = 8, onBatch = null) {
  const n = crops.length;
  if (!n) return [];
  const imgH = 48;
  const ratios = crops.map(c => c.w / Math.max(1, c.h));
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ratios[a] - ratios[b]);
  const results = new Array(n);

  for (let start = 0; start < n; start += batchSize) {
    const end = Math.min(n, start + batchSize);
    const idxs = order.slice(start, end);
    const bs = idxs.length;
    let maxRatio = 320 / imgH;
    for (const ci of idxs) if (ratios[ci] > maxRatio) maxRatio = ratios[ci];
    const maxW = Math.ceil(Math.ceil(imgH * maxRatio) / 4) * 4;
    const plane = imgH * maxW;
    const batch = new Float32Array(bs * 3 * plane);

    for (let bi = 0; bi < bs; bi++) {
      const crop = crops[idxs[bi]];
      const rw = Math.min(maxW, Math.max(1, Math.ceil(imgH * crop.w / Math.max(1, crop.h))));
      const res = resizeRgb(crop, rw, imgH);
      const base = bi * 3 * plane;
      for (let y = 0; y < imgH; y++) {
        const outRow = y * maxW;
        const srcRow = y * rw * 3;
        for (let x = 0; x < rw; x++) {
          const si = srcRow + x * 3;
          const oi = outRow + x;
          // BGR order normalized to [-1, 1]
          batch[base + oi] = res.data[si + 2] * (2 / 255) - 1;
          batch[base + plane + oi] = res.data[si + 1] * (2 / 255) - 1;
          batch[base + 2 * plane + oi] = res.data[si] * (2 / 255) - 1;
        }
      }
    }

    const tensor = new ort.Tensor('float32', batch, [bs, 3, imgH, maxW]);
    const outMap = await recSession.run({ [recInName]: tensor });
    const outTensor = outMap[recSession.outputNames[0]];
    const [, T, V] = outTensor.dims;
    const probs = outTensor.data;

    for (let bi = 0; bi < bs; bi++) {
      const bOff = bi * T * V;
      let text = '', scoreSum = 0, scoreCnt = 0, prev = -1;
      for (let t = 0; t < T; t++) {
        const tOff = bOff + t * V;
        let bestId = 0, bestP = probs[tOff];
        for (let v = 1; v < V; v++) {
          const p = probs[tOff + v];
          if (p > bestP) { bestP = p; bestId = v; }
        }
        if (bestId !== 0 && bestId !== prev) {
          if (bestId < vocab.length) {
            text += vocab[bestId];
            scoreSum += bestP;
            scoreCnt++;
          }
        }
        prev = bestId;
      }
      results[idxs[bi]] = { text, score: scoreCnt ? scoreSum / scoreCnt : 0 };
    }
    if (onBatch) onBatch(end, n);
  }
  return results;
}

function quadBbox(q) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of q) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

function snapCadAngle(deg) {
  if (Math.abs(deg) <= 1.5) return 0;
  if (Math.abs(deg + 90) <= 1.5) return -90;
  if (Math.abs(deg - 90) <= 1.5) return 90;
  return Math.round(deg * 100) / 100;
}

async function runPage(rgba, width, height, includeVertical, report) {
  const tile = 1920, overlap = 560, stride = tile - overlap;
  const detScale = Math.max(width, height) <= 1200 ? 1.0 : 0.85;
  const ys = []; for (let y = 0; y < Math.max(1, height - tile + 1); y += stride) ys.push(y);
  if (ys[ys.length - 1] + tile < height) ys.push(Math.max(0, height - tile));
  const xs = []; for (let x = 0; x < Math.max(1, width - tile + 1); x += stride) xs.push(x);
  if (xs[xs.length - 1] + tile < width) xs.push(Math.max(0, width - tile));

  const detCandidates = [];
  const totalTiles = ys.length * xs.length;
  let tileIdx = 0;

  for (const y0 of ys) {
    for (const x0 of xs) {
      tileIdx++;
      const tw = Math.min(tile, width - x0), th = Math.min(tile, height - y0);
      report('日本語OCR（検出）：' + tileIdx + ' / ' + totalTiles);
      // Fast empty-tile skip
      let hasInk = false;
      for (let y = 0; y < th && !hasInk; y += 4) {
        const row = (y0 + y) * width + x0;
        for (let x = 0; x < tw; x += 4) {
          const p = (row + x) * 4;
          if (rgba[p] < 235 || rgba[p + 1] < 235 || rgba[p + 2] < 235) { hasInk = true; break; }
        }
      }
      if (!hasInk) continue;

      const boxes = await detectTile(rgba, width, x0, y0, tw, th, detScale, 0.25, 0.40, 1.78);
      for (const b of boxes) {
        const lb = quadBbox(b.primary);
        const touch = (x0 > 0 && lb[0] < 6) || (x0 + tw < width && lb[2] > tw - 6) ||
                      (y0 > 0 && lb[1] < 6) || (y0 + th < height && lb[3] > th - 6);
        const gq = b.primary.map(p => [p[0] + x0, p[1] + y0]);
        const galt = b.alt ? b.alt.map(p => [p[0] + x0, p[1] + y0]) : null;
        const bbox = quadBbox(gq);
        detCandidates.push({
          quad: gq, altQuad: galt, bbox, detScore: b.score, touch,
          area: Math.max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        });
      }
    }
  }

  // Border-aware NMS across overlapping tiles
  detCandidates.sort((a, b) => (Number(!b.touch) - Number(!a.touch)) || (b.area - a.area) || (b.detScore - a.detScore));
  const merged = [];
  for (const c of detCandidates) {
    const b = c.bbox;
    let dup = false;
    for (const k of merged) {
      const p = k.bbox;
      const iw = Math.max(0, Math.min(b[2], p[2]) - Math.max(b[0], p[0]));
      const ih = Math.max(0, Math.min(b[3], p[3]) - Math.max(b[1], p[1]));
      if (iw * ih > 0.45 * Math.min(c.area, k.area)) {
        if (!c.touch && k.touch && c.area > k.area * 1.15) Object.assign(k, c);
        dup = true; break;
      }
    }
    if (!dup) merged.push(c);
  }
  if (!merged.length) return [];

  report('日本語OCR（認識）：0 / ' + merged.length);
  const rawCrops = merged.map(c => warpCrop(rgba, width, height, c.quad, 0.04, 0.04, 0.04));
  const cleanCrops = rawCrops.map(rc => borderCleanCrop(rc, 1, true));
  const rawRes = await recBatch(rawCrops, 8, (done, tot) => report('日本語OCR（認識 1/2）：' + done + ' / ' + tot));
  const cleanRes = await recBatch(cleanCrops, 8, (done, tot) => report('日本語OCR（認識 2/2）：' + done + ' / ' + tot));

  // Ambiguous tall boxes (1.15 <= v/h <= 1.60): test vertical (-90 deg) orientation
  const altIdxs = [];
  for (let i = 0; i < merged.length; i++) if (merged[i].altQuad) altIdxs.push(i);
  if (altIdxs.length) {
    const altCrops = altIdxs.map(i => borderCleanCrop(warpCrop(rgba, width, height, merged[i].altQuad, 0.04, 0.04, 0.04), 1, true));
    const altRes = await recBatch(altCrops, 8);
    for (let k = 0; k < altIdxs.length; k++) {
      const i = altIdxs[k], at = altRes[k].text.trim(), as = altRes[k].score;
      const rt = rawRes[i].text.trim(), ct = cleanRes[i].text.trim();
      const bestH = Math.max(rawRes[i].score, cleanRes[i].score);
      if (as > bestH + 0.03 || (as >= 0.95 && at.length > Math.max(rt.length, ct.length))) {
        merged[i].quad = merged[i].altQuad;
        rawCrops[i] = warpCrop(rgba, width, height, merged[i].quad, 0.04, 0.04, 0.04);
        cleanCrops[i] = altCrops[k];
        rawRes[i] = altRes[k];
        cleanRes[i] = altRes[k];
      }
    }
  }

  const chosen = [];
  const stretchIdxs = [], stretchCrops = [];
  const prefixIdxs = [], prefixCrops = [];
  const kanaCjkRe = /[\\u3040-\\u30ff\\u4e00-\\u9fff]/;
  const bareDimRe = /^\\d{3,4}(?:\\([A-Z0]{2}\\))?$/;

  for (let i = 0; i < merged.length; i++) {
    const rt = rawRes[i].text, rs = rawRes[i].score;
    const ct = cleanRes[i].text, cs = cleanRes[i].score;
    let txt, sc;
    if (ct.trim().length >= rt.trim().length && cs >= rs - 0.02) { txt = ct; sc = cs; }
    else if (rt.trim().length > ct.trim().length && rs >= 0.70) { txt = rt; sc = rs; }
    else if (cs >= rs) { txt = ct; sc = cs; }
    else { txt = rt; sc = rs; }
    chosen.push({ text: txt, score: sc });

    const ts = txt.trim();
    if ((sc < 0.992 && kanaCjkRe.test(ts) && ts.length >= 2) || (sc < 0.92 && ts.length >= 2)) {
      stretchIdxs.push(i);
      stretchCrops.push(borderCleanCrop(rawCrops[i], 1.25, true));
    }
    const q = merged[i].quad;
    const ang = Math.abs(Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180 / Math.PI);
    if (ang > 5 && bareDimRe.test(ts)) {
      prefixIdxs.push(i);
      prefixCrops.push(borderCleanCrop(warpCrop(rgba, width, height, q, 0.55, 0.04, 0.04), 1, false));
    }
  }

  if (stretchCrops.length) {
    report('日本語OCR（細密補正）：' + stretchCrops.length + '件');
    const sRes = await recBatch(stretchCrops, 8);
    for (let k = 0; k < stretchIdxs.length; k++) {
      const i = stretchIdxs[k], st = sRes[k].text.trim(), ss = sRes[k].score;
      const oldT = chosen[i].text.trim(), oldS = chosen[i].score;
      if (st && st.length >= oldT.length && ss > oldS + 0.002) {
        chosen[i] = { text: sRes[k].text, score: ss };
      }
    }
  }

  if (prefixCrops.length) {
    const pRes = await recBatch(prefixCrops, 8);
    for (let k = 0; k < prefixIdxs.length; k++) {
      const i = prefixIdxs[k], pt = normalizeCadText(pRes[k].text), ps = pRes[k].score;
      const oldNorm = normalizeCadText(chosen[i].text);
      if (pt === 'φ' + oldNorm && ps >= 0.72) {
        chosen[i] = { text: pt, score: Math.max(chosen[i].score, ps) };
      }
    }
  }

  const items = [];
  for (let i = 0; i < merged.length; i++) {
    const rawTxt = chosen[i].text, sc = chosen[i].score;
    const q = merged[i].quad;
    if (isBoltOrSymbolFp(rawTxt, sc, merged[i].detScore, q, rawCrops[i], cleanCrops[i])) continue;
    const norm = normalizeCadText(rawTxt);
    if (!norm || !/[\\p{L}\\p{N}φΦ°]/u.test(norm) || /[\\ufffd\\ue000-\\uf8ff]/.test(norm)) continue;
    const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1];
    const vx = q[3][0] - q[0][0], vy = q[3][1] - q[0][1];
    const w = Math.hypot(ux, uy), h = Math.hypot(vx, vy);
    if (h < 5 || h > 300 || w < 3) continue;
    const rawAngle = Math.atan2(uy, ux) * 180 / Math.PI;
    const angle = snapCadAngle(rawAngle);
    if (includeVertical === false && Math.abs(angle) > 20) continue;
    items.push({
      text: norm,
      raw: rawTxt.trim(),
      x: q[3][0],
      y: q[3][1],
      width: w,
      height: h,
      angle,
      source: 'ocr',
      confidence: Math.round(Math.max(0, Math.min(100, sc * 100)) * 10) / 10
    });
  }
  items.sort((a, b) => (Math.round(a.y / 25) - Math.round(b.y / 25)) || (a.x - b.x));
  return items;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      self.postMessage({ type: 'progress', id: msg.id, message: '日本語OCRエンジンを展開中…' });
      const [ortJsBytes, mjsBytes, wasmBytes, detBytes, recBytes, vocabBytes] = await Promise.all([
        gunzip(msg.files['ort.wasm.min.js.gz']),
        gunzip(msg.files['ort-wasm-simd-threaded.mjs.gz']),
        gunzip(msg.files['ort-wasm-simd-threaded.wasm.gz']),
        gunzip(msg.files['ppocrv6_det_bf16.onnx.gz']),
        gunzip(msg.files['ppocrv6_rec_bf16.onnx.gz']),
        gunzip(msg.files['ppocrv6_vocab.txt.gz'])
      ]);
      wasmBytesLocal = wasmBytes;
      const ortUrl = URL.createObjectURL(new Blob([ortJsBytes], { type: 'text/javascript' }));
      try { importScripts(ortUrl); } finally { URL.revokeObjectURL(ortUrl); }
      const mjsUrl = URL.createObjectURL(new Blob([mjsBytes], { type: 'text/javascript' }));
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: 'https://ocr-local.invalid/ort-wasm-simd-threaded.wasm' };
      const sessOpts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      self.postMessage({ type: 'progress', id: msg.id, message: '日本語OCRモデルを初期化中…' });
      detSession = await ort.InferenceSession.create(detBytes, sessOpts);
      recSession = await ort.InferenceSession.create(recBytes, sessOpts);
      detInName = detSession.inputNames[0];
      recInName = recSession.inputNames[0];
      const vText = new TextDecoder('utf-8').decode(vocabBytes);
      vocab = ['blank', ...vText.split(/\\r?\\n/), ' '];
      URL.revokeObjectURL(mjsUrl);
      self.postMessage({ type: 'ready', id: msg.id });
    } else if (msg.type === 'recognize') {
      const rgba = new Uint8ClampedArray(msg.rgba);
      const items = await runPage(rgba, msg.width, msg.height, msg.includeVertical, m => {
        self.postMessage({ type: 'progress', id: msg.id, message: m });
      });
      self.postMessage({ type: 'result', id: msg.id, items });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
};
`;
  },

  _call(msg, transfer = [], onProgress = null) {
    return new Promise((resolve, reject) => {
      const id = ++this._reqId;
      this._pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  },

  async ensure(onProgress = null) {
    if (this.promise) return this.promise;
    this.promise = (async () => {
      if (!window.draftOcrAssets) {
        if (onProgress) onProgress('日本語OCRデータを読み込み中…');
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'ocr-assets.js';
          s.onload = resolve;
          s.onerror = () => reject(Error('日本語OCRデータを読み込めません。'));
          document.head.append(s);
        });
      }
      const rawAssets = window.draftOcrAssets;
      const fileMap = rawAssets?.files || rawAssets;
      const decode = s => {
        if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s);
        const b = atob(s);
        const out = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
        return out;
      };
      const workerUrl = URL.createObjectURL(new Blob([this._workerSource()], { type: 'text/javascript' }));
      this.urls.push(workerUrl);
      const worker = new Worker(workerUrl);
      worker.onmessage = ev => {
        const msg = ev.data || {};
        const entry = this._pending.get(msg.id);
        if (!entry) return;
        if (msg.type === 'progress') {
          if (entry.onProgress) entry.onProgress(msg.message);
        } else if (msg.type === 'ready' || msg.type === 'result') {
          this._pending.delete(msg.id);
          entry.resolve(msg.items || true);
        } else if (msg.type === 'error') {
          this._pending.delete(msg.id);
          entry.reject(Error(msg.message || '日本語OCRの処理に失敗しました。'));
        }
      };
      worker.onerror = err => {
        for (const [, entry] of this._pending) entry.reject(Error(err.message || '日本語OCRワーカーでエラーが発生しました。'));
        this._pending.clear();
      };
      this.worker = worker;

      const keys = [
        'ort.wasm.min.js.gz',
        'ort-wasm-simd-threaded.mjs.gz',
        'ort-wasm-simd-threaded.wasm.gz',
        'ppocrv6_det_bf16.onnx.gz',
        'ppocrv6_rec_bf16.onnx.gz',
        'ppocrv6_vocab.txt.gz'
      ];
      const files = {};
      const transfers = [];
      for (const k of keys) {
        if (!fileMap[k]) throw Error('日本語OCRデータが不完全です：' + k);
        const arr = decode(fileMap[k]);
        files[k] = arr.buffer;
        transfers.push(arr.buffer);
      }
      await this._call({ type: 'init', files }, transfers, onProgress);
      return worker;
    })().catch(error => {
      this.worker?.terminate();
      this.worker = null;
      this.promise = null;
      for (const url of this.urls) URL.revokeObjectURL(url);
      this.urls = [];
      throw error;
    });
    return this.promise;
  },

  async recognize(canvas, { progress = () => {}, cancelled = () => false, existing = [], includeVertical = true } = {}) {
    await this.ensure(progress);
    if (cancelled()) throw Error('文字認識を中止しました。');
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const copy = new Uint8ClampedArray(imgData.data);
    const items = await this._call(
      { type: 'recognize', rgba: copy.buffer, width: canvas.width, height: canvas.height, includeVertical },
      [copy.buffer],
      m => { if (!cancelled()) progress(m); }
    );
    if (cancelled()) throw Error('文字認識を中止しました。');

    const output = [];
    for (const item of items || []) {
      const cleaned = window.DraftOcrDomain ? DraftOcrDomain.cleanOcr(item.text) : item.text;
      if (!cleaned) continue;
      const t = { ...item, id: 'ocr-' + output.length, text: cleaned };
      const q = DraftTexts.bounds(t);
      const areaQ = Math.max(1, (q[2] - q[0]) * (q[3] - q[1]));
      const duplicate = [...existing, ...output].some(other => {
        const p = DraftTexts.bounds(other);
        const iw = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0]));
        const ih = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
        return iw * ih > 0.5 * Math.min(Math.max(1, (p[2] - p[0]) * (p[3] - p[1])), areaQ);
      });
      if (!duplicate) output.push(t);
    }
    return DraftTexts.validate(output);
  },

  eraseRecognized(canvas, texts) {
    const result = document.createElement('canvas');
    result.width = canvas.width;
    result.height = canvas.height;
    const c = result.getContext('2d');
    c.drawImage(canvas, 0, 0);
    for (const text of texts) {
      const b = DraftTexts.bounds(text);
      const x = Math.max(0, Math.floor(b[0]));
      const y = Math.max(0, Math.floor(b[1]));
      const w = Math.min(canvas.width - x, Math.ceil(b[2]) - x + 1);
      const h = Math.min(canvas.height - y, Math.ceil(b[3]) - y + 1);
      if (w <= 0 || h <= 0) continue;

      // For angled text (non-orthogonal), restrict erasure strictly to the tight oriented rectangle!
      const isAngled = Math.abs(text.angle % 90) > 1 && Math.abs(Math.abs(text.angle % 90) - 90) > 1;
      const rad = text.angle * Math.PI / 180, cosA = Math.cos(rad), sinA = Math.sin(rad);
      const inOrientedBox = (px, py) => {
        if (!isAngled) return true;
        const dx = px - text.x, dy = py - text.y;
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        return lx >= -1 && lx <= text.width + 1 && ly >= -text.height - 1 && ly <= 1;
      };

      // Keep dark strokes that cross both opposite edges of the text rectangle.
      const m = Math.max(3, Math.ceil(Math.min(h, text.height * 1.5)));
      const sx = Math.max(0, x - m), sy = Math.max(0, y - m);
      const sw = Math.min(canvas.width - sx, w + 2 * m), sh = Math.min(canvas.height - sy, h + 2 * m);
      const image = c.getImageData(sx, sy, sw, sh), ox = x - sx, oy = y - sy;
      const dark = (a, b) => {
        if (a < 0 || b < 0 || a >= sw || b >= sh) return false;
        const i = (b * sw + a) * 4;
        return image.data[i] + image.data[i + 1] + image.data[i + 2] < 540;
      };
      const keepY = new Set(), keepX = new Set();
      for (let j = 0; j < h; j++) if (dark(ox - 2, oy + j) && dark(ox + w + 1, oy + j) && dark(ox - Math.min(m, ox), oy + j) && dark(Math.min(sw - 1, ox + w + m - 1), oy + j)) keepY.add(j);
      for (let i = 0; i < w; i++) if (dark(ox + i, oy - 2) && dark(ox + i, oy + h + 1) && dark(ox + i, oy - Math.min(m, oy)) && dark(ox + i, Math.min(sh - 1, oy + h + m - 1))) keepX.add(i);

      // Protect diagonal straight strokes crossing the patch using only pixels outside the text box.
      const edgePoints = [];
      const edges = [
        Array.from({ length: sw }, (_, i) => [i, 0]),
        Array.from({ length: sw }, (_, i) => [i, sh - 1]),
        Array.from({ length: sh }, (_, i) => [0, i]),
        Array.from({ length: sh }, (_, i) => [sw - 1, i])
      ];
      edges.forEach((edge, side) => {
        let run = [];
        const flush = () => { if (run.length) { edgePoints.push({ p: run[Math.floor(run.length / 2)], side }); run = []; } };
        for (const p of edge) { if (dark(...p)) run.push(p); else flush(); }
        flush();
      });
      const protectedPixels = new Set();
      const near = (a, b) => [-1, 0, 1].some(dx => [-1, 0, 1].some(dy => dark(Math.round(a) + dx, Math.round(b) + dy)));
      if (edgePoints.length <= 30) {
        for (let a = 0; a < edgePoints.length; a++) {
          for (let bIdx = a + 1; bIdx < edgePoints.length; bIdx++) {
            if (edgePoints[a].side === edgePoints[bIdx].side) continue;
            const p = edgePoints[a].p, q = edgePoints[bIdx].p, dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy);
            if (length < 2 * Math.min(h, text.height)) continue;
            const steps = Math.ceil(length);
            const points = Array.from({ length: steps + 1 }, (_, i) => [p[0] + dx * i / steps, p[1] + dy * i / steps]);
            const inside = points.map(([px, py]) => px >= ox && px < ox + w && py >= oy && py < oy + h);
            const first = inside.indexOf(true), last = inside.lastIndexOf(true);
            if (first < Math.min(h, m) * 0.6 || last < 0 || points.length - last < Math.min(h, m) * 0.6) continue;
            const outside = points.filter((_, i) => !inside[i]);
            if (!outside.length || outside.filter(pt => near(...pt)).length / outside.length < 0.96) continue;
            for (let k = first; k <= last; k++) {
              const [px, py] = points[k];
              for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) protectedPixels.add((Math.round(py) + v) * sw + Math.round(px) + u);
            }
          }
        }
      }
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (keepY.has(j) || keepX.has(i) || protectedPixels.has((oy + j) * sw + ox + i)) continue;
          if (!inOrientedBox(x + i, y + j)) continue;
          const p = ((oy + j) * sw + ox + i) * 4;
          image.data[p] = image.data[p + 1] = image.data[p + 2] = 255;
          image.data[p + 3] = 255;
        }
      }
      c.putImageData(image, sx, sy);
    }
    return result;
  }
};
