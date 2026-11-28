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
    endpoint:'M4 18 17 5 M2 16h4v4H2z M15 3h4v4h-4z M16 15h6 M19 12v6',splitLine:'M3 19 9 13 M15 7l6-6 M8 5l11 14 M8 19l11-14',trimLine:'M3 12h6 M15 12h6 M9 8v8 M15 8v8 M10 10l4 4 M14 10l-4 4',trimTo:'M3 12h11 M14 4v16 M17 12h4 M17 9l3 3-3 3',
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
  el('saveProject').lastChild.textContent='この図面を保存';
  el('saveProject').title='下絵と編集内容を保存して、後から作業を再開できます（Ctrl＋S）';
  el('undo').title='直前の図形編集を元に戻す（Ctrl＋Z）。縮尺は左側の「縮尺設定を戻す」を使用';
  el('redo').title='元に戻した図形編集をやり直す（Ctrl＋Y）';
  header.append(actions,el('savedState'));
  const status=make('div','app-status');status.append(make('span','status-caption','状態'),el('status'));status.setAttribute('role','status');
  const workspace=make('main','workspace'),sidebar=make('aside','tool-panel'),stage=make('div','drawing-stage');
  sidebar.setAttribute('aria-label','変換と編集ツール');
  const panelHeading=make('div','panel-heading','作業パネル');sidebar.append(panelHeading);
  const nav=make('nav','tool-nav');nav.setAttribute('aria-label','作業の切替');nav.setAttribute('role','tablist');sidebar.append(nav);
  const groups=new Map();
  const panes=new Map();
  let activePane='input';
  const paneFor=key=>['check','text'].includes(key)?'check':['input','pages','project','measure','output','help'].includes(key)?'input':'edit';
  function switchPane(key,focusTab=false){
    if(!panes.has(key))return;
    const changed=activePane!==key;activePane=key;
    for(const [id,pane] of panes){pane.hidden=id!==key;const b=nav.querySelector('[data-tool-section="'+id+'"]');b.setAttribute('aria-selected',String(id===key));b.setAttribute('aria-current',String(id===key));b.tabIndex=id===key?0:-1;if(focusTab&&id===key)b.focus();}
    if(changed)sidebar.scrollTop=0;
  }
  function compactHelp(box){
    const body=box.querySelector('.tool-body');if(!body)return;
    const notes=[...body.querySelectorAll('p.note:not([id])')];
    if(!notes.length)return;
    let detail=body.querySelector(':scope > .inline-help');if(!detail){detail=make('details','inline-help');detail.append(make('summary','','使い方'));}
    for(const note of notes)detail.append(note);body.append(detail);
  }
  function register(key,box){groups.set(key,box);box.dataset.panelGroup=key;const pane=panes.get(paneFor(key));if(box.parentElement!==pane)pane.append(box);compactHelp(box);refreshPanels(window.draftEditor);}
  function refreshPanels(e){
    const selected=!!e?.selected?.size;
    for(const [key,box] of groups){
      box.hidden=key==='region'||key==='properties'&&!selected||key==='productivity'&&!selected;
    }
    if(e){
      const note=el('repairRiskNote');if(note)note.hidden=!['maximum','custom'].includes(el('repairStrength').value);
    }
  }
  function reveal(key,focusSummary=false){
    if(key==='region')return;
    const box=groups.get(key);if(!box)return;
    switchPane(paneFor(key));refreshPanels(window.draftEditor);if(box.hidden)return;
    box.open=true;
    if(innerWidth<=850)box.scrollIntoView({block:'nearest'});else sidebar.scrollTop=Math.max(0,box.offsetTop-nav.offsetHeight);
    if(focusSummary)box.querySelector('summary').focus({preventScroll:true});
  }
  function group(key,title,nodes){
    const box=make('details','tool-group');box.id='tools-'+key;box.open=['input','edit','check'].includes(key);const summary=make('summary','');summary.append(make('span','section-title',title.replace(/^\d{2}\s+/,'')));box.append(summary);
    const body=make('div','tool-body');nodes.forEach(n=>body.append(n));box.append(body);register(key,box);return body;
  }
  for(const [key,label] of [['input','読込・変換'],['edit','編集'],['check','点検']]){
    const b=make('button','nav-button');b.append(icon(key),make('span','',label));b.type='button';b.id='tab-'+key;b.dataset.toolSection=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','pane-'+key);b.onclick=()=>switchPane(key);nav.append(b);
    const pane=make('div','tool-pane');pane.id='pane-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',b.id);pane.hidden=key!=='input';panes.set(key,pane);sidebar.append(pane);
  }
  nav.addEventListener('keydown',event=>{const keys=[...panes.keys()],i=keys.indexOf(activePane);let next;if(event.key==='ArrowRight')next=(i+1)%keys.length;else if(event.key==='ArrowLeft')next=(i+keys.length-1)%keys.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=keys.length-1;else return;event.preventDefault();switchPane(keys[next],true);});
  switchPane('input');
  const toolbar=id=>el(id).closest('.toolbar');
  group('input','01  図面を開く・変換',[inputSection]);
  const inputAdvanced=make('details','inline-help input-advanced');inputAdvanced.id='inputAdvanced';inputAdvanced.append(make('summary','','読込の詳細設定'));
  for(const id of ['textMode','pdfDpi','pdfInputMode'])inputAdvanced.append(el(id).closest('label'));
  inputSection.append(inputAdvanced);
  const project=make('div','project-open');project.append(el('openProject').closest('label'));
  group('project','作業を再開・バックアップ',[project,el('backupTools')]);
  group('edit','02  選択と線の修正',[el('selectionTools'),toolbar('delete'),el('axisTools'),toolbar('linearize')]);
  el('boxSelection').add(new Option('方向で自動（左→右：内包 / 右→左：交差）','auto'));
  el('selectionTools').querySelector('span').textContent='直線をダブルクリックで延長上の途切れを選択。Altでなぞり追加（Shift併用で解除）。Ctrl＋Shift＋ドラッグで枠除外。重なり順送りはCtrl＋Alt＋クリック。';
  const repair=make('div','toolbar');
  const repairButton=make('button','','途切れを一括修復');repairButton.id='repairLines';repairButton.type='button';repairButton.disabled=true;
  repair.append(repairButton,make('p','note','①範囲を囲む、または直線をダブルクリックで延長上の候補を選択 → ②一括修復。選択した直線のみを接続し、交点付近は残します。破線の範囲は避けてください。設定は「線の修正・保護」。元に戻す1回で取り消せます。'));
  window.DraftRepairPresets={weak:[8,1,2],normal:[20,3,6],strong:[60,12,18],maximum:[200,50,45]};
  const strengthLabel=make('label','','修復の強さ'),strength=document.createElement('select');strength.id='repairStrength';
  for(const [id,label] of [['weak','弱'],['normal','標準'],['strong','強'],['maximum','最強（大きなずれ）'],['custom','カスタム']])strength.add(new Option(label,id));strength.value='normal';strengthLabel.append(strength);repair.prepend(strengthLabel);
  const repairRisk=make('p','risk-note','大きなずれを許容します。別の線の誤統合に注意し、範囲を絞って結果を確認してください。');repairRisk.id='repairRiskNote';repairRisk.hidden=true;repair.append(repairRisk);
  for(const [id,label,value,max] of [['repairGap','一括修復：隙間 px',20,1000],['repairOffset','一括修復：横ずれ px',3,100],['repairAngle','一括修復：角度差 °',6,60]]){const l=make('label','',label),n=document.createElement('input');n.id=id;n.type='number';n.min='0.01';n.max=String(max);n.step='0.1';n.value=String(value);l.append(n);repair.append(l);}
  for(const [id,label,value,max] of [['doubleClickGap','線と線の隙間 px',20,1000],['doubleClickWidth','許容幅（横ずれ）px',3,100],['doubleClickAngle','方向の許容角度 °',6,60]]){const l=make('label','',label),n=document.createElement('input');n.id=id;n.type='number';n.min='0.01';n.max=String(max);n.step='0.1';n.value=String(value);l.append(n);repair.append(l);}
  sidebar.querySelector('#tools-edit .tool-body').append(repair);
  const styleTools=make('div','line-style-tools'),styleLabel=make('label','','線種'),styleSelect=document.createElement('select');styleSelect.id='lineStyle';
  styleTools.setAttribute('role','group');styleTools.setAttribute('aria-label','線種変更');
  styleTools.title='選択した直線・円・円弧・楕円の線種を変更します。新しく描く線にも選んだ線種を使用します。';
  for(const [value,label] of [['solid','実線 · 紫'],['dashed','破線 · 緑'],['dashdot','一点鎖線 · 橙']])styleSelect.add(new Option(label,value));
  styleLabel.append(styleSelect);const applyStyle=make('button','','適用');applyStyle.id='applyLineStyle';applyStyle.type='button';applyStyle.title='選択した線の線種を変更（元に戻すで取り消し）';applyStyle.disabled=true;styleTools.append(styleLabel,applyStyle);
  const styleState=make('span','','');styleState.id='selectedLineStyle';styleState.setAttribute('aria-live','polite');styleTools.append(styleState);
  const connectedButton=make('button','','つながり選択');connectedButton.id='selectConnected';connectedButton.type='button';connectedButton.disabled=true;connectedButton.title='選択した線から端点のつながりをたどります。分岐では停止。図形は変更しません。';el('selectionTools').append(connectedButton);
  const connectLabel=make('label','','つながり選択：隙間 px'),connectGap=document.createElement('input');connectGap.id='connectedGap';connectGap.type='number';connectGap.min='0';connectGap.max='100';connectGap.step='0.1';connectGap.value='3';connectLabel.append(connectGap);repair.append(connectLabel);
  group('region','範囲を再変換・保護',[el('regionTools')]);
  // Retain the internal controls for existing drawing/protection data, not as tools.
  const retiredRegion=sidebar.querySelector('#tools-region');retiredRegion.hidden=true;retiredRegion.inert=true;
  group('partialRepair','部分修復・描き直し',[el('partialRepairTools')]);
  group('check','03  気になる線を点検',[el('gapControls'),el('inspectionAdvanced'),el('inspectionPanel')]);
  group('draw','04  直線・円・円弧を描く',[toolbar('drawLine'),el('drawPrecision'),el('snapTools')]);
  group('arc','円・円弧の数値編集',[el('arcProperties')]);
  group('endpoint','端点を動かす',[toolbar('moveEndpoint')]);
  group('extend','相手まで延長・短縮',[toolbar('extendTo')]);
  group('cut','部分削除',[toolbar('trimLine')]);
  group('measure','05  距離測定・実寸合わせ',[toolbar('measureMode'),toolbar('applyScale')]);
  group('output','06  PDF・DXFの出力設定',[toolbar('dpi')]);
  const help=make('details','tool-group');help.id='tools-help';help.append(make('summary','','使い方・変換情報'));
  const helpBody=make('div','tool-body');
  helpBody.append(make('p','note','ショートカットは上部の「設定」で確認・変更できます。入力欄の編集中はツールを切り替えません。Ctrlを含む保存キーは入力欄からも編集データを保存します。'));
  helpBody.append(make('p','note','右ドラッグ、ホイール押し込み、Shift＋ドラッグ、またはスペース＋ドラッグで一時的に移動。Escは作成途中の点を中止、もう一度で選択モードへ戻ります。修正は即反映され、「元に戻す」で取り消せます。'));
  helpBody.append(make('p','note','選択モードで直線をダブルクリックすると、同じ方向・線種の途切れた直線を両側にたどって選択します。隙間・許容幅・角度差は「設定 → ダブルクリック選択」で変更・自動保存。一括修復の強さとは別の設定です。Ctrl併用で今の選択へ追加します。選択のみで図形は変わりません。確認後に「統合」または「一括修復」を使ってください。'));
  helpBody.append(make('p','note','選択モードでAltを押しながらなぞると線・円弧を追加選択します。マウスを押さなくても使えます。重なった要素はCtrl＋Alt＋クリックで順送り。「延長/短縮」は動かす側の端点、相手の線の順にクリックし、接触位置まで長さを変更します。'));
  for(const text of notes)helpBody.append(make('p','note',text));
  helpBody.append(el('summary').closest('details'),el('log').closest('details'));help.append(helpBody);register('help',help);

  const panelShortcuts=make('div','toolbar panel-shortcuts');
  for(const [key,label] of [['partialRepair','部分修復'],['draw','作図の設定'],['measure','実寸・縮尺'],['output','出力サイズ']]){const b=make('button','',label);b.type='button';b.onclick=()=>reveal(key,true);panelShortcuts.append(b);}
  panes.get('edit').prepend(panelShortcuts);
  // Repeated action sources stay in the DOM for shortcuts, with one visible entry.
  for(const id of ['horizontal','vertical','merge','align','mergeArcs','mergeEllipse','corner','linearize','delete','drawLine','drawCircle','drawArc','moveEndpoint','extendTo','trimLine','measureMode'])el(id).hidden=true;
  const editHelp=make('details','inline-help');editHelp.append(make('summary','','選択・修正の使い方'));
  for(const node of [el('selectionTools').querySelector('span'),el('axisTools').querySelector('span'),toolbar('linearize').querySelector('span')])if(node)editHelp.append(node);
  groups.get('edit').querySelector('.tool-body').append(editHelp);
  for(const id of ['delete','linearize','horizontal'])toolbar(id).hidden=true;
  el('align').hidden=false;el('selectionTools').append(el('align'));
  el('openProject').closest('label').firstChild.textContent='この図面の編集データを開く';

  // Tool shortcuts live beside the drawing; detailed settings stay in the sidebar.
  const toolStrip=make('div','mode-strip');toolStrip.setAttribute('role','toolbar');toolStrip.setAttribute('aria-label','図面の操作');
  const proxies=[];
  const modes=[['select','選択','V'],['drawLine','直線','L'],['drawCircle','円','C'],['drawArc','円弧','A'],['endpoint','端点','E'],['extend','延長/短縮',''],['trimLine','区間削除','T'],['measure','測定','M']];
  for(const [mode,label,key] of modes){
    const b=make('button','mode-button',label);b.type='button';b.id='tool-'+mode;b.dataset.mode=mode;b.title=label+(key?'（'+key+'）':'');if(key)b.setAttribute('aria-keyshortcuts',key);
    b.prepend(icon(mode));
    b.onclick=()=>{const e=window.draftEditor;if(!e||e.busy||!e.doc)return;const source={endpoint:'moveEndpoint',extend:'extendTo',measure:'measureMode'}[mode]||mode;if(el(source))el(source).click();else e.setMode(mode);e.canvas.focus({preventScroll:true});};
    toolStrip.append(b);
  }
  toolStrip.append(styleTools);
  const view=el('mode').closest('.toolbar');view.classList.add('view-toolbar');
  // Keep the full mode selector available for keyboard users and existing integrations.
  el('mode').closest('label').classList.add('mode-picker');
  const fitSelected=make('button','','選択を拡大');fitSelected.id='fitSelected';fitSelected.title='選択した線を画面いっぱいに表示（Shift＋F）';fitSelected.onclick=()=>window.draftEditor?.fitSelection();
  el('fit').after(fitSelected);el('fit').title='図面全体を表示（F）';
  const overlayLabel=make('label',''),overlayCheck=document.createElement('input');overlayCheck.id='overlayBaseline';overlayCheck.type='checkbox';
  overlayCheck.onchange=()=>{if(window.draftEditor){window.draftEditor.overlayBaseline=overlayCheck.checked;window.draftEditor.draw();}};
  overlayLabel.append(overlayCheck,'修正前を重ね表示');
  el('opacity').closest('label').after(overlayLabel);
  el('zoomLevel').title='画面上の表示倍率です。DXFの実寸縮尺や出力サイズは変わりません。';
  el('dpi').closest('label').firstChild.textContent='用紙換算DPI';
  el('dpi').closest('label').title='画像のpxを用紙上のmmへ換算します。PDFの用紙サイズと、実寸未設定時のDXFサイズに使用します。線の精度を上げる設定ではありません。';
  const rotations=make('span','rotation-buttons');rotations.append(el('rotateCCW'),el('rotateCW'));view.append(rotations);
  el('rotateCCW').textContent='左90°';el('rotateCW').textContent='右90°';
  const quick=make('div','quick-actions');quick.setAttribute('role','toolbar');quick.setAttribute('aria-label','選択した線の修正');
  const selectionInfo=make('span','selection-info','線を選ぶと修正できます');selectionInfo.id='selectionInfo';quick.append(selectionInfo);
  for(const [id,label,tip] of [['horizontal','水平','直線の中心と長さを保って水平に。接続先は動かしません'],['vertical','垂直','直線の中心と長さを保って垂直に。接続先は動かしません'],['merge','統合','円弧は両端を結ぶ直線へ変えてから、選択した線を1本に統合。許容ずれは「設定」で変更。一周の円は対象外'],['mergeArcs','円・円弧統合','選択した線と円弧から円周を復元。許容ずれの数値制限は使いません。3/4周以上なら閉じた円に補完'],['mergeEllipse','楕円統合','選択した直線・円弧から1つの楕円を復元。内側の線は含めず、全周に近い輪郭を選択'],['corner','角を作る','残したい側をCtrl＋クリックで2本選択し、交点でつなぐ'],['linearize','直線化','選択した円弧を直線に変更。一周の円は対象外'],['delete','削除','選択した線を削除']]){
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
  for(const box of groups.values())compactHelp(box);
  stage.append(toolStrip,view,quick,previewBar,canvas,instruction,footer);
  workspace.append(sidebar,stage);
  editSection.remove();document.querySelectorAll('body > p.note').forEach(p=>p.remove());document.body.prepend(header,status,workspace);
  window.DraftLayout={
    reveal,
    register,refreshPanels,switchPane,
    updateDrag(e){
      const moving=e.drag?.move?.started;canvas.classList.toggle('is-moving',!!moving);
      if(moving){const mm=DraftWorkflow.scale(e),[dx,dy]=e.drag.move.delta;const snapNote=e.moveSnap?` [${e.moveSnap.kind}]`:'';modeBadge.textContent='線の移動';hint.textContent=`横 ${(dx*mm).toFixed(2)} mm / 縦 ${(-dy*mm).toFixed(2)} mm（${e.calibration?'実寸':'用紙上'}、右・上が正）${snapNote} / Shiftで水平・垂直 / 離すと反映 / Escで中止`;}
    },
    update(e){
      const mode=e.mode;
      for(const [value,label] of modes){const b=el('tool-'+value),active=value===mode;b.disabled=e.busy||!e.doc;b.classList.toggle('active-tool',active);b.setAttribute('aria-pressed',String(active));if(active)modeBadge.textContent=label;}
      for(const id of ['drawLine','drawCircle','drawArc','moveEndpoint','extendTo','trimLine','measureMode']){
        const active=({moveEndpoint:'endpoint',extendTo:'extend',measureMode:'measure'}[id]||id)===mode;
        el(id).classList.toggle('active-tool',active);el(id).setAttribute('aria-pressed',String(active));
      }
      fitSelected.disabled=e.busy||!e.selected.size;
      for(const id of ['zoomIn','zoomOut','fit','showOriginal','opacity','overlayBaseline'])if(el(id))el(id).disabled=!e.doc;
      canvas.dataset.mode=mode;canvas.classList.toggle('is-panning',!!e.drag?.pan||!!e.spacePan);
      const refs=[...e.selected];let lines=0,arcs=0,ellipses=0;
      if(e.doc)for(const ref of refs){const [pi,si]=ref.split(':').map(Number);const s=e.doc.paths[pi]?.segments[si];if(s?.type==='line')lines++;else if(s?.type==='arc')arcs++;else if(s?.type==='ellipse')ellipses++;}
      for(const [b,id,tip] of proxies){
        const needsLines=['horizontal','vertical','corner'].includes(id);
        b.disabled=el(id).disabled||(needsLines&&(arcs>0||ellipses>0));
        const key=window.DraftSettings?.key(id),suffix=key?'（'+key+'）':'';
        b.title=(b.disabled?(e.busy?'現在は編集できません。':ellipses&&id!=='delete'?'選択に楕円が含まれています。':needsLines&&arcs?'直線だけを選択してください。':id==='corner'?'直線を2本選択してください。':id==='mergeArcs'?'円周の線・円弧を2つ以上選択してください。':id==='mergeEllipse'?'輪郭の直線を5本以上、円弧を含むなら3要素以上選択してください。':id==='linearize'?'円弧を選択してください。':'線を選択してください。')+' '+tip:tip)+suffix;
      }
      const cycleNote=e.cyclePick?.total>1?` · 重なり ${e.cyclePick.index}/${e.cyclePick.total}`:'';
      selectionInfo.textContent=refs.length?`${refs.length}個選択 · 直線${lines} / 円弧${arcs}${ellipses?' / 楕円'+ellipses:''}${cycleNote}`:'線を選ぶと修正できます';
      if(mode==='partialRepair')modeBadge.textContent='部分修復';
      const source=mode==='partialRepair'?'partialRepairHint':mode==='endpoint'?'endpointHint':mode==='extend'?'extendHint':mode==='trimLine'?'cutHint':mode.startsWith('draw')?'drawHint':mode==='measure'?'measureResult':null;
      const undoKey=window.DraftSettings?.key('undo');
      hint.textContent=source?el(source).textContent:'Altでなぞり選択 / 選択線をドラッグで吸着移動（Shiftで直交） / Ctrlで追加 / Ctrl＋Altで重なり順送り / '+(undoKey?undoKey+'で元に戻す':'元に戻すボタンで取り消し');
      if(e.altPainting&&mode==='select'){modeBadge.textContent=e.altSubtract?'なぞり解除':'なぞり選択';hint.textContent=e.altSubtract?'Alt＋Shiftを押したまま線をなぞると選択解除 / 離すと終了':'Altを押したまま線をなぞると追加選択 / Shift併用で解除 / 離すと終了';}
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
      refreshPanels(e);
      this.updateDrag(e);
    }
  };
  const observer=new MutationObserver(()=>{if(window.draftEditor)DraftLayout.update(window.draftEditor);});
  for(const id of ['drawHint','endpointHint','extendHint','cutHint','measureResult','regionHint','partialRepairHint','status'])observer.observe(el(id),{childList:true,characterData:true,subtree:true});
})();
