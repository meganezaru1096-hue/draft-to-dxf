// Offline parallel Web-Worker inference for TinyLineUNet v3 (4-ch Pure CAD Ink Restoration, INT8).
// Lazy-loads preprocess-ml-model.js (~24KB) only when user selects AI線復元. Zero external requests.
window.DraftPreprocessMl = (() => {
  let modelPromise = null;
  let activeWorkers = [];
  let runSeq = 0;

  // Self-contained tile worker source (exact mathematical parity with tools/ml_preprocess_unet_v3.py).
  const WORKER_SOURCE = `
  function b64ToInt8(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Int8Array(u8.buffer);
  }
  function decodeModel(json) {
    const layers = {};
    for (const l of json.layers) {
      const q = b64ToInt8(l.w_int8_b64);
      const scales = l.w_scales;
      const bias = Float32Array.from(l.bias);
      const w = new Float32Array(q.length);
      if (l.kind === 'dw3') {
        for (let c = 0; c < l.cin; c++) {
          const sc = scales[c], base = c * 9;
          for (let k = 0; k < 9; k++) w[base + k] = q[base + k] * sc;
        }
      } else {
        const cout = l.cout, rows = q.length / cout;
        for (let r = 0; r < rows; r++) {
          const base = r * cout;
          for (let j = 0; j < cout; j++) w[base + j] = q[base + j] * scales[j];
        }
      }
      layers[l.name] = { name: l.name, kind: l.kind, cin: l.cin, cout: l.cout, dilation: l.dilation || 1, w, b: bias };
    }
    return { alpha: json.leaky_relu_alpha ?? 0.1, layers };
  }
  function conv3x3(x, h, w, layer) {
    const cin = layer.cin, cout = layer.cout, wt = layer.w, b = layer.b;
    const y = new Float32Array(h * w * cout);
    const wm1 = w - 1, hm1 = h - 1;
    for (let r = 0; r < h; r++) {
      const r0 = r > 0 ? r - 1 : 0, r2 = r < hm1 ? r + 1 : hm1;
      const rows = [r0, r, r2];
      for (let c = 0; c < w; c++) {
        const c0 = c > 0 ? c - 1 : 0, c2 = c < wm1 ? c + 1 : wm1;
        const cols = [c0, c, c2];
        const outBase = (r * w + c) * cout;
        for (let o = 0; o < cout; o++) y[outBase + o] = b[o];
        let kIdx = 0;
        for (let ky = 0; ky < 3; ky++) {
          const rr = rows[ky] * w;
          for (let kx = 0; kx < 3; kx++) {
            const inBase = (rr + cols[kx]) * cin;
            for (let ic = 0; ic < cin; ic++) {
              const xv = x[inBase + ic], wBase = (kIdx * cin + ic) * cout;
              for (let o = 0; o < cout; o++) y[outBase + o] += xv * wt[wBase + o];
            }
            kIdx++;
          }
        }
      }
    }
    return y;
  }
  function dwconv3x3(x, h, w, layer) {
    const ch = layer.cin, d = layer.dilation, wt = layer.w, b = layer.b;
    const y = new Float32Array(h * w * ch);
    const wm1 = w - 1, hm1 = h - 1;
    for (let r = 0; r < h; r++) {
      let r0 = r - d; if (r0 < 0) r0 = 0;
      let r2 = r + d; if (r2 > hm1) r2 = hm1;
      const rows = [r0, r, r2];
      for (let c = 0; c < w; c++) {
        let c0 = c - d; if (c0 < 0) c0 = 0;
        let c2 = c + d; if (c2 > wm1) c2 = wm1;
        const cols = [c0, c, c2];
        const outBase = (r * w + c) * ch;
        for (let ic = 0; ic < ch; ic++) y[outBase + ic] = b[ic];
        let kIdx = 0;
        for (let ky = 0; ky < 3; ky++) {
          const rr = rows[ky] * w;
          for (let kx = 0; kx < 3; kx++) {
            const inBase = (rr + cols[kx]) * ch;
            for (let ic = 0; ic < ch; ic++) y[outBase + ic] += x[inBase + ic] * wt[ic * 9 + kIdx];
            kIdx++;
          }
        }
      }
    }
    return y;
  }
  function pw1x1(x, h, w, layer) {
    const cin = layer.cin, cout = layer.cout, wt = layer.w, b = layer.b;
    const n = h * w, y = new Float32Array(n * cout);
    for (let i = 0; i < n; i++) {
      const inBase = i * cin, outBase = i * cout;
      for (let o = 0; o < cout; o++) y[outBase + o] = b[o];
      for (let ic = 0; ic < cin; ic++) {
        const xv = x[inBase + ic], wBase = ic * cout;
        for (let o = 0; o < cout; o++) y[outBase + o] += xv * wt[wBase + o];
      }
    }
    return y;
  }
  function lreluInPlace(a, alpha) { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] *= alpha; return a; }
  function addLrelu(a, res, alpha) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) { const v = a[i] + res[i]; out[i] = v >= 0 ? v : v * alpha; }
    return out;
  }
  function avgpool2(x, h, w, ch) {
    const nh = h >> 1, nw = w >> 1, y = new Float32Array(nh * nw * ch);
    for (let r = 0; r < nh; r++) {
      const r0 = (r * 2) * w, r1 = (r * 2 + 1) * w;
      for (let c = 0; c < nw; c++) {
        const c0 = c * 2, c1 = c0 + 1;
        const i00 = (r0 + c0) * ch, i01 = (r0 + c1) * ch, i10 = (r1 + c0) * ch, i11 = (r1 + c1) * ch;
        const o = (r * nw + c) * ch;
        for (let k = 0; k < ch; k++) y[o + k] = 0.25 * (x[i00 + k] + x[i01 + k] + x[i10 + k] + x[i11 + k]);
      }
    }
    return y;
  }
  function upsample2Concat(low, lh, lw, lc, skip, sc) {
    const h = lh * 2, w = lw * 2, tc = lc + sc, y = new Float32Array(h * w * tc);
    for (let r = 0; r < h; r++) {
      const lr = r >> 1;
      for (let c = 0; c < w; c++) {
        const lBase = (lr * lw + (c >> 1)) * lc, sBase = (r * w + c) * sc, oBase = (r * w + c) * tc;
        for (let k = 0; k < lc; k++) y[oBase + k] = low[lBase + k];
        for (let k = 0; k < sc; k++) y[oBase + lc + k] = skip[sBase + k];
      }
    }
    return y;
  }
  function forwardPatch(decoded, patchFeats, h, w) {
    const L = decoded.layers, a = decoded.alpha;
    const r0 = lreluInPlace(conv3x3(patchFeats, h, w, L.stem), a);
    let z = pw1x1(dwconv3x3(r0, h, w, L.e1_dw), h, w, L.e1_pw);
    const s1 = addLrelu(z, r0, a);
    const h2 = h >> 1, w2 = w >> 1;
    const p1 = avgpool2(s1, h, w, 16);
    const r2a = lreluInPlace(pw1x1(dwconv3x3(p1, h2, w2, L.e2a_dw), h2, w2, L.e2a_pw), a);
    z = pw1x1(dwconv3x3(r2a, h2, w2, L.e2b_dw), h2, w2, L.e2b_pw);
    const s2 = addLrelu(z, r2a, a);
    const h4 = h2 >> 1, w4 = w2 >> 1;
    const p2 = avgpool2(s2, h2, w2, 24);
    const rba = lreluInPlace(pw1x1(dwconv3x3(p2, h4, w4, L.ba_dw), h4, w4, L.ba_pw), a);
    z = pw1x1(dwconv3x3(rba, h4, w4, L.bb_dw), h4, w4, L.bb_pw);
    const rbb = addLrelu(z, rba, a);
    z = pw1x1(dwconv3x3(rbb, h4, w4, L.bc_dw), h4, w4, L.bc_pw);
    const bot = addLrelu(z, rbb, a);
    const cat2 = upsample2Concat(bot, h4, w4, 36, s2, 24);
    const rd2 = lreluInPlace(pw1x1(cat2, h2, w2, L.d2_red), a);
    z = pw1x1(dwconv3x3(rd2, h2, w2, L.d2_dw), h2, w2, L.d2_pw);
    const d2 = addLrelu(z, rd2, a);
    const cat1 = upsample2Concat(d2, h2, w2, 20, s1, 16);
    const rd1 = lreluInPlace(pw1x1(cat1, h, w, L.d1_red), a);
    z = pw1x1(dwconv3x3(rd1, h, w, L.d1_dw), h, w, L.d1_pw);
    const d1 = addLrelu(z, rd1, a);
    const logits = pw1x1(d1, h, w, L.head);
    const probs = new Float32Array(h * w);
    for (let i = 0; i < logits.length; i++) {
      let v = logits[i]; if (v > 30) v = 30; else if (v < -30) v = -30;
      probs[i] = 1.0 / (1.0 + Math.exp(-v));
    }
    return probs;
  }
  let decoded = null;
  onmessage = ({ data }) => {
    if (data.kind === 'init') {
      decoded = decodeModel(data.modelJson);
      postMessage({ kind: 'ready' });
      return;
    }
    if (data.kind === 'tile') {
      const probs = forwardPatch(decoded, new Float32Array(data.patch), data.th, data.tw);
      postMessage({ kind: 'done', tileIdx: data.tileIdx, probs: probs.buffer }, [probs.buffer]);
    }
  };
  `;

  function boxMeanEdge(src, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const inv = 1.0 / (2 * radius + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const x = k < 0 ? 0 : (k >= w ? w - 1 : k);
        sum += src[row + x];
      }
      tmp[row] = sum * inv;
      for (let x = 1; x < w; x++) {
        const xAdd = x + radius < w ? x + radius : w - 1;
        const xSub = x - radius - 1 >= 0 ? x - radius - 1 : 0;
        sum += src[row + xAdd] - src[row + xSub];
        tmp[row + x] = sum * inv;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const y = k < 0 ? 0 : (k >= h ? h - 1 : k);
        sum += tmp[y * w + x];
      }
      out[x] = sum * inv;
      for (let y = 1; y < h; y++) {
        const yAdd = y + radius < h ? y + radius : h - 1;
        const ySub = y - radius - 1 >= 0 ? y - radius - 1 : 0;
        sum += tmp[yAdd * w + x] - tmp[ySub * w + x];
        out[y * w + x] = sum * inv;
      }
    }
    return out;
  }

  function extractFeaturesV3(grayU8, w, h) {
    const n = w * h;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = grayU8[i];
    const m15 = boxMeanEdge(g, w, h, 7);
    const m45 = boxMeanEdge(g, w, h, 22);
    const ch1 = new Float32Array(n);
    const feats = new Float32Array(n * 4);
    const inv255 = 1.0 / 255.0, inv95 = 1.0 / 95.0, inv115 = 1.0 / 115.0;
    for (let i = 0; i < n; i++) {
      const gi = g[i];
      const v0 = (255.0 - gi) * inv255;
      let v1 = (m15[i] - gi) * inv95;
      if (v1 < 0) v1 = 0; else if (v1 > 1) v1 = 1;
      let v2 = (m45[i] - gi) * inv115;
      if (v2 < 0) v2 = 0; else if (v2 > 1) v2 = 1;
      ch1[i] = v1;
      const o = i * 4;
      feats[o] = v0; feats[o + 1] = v1; feats[o + 2] = v2;
    }
    const inv7 = 1.0 / 7.0, wm1 = w - 1, hm1 = h - 1;
    for (let y = 0; y < h; y++) {
      const yRow = y * w;
      for (let x = 0; x < w; x++) {
        let sh = 0, sv = 0, sd1 = 0, sd2 = 0;
        for (let k = -3; k <= 3; k++) {
          let xk = x + k; if (xk < 0) xk = 0; else if (xk > wm1) xk = wm1;
          let yk = y + k; if (yk < 0) yk = 0; else if (yk > hm1) yk = hm1;
          let xm = x - k; if (xm < 0) xm = 0; else if (xm > wm1) xm = wm1;
          sh += ch1[yRow + xk];
          sv += ch1[yk * w + x];
          sd1 += ch1[yk * w + xk];
          sd2 += ch1[yk * w + xm];
        }
        let best = sh > sv ? sh : sv;
        if (sd1 > best) best = sd1;
        if (sd2 > best) best = sd2;
        feats[(yRow + x) * 4 + 3] = best * inv7;
      }
    }
    return feats;
  }

  function ensureModel() {
    if (window.DraftPreprocessMlModel) return Promise.resolve(window.DraftPreprocessMlModel);
    if (modelPromise) return modelPromise;
    const src = window.draftPreprocessMlModelSrc || document.querySelector('meta[name="draft-preprocess-ml-model"]')?.content || 'preprocess-ml-model.js';
    modelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => window.DraftPreprocessMlModel ? resolve(window.DraftPreprocessMlModel) : reject(Error('AI線復元モデルを読み込めません。'));
      s.onerror = () => reject(Error('AI線復元モデルの読み込みに失敗しました。'));
      document.head.appendChild(s);
    }).catch(err => { modelPromise = null; throw err; });
    return modelPromise;
  }

  function stopWorkers() {
    for (const w of activeWorkers) {
      try { w.terminate(); } catch (_) {}
    }
    activeWorkers = [];
  }

  function cancel() {
    runSeq++;
    stopWorkers();
  }

  async function restoreGray(grayU8, width, height, opts = {}) {
    const seq = ++runSeq;
    const t0 = performance.now();
    const progress = opts.progress || (() => {});
    const cancelled = opts.cancelled || (() => false);
    const tile = opts.tile || 256;
    const overlap = opts.overlap || 32;

    progress('AI線復元モデルを読み込んでいます…');
    const modelJson = await ensureModel();
    if (seq !== runSeq || cancelled()) return null;
    if (modelJson.format !== 'draft-to-dxf-tiny-line-unet' || modelJson.version !== 3) {
      throw Error('未対応のAI線復元モデル形式です。');
    }
    const threshold = opts.threshold ?? (modelJson.metadata?.recommended_threshold ?? 0.50);

    // Handle light-lines-on-dark-background blueprints cleanly by auto-inverting before UNet
    let workGray = grayU8;
    let sumSample = 0, cntSample = 0;
    const step = Math.max(1, Math.floor(grayU8.length / 4096));
    for (let i = 0; i < grayU8.length; i += step) { sumSample += grayU8[i]; cntSample++; }
    const invertedInput = (sumSample / Math.max(1, cntSample)) < 115;
    if (invertedInput) {
      workGray = new Uint8Array(grayU8.length);
      for (let i = 0; i < grayU8.length; i++) workGray[i] = 255 - grayU8[i];
    }

    progress('AI線復元：特徴量を計算しています…');
    const feats = extractFeaturesV3(workGray, width, height);
    if (seq !== runSeq || cancelled()) return null;

    const out = new Float32Array(width * height);
    const weight = new Float32Array(width * height);
    const stride = tile - overlap;

    const ys = [];
    for (let y = 0; y <= Math.max(0, height - tile); y += stride) ys.push(y);
    if (!ys.length) ys.push(0);
    if (ys[ys.length - 1] + tile < height) ys.push(Math.max(0, height - tile));
    const xs = [];
    for (let x = 0; x <= Math.max(0, width - tile); x += stride) xs.push(x);
    if (!xs.length) xs.push(0);
    if (xs[xs.length - 1] + tile < width) xs.push(Math.max(0, width - tile));

    const queue = [];
    let tilesTotal = 0, tilesSkipped = 0;
    for (const y0 of ys) {
      for (const x0 of xs) {
        tilesTotal++;
        const y1 = Math.min(height, y0 + tile), x1 = Math.min(width, x0 + tile);
        const ph = y1 - y0, pw = x1 - x0;
        const m = Math.min(overlap >> 1, ph >> 2, pw >> 2);
        const wy = new Float32Array(ph).fill(1.0);
        const wx = new Float32Array(pw).fill(1.0);
        if (m > 0) {
          for (let i = 0; i < m; i++) {
            const ramp = m > 1 ? 0.05 + 0.95 * (i / (m - 1)) : 1.0;
            if (y0 > 0) wy[i] = ramp;
            if (y0 + ph < height) wy[ph - 1 - i] = ramp;
            if (x0 > 0) wx[i] = ramp;
            if (x0 + pw < width) wx[pw - 1 - i] = ramp;
          }
        }
        let max1 = 0, max2 = 0;
        for (let r = 0; r < ph; r++) {
          const base = ((y0 + r) * width + x0) * 4;
          for (let c = 0; c < pw; c++) {
            const v1 = feats[base + c * 4 + 1], v2 = feats[base + c * 4 + 2];
            if (v1 > max1) max1 = v1;
            if (v2 > max2) max2 = v2;
          }
        }
        if (max1 < 0.08 && max2 < 0.08) {
          tilesSkipped++;
          for (let r = 0; r < ph; r++) {
            const rowOut = (y0 + r) * width + x0, wyr = wy[r];
            for (let c = 0; c < pw; c++) weight[rowOut + c] += wyr * wx[c];
          }
          continue;
        }
        queue.push({ y0, x0, ph, pw, wy, wx });
      }
    }

    if (queue.length > 0) {
      const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const nWorkers = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 2), queue.length);
      stopWorkers();
      try {
        await new Promise((resolve, reject) => {
          let nextIdx = 0, doneCount = 0, finished = false;
          const finish = (err) => {
            if (finished) return;
            finished = true;
            stopWorkers();
            if (err) reject(err); else resolve();
          };
          const dispatch = (worker) => {
            if (finished || seq !== runSeq || cancelled()) { finish(); return; }
            if (nextIdx >= queue.length) return;
            const tileIdx = nextIdx++;
            const job = queue[tileIdx];
            const padH = (4 - (job.ph % 4)) % 4, padW = (4 - (job.pw % 4)) % 4;
            const th = job.ph + padH, tw = job.pw + padW;
            const patch = new Float32Array(th * tw * 4);
            for (let r = 0; r < th; r++) {
              const sr = job.y0 + (r < job.ph ? r : job.ph - 1);
              for (let c = 0; c < tw; c++) {
                const sc = job.x0 + (c < job.pw ? c : job.pw - 1);
                const src = (sr * width + sc) * 4, dst = (r * tw + c) * 4;
                patch[dst] = feats[src]; patch[dst + 1] = feats[src + 1];
                patch[dst + 2] = feats[src + 2]; patch[dst + 3] = feats[src + 3];
              }
            }
            worker.postMessage({ kind: 'tile', tileIdx, th, tw, patch: patch.buffer }, [patch.buffer]);
          };
          for (let wi = 0; wi < nWorkers; wi++) {
            const w = new Worker(workerUrl);
            activeWorkers.push(w);
            w.onerror = (ev) => finish(Error(ev.message || 'AI線復元ワーカーでエラーが発生しました。'));
            w.onmessage = ({ data }) => {
              if (finished || seq !== runSeq || cancelled()) { finish(); return; }
              if (data.kind === 'ready') {
                dispatch(w);
              } else if (data.kind === 'done') {
                const job = queue[data.tileIdx];
                const probs = new Float32Array(data.probs);
                const tw = job.pw + ((4 - (job.pw % 4)) % 4);
                for (let r = 0; r < job.ph; r++) {
                  const rowOut = (job.y0 + r) * width + job.x0, rowP = r * tw, wyr = job.wy[r];
                  for (let c = 0; c < job.pw; c++) {
                    const b = wyr * job.wx[c];
                    out[rowOut + c] += probs[rowP + c] * b;
                    weight[rowOut + c] += b;
                  }
                }
                doneCount++;
                const pct = Math.round((doneCount / queue.length) * 100);
                progress(`AI線復元を実行中… ${pct}%（${doneCount}/${queue.length}タイル・空${tilesSkipped}スキップ）`);
                if (doneCount >= queue.length) finish();
                else dispatch(w);
              }
            };
            w.postMessage({ kind: 'init', modelJson });
          }
        });
      } finally {
        URL.revokeObjectURL(workerUrl);
        stopWorkers();
      }
    }

    if (seq !== runSeq || cancelled()) return null;
    const cleanGray = new Uint8Array(width * height);
    for (let i = 0; i < cleanGray.length; i++) {
      const p = out[i] / Math.max(weight[i], 1e-6);
      cleanGray[i] = p >= threshold ? 0 : 255;
    }
    return {
      grayU8: cleanGray,
      width,
      height,
      tilesTotal,
      tilesSkipped,
      invertedInput,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  return { ensureModel, restoreGray, cancel };
})();
