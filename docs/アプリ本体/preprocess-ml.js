// Offline ONNX Runtime Web (WASM SIMD) inference for CADLineUNet v5-compatible 4/8-head models.
// Lazy-loads preprocess-ml-model.js (~740KB) & shared ORT WASM runtime only when user selects 高精度変換. Zero external requests.
window.DraftPreprocessMl = (() => {
  let modelPromise = null;
  let ortAssetsPromise = null;
  let workerPromise = null;
  let workers = [];
  let workerModel = null;
  let workerCount = 0;
  let poolEpoch = 0;
  let workerUrl = null;
  let reqId = 0;
  let runSeq = 0;
  const pending = new Map();

  const ORT_WORKER_SOURCE = `'use strict';
let session = null, inName = '', outName = '', wasmBytesLocal = null;

const _nativeFetch = self.fetch ? self.fetch.bind(self) : null;
self.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : (input && input.url) || '');
  if (url.endsWith('ort-wasm-simd-threaded.wasm') && wasmBytesLocal) {
    return new Response(wasmBytesLocal, { status: 200, headers: { 'content-type': 'application/wasm' } });
  }
  if (/^(blob:|data:)/.test(url) && _nativeFetch) return _nativeFetch(input, init);
  throw new Error('AI preprocess external request blocked: ' + url);
};

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      const [ortJsBytes, mjsBytes, wasmBytes, onnxBytes] = await Promise.all([
        gunzip(msg.files.ortJs),
        gunzip(msg.files.ortMjs),
        gunzip(msg.files.ortWasm),
        gunzip(msg.files.modelGz)
      ]);
      wasmBytesLocal = wasmBytes;
      const ortUrl = URL.createObjectURL(new Blob([ortJsBytes], { type: 'text/javascript' }));
      try { importScripts(ortUrl); } finally { URL.revokeObjectURL(ortUrl); }
      const mjsUrl = URL.createObjectURL(new Blob([mjsBytes], { type: 'text/javascript' }));
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: 'https://preprocess-local.invalid/ort-wasm-simd-threaded.wasm' };
      session = await ort.InferenceSession.create(onnxBytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      inName = session.inputNames[0];
      outName = session.outputNames[0];
      URL.revokeObjectURL(mjsUrl);
      self.postMessage({ type: 'ready', id: msg.id });
    } else if (msg.type === 'tile') {
      const inp = new Float32Array(msg.patch);
      const tensor = new ort.Tensor('float32', inp, [1, 4, msg.ph, msg.pw]);
      let outMap = null;
      try {
      const runStart = performance.now();
      outMap = await session.run({ [inName]: tensor });
      const runMs = performance.now() - runStart;
      const outTensor = outMap[outName];
      const plane = msg.ph * msg.pw;
      const chOut = (outTensor.dims && outTensor.dims.length >= 2) ? outTensor.dims[1] : 2;
      // ch0 = clean CAD ink probability; in v5 (4-head), ch2 = junction_prob, ch3 = curve_prob
      const inkProb = new Float32Array(plane);
      inkProb.set(outTensor.data.subarray(0, plane));
      if (chOut >= 4) {
        const juncProb = new Float32Array(plane);
        const curveProb = new Float32Array(plane);
        juncProb.set(outTensor.data.subarray(2 * plane, 3 * plane));
        curveProb.set(outTensor.data.subarray(3 * plane, 4 * plane));
        const message = { type: 'done', id: msg.id, probs: inkProb.buffer, junc: juncProb.buffer, curve: curveProb.buffer, runMs };
        const transfer = [inkProb.buffer, juncProb.buffer, curveProb.buffer];
        if (chOut >= 8) {
          const semantic = new Float32Array(4 * plane);
          semantic.set(outTensor.data.subarray(4 * plane, 8 * plane));
          message.semantic = semantic.buffer;
          transfer.push(semantic.buffer);
        }
        self.postMessage(message, transfer);
      } else {
        self.postMessage({ type: 'done', id: msg.id, probs: inkProb.buffer, runMs }, [inkProb.buffer]);
      }
      } finally {
        // ORT owns native WASM resources even when Tensor.data is a JS Float32Array.
        if (outMap) for (const value of new Set(Object.values(outMap))) if (typeof value.dispose === 'function') value.dispose();
        if (typeof tensor.dispose === 'function') tensor.dispose();
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
`;

  function decodeBase64(b64) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

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

  // Exact O(1)-amortized separable 2D sliding-window maximum (BORDER_REPLICATE parity with cv2.dilate).
  function maxFilterEdge(src, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const dqIdx = new Int32Array(Math.max(w, h) + 2 * radius + 4);
    const dqVal = new Float32Array(Math.max(w, h) + 2 * radius + 4);

    for (let y = 0; y < h; y++) {
      const row = y * w;
      let head = 0, tail = 0;
      for (let i = -radius; i < w + radius; i++) {
        const sx = i < 0 ? 0 : (i >= w ? w - 1 : i);
        const v = src[row + sx];
        while (tail > head && dqVal[tail - 1] <= v) tail--;
        dqIdx[tail] = i;
        dqVal[tail] = v;
        tail++;
        const x = i - radius;
        if (x >= 0) {
          const minIdx = x - radius;
          while (dqIdx[head] < minIdx) head++;
          tmp[row + x] = dqVal[head];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      let head = 0, tail = 0;
      for (let i = -radius; i < h + radius; i++) {
        const sy = i < 0 ? 0 : (i >= h ? h - 1 : i);
        const v = tmp[sy * w + x];
        while (tail > head && dqVal[tail - 1] <= v) tail--;
        dqIdx[tail] = i;
        dqVal[tail] = v;
        tail++;
        const y = i - radius;
        if (y >= 0) {
          const minIdx = y - radius;
          while (dqIdx[head] < minIdx) head++;
          out[y * w + x] = dqVal[head];
        }
      }
    }
    return out;
  }

  // Exact bit-parity with tools/ml_preprocess_unet_v4_onnx.py extract_input_features_v4 (planar 4 x H x W).
  function extractFeaturesV4(grayU8, w, h) {
    const n = w * h;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = grayU8[i];
    const m19 = boxMeanEdge(g, w, h, 9);
    const m63 = boxMeanEdge(g, w, h, 31);
    const w15 = maxFilterEdge(g, w, h, 7);
    const feats = new Float32Array(4 * n);
    const inv255 = 1.0 / 255.0, inv85 = 1.0 / 85.0, inv110 = 1.0 / 110.0, inv100 = 1.0 / 100.0;
    const o1 = n, o2 = 2 * n, o3 = 3 * n;
    for (let i = 0; i < n; i++) {
      const gi = g[i];
      feats[i] = (255.0 - gi) * inv255;
      let v1 = (m19[i] - gi) * inv85;
      if (v1 < 0) v1 = 0; else if (v1 > 1) v1 = 1;
      let v2 = (m63[i] - gi) * inv110;
      if (v2 < 0) v2 = 0; else if (v2 > 1) v2 = 1;
      let v3 = (w15[i] - gi) * inv100;
      if (v3 < 0) v3 = 0; else if (v3 > 1) v3 = 1;
      feats[o1 + i] = v1;
      feats[o2 + i] = v2;
      feats[o3 + i] = v3;
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
      s.onload = () => window.DraftPreprocessMlModel ? resolve(window.DraftPreprocessMlModel) : reject(Error('高精度変換モデルを読み込めません。'));
      s.onerror = () => reject(Error('高精度変換モデルの読み込みに失敗しました。'));
      document.head.appendChild(s);
    }).catch(err => { modelPromise = null; throw err; });
    return modelPromise;
  }

  function ensureOrtAssets() {
    if (window.draftOcrAssets) return Promise.resolve(window.draftOcrAssets);
    if (ortAssetsPromise) return ortAssetsPromise;
    ortAssetsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'ocr-assets.js';
      s.onload = () => window.draftOcrAssets ? resolve(window.draftOcrAssets) : reject(Error('ONNXランタイムを読み込めません。'));
      s.onerror = () => reject(Error('ONNXランタイムの読み込みに失敗しました。'));
      document.head.appendChild(s);
    }).catch(err => { ortAssetsPromise = null; throw err; });
    return ortAssetsPromise;
  }

  function callWorker(target, msg, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, { resolve, reject });
      target.postMessage({ ...msg, id }, transfer);
    });
  }

  function resetWorker(reason = null) {
    poolEpoch++;
    for (const target of workers) try { target.terminate(); } catch (_) {}
    workers = [];
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }
    workerPromise = null;
    workerModel = null;
    workerCount = 0;
    if (pending.size) {
      for (const [, entry] of pending) entry.reject(Error(reason || '高精度変換ワーカーを再初期化しました。'));
      pending.clear();
    }
  }

  async function ensureWorker(modelJson, progress, count) {
    if (workerPromise && workerModel === modelJson && workerCount === count) return workerPromise;
    if (workerPromise) resetWorker();
    workerModel = modelJson;
    workerCount = count;
    const epoch = poolEpoch;
    workerPromise = (async () => {
      progress('高精度変換（ONNX WASM SIMD）を準備しています…');
      const rawAssets = await ensureOrtAssets();
      const fileMap = rawAssets?.files || rawAssets;
      const ortJs = decodeBase64(fileMap['ort.wasm.min.js.gz']);
      const ortMjs = decodeBase64(fileMap['ort-wasm-simd-threaded.mjs.gz']);
      const ortWasm = decodeBase64(fileMap['ort-wasm-simd-threaded.wasm.gz']);
      const modelGz = decodeBase64(modelJson.onnx_gz_b64);
      if (epoch !== poolEpoch) throw Error('高精度変換モデルの初期化を中止しました。');

      workerUrl = URL.createObjectURL(new Blob([ORT_WORKER_SOURCE], { type: 'text/javascript' }));
      const created = Array.from({length:count}, () => new Worker(workerUrl));
      workers = created;
      await Promise.all(created.map(target => {
      target.onmessage = (ev) => {
        const msg = ev.data || {};
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.type === 'error') entry.reject(Error(msg.message || '高精度変換ワーカーでエラーが発生しました。'));
        else entry.resolve(msg);
      };
      target.onerror = (err) => {
        if (epoch === poolEpoch) resetWorker(err.message || '高精度変換ワーカーが停止しました。');
      };
      // Independent one-thread SIMD sessions: no SharedArrayBuffer or cross-origin isolation required.
      const files = {ortJs:ortJs.slice().buffer, ortMjs:ortMjs.slice().buffer,
        ortWasm:ortWasm.slice().buffer, modelGz:modelGz.slice().buffer};
      return callWorker(target, {type:'init',files},Object.values(files));
      }));
      return created;
    })().catch(err => {
      if (epoch === poolEpoch) resetWorker();
      throw err;
    });
    return workerPromise;
  }

  function cancel() {
    runSeq++;
  }

  function tileSchedule(width, height, {tile=384,overlap=48,edge_mode='legacy'}={}) {
    if (!Number.isInteger(tile) || tile < 8 || tile > 2048 || !Number.isInteger(overlap) || overlap < 0 || overlap >= tile) throw Error('AIタイルの大きさ・重なりが不正です。');
    if (!['legacy','ragged'].includes(edge_mode)) throw Error('未対応のAIタイル境界方式です。');
    const starts = length => {
      const positions = [0], stride=tile-overlap;
      if (edge_mode === 'ragged') {
        while (positions[positions.length-1]+tile < length) positions.push(positions[positions.length-1]+stride);
      } else {
        for(let p=stride;p<=Math.max(0,length-tile);p+=stride)positions.push(p);
        if(positions[positions.length-1]+tile<length)positions.push(Math.max(0,length-tile));
      }
      return positions;
    };
    const jobs=[];
    for(const y0 of starts(height))for(const x0 of starts(width))jobs.push({y0,x0,th:Math.min(tile,height-y0),tw:Math.min(tile,width-x0)});
    return jobs;
  }

  async function restoreGray(grayU8, width, height, opts = {}) {
    const seq = ++runSeq;
    const t0 = performance.now();
    const progress = opts.progress || (() => {});
    const cancelled = opts.cancelled || (() => false);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width*height>40000000 || grayU8.length!==width*height) throw Error('高精度変換の画像サイズが不正です。');

    progress('高精度変換モデルを読み込んでいます…');
    const modelJson = await ensureModel();
    if (seq !== runSeq || cancelled()) return null;
    const isV5 = modelJson.format === 'draft-to-dxf-cadline-unet-v5-onnx' && modelJson.version === 5;
    const isV4 = modelJson.format === 'draft-to-dxf-cadline-unet-onnx' && modelJson.version === 4;
    if ((!isV5 && !isV4) || !modelJson.onnx_gz_b64) {
      throw Error('未対応の高精度変換モデル形式です。');
    }
    const hasStructHeads = isV5 || (modelJson.channels_out >= 4);
    const hasSemanticHeads = modelJson.channels_out >= 8;
    const meta=modelJson.metadata||{};
    const tile=opts.tile??meta.tile??384,overlap=opts.overlap??meta.overlap??48;
    const edgeMode=opts.edge_mode??(opts.ragged===undefined?null:(opts.ragged?'ragged':'legacy'))??meta.edge_mode??(meta.ragged?'ragged':'legacy');
    const requestedWorkers=opts.workers??meta.workers??1;
    if (![1,2].includes(requestedWorkers)) throw Error('AIワーカー数は1または2で指定してください。');
    const threshold = opts.threshold ?? (modelJson.metadata?.recommended_threshold ?? 0.31);

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

    progress('高精度変換：特徴量を計算しています…');
    const feats = extractFeaturesV4(workGray, width, height);
    if (seq !== runSeq || cancelled()) return null;

    const n = width * height;
    const out = new Float32Array(n);
    const outJunc = hasStructHeads ? new Float32Array(n) : null;
    const outCurve = hasStructHeads ? new Float32Array(n) : null;
    const outSemantic = hasSemanticHeads ? new Float32Array(4*n) : null;
    const weight = new Float32Array(n);

    const queue = [];
    let tilesTotal = 0, tilesSkipped = 0;
    const o1 = n, o3 = 3 * n;

    for (const job of tileSchedule(width,height,{tile,overlap,edge_mode:edgeMode})) {
        const {y0,x0,th,tw}=job;
        tilesTotal++;
        let max0 = 0, max1 = 0, max3 = 0;
        for (let r = 0; r < th; r++) {
          const base = (y0 + r) * width + x0;
          for (let c = 0; c < tw; c++) {
            const idx = base + c;
            const v0 = feats[idx], v1 = feats[o1 + idx], v3 = feats[o3 + idx];
            if (v0 > max0) max0 = v0;
            if (v1 > max1) max1 = v1;
            if (v3 > max3) max3 = v3;
          }
        }
        if (max1 < 0.06 && max3 < 0.06 && max0 < 0.14) {
          tilesSkipped++;
          for (let r = 0; r < th; r++) {
            const rowOut = (y0 + r) * width + x0;
            for (let c = 0; c < tw; c++) weight[rowOut + c] += 1.0;
          }
          continue;
        }
        queue.push({ y0, x0, th, tw });
    }

    const featureMs=performance.now()-t0;
    const initStart=performance.now();
    let pool=[];
    if (queue.length) try { pool=await ensureWorker(modelJson,progress,Math.min(requestedWorkers,queue.length)); }
    catch(err){if(seq!==runSeq||cancelled())return null;throw err;}
    const initMs=performance.now()-initStart,inferenceStart=performance.now();
    let sessionRunMs=0,processedPixels=0;
    const runTile = (target,job) => {
      const {y0,x0,th,tw}=job;
      const ph=((th+7)>>3)<<3,pw=((tw+7)>>3)<<3,plane=ph*pw;
      processedPixels+=plane;
      const patch=new Float32Array(4*plane);
      for(let ch=0;ch<4;ch++)for(let r=0;r<ph;r++){
        const src=ch*n+(y0+Math.min(r,th-1))*width,dst=ch*plane+r*pw;
        for(let c=0;c<pw;c++)patch[dst+c]=feats[src+x0+Math.min(c,tw-1)];
      }
      return callWorker(target,{type:'tile',ph,pw,patch:patch.buffer},[patch.buffer]).then(res=>({job,res,pw,plane}));
    };
    for (let qi = 0; qi < queue.length; qi+=pool.length) {
      if (seq !== runSeq || cancelled()) return null;
      let batch;
      try {batch=await Promise.all(queue.slice(qi,qi+pool.length).map((job,i)=>runTile(pool[i],job)));}
      catch(err){if(seq!==runSeq||cancelled())return null;throw err;}
      // Always accumulate in queue order, not completion order. Pool1 and pool2 stay byte-identical.
      for(const {job,res,pw,plane} of batch){
      const { y0, x0, th, tw } = job;
      if (seq !== runSeq || cancelled()) return null;
      sessionRunMs+=res.runMs||0;
      const probs = new Float32Array(res.probs);
      const juncTile = (outJunc && res.junc) ? new Float32Array(res.junc) : null;
      const curveTile = (outCurve && res.curve) ? new Float32Array(res.curve) : null;
      const semanticTile=(outSemantic&&res.semantic)?new Float32Array(res.semantic):null;
      const wy = new Float32Array(th).fill(1.0);
      const wx = new Float32Array(tw).fill(1.0);
      const m = Math.min(overlap >> 1, th >> 2, tw >> 2);
      if (m > 1) {
        for (let i = 0; i < m; i++) {
          const ramp = 0.15 + 0.85 * (i / (m - 1));
          if (y0 > 0) wy[i] = ramp;
          if (y0 + th < height) wy[th - 1 - i] = ramp;
          if (x0 > 0) wx[i] = ramp;
          if (x0 + tw < width) wx[tw - 1 - i] = ramp;
        }
      }
      for (let r = 0; r < th; r++) {
        const rowOut = (y0 + r) * width + x0, rowP = r * pw, wyr = wy[r];
        for (let c = 0; c < tw; c++) {
          const b = wyr * wx[c];
          const idxO = rowOut + c, idxP = rowP + c;
          out[idxO] += probs[idxP] * b;
          if (juncTile) outJunc[idxO] += juncTile[idxP] * b;
          if (curveTile) outCurve[idxO] += curveTile[idxP] * b;
          if (semanticTile) for(let ch=0;ch<4;ch++)outSemantic[ch*n+idxO]+=semanticTile[ch*plane+idxP]*b;
          weight[idxO] += b;
        }
      }
      }
      const done=Math.min(qi+pool.length,queue.length),pct=Math.round(done/queue.length*100);
      progress(`高精度変換（ONNX）を実行中… ${pct}%（${done}/${queue.length}タイル・空${tilesSkipped}スキップ）`);
    }

    if (seq !== runSeq || cancelled()) return null;
    const cleanGray = new Uint8Array(n);
    const juncU8 = outJunc ? new Uint8Array(n) : null;
    const curveU8 = outCurve ? new Uint8Array(n) : null;
    const semanticU8 = outSemantic ? new Uint8Array(4*n) : null;
    for (let i = 0; i < n; i++) {
      const invW = 1.0 / Math.max(weight[i], 1e-6);
      const p = out[i] * invW;
      cleanGray[i] = p >= threshold ? 0 : 255;
      if (juncU8) juncU8[i] = Math.max(0, Math.min(255, Math.round(outJunc[i] * invW * 255)));
      if (curveU8) curveU8[i] = Math.max(0, Math.min(255, Math.round(outCurve[i] * invW * 255)));
      if (semanticU8) for(let ch=0;ch<4;ch++)semanticU8[ch*n+i]=Math.max(0,Math.min(255,Math.round(outSemantic[ch*n+i]*invW*255)));
    }
    return {
      grayU8: cleanGray,
      juncU8,
      curveU8,
      semanticU8,
      width,
      height,
      tilesTotal,
      tilesSkipped,
      workers:pool.length,
      tile,
      overlap,
      edgeMode,
      processedPixels,
      featureMs:Math.round(featureMs),
      initMs:Math.round(initMs),
      inferenceMs:Math.round(performance.now()-inferenceStart),
      sessionRunMs:Math.round(sessionRunMs),
      invertedInput,
      modelVersion: modelJson.version,
      modelName: meta.model_name || meta.model || (isV5 ? 'CADLineUNet v5.2 (4-head ONNX)' : 'CADLineUNet v4 (ONNX)'),
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  return { ensureModel, restoreGray, cancel, _extractFeaturesV4: extractFeaturesV4, _tileSchedule:tileSchedule };
})();
