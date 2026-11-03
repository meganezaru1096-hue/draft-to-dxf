// Move existing controls, keeping their IDs and event handlers intact.
(() => {
  // Moving into a detached layout temporarily removes controls from getElementById.
  const controls=new Map([...document.querySelectorAll('[id]')].map(n=>[n.id,n]));
  const el=id=>document.getElementById(id)||controls.get(id);
  const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
  const iconPaths={
    brand:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5',
    select:'m5 3 14 10-7 1-3 7z',pan:'M8 11V6a2 2 0 0 1 4 0v5 M12 10V4a2 2 0 0 1 4 0v7 M16 10V7a2 2 0 0 1 4 0v8c0 4-2 6-6 6h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l3 3',
    drawLine:'M5 19 19 5 M3 17h4v4H3z M17 3h4v4h-4z',drawCircle:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M10 12h4 M12 10v4',drawArc:'M4 18a8 12 0 0 1 16 0 M2 16h4v4H2z M18 16h4v4h-4z',
    endpoint:'M4 18 17 5 M2 16h4v4H2z M15 3h4v4h-4z M16 15h6 M19 12v6',splitLine:'M3 19 9 13 M15 7l6-6 M8 5l11 14 M8 19l11-14',trimLine:'M3 12h6 M15 12h6 M9 8v8 M15 8v8 M10 10l4 4 M14 10l-4 4',
    extend:'M3 12h14 M12 7l5 5-5 5 M20 3v18',
    measure:'m3 15 12-12 6 6-12 12z M8 10l3 3 M12 6l3 3 M4 14l3 3',region:'M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6 M8 8h8v8H8z',
    horizontal:'M3 12h18 M3 8v8 M21 8v8',vertical:'M12 3v18 M8 3h8 M8 21h8',merge:'M3 6h6l3 6h9 M3 18h6l3-6',mergeArcs:'M12 3a9 9 0 0 1 9 9 M12 21a9 9 0 0 1-9-9 M8 3h4v4 M12 17v4h4 M9 12h6 M12 9v6',corner:'M5 3v16h16 M9 15h4v4',linearize:'M3 18Q12 0 21 18 M3 18h18',delete:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    undo:'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 6 6v3',redo:'m15 5 5 5-5 5 M20 10H10a6 6 0 0 0-6 6v3',saveProject:'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-7h8v7',
    input:'M3 7h7l2 3h9l-3 10H3z M3 7V4h8l2 3',edit:'m4 17 10-10 3 3L7 20H4z M14 7l3-3 3 3-3 3',draw:'m4 17 10-10 3 3L7 20H4z M14 7l3-3 3 3-3 3',check:'M9 4h6v3H9z M9 5H5v16h14V5h-4 M8 14l3 3 5-6',output:'M12 3v12 M8 11l4 4 4-4 M4 16v5h16v-5',
    exportDxf:'M5 3h9l5 5v13H5z M14 3v6h5 M8 17l3-4 2 2 3-4',exportPdf:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6'
  };
  function icon(key){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('ui-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[key]||iconPaths.select);svg.append(path);return svg;}
  const inputSection=el('input').closest('section'),editSection=el('preview').closest('section');
  const notes=[...document.querySelectorAll('p.note')].map(p=>p.textContent);
  const header=make('header','app-header');
  const brand=make('div','app-brand'),mark=make('span','brand-mark'),brandText=make('div','brand-text'),heading=document.querySelector('h1');
  const caption=make('span','brand-caption','図面トレース・編集');caption.append(make('span','author-signature','Makoto Nagata'));
  heading.textContent='Draft to DXF';mark.append(icon('brand'));brandText.append(heading,caption);brand.append(mark,brandText);
  header.append(brand);
  const actions=make('div','app-actions');
  for(const id of ['undo','redo','saveProject','exportDxf','exportPdf']){el(id).prepend(icon(id));actions.append(el(id));}
  el('saveProject').classList.add('primary-action');
  el('saveProject').title='下絵と編集内容を保存して、後から作業を再開できます（Ctrl＋S）';
  el('undo').title='直前の図形編集を元に戻す（Ctrl＋Z）。縮尺は左側の「縮尺設定を戻す」を使用';
  el('redo').title='元に戻した図形編集をやり直す（Ctrl＋Y）';
  header.append(actions,el('savedState'));
  const status=make('div','app-status');status.append(make('span','status-caption','状態'),el('status'));status.setAttribute('role','status');
  const workspace=make('main','workspace'),sidebar=make('aside','tool-panel'),stage=make('div','drawing-stage');
  sidebar.setAttribute('aria-label','変換と編集ツール');
  const panelHeading=make('div','panel-heading','作業パネル');sidebar.append(panelHeading);
  const nav=make('nav','tool-nav');nav.setAttribute('aria-label','目的別にツールを探す');sidebar.append(nav);
  const groups=new Map();
  let navTarget='input';
  function activeSection(key){for(const b of nav.children)b.setAttribute('aria-current',String(b.dataset.toolSection===key));}
  function reveal(key){const box=groups.get(key);if(!box)return;navTarget=key;box.open=true;if(innerWidth<=850)box.scrollIntoView({block:'start'});else sidebar.scrollTop=Math.max(0,box.offsetTop-nav.offsetHeight);box.querySelector('summary').focus({preventScroll:true});activeSection(key);}
  function group(key,title,nodes){
    const box=make('details','tool-group');box.id='tools-'+key;box.open=true;const summary=make('summary',''),match=title.match(/^(\d{2})\s+(.+)$/);if(match)summary.append(make('span','section-index',match[1]),make('span','section-title',match[2]));else summary.append(make('span','section-title',title));box.append(summary);
    const body=make('div','tool-body');nodes.forEach(n=>body.append(n));box.append(body);sidebar.append(box);groups.set(key,box);return body;
  }
  for(const [key,label] of [['input','開く'],['edit','修正'],['check','点検'],['draw','描く'],['measure','縮尺'],['output','出力']]){
    const b=make('button','nav-button');b.append(icon(key),make('span','',label));b.type='button';b.dataset.toolSection=key;b.onclick=()=>reveal(key);nav.append(b);
  }
  activeSection('input');
  let navFrame=0;sidebar.addEventListener('scroll',()=>{if(navFrame||innerWidth<=850)return;navFrame=requestAnimationFrame(()=>{navFrame=0;const pinned=groups.get(navTarget)?.querySelector('summary').getBoundingClientRect();if(pinned&&pinned.top>=nav.getBoundingClientRect().bottom-2&&pinned.bottom<=sidebar.getBoundingClientRect().bottom){activeSection(navTarget);return;}navTarget=null;let key='input';for(const value of ['input','edit','check','draw','measure','output'])if(groups.get(value).offsetTop<=sidebar.scrollTop+nav.offsetHeight+12)key=value;activeSection(key);});},{passive:true});
  const toolbar=id=>el(id).closest('.toolbar');
  group('input','01  図面を開く・変換',[inputSection]);
  const project=make('div','project-open');project.append(el('openProject').closest('label'));
  group('project','作業を再開・バックアップ',[project,el('backupTools')]);
  group('edit','02  選択と線の修正',[el('selectionTools'),toolbar('delete'),el('axisTools'),toolbar('linearize')]);
  el('selectionTools').querySelector('span').textContent='Altを押してなぞると触れた線を追加選択。重なった線の順送りはCtrl＋Alt＋クリック。';
  group('region','範囲を再変換・保護',[el('regionTools')]);
  group('check','03  気になる線を点検',[el('gapControls'),el('inspectionAdvanced'),el('inspectionPanel')]);
  group('draw','04  直線・円・円弧を描く',[toolbar('drawLine'),el('drawPrecision'),el('snapTools')]);
  group('arc','円・円弧の数値編集',[el('arcProperties')]);
  group('endpoint','端点を動かす',[toolbar('moveEndpoint')]);
  group('extend','相手の線まで延長',[toolbar('extendTo')]);
  group('cut','分割・部分削除',[toolbar('splitLine')]);
  group('measure','05  距離測定・実寸合わせ',[toolbar('measureMode'),toolbar('applyScale')]);
  group('output','06  PDF・DXFの出力設定',[toolbar('dpi')]);
  const help=make('details','tool-group');help.append(make('summary','','操作説明・注意事項'));
  const helpBody=make('div','tool-body');
  helpBody.append(make('p','note','ショートカットは上部の「設定」で確認・変更できます。入力欄の編集中はツールを切り替えません。Ctrlを含む保存キーは入力欄からも編集データを保存します。'));
  helpBody.append(make('p','note','右ドラッグ、ホイール押し込み、Shift＋ドラッグ、またはスペース＋ドラッグで一時的に移動。Escは作成途中の点を中止、もう一度で選択モードへ戻ります。修正は即反映され、「元に戻す」で取り消せます。'));
  helpBody.append(make('p','note','選択モードでAltを押しながらなぞると線・円弧を追加選択します。マウスを押さなくても使えます。重なった要素はCtrl＋Alt＋クリックで順送り。「延長」は伸ばす側の端点、相手の線の順にクリックし、最初の接触位置まで伸ばします。'));
  for(const text of notes)helpBody.append(make('p','note',text));
  helpBody.append(el('summary').closest('details'),el('log').closest('details'));help.append(helpBody);sidebar.append(help);

  // Tool shortcuts live beside the drawing; detailed settings stay in the sidebar.
  const toolStrip=make('div','mode-strip');toolStrip.setAttribute('role','toolbar');toolStrip.setAttribute('aria-label','図面の操作');
  const proxies=[];
  const modes=[['select','選択','V'],['pan','画面移動','H'],['drawLine','直線','L'],['drawCircle','円','C'],['drawArc','円弧','A'],['endpoint','端点','E'],['extend','延長',''],['splitLine','分割','X'],['trimLine','区間削除','T'],['measure','測定','M'],['region','範囲','R']];
  for(const [mode,label,key] of modes){
    const b=make('button','mode-button',label);b.type='button';b.id='tool-'+mode;b.dataset.mode=mode;b.title=label+'（'+key+'）';b.setAttribute('aria-keyshortcuts',key);
    b.prepend(icon(mode));
    b.onclick=()=>{const e=window.draftEditor;if(!e||e.busy||!e.doc)return;const source={endpoint:'moveEndpoint',extend:'extendTo',measure:'measureMode',region:'regionMode'}[mode]||mode;if(el(source))el(source).click();else e.setMode(mode);e.canvas.focus({preventScroll:true});};
    toolStrip.append(b);
  }
  const view=el('mode').closest('.toolbar');view.classList.add('view-toolbar');
  el('mode').querySelector('option[value="pan"]').textContent='画面移動';
  // Keep the full mode selector available for keyboard users and existing integrations.
  el('mode').closest('label').classList.add('mode-picker');
  const fitSelected=make('button','','選択を拡大');fitSelected.id='fitSelected';fitSelected.title='選択した線を画面いっぱいに表示（Shift＋F）';fitSelected.onclick=()=>window.draftEditor?.fitSelection();
  el('fit').after(fitSelected);el('fit').title='図面全体を表示（F）';
  el('zoomLevel').title='画面上の表示倍率です。DXFの実寸縮尺や出力サイズは変わりません。';
  el('dpi').closest('label').firstChild.textContent='用紙換算DPI';
  el('dpi').closest('label').title='画像のpxを用紙上のmmへ換算します。PDFの用紙サイズと、実寸未設定時のDXFサイズに使用します。線の精度を上げる設定ではありません。';
  const rotations=make('span','rotation-buttons');rotations.append(el('rotateCCW'),el('rotateCW'));view.append(rotations);
  el('rotateCCW').textContent='左90°';el('rotateCW').textContent='右90°';
  const quick=make('div','quick-actions');quick.setAttribute('role','toolbar');quick.setAttribute('aria-label','選択した線の修正');
  const selectionInfo=make('span','selection-info','線を選ぶと修正できます');selectionInfo.id='selectionInfo';quick.append(selectionInfo);
  for(const [id,label,tip] of [['horizontal','水平','直線の中心と長さを保って水平に。接続先は動かしません'],['vertical','垂直','直線の中心と長さを保って垂直に。接続先は動かしません'],['merge','統合','選択した直線を1本に統合。許容ずれは「設定」で変更'],['mergeArcs','円・円弧統合','選択した線と円弧から円周を復元。許容ずれの数値制限は使いません。3/4周以上なら閉じた円に補完'],['corner','角を作る','残したい側をCtrl＋クリックで2本選択し、交点でつなぐ'],['linearize','直線化','選択した円弧を直線に変更。一周の円は対象外'],['delete','削除','選択した線を削除']]){
    const b=make('button',id==='delete'?'danger-action':'',label);b.type='button';b.id='quick-'+id;b.title=tip;b.onclick=()=>{el(id).click();window.draftEditor?.canvas.focus({preventScroll:true});};quick.append(b);proxies.push([b,id,tip]);
    b.prepend(icon(id));
  }
  const canvas=el('preview'),instruction=make('div','active-instruction');instruction.id='activeInstruction';instruction.setAttribute('aria-live','polite');
  const modeBadge=make('span','mode-badge');modeBadge.id='activeMode';const hint=make('span','instruction-text');hint.id='instructionText';instruction.append(modeBadge,hint);
  const footer=make('div','drawing-footer');
  const name=make('span','document-name');name.id='documentName';
  const drawingScale=make('button','drawing-scale'),scaleText=make('span','');drawingScale.id='drawingScale';drawingScale.type='button';drawingScale.append(icon('measure'),scaleText);drawingScale.onclick=()=>reveal('measure');
  footer.append(name,el('selection'),el('elementCount'),drawingScale,el('compareBefore'),el('comparisonState'));
  const previewBar=el('previewActions');previewBar.classList.add('preview-actions');
  stage.append(toolStrip,view,quick,previewBar,canvas,instruction,footer);
  workspace.append(sidebar,stage);
  editSection.remove();document.querySelectorAll('body > p.note').forEach(p=>p.remove());document.body.prepend(header,status,workspace);
  window.DraftLayout={
    reveal,
    register(key,box){groups.set(key,box);},
    updateDrag(e){
      const moving=e.drag?.move?.started;canvas.classList.toggle('is-moving',!!moving);
      if(moving){const mm=DraftWorkflow.scale(e),[dx,dy]=e.drag.move.delta;modeBadge.textContent='線の移動';hint.textContent=`横 ${(dx*mm).toFixed(2)} mm / 縦 ${(dy*mm).toFixed(2)} mm（${e.calibration?'実寸':'用紙上'}、右・下が正） / 離すと反映 / Escで中止`;}
    },
    update(e){
      const mode=e.mode;
      for(const [value,label] of modes){const b=el('tool-'+value),active=value===mode;b.disabled=e.busy||!e.doc;b.classList.toggle('active-tool',active);b.setAttribute('aria-pressed',String(active));if(active)modeBadge.textContent=label;}
      for(const id of ['drawLine','drawCircle','drawArc','moveEndpoint','extendTo','splitLine','trimLine','measureMode','regionMode']){
        const active=({moveEndpoint:'endpoint',extendTo:'extend',measureMode:'measure',regionMode:'region'}[id]||id)===mode;
        el(id).classList.toggle('active-tool',active);el(id).setAttribute('aria-pressed',String(active));
      }
      fitSelected.disabled=e.busy||!e.selected.size;
      for(const id of ['zoomIn','zoomOut','fit','showOriginal','opacity'])el(id).disabled=!e.doc;
      canvas.dataset.mode=mode;canvas.classList.toggle('is-panning',!!e.drag?.pan||!!e.spacePan);
      const refs=[...e.selected];let lines=0,arcs=0;
      if(e.doc)for(const ref of refs){const [pi,si]=ref.split(':').map(Number);const s=e.doc.paths[pi]?.segments[si];if(s?.type==='line')lines++;else if(s)arcs++;}
      for(const [b,id,tip] of proxies){
        const needsLines=['horizontal','vertical','merge','corner'].includes(id);
        b.disabled=el(id).disabled||(needsLines&&arcs>0);
        const key=window.DraftSettings?.key(id),suffix=key?'（'+key+'）':'';
        b.title=(b.disabled?(e.busy?'現在は編集できません。':needsLines&&arcs?'直線だけを選択してください。':id==='corner'?'直線を2本選択してください。':id==='mergeArcs'?'円周の線・円弧を2つ以上選択してください。':id==='linearize'?'円弧を選択してください。':'線を選択してください。')+tip:tip)+suffix;
      }
      selectionInfo.textContent=refs.length?`${refs.length}個選択 · 直線${lines} / 円弧${arcs}`:'線を選ぶと修正できます';
      const source=mode==='endpoint'?'endpointHint':mode==='extend'?'extendHint':['splitLine','trimLine'].includes(mode)?'cutHint':mode.startsWith('draw')?'drawHint':mode==='measure'?'measureResult':mode==='region'?'regionHint':null;
      const selectKey=window.DraftSettings?.key('select'),undoKey=window.DraftSettings?.key('undo');
      hint.textContent=source?el(source).textContent:mode==='pan'?'ドラッグで図面を移動 / ホイールで拡大・縮小 / '+(selectKey?selectKey+'で選択へ':'選択ボタンで戻る'):'Altでなぞって追加選択 / 選択した線をドラッグで移動 / Ctrlで追加 / Ctrl＋Altで重なりを順送り / '+(undoKey?undoKey+'で元に戻す':'元に戻すボタンで取り消し');
      if(e.altPainting&&mode==='select'){modeBadge.textContent='なぞり選択';hint.textContent='Altを押したまま線をなぞると追加選択 / 離すと終了 / 線は移動しません';}
      if(e.comparing){modeBadge.textContent='比較';hint.textContent=`${e.baselineLabel}の形状を表示中（閲覧のみ）。下の「編集後に戻る」またはEscで編集を再開。縮尺設定は比較対象外。`;}
      if(e.processing){modeBadge.textContent='処理中';hint.textContent='処理が終わるまでお待ちください。';}
      name.textContent=e.doc?e.name:'図面を開いてください';name.title=name.textContent;
      drawingScale.disabled=!e.doc;
      const dpi=Number(el('dpi').value),cal=e.calibration,validDpi=Number.isFinite(dpi)&&dpi>=1&&dpi<=9600;
      scaleText.textContent=cal?'DXF：実寸設定済み':validDpi?'DXF：用紙寸法':'DXF：DPIを確認';
      drawingScale.dataset.calibrated=String(!!cal);drawingScale.dataset.invalid=String(!cal&&!validDpi);
      drawingScale.title=cal?`DXFは指定した実寸で出力します（1 px = ${cal.mmPerPixel.toPrecision(7)} mm）。クリックして既知寸法で再確認。PDFは用紙換算DPIによる用紙サイズです。`:validDpi?'実寸は未設定です。DXFは用紙上のmmで出力します。クリックして既知寸法から実寸を合わせられます。':'用紙換算DPIを1〜9600の数値で指定してください。';
      el('savedState').classList.toggle('is-dirty',!!e.dirty);
      el('savedState').title=e.dirty?'作業に未保存の変更があります。編集データを保存してください。':e.saveRequested?'保存操作を行いました。ブラウザからファイルの保存完了は確認できないため、ダウンロード先を確認してください。':'図面の読込後に変更はありません。';
      quick.classList.toggle('has-selection',refs.length>0);
      status.dataset.state=e.processing?'busy':el('status').textContent.startsWith('エラー')?'error':'ready';
      stage.setAttribute('aria-busy',String(!!e.processing));
      this.updateDrag(e);
    }
  };
  const observer=new MutationObserver(()=>{if(window.draftEditor)DraftLayout.update(window.draftEditor);});
  for(const id of ['drawHint','endpointHint','extendHint','cutHint','measureResult','regionHint','status'])observer.observe(el(id),{childList:true,characterData:true,subtree:true});
})();
