// Interactive human-in-the-loop ML line-bridge (V5 56-feat 5-expert / V4 / V3)
// + co-circular broken-arc proposals. Never auto-applies without user approval.
window.DraftBridgeProposals = (() => {
  const V3_LOG_INDICES = [0, 1, 4, 5, 7, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 36, 37];
  const V4_LOG_INDICES = [...V3_LOG_INDICES, 42, 43, 44];
  const V5_LOG_INDICES = [...V4_LOG_INDICES, 53, 54];
  const PRESETS = {
    strict: { threshold: 0.95, label: '厳格 (0.95・要確認)' },
    balanced: { threshold: 0.90, label: '標準 (0.90)' },
    broad: { threshold: 0.82, label: '広め (0.82・要確認)' }
  };

  let modelPromise = null;

  function ensureModel() {
    if (window.DraftBridgeMlModel) return Promise.resolve(window.DraftBridgeMlModel);
    if (modelPromise) return modelPromise;
    const src = window.draftBridgeMlModelSrc || document.querySelector('meta[name="draft-bridge-ml-model"]')?.content || 'bridge-ml-model.js';
    modelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => window.DraftBridgeMlModel ? resolve(window.DraftBridgeMlModel) : reject(Error('線切れMLモデルを読み込めません。'));
      s.onerror = () => reject(Error('線切れMLモデルの読み込みに失敗しました。'));
      document.head.appendChild(s);
    }).catch(err => { modelPromise = null; throw err; });
    return modelPromise;
  }

  function predictCommittee(model, rows) {
    const version = model.version;
    if (model.format !== 'draft-to-dxf-experimental-bridge-committee' || ![3, 4, 5].includes(version)) {
      throw Error('未対応のMLモデル形式です。');
    }
    const nFeat = version === 5 ? 56 : (version === 4 ? 48 : 39);
    const expectedLog = version === 5 ? V5_LOG_INDICES : (version === 4 ? V4_LOG_INDICES : V3_LOG_INDICES);
    const kinds = version === 5
      ? ['raw56', 'log56', 'sqrt56', 'raw56_fp', 'log56_fp']
      : (version === 4 ? ['raw48', 'log48', 'sqrt48'] : ['raw21', 'raw39', 'log39']);
    const nExp = kinds.length;
    const hidden = version === 5
      ? (model.hidden_sizes || [48, 24])
      : (version === 4 ? (model.hidden_sizes || [40, 20]) : [32, 16]);
    if (
      model.input_clip !== 12 ||
      model.activation !== 'relu' ||
      model.periodic_guard !== null ||
      JSON.stringify(model.log_indices) !== JSON.stringify(expectedLog) ||
      model.features?.length !== nFeat
    ) throw Error('未対応のMLモデル形式です。');
    if (
      model.experts?.length !== nExp ||
      model.weights?.length !== nExp ||
      model.weights.some(v => !Number.isFinite(v) || v < 0) ||
      Math.abs(model.weights.reduce((a, b) => a + b, 0) - 1) > 1e-6
    ) throw Error('MLモデル設定が不正です。');
    for (let e = 0; e < nExp; e++) {
      const m = model.experts[e], n = (version === 3 && e === 0) ? 21 : nFeat, sizes = [n, hidden[0], hidden[1], 1];
      if (m.kind !== kinds[e] || m.mean?.length !== n || m.scale?.length !== n || m.mean.some(v => !Number.isFinite(v)) || m.scale.some(v => !Number.isFinite(v) || v <= 0)) {
        throw Error('MLエキスパート定義が不正です。');
      }
      for (let l = 0; l < 3; l++) {
        if (m.weights[l]?.length !== sizes[l] || m.weights[l].some(r => r.length !== sizes[l + 1] || r.some(v => !Number.isFinite(v))) || m.biases[l]?.length !== sizes[l + 1] || m.biases[l].some(v => !Number.isFinite(v))) {
          throw Error('ML重み配列が不正です。');
        }
      }
    }
    return rows.map(row => {
      const featRow = row.length >= nFeat ? row.slice(0, nFeat) : row;
      if (featRow.length !== nFeat || featRow.some(v => !Number.isFinite(v))) throw Error('特徴量入力が不正です。');
      let score = 0;
      for (let e = 0; e < nExp; e++) {
        if (model.weights[e] === 0) continue;
        const m = model.experts[e];
        const input = (version === 3 && e === 0) ? featRow.slice(0, 21) : featRow.slice();
        if (m.kind === 'log39' || m.kind === 'log48' || m.kind === 'log56' || m.kind === 'log56_fp') {
          for (const idx of expectedLog) input[idx] = Math.log1p(Math.max(0, input[idx]));
        } else if (m.kind === 'sqrt48' || m.kind === 'sqrt56') {
          for (const idx of expectedLog) input[idx] = Math.sqrt(Math.max(0, input[idx]));
        }
        let values = input.map((v, i) => Math.max(-12, Math.min(12, (v - m.mean[i]) / m.scale[i])));
        for (let l = 0; l < 3; l++) {
          const next = m.biases[l].slice();
          for (let i = 0; i < values.length; i++) {
            const vi = values[i], wRow = m.weights[l][i];
            for (let j = 0; j < next.length; j++) next[j] += vi * wRow[j];
          }
          values = l < 2 ? next.map(v => Math.max(0, v)) : next;
        }
        score += model.weights[e] / (1 + Math.exp(-Math.max(-50, Math.min(50, values[0]))));
      }
      return score;
    });
  }

  function chooseBridges(candidates, scores, threshold, requireInk, arcCandidates = []) {
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const used = new Set();
    const chosen = [];
    for (const [score, i] of order) {
      if (score < threshold) break;
      const c = candidates[i];
      const inkMean = c.features[8];
      const centralEmpty = c.features[38];
      if (requireInk && inkMean < 0.05 && centralEmpty >= 0.85) continue;
      const keyA = c.a.join(':'), keyB = c.b.join(':');
      if (used.has(keyA) || used.has(keyB)) continue;
      used.add(keyA);
      used.add(keyB);
      chosen.push({
        id: chosen.length,
        kind: 'line',
        candidateIndex: i,
        p: c.p,
        q: c.q,
        line_style: c.line_style || 'solid',
        score,
        gap_px: c.features[0],
        angle_deg: c.features[2],
        ink_mean: inkMean,
        central_empty: centralEmpty,
        accepted: true
      });
    }
    // Also select co-circular broken-arc gap proposals using same preset threshold
    const arcOrder = (arcCandidates || []).slice().sort((a, b) => b.score - a.score);
    const arcThr = Math.max(0.80, threshold - 0.04);
    for (const ac of arcOrder) {
      if (ac.score < arcThr) break;
      if (requireInk && ac.ink_mean < 0.05 && ac.central_empty >= 0.85) continue;
      const keyA = 'A:' + ac.a.join(':'), keyB = 'A:' + ac.b.join(':');
      if (used.has(keyA) || used.has(keyB)) continue;
      used.add(keyA);
      used.add(keyB);
      chosen.push({
        id: chosen.length,
        kind: 'arc',
        p: ac.p,
        q: ac.q,
        center: ac.center,
        radius: ac.radius,
        start_deg: ac.start_deg,
        extent_deg: ac.extent_deg,
        line_style: ac.line_style || 'solid',
        score: ac.score,
        gap_px: ac.gap_px,
        angle_deg: 0,
        ink_mean: ac.ink_mean,
        central_empty: ac.central_empty,
        accepted: true
      });
    }
    return chosen;
  }

  function distToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function distToArcProposal(pt, item) {
    const cx = item.center[0], cy = item.center[1], r = item.radius;
    const a0 = item.start_deg * Math.PI / 180;
    const ext = item.extent_deg * Math.PI / 180;
    let best = Math.min(Math.hypot(pt[0] - item.p[0], pt[1] - item.p[1]), Math.hypot(pt[0] - item.q[0], pt[1] - item.q[1]));
    const steps = 12;
    for (let k = 1; k < steps; k++) {
      const a = a0 + ext * (k / steps);
      const d = Math.hypot(pt[0] - (cx + r * Math.cos(a)), pt[1] - (cy + r * Math.sin(a)));
      if (d < best) best = d;
    }
    return best;
  }

  function strokeProposal(c, item) {
    c.beginPath();
    if (item.kind === 'arc') {
      const a0 = item.start_deg * Math.PI / 180;
      const a1 = (item.start_deg + item.extent_deg) * Math.PI / 180;
      c.arc(item.center[0], item.center[1], item.radius, a0, a1, item.extent_deg < 0);
    } else {
      c.moveTo(item.p[0], item.p[1]);
      c.lineTo(item.q[0], item.q[1]);
    }
    c.stroke();
  }

  return {
    state: null,
    pendingId: 0,
    predictCommittee,
    chooseBridges,

    init(e) {
      const style = document.createElement('style');
      style.textContent = [
        '#mlBridgePanel{display:grid;gap:6px;padding:10px;border:1px solid #c9d8d3;border-radius:8px;background:#f7fbfa;margin-top:8px}',
        '#mlBridgePanel .ml-bridge-title{font-weight:600;font-size:13px;color:#1c473c;margin:0}',
        '#mlBridgePanel .ml-bridge-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
        '#mlBridgePanel .ml-bridge-check{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:1.4;cursor:pointer}',
        '#mlBridgePanel .ml-bridge-check input{margin-top:2px;flex:0 0 auto}',
        '#mlBridgePanel .ml-bridge-summary{font-size:12px;color:#39524c;margin:0;line-height:1.45}'
      ].join('');
      document.head.append(style);

      const make = (tag, id, text) => {
        const n = document.createElement(tag);
        if (id) n.id = id;
        if (text) n.textContent = text;
        return n;
      };

      const panel = make('div', 'mlBridgePanel');
      const title = make('p', null, 'AI線切れ候補（直線＋円弧・確認承認）');
      title.className = 'ml-bridge-title';

      const topRow = make('div'); topRow.className = 'ml-bridge-row';
      const scanBtn = make('button', 'scanBridgeProposals', '線切れ候補を提案（ML）');
      scanBtn.type = 'button';
      scanBtn.onclick = () => this.scan(e);

      const presetLabel = make('label', null, '基準');
      const preset = make('select', 'bridgePreset');
      for (const [val, info] of Object.entries(PRESETS)) preset.add(new Option(info.label, val));
      preset.value = 'balanced';
      preset.onchange = () => this.refilter(e);
      presetLabel.append(preset);
      topRow.append(scanBtn, presetLabel);

      const inkLabel = make('label', null, '下絵に線跡がある候補のみ（空白の切り欠き誤接続を防止）');
      inkLabel.className = 'ml-bridge-check';
      const inkCheck = make('input', 'bridgeRequireInk');
      inkCheck.type = 'checkbox';
      inkCheck.checked = true;
      inkCheck.onchange = () => this.refilter(e);
      inkLabel.prepend(inkCheck);

      const summary = make('p', 'bridgeSummary', '候補は未検出です。スコアは正解確率ではありません。緑の線/円弧を確認して採用してください。');
      summary.className = 'ml-bridge-summary';

      const navRow = make('div'); navRow.className = 'ml-bridge-row';
      const prevBtn = make('button', 'prevBridgeProposal', '前の候補'); prevBtn.type = 'button'; prevBtn.onclick = () => this.stepFocus(e, -1);
      const nextBtn = make('button', 'nextBridgeProposal', '次の候補'); nextBtn.type = 'button'; nextBtn.onclick = () => this.stepFocus(e, 1);
      const allBtn = make('button', 'acceptAllBridges', '全採用'); allBtn.type = 'button'; allBtn.onclick = () => this.setAll(e, true);
      const noneBtn = make('button', 'rejectAllBridges', '全除外'); noneBtn.type = 'button'; noneBtn.onclick = () => this.setAll(e, false);
      navRow.append(prevBtn, nextBtn, allBtn, noneBtn);

      const actRow = make('div'); actRow.className = 'ml-bridge-row';
      const applyBtn = make('button', 'applyBridgeProposals', '採用候補を反映'); applyBtn.type = 'button'; applyBtn.onclick = () => this.apply(e);
      const clearBtn = make('button', 'clearBridgeProposals', '候補を閉じる'); clearBtn.type = 'button'; clearBtn.onclick = () => { this.reset(e); e.update(); e.draw(); };
      actRow.append(applyBtn, clearBtn);

      panel.append(title, topRow, inkLabel, summary, navRow, actRow);
      const editBody = document.querySelector('#tools-edit .tool-body');
      if (editBody) editBody.append(panel);
      this.update(e);
    },

    active() {
      return !!(this.state && this.state.items.length);
    },

    reset(e, message = null) {
      this.pendingId++;
      this.state = null;
      const summary = document.getElementById('bridgeSummary');
      if (summary) {
        summary.textContent = message || '候補は未検出です。全自動変更せず、緑の線/円弧をクリックで確認・切替できます。';
      }
      if (e) this.update(e);
    },

    async scan(e) {
      if (e.busy || !e.doc || !e.background) return;
      const requestId = ++this.pendingId;
      const revision = e.revision;
      const doc = e.doc;
      e.setBusy(true);
      const status = document.getElementById('status');
      if (status) status.textContent = 'MLモデルと線切れ候補を準備しています…';
      try {
        const model = await ensureModel();
        if (requestId !== this.pendingId || e.doc !== doc || e.revision !== revision) return;
        const canvas = document.createElement('canvas');
        canvas.width = doc.width;
        canvas.height = doc.height;
        let pixels;
        try {
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          DraftRotation.drawBackground(e, ctx);
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer;
        } finally {
          canvas.width = canvas.height = 0;
        }
        if (status) status.textContent = 'ML線切れ候補（直線＋円弧）を解析しています…';
        window.requestDraftBridgeProposals({
          requestId,
          width: doc.width,
          height: doc.height,
          pixels,
          model
        });
      } catch (error) {
        if (requestId === this.pendingId) {
          e.setBusy(false);
          if (status) status.textContent = 'エラー: ' + error.message;
        }
      }
    },

    receive(e, data, model) {
      if (data.requestId !== this.pendingId) return;
      e.setBusy(false);
      const status = document.getElementById('status');
      if (data.error) {
        if (status) status.textContent = 'エラー: ' + data.error;
        this.update(e);
        return;
      }
      const candidates = data.candidates || [];
      const arcCandidates = data.arc_candidates || [];
      const scores = candidates.length ? predictCommittee(model, candidates.map(c => c.features)) : [];
      this.state = {
        revision: e.revision,
        candidates,
        arcCandidates,
        scores,
        truncated: !!data.truncated,
        items: [],
        focus: -1
      };
      this.refilter(e);
      if (status) {
        status.textContent = this.state.items.length
          ? `ML線切れ候補を ${this.state.items.length}件 検出しました。確認後に反映してください。`
          : '条件を満たすML線切れ候補はありませんでした。';
      }
    },

    refilter(e) {
      if (!this.state) return;
      const presetKey = document.getElementById('bridgePreset')?.value || 'balanced';
      const threshold = (PRESETS[presetKey] || PRESETS.balanced).threshold;
      const requireInk = !!document.getElementById('bridgeRequireInk')?.checked;
      this.state.items = chooseBridges(this.state.candidates, this.state.scores, threshold, requireInk, this.state.arcCandidates);
      this.state.focus = this.state.items.length ? 0 : -1;
      this.update(e);
      e.draw();
    },

    setAll(e, accepted) {
      if (!this.state) return;
      for (const item of this.state.items) item.accepted = accepted;
      this.update(e);
      e.draw();
    },

    stepFocus(e, delta) {
      if (!this.state || !this.state.items.length) return;
      const n = this.state.items.length;
      this.state.focus = ((this.state.focus < 0 ? 0 : this.state.focus) + delta + n) % n;
      const item = this.state.items[this.state.focus];
      const cx = (item.p[0] + item.q[0]) / 2, cy = (item.p[1] + item.q[1]) / 2;
      const span = Math.max(60, item.gap_px * 6);
      const scale = Math.max(e.view.scale, Math.min(8, Math.min(e.canvas.width, e.canvas.height) / (span * 2.5)));
      e.view.scale = scale;
      e.view.x = e.canvas.width / 2 - cx * scale;
      e.view.y = e.canvas.height / 2 - cy * scale;
      this.update(e);
      e.draw();
    },

    pick(e, worldPt) {
      if (!this.state || !this.state.items.length || e.comparing) return false;
      const tol = 10 / Math.max(0.05, e.view.scale);
      let best = -1, bestDist = tol;
      for (let i = 0; i < this.state.items.length; i++) {
        const item = this.state.items[i];
        const d = item.kind === 'arc' ? distToArcProposal(worldPt, item) : distToSegment(worldPt, item.p, item.q);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best < 0) return false;
      this.state.items[best].accepted = !this.state.items[best].accepted;
      this.state.focus = best;
      this.update(e);
      e.draw();
      return true;
    },

    apply(e) {
      if (e.busy || !e.doc || !this.state) return;
      const accepted = this.state.items.filter(item => item.accepted);
      if (!accepted.length) return;
      const added = accepted.map(item => ({
        segments: [
          item.kind === 'arc'
            ? { type: 'arc', center: item.center.slice(), radius: item.radius, start_deg: item.start_deg, extent_deg: item.extent_deg }
            : { type: 'line', p0: item.p.slice(), p1: item.q.slice() }
        ],
        closed: false,
        line_style: item.line_style || 'solid'
      }));
      const nextPaths = [...e.doc.paths, ...added];
      this.state = null;
      e.send({
        kind: 'edit',
        action: 'replacePaths',
        paths: nextPaths,
        label: `ML線切れ候補を反映（${accepted.length}件）`,
        selectAdded: true
      });
    },

    update(e) {
      const scanBtn = document.getElementById('scanBridgeProposals');
      if (!scanBtn) return;
      const hasDoc = !!e.doc && !!e.background;
      const items = this.state?.items || [];
      const acceptedCount = items.filter(it => it.accepted).length;
      const arcCount = items.filter(it => it.kind === 'arc').length;
      scanBtn.disabled = e.busy || !hasDoc;
      document.getElementById('bridgePreset').disabled = e.busy;
      document.getElementById('bridgeRequireInk').disabled = e.busy;
      for (const id of ['prevBridgeProposal', 'nextBridgeProposal', 'acceptAllBridges', 'rejectAllBridges']) {
        document.getElementById(id).disabled = e.busy || !items.length;
      }
      const applyBtn = document.getElementById('applyBridgeProposals');
      applyBtn.disabled = e.busy || !acceptedCount;
      applyBtn.textContent = acceptedCount ? `採用候補を反映（${acceptedCount}件）` : '採用候補を反映';
      document.getElementById('clearBridgeProposals').disabled = e.busy || !this.state;

      const summary = document.getElementById('bridgeSummary');
      if (this.state) {
        const focused = this.state.focus >= 0 && items[this.state.focus];
        const kindTag = focused ? (focused.kind === 'arc' ? '円弧' : '直線') : '';
        const focusInfo = focused
          ? ` ／ 注目 #${this.state.focus + 1}[${kindTag}]: スコア ${(focused.score * 100).toFixed(1)}%・隙間 ${focused.gap_px.toFixed(1)}px・${focused.ink_mean >= 0.05 || focused.central_empty < 0.85 ? '線跡あり' : '空白'}・${focused.accepted ? '採用' : '除外'}`
          : '';
        const arcSuffix = arcCount ? `（うち円弧 ${arcCount}件）` : '';
        summary.textContent = items.length
          ? `提案 ${items.length}件${arcSuffix}（採用 ${acceptedCount} / 除外 ${items.length - acceptedCount}）。緑をクリックで切替${this.state.truncated ? '（上限4000候補まで解析）' : ''}${focusInfo}`
          : `基準を満たす候補なし（直線${this.state.candidates.length}＋円弧${(this.state.arcCandidates || []).length}ペア解析済）。基準を「広め」にすると増えます。`;
      }
    },

    draw(e, c) {
      if (!this.state || !this.state.items.length || e.comparing) return;
      const s = e.view.scale;
      c.save();
      for (let i = 0; i < this.state.items.length; i++) {
        const item = this.state.items[i];
        const focused = i === this.state.focus;
        if (focused) {
          c.strokeStyle = 'rgba(245,158,11,0.55)';
          c.lineWidth = 8 / s;
          c.setLineDash([]);
          strokeProposal(c, item);
        }
        c.strokeStyle = item.accepted ? (item.kind === 'arc' ? '#0d9488' : '#16a34a') : '#94a3b8';
        c.lineWidth = (item.accepted ? 3.2 : 1.8) / s;
        c.setLineDash(item.accepted ? [6 / s, 3 / s] : [2 / s, 4 / s]);
        strokeProposal(c, item);
        c.setLineDash([]);
        c.fillStyle = item.accepted ? (item.kind === 'arc' ? '#0f766e' : '#15803d') : '#64748b';
        for (const pt of [item.p, item.q]) {
          c.beginPath();
          c.arc(pt[0], pt[1], (item.accepted ? 3.0 : 2.0) / s, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }
  };
})();
