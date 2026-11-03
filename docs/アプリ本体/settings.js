// User preferences stay separate from drawing data and export scale.
(() => {
  const $=id=>document.getElementById(id);
  const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const actions=[
    ['select','選択','V','tool-select'],['pan','画面移動','H','tool-pan'],
    ['drawLine','直線を描く','L','tool-drawLine'],['drawCircle','円を描く','C','tool-drawCircle'],['drawArc','円弧を描く','A','tool-drawArc'],
    ['endpoint','端点を動かす','E','tool-endpoint'],['splitLine','線を分割','X','tool-splitLine'],['trimLine','区間削除','T','tool-trimLine'],
    ['extend','相手の線まで延長','','tool-extend'],
    ['copySelected','選択を複写','','copySelected'],['offsetSelected','オフセット複写','','offsetSelected'],['trimTo','相手まで切り詰め','','trimTo'],
    ['measure','測定','M','tool-measure'],['region','範囲を指定','R','tool-region'],
    ['fit','全体表示','F','fit'],['fitSelected','選択を拡大','Shift+F','fitSelected'],
    ['saveProject','編集データ保存','Ctrl+S','saveProject'],['undo','元に戻す','Ctrl+Z','undo'],['redo','やり直す','Ctrl+Y','redo'],
    ['selectAll','対象を全選択','Ctrl+A','selectAll'],['delete','選択を削除','Delete','quick-delete'],
    ['horizontal','水平にする','','quick-horizontal'],['vertical','垂直にする','','quick-vertical'],
    ['merge','直線を統合','','quick-merge'],['align','同一直線に整列','','align'],['mergeArcs','円・円弧統合','','quick-mergeArcs'],
    ['corner','角を作る','','quick-corner'],['linearize','円弧を直線化','','quick-linearize'],
    ['rotateCCW','図面を左90°','','rotateCCW'],['rotateCW','図面を右90°','','rotateCW'],
    ['exportDxf','DXF保存','','exportDxf'],['exportPdf','PDF保存','','exportPdf']
  ];
  const sections=[
    ['editing','線の修正・保護',['tolerance','autoProtect','showProtection']],
    ['measurement','縮尺設定',['calibrationMethod']],
    ['snapping','吸着',['drawSnap','endpointSnap','cutSnap','measureSnap','snapMidpoint','snapCenter']],
    ['inspection','点検の判定基準',['shortThreshold','gapThreshold','overlapTolerance','isolationDistance','inspectGaps','inspectJunctions','inspectContinuity','inspectOverlap','inspectIsolated']]
  ];
  const controls=sections.flatMap(s=>s[2]);
  // Keep operation parameters and drawing dimensions separate from preferences.
  const savedControls=new Set([...controls,'noise','regionNoise','pdfDpi','pdfInputMode','showOriginal','opacity','drawAxis','boxSelection']);
  const defaults=Object.fromEntries([...savedControls].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
  const defaultKeys=Object.fromEntries(actions.map(([id,,key])=>[id,key]));
  const storageKey='draft-to-dxf-settings-v1';let keys={...defaultKeys},values={...defaults},storageError='',restoredRecord=null,savedAt=0,revision=0,applying=false;
  const validKey=key=>typeof key==='string'&&(key===''||/^(Ctrl\+)?(Shift\+)?([A-Z0-9]|Delete|F[2-4]|F[6-9]|F10)$/.test(key))&&!/^Ctrl\+(Shift\+)?([WTNRLOPQ]|F4|F6)$/.test(key)&&key!=='Ctrl+Shift+Delete';
  function completeKeys(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const next={};for(const [id] of actions){const value=['extend','copySelected','offsetSelected','trimTo'].includes(id)&&!Object.hasOwn(raw,id)?'':raw[id];if(!validKey(value))return null;next[id]=value;}const bound=Object.values(next).filter(Boolean);return new Set(bound).size===bound.length?next:null;}
  function validValue(id,value){const n=$(id);if(!n)return false;if(n.tagName==='SELECT')return typeof value==='string'&&[...n.options].some(o=>o.value===value);return n.type==='checkbox'?typeof value==='boolean':typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&(!n.min||Number(value)>=Number(n.min))&&(!n.max||Number(value)<=Number(n.max));}
  const isRecord=data=>data?.version===1&&data.values&&typeof data.values==='object'&&!Array.isArray(data.values);
  const timestamp=data=>Number.isSafeInteger(data?.savedAt)&&data.savedAt>=0?Math.min(data.savedAt,Date.now()+86400000):0;
  let legacyPdfDpi=null;
  try{legacyPdfDpi=localStorage.getItem('draft-to-dxf-pdf-dpi-v1');}catch(_){}
  try{const data=JSON.parse(localStorage.getItem(storageKey)||'null');if(data!==null&&!isRecord(data))throw Error('Invalid preferences');if(data)restoredRecord=data;}catch(_){storageError='保存した設定を確認しています…';}
  function applyRecord(data,notify=false){
    savedAt=timestamp(data);keys=completeKeys(data?.keys)||{...defaultKeys};values={...defaults};
    for(const id of savedControls){const value=data?.values?.[id]??(id==='pdfDpi'?legacyPdfDpi:undefined);if(validValue(id,value))values[id]=value;}
    applying=true;try{for(const id of savedControls){const n=$(id);if(n.type==='checkbox')n.checked=values[id];else n.value=values[id];if(notify)n.dispatchEvent(new Event('change',{bubbles:true}));}}finally{applying=false;}
  }
  applyRecord(restoredRecord);
  const dialog=make('dialog','settings-dialog');dialog.id='settingsDialog';dialog.setAttribute('aria-labelledby','settingsTitle');
  const header=make('div','settings-header'),title=make('h2','','設定');title.id='settingsTitle';
  const close=make('button','','閉じる');close.id='closeSettings';close.type='button';header.append(title,close);
  const note=make('p','settings-intro','変更は自動保存され、同じ起動ファイル・ブラウザで次回も引き継ぎます。図面や出力データは変更しません。');
  const message=make('p','settings-message',storageError||'設定は自動保存されます。');message.id='settingsMessage';message.setAttribute('role','status');
  const tabs=make('div','settings-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','設定の種類');
  const panels=make('div','settings-panels'),panelMap=new Map(),tabMap=new Map();
  function showTab(id){for(const [key,p] of panelMap){p.hidden=key!==id;const t=tabMap.get(key);t.setAttribute('aria-selected',String(key===id));t.tabIndex=key===id?0:-1;}}
  for(const [id,label] of [['shortcuts','ショートカット'],...sections.map(([id,label])=>[id,label])]){
    const tab=make('button','',label);tab.id='settings-tab-'+id;tab.type='button';tab.setAttribute('role','tab');tab.setAttribute('aria-controls','settings-panel-'+id);tab.onclick=()=>showTab(id);
    tab.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const ids=[...tabMap.keys()],i=ids.indexOf(id),next=e.key==='Home'?0:e.key==='End'?ids.length-1:(i+(e.key==='ArrowRight'?1:-1)+ids.length)%ids.length;showTab(ids[next]);tabMap.get(ids[next]).focus();};
    const panel=make('div','settings-panel');panel.id='settings-panel-'+id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);tabs.append(tab);panels.append(panel);panelMap.set(id,panel);tabMap.set(id,tab);
  }
  let messageVersion=0,writeQueue=Promise.resolve();
  function report(text,error=false){messageVersion++;message.textContent=text;message.classList.toggle('is-error',error);}
  const snapshot=()=>({version:1,savedAt,keys:{...keys},values:{...values}});
  // A second browser store recovers preferences when localStorage is unavailable.
  // This database is intentionally separate from drawing recovery and its cleanup.
  const database=new Promise(resolve=>{
    let done=false;const finish=db=>{if(done){db?.close();return;}done=true;clearTimeout(timer);resolve(db);},timer=setTimeout(()=>finish(null),2000);
    try{const request=indexedDB.open('draft-to-dxf-preferences-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('preferences');request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();finish(db);};request.onerror=request.onblocked=()=>finish(null);}catch(_){finish(null);}
  });
  function transact(db,record){return new Promise(resolve=>{
    let tx,done=false;const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve(result);},timer=setTimeout(()=>{try{tx?.abort();}catch(_){}finish(record?false:null);},2000);
    try{tx=db.transaction('preferences',record?'readwrite':'readonly');const store=tx.objectStore('preferences');let result=null;const request=record?store.put(record,'current'):store.get('current');request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>finish(record?true:result);tx.onerror=tx.onabort=()=>finish(record?false:null);}catch(_){finish(record?false:null);}
  });}
  const ready=database.then(async db=>{
    if(!db)return;
    const mirror=await transact(db);
    // Never let a slow startup read replace changes already made in this window.
    if(revision)return;
    if(isRecord(mirror)&&(!restoredRecord||timestamp(mirror)>timestamp(restoredRecord))){restoredRecord=mirror;applyRecord(mirror,true);refresh();try{localStorage.setItem(storageKey,JSON.stringify(snapshot()));}catch(_){}report('保存した設定を引き継ぎました。');}
    else if(storageError)report('保存した設定を読み込めませんでした。設定を変更すると自動保存します。',true);
    if(restoredRecord)await transact(db,snapshot());
  }).catch(()=>{}).finally(()=>{if(storageError&&message.textContent===storageError)report('設定を読み込めませんでした。設定を変更すると自動保存します。',true);});
  function persist(){
    const currentRevision=++revision;savedAt=Math.max(Date.now(),savedAt+1);const record=snapshot();let localSaved=false;
    try{localStorage.setItem(storageKey,JSON.stringify(record));localSaved=true;}catch(_){}
    report(localSaved?'変更を保存しました。':'設定を保存しています…');const reportVersion=messageVersion;
    writeQueue=writeQueue.then(async()=>{await ready;const db=await database;const mirrored=db?await transact(db,record):false;if(currentRevision===revision&&messageVersion===reportVersion){if(localSaved||mirrored)report('変更を保存しました。');else report('設定を自動保存できません。この画面内では有効です。「設定をファイル保存」で保管してください。',true);}return localSaved||mirrored;});
  }
  function watchPreference(control,n=$(control)){
    const label=n.closest('label');
    const changed=event=>{if(applying)return;const value=n.type==='checkbox'?n.checked:n.value;if(!validValue(control,value)){if(event.type==='change'){if(n.type==='checkbox')n.checked=values[control];else n.value=values[control];report('値が範囲外です。「'+(label?.textContent.trim()||control)+'」の最小値・最大値を確認してください。',true);}return;}if(values[control]===value)return;values[control]=value;persist();};
    // Save valid numeric input immediately, even if the window closes before blur.
    n.addEventListener('input',changed);n.addEventListener('change',changed);
  }
  const keyInputs=new Map(),originalTitles=new Map();
  for(const [,label,,target] of actions){const n=$(target);if(n)originalTitles.set(target,n.title.replace(/（[^（）]*）/g,'')||label);}
  function refresh(){
    for(const [id,label,,target] of actions){const key=keys[id],n=$(target),input=keyInputs.get(id);if(input)input.value=key||'未割り当て';if(n){n.title=(originalTitles.get(target)||label)+(key?'（'+key+'）':'');if(key)n.setAttribute('aria-keyshortcuts',key);else n.removeAttribute('aria-keyshortcuts');}}
    const e=window.draftEditor;if(e){DraftLayout.update(e);e.draw();}
  }
  function assign(id,key){
    if(!validKey(key)){report('英数字・Delete・F2〜F4・F6〜F10と、Ctrl／Shiftを使用できます。ブラウザ予約キー・Esc・Spaceは変更できません。',true);return false;}
    const conflict=key&&actions.find(([other])=>other!==id&&keys[other]===key);
    if(conflict){report('「'+key+'」は「'+conflict[1]+'」に割り当て済みです。先にその割り当てを解除してください。',true);return false;}
    keys[id]=key;persist();refresh();return true;
  }
  function combo(e){if(e.altKey)return null;const key=e.key.length===1?e.key.toUpperCase():e.key;return (e.ctrlKey||e.metaKey?'Ctrl+':'')+(e.shiftKey?'Shift+':'')+key;}
  const shortcutPanel=panelMap.get('shortcuts');
  shortcutPanel.append(make('p','note','キー欄を選び、使いたいキーを押してください。Ctrl・Shiftの組み合わせも使用できます。「解除」で未割り当てに戻せます。Esc（中止）とSpace（画面移動）は固定です。'));
  for(const [id,label] of actions){
    const row=make('div','shortcut-row'),labelNode=make('label','',label),input=make('input','shortcut-input');input.id='shortcut-'+id;input.type='text';input.readOnly=true;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-describedby','settingsMessage');labelNode.htmlFor=input.id;
    input.onkeydown=e=>{if(e.key==='Tab'||e.key==='Escape')return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat||e.isComposing||['Control','Shift','Alt','Meta'].includes(e.key))return;assign(id,combo(e));};
    const clear=make('button','','解除');clear.type='button';clear.id='clear-shortcut-'+id;clear.setAttribute('aria-label',label+'の割り当てを解除');clear.onclick=()=>assign(id,'');row.append(labelNode,input,clear);shortcutPanel.append(row);keyInputs.set(id,input);
  }
  const resetKeys=make('button','settings-reset','ショートカットを標準に戻す');resetKeys.id='resetShortcuts';resetKeys.onclick=()=>{keys={...defaultKeys};persist();refresh();};shortcutPanel.append(resetKeys);
  for(const [id,,ids] of sections){const panel=panelMap.get(id);for(const control of ids){const n=$(control),label=n.closest('label');label.classList.add('settings-field');panel.append(label);
    watchPreference(control,n);
  }const reset=make('button','settings-reset','この項目を標準に戻す');reset.id='reset-settings-'+id;reset.onclick=()=>{for(const control of ids){const n=$(control);if(n.disabled)continue;if(n.type==='checkbox')n.checked=defaults[control];else n.value=defaults[control];n.dispatchEvent(new Event('change',{bubbles:true}));}};panel.append(reset);}
  panelMap.get('editing').append(make('p','note','直線の許容ずれは統合・整列に使用します。単位pxは元画像上の距離です。円・円弧統合は許容ずれの数値制限を使用しません。保護枠が非表示でも保護は有効です。'));
  panelMap.get('snapping').append(make('p','note','描画・端点移動・分割・測定の各操作に適用します。中点と円の中心は描画・端点移動で使用します。'));
  panelMap.get('measurement').append(make('p','note','実寸合わせを「2点を指定」または「選択した直線」から選びます。直線方式は1本選択し、その実際の長さをmmで入力します。設定方式は保存されますが、図面の実寸倍率は適用ボタンを押すまで変わりません。円弧は対象外です。'));
  panelMap.get('inspection').append(make('p','note','変更後は作業画面の「確認候補を検出」で再検出してください。基準の単位は元画像上のpxです。'));
  const transfer=make('div','settings-transfer'),saveSettings=make('button','','設定をファイル保存'),loadSettings=make('button','','設定ファイルを読込'),settingsFile=make('input','');saveSettings.id='exportSettings';loadSettings.id='importSettings';settingsFile.id='settingsFile';settingsFile.type='file';settingsFile.accept='.json,application/json';settingsFile.hidden=true;transfer.append(saveSettings,loadSettings,settingsFile);
  saveSettings.onclick=()=>{try{DraftExport.download(new Blob([JSON.stringify({format:'draft-to-dxf-settings',version:1,keys,values},null,2)],{type:'application/json'}),'Draft-to-DXF.settings.json');report('設定ファイルの保存を開始しました。別のPCでも「設定ファイルを読込」で再利用できます。');}catch(_){report('設定ファイルを保存できませんでした。',true);}};
  loadSettings.onclick=()=>settingsFile.click();settingsFile.onchange=async()=>{const file=settingsFile.files[0];if(!file)return;try{
    if(window.draftEditor?.busy)throw Error('処理が終わってから設定を読み込んでください。');
    if(file.size>100000)throw Error('設定ファイルは100KB以下で指定してください。');const data=JSON.parse(await file.text());
    const importedKeys=completeKeys(data?.keys),importedValues={...data?.values};
    if(!Object.hasOwn(importedValues,'calibrationMethod'))importedValues.calibrationMethod=defaults.calibrationMethod;
    for(const id of savedControls)if(!controls.includes(id)&&!Object.hasOwn(importedValues,id))importedValues[id]=values[id];
    if(data?.format!=='draft-to-dxf-settings'||data.version!==1||!data.values||![...savedControls].every(id=>validValue(id,importedValues[id]))||!importedKeys)throw Error('対応していない、不正な値またはキー重複を含む設定ファイルです。');
    // Validate the whole file before changing any preference.
    keys=importedKeys;values=Object.fromEntries([...savedControls].map(id=>[id,importedValues[id]]));
    applying=true;try{for(const id of savedControls){const n=$(id);if(n.type==='checkbox')n.checked=values[id];else n.value=values[id];n.dispatchEvent(new Event('change',{bubbles:true}));}}finally{applying=false;}persist();refresh();
  }catch(error){report(error.message||'設定ファイルを読み込めませんでした。',true);}finally{settingsFile.value='';}};
  dialog.append(header,note,transfer,tabs,message,panels);document.body.append(dialog);showTab('shortcuts');
  const open=make('button','','設定');open.id='openSettings';open.type='button';open.title='ショートカット・許容ずれ・吸着・点検の設定';document.querySelector('.app-actions').append(open);
  open.onclick=async()=>{await ready;const e=window.draftEditor;if(e?.drag||e?.pendingMove)return;if(e){e.spacePan=false;e.stopBrush();e.canvas.classList.remove('is-panning');}dialog.showModal();close.focus();};
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>open.focus({preventScroll:true}));
  for(const [group,tab,label] of [['edit','editing','許容ずれ・保護の設定'],['region','editing','自動保護・保護枠の設定'],['draw','snapping','吸着の設定'],['check','inspection','点検条件の設定'],['measure','measurement','実寸合わせの方式を変更']]){
    const row=make('div','toolbar settings-link'),button=make('button','',label);button.type='button';button.onclick=()=>window.DraftSettings.open(tab);row.append(button);$('tools-'+group).querySelector('.tool-body').append(row);
  }
  // Remove the now-empty settings wrapper, not the surrounding drawing actions.
  $('snapTools').remove();
  window.DraftSettings={
    ready,whenSaved:()=>writeQueue,
    update(e){for(const id of controls)$(id).disabled=e.busy;},
    get isOpen(){return dialog.open;},key:id=>keys[id]||'',
    is:(event,id)=>!event.isComposing&&combo(event)===keys[id]&&!!keys[id],
    action(event){if(event.isComposing||event.altKey)return null;const key=combo(event),found=actions.find(([id])=>keys[id]&&keys[id]===key);if(found)return found[0];if(key==='Ctrl+Shift+Z'&&keys.undo==='Ctrl+Z'&&keys.redo==='Ctrl+Y')return 'redo';return null;},
    run(id,e){if(e.busy&&!['saveProject','exportDxf','exportPdf'].includes(id)||!e.doc)return;if(id==='selectAll'&&e.mode!=='select')e.setMode('select');const target=actions.find(a=>a[0]===id)?.[3],n=$(target);if(n&&!n.disabled)n.click();},
    open(tab){showTab(tab||'shortcuts');open.click();}
  };
  for(const id of savedControls)if(!controls.includes(id))watchPreference(id);
  refresh();
})();
