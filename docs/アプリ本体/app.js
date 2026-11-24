const status=document.getElementById('status'),input=document.getElementById('input'),convertButton=document.getElementById('convert'),logBox=document.getElementById('log');
const workerBlobParts=window.workerSource?[window.workerSource]:[
  'const payload=',JSON.stringify({lock:window.workerRuntimeParts.lock,sources:window.workerAppParts.sources,assets:window.workerRuntimeParts.assets}),';\n',
  window.workerRuntimeParts.pyodideAsm,'\n',
  window.workerRuntimeParts.pyodideJs,'\n',
  window.workerAppParts.workerCode
];
const workerUrl=URL.createObjectURL(new Blob(workerBlobParts,{type:'text/javascript'}));
workerBlobParts.length=0; // The Blob owns the bytes; do not retain the large source strings.
let worker=new Worker(workerUrl),recovering=false,conversionToken=0;
window.workerSource=null;window.workerRuntimeParts=null;window.workerAppParts=null;
window.probeState={ready:false,results:[],errors:[]};
const logLines=[];
function appendLog(text){
  const parts=String(text).split('\n');
  for(const line of parts)logLines.push(line);
  if(logLines.length>500)logLines.splice(0,logLines.length-500);
  logBox.textContent=logLines.join('\n')+'\n';
}
const editor=window.draftEditor=new DraftEditor(document.getElementById('preview'),message=>{
  if(!recovering&&message.action!=='historyRestore')DraftHistory.begin(editor,DraftCommandLabel(message));
  editor.lastRequest={...message};
  setBusy(true);
  worker.postMessage(message,message.pixels?[message.pixels]:[]);
});
let pendingProject=null,nextMetadata=null;
const repairFields=['repairGap','repairOffset','repairAngle'];
function syncRepairStrength(){const values=repairFields.map(id=>Number(document.getElementById(id).value));document.getElementById('repairStrength').value=Object.entries(DraftRepairPresets).find(([,preset])=>preset.every((v,i)=>v===values[i]))?.[0]||'custom';}
for(const id of repairFields)for(const event of ['input','change'])document.getElementById(id).addEventListener(event,syncRepairStrength);
document.getElementById('repairStrength').onchange=event=>{if(editor.busy)return;const preset=DraftRepairPresets[event.target.value];if(!preset)return;repairFields.forEach((id,i)=>{const n=document.getElementById(id);n.value=String(preset[i]);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));});syncRepairStrength();};
syncRepairStrength();DraftSettings.ready.then(syncRepairStrength);
document.getElementById('applyLineStyle').onclick=()=>{
  if(editor.busy||!editor.selected.size)return;
  editor.send({kind:'edit',action:'lineStyle',label:'線種変更',refs:[...editor.selected].map(k=>k.split(':').map(Number)),style:document.getElementById('lineStyle').value});
};
document.getElementById('selectConnected').onclick=()=>{
  if(editor.busy||!editor.doc||!editor.selected.size)return;
  try{
    const before=editor.selected.size;
    editor.selected=DraftGeometry.connected(editor,Number(document.getElementById('connectedGap').value));
    editor.anchors.clear();editor.update();editor.draw();
    status.textContent=`つながり選択：${editor.selected.size}要素（${editor.selected.size-before}要素追加）。分岐・曖昧な接続では停止します。`;
  }catch(error){status.textContent=error.message;}
};
document.getElementById('repairLines').onclick=()=>{
  if(editor.busy||!editor.doc)return;
  const refs=[...editor.selected].map(k=>k.split(':').map(Number));
  editor.send({kind:'edit',action:'repairLines',label:'途切れの一括修復',refs,gap:Number(document.getElementById('repairGap').value),offset:Number(document.getElementById('repairOffset').value),angle:Number(document.getElementById('repairAngle').value)});
};
function setBusy(value){input.disabled=value;convertButton.disabled=value;editor.setBusy(value);}
function extractErrorMessage(text){
  const raw=String(text);
  const valueMatches=[...raw.matchAll(/ValueError: ([^\n]+)/g)];
  if(valueMatches.length)return valueMatches.at(-1)[1];
  const pyMatches=[...raw.matchAll(/(?:RuntimeError|TypeError|KeyError|OverflowError|MemoryError|OSError): ([^\n]+)/g)];
  if(pyMatches.length)return pyMatches.at(-1)[1];
  const errMatch=raw.match(/^Error:\s*(.+)$/m);
  return errMatch?errMatch[1]:raw;
}
function fail(text){
  status.textContent='エラー: '+extractErrorMessage(text);
  appendLog(text);
  window.probeState.errors.push(text);
  if(!window.probeState.ready)window.DraftStartup?.fail();
}
function bindWorker(){
  const runtime=worker;
  runtime.onerror=event=>{
    if(runtime!==worker)return;
    event.preventDefault();
    window.DraftRuntime.failed=true;
    DraftHistory.abort(editor);
    editor.comparing=false;editor.pendingMove=null;editor.pendingPreview=null;editor.drag=null;
    if(window.DraftSession){DraftSession.switching=null;DraftSession.pendingWorkspace=null;DraftSession.pending=null;}
    fail(event.message);
    setBusy(true);
    status.textContent+=' 編集データを保存できます。「処理を再起動」で復旧してください。';
  };
  runtime.onmessage=async({data})=>{
    if(runtime!==worker)return;
    if(data.kind==='startup')window.DraftStartup?.stage(data.phase);
    if(data.kind==='log')appendLog(data.text);
    if(data.kind==='progress')status.textContent=data.text;
    if(data.kind==='preview'){DraftWorkflow.showPreview(editor,data.response,data.label);status.textContent='編集を反映しています…';}
    if(data.kind==='error'){
      nextMetadata=null;
      if(window.DraftSession){DraftSession.pending=null;DraftSession.switching=null;DraftSession.pendingWorkspace=null;}
      DraftHistory.abort(editor);
      fail(data.text);
      if(!window.probeState.ready){window.DraftRuntime.failed=true;setBusy(true);}
    }
    if(data.kind==='editError'){
      pendingProject=null;editor.lastRequest=null;editor.pendingRotationMeta=null;editor.pendingMove=null;
      if(window.DraftSession){DraftSession.switching=null;DraftSession.pendingWorkspace=null;}
      DraftHistory.abort(editor);
      fail(data.text);
      setBusy(false);
      editor.draw();
    }
    if(data.kind==='edited'){
      const editLabel=editor.lastRequest?DraftCommandLabel(editor.lastRequest):'編集';
      if(recovering){
        recovering=false;pendingProject=null;editor.revision=data.response.revision;
        window.DraftRuntime.failed=false;window.probeState.ready=true;setBusy(false);
        status.textContent='処理を再起動しました。直前の図面を維持して再開できます。';
        return;
      }
      if(data.restored&&pendingProject){
        const p=pendingProject;pendingProject=null;
        document.getElementById('dpi').value=p.dpi;
        editor.setDocument({...p,paths:data.response.paths},{
          background:p.background,dpi:p.dpi,name:p.name,dirty:false,calibration:p.calibration,
          baselineLabel:p.baselinePaths?(p.baselineLabel||'保存した比較基準'):'編集データの読込時',
          baselinePaths:data.response.baselinePaths,protection:p.protection,
          backgroundTurns:p.backgroundTurns??0,baselineTurns:p.baselinePaths?(p.baselineTurns??0):0
        });
        input.value='';document.getElementById('pageCount').textContent='';
        window.DraftSession?.restored(editor);
      }else{
        editor.acceptEdit(data.response);
      }
      setBusy(false);
      status.textContent=editLabel+'を反映しました。';
    }
    if(data.kind==='ready'){
      await DraftSettings.ready;
      if(runtime!==worker)return;
      if(recovering&&editor.doc){worker.postMessage({kind:'restore',paths:editor.doc.paths});return;}
      recovering=false;window.DraftRuntime.failed=false;window.probeState.ready=true;
      window.DraftStartup?.finish();
      setBusy(false);
      if(!window.probeState.errors.length)status.textContent=editor.doc?'準備完了':'図面を開いてください';
    }
    if(data.kind==='result'&&!recovering){
      const r=data.result;
      const meta=nextMetadata||{name:'test-drawing',dpi:300,dirty:false};nextMetadata=null;
      if(meta.note)r.summary=meta.note+'\n'+r.summary;
      window.probeState.results.push({summary:r.summary,width:r.width,height:r.height,stats:r.stats,input_sha256:r.input_sha256,stages:r.stages,paths:r.paths,trace:r.trace?(r.trace.approximations?r.trace:{angle:r.trace.angle}):undefined});
      if(window.probeState.results.length>2)window.probeState.results.shift();
      document.getElementById('summary').textContent=r.summary;
      if(r.versions)appendLog(JSON.stringify(r.versions,null,2));
      document.getElementById('dpi').value=meta.dpi;
      editor.setDocument(r,{...meta,background:r.trace?.gray_png?'data:image/png;base64,'+r.trace.gray_png:null});
      window.DraftSession?.converted(editor,meta.totalPages||null);
    }
  };
}
window.DraftRuntime={
  failed:false,
  restart(){
    conversionToken++;
    window.cancelPdfRead?.();window.cancelTiffRead?.();
    worker.terminate();
    recovering=!!editor.doc;pendingProject=null;nextMetadata=null;
    if(window.DraftSession){DraftSession.pending=null;DraftSession.switching=null;DraftSession.pendingWorkspace=null;}
    DraftHistory.abort(editor);
    editor.lastRequest=null;editor.comparing=false;editor.pendingRotationMeta=null;editor.pendingMove=null;editor.pendingPreview=null;editor.drag=null;editor.trimDraft=null;editor.stopBrush();
    window.probeState.ready=false;window.probeState.errors=[];
    setBusy(true);
    status.textContent='処理を再起動しています。図面の保存は引き続き使えます。';
    worker=new Worker(workerUrl);bindWorker();
  }
};
bindWorker();
function allowReplace(targetPage=null){
  const currentDirty=!!editor.dirty;
  const targetDirty=!!(targetPage&&targetPage.id!==window.DraftSession?.current&&targetPage.dirty);
  if(!currentDirty&&!targetDirty)return true;
  if(targetDirty){
    const name=targetPage.project?.name||'別ページ';
    return confirm(`「${name}」に未保存の編集データがあります。保存せずに置き換えますか？`);
  }
  return confirm('未保存の編集データがあります。保存せずに現在の作業を置き換えますか？');
}
async function convertSelected(eventOrOptions=null){
  let existingSourceId=null,requestedPage=null,fromInput=false;
  if(typeof eventOrOptions==='string'){existingSourceId=eventOrOptions;}
  else if(eventOrOptions&&typeof eventOrOptions==='object'&&!(eventOrOptions instanceof Event)){
    existingSourceId=eventOrOptions.sourceId||null;
    requestedPage=eventOrOptions.page??null;
    fromInput=!!eventOrOptions.fromInput;
  }
  const currentPage=window.DraftSession?.pages.find(p=>p.id===DraftSession.current);
  const pickedFile=existingSourceId?window.DraftSession?.sources.get(existingSourceId)?.file:input.files[0];
  const file=pickedFile||window.DraftSession?.sources.get(currentPage?.sourceId)?.file;
  if(!existingSourceId&&!input.files[0]&&file)existingSourceId=currentPage?.sourceId||null;
  if(!file||editor.busy)return;
  const isPdf=file.name.toLowerCase().endsWith('.pdf')||file.type==='application/pdf',isTiff=isDraftTiff(file);
  const page=isPdf||isTiff?(requestedPage!=null?requestedPage:fromInput?1:Number(document.getElementById('pdfPage').value)):1;
  const sourceId=existingSourceId&&window.DraftSession?.sources.has(existingSourceId)?existingSourceId:file.name+'|'+file.size+'|'+file.lastModified;
  const collision=window.DraftSession?.pages.find(p=>p.sourceId===sourceId&&p.page===page)||null;
  if(!allowReplace(collision)){
    if(fromInput)input.value='';
    return;
  }
  if(isPdf||isTiff)document.getElementById('pdfPage').value=page;
  const token=++conversionToken;
  setBusy(true);window.probeState.errors=[];window.probeState.ready=false;
  let canvas=null,tracing=null;
  try{
    window.DraftSession?.beforeConvert(file,page,existingSourceId);
    document.getElementById('pdfVectorWarning').textContent='';
    if(isPdf){status.textContent='PDFを読み込んでいます…';canvas=await window.renderLocalPdf(file,page,Number(document.getElementById('pdfDpi').value),{mode:document.getElementById('pdfInputMode').value});}
    else if(isTiff){status.textContent='TIFFを読み込んでいます…';canvas=await renderLocalTiff(file,page,{grayOnly:true});}
    else{
      document.getElementById('pageCount').textContent='';
      const bitmap=await createImageBitmap(file);
      if(bitmap.width>20000||bitmap.height>20000||bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('縦横2万px以下・2400万画素以下でお試しください。');}
      canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();
    }
    if(token!==conversionToken)return;
    tracing=canvas.draftTraceCanvas||canvas;
    const dpi=canvas.draftDpi||(isPdf?300:Number(document.getElementById('dpi').value));
    if(!Number.isFinite(dpi)||dpi<1||dpi>9600)throw Error('出力解像度は1〜9600dpiで指定してください。');
    nextMetadata={name:file.name.replace(/\.[^.]+$/,'')+(isPdf||isTiff?'_p'+page:''),dpi,dirty:true,note:canvas.draftImportNote,totalPages:canvas.draftTotalPages||null};
    status.textContent='変換中…';
    if(canvas.draftPaths){
      const background=canvas.toDataURL('image/png');
      worker.postMessage({kind:'import',paths:canvas.draftPaths,width:canvas.width,height:canvas.height,background,summary:canvas.draftSummary});
      return;
    }
    const channels=tracing.draftGrayPixels?1:4;
    const pixels=tracing.draftGrayPixels||tracing.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.buffer;
    const diagnostics=!!window.probeState.enableDiagnostics;
    worker.postMessage({
      kind:'image',width:canvas.width,height:canvas.height,pixels,channels,dpi,diagnostics,
      noise:Number(document.getElementById('noise').value),
      ...(canvas.draftNativePaths?{nativePaths:canvas.draftNativePaths,background:canvas.toDataURL('image/png')}:{})
    },[pixels]);
  }catch(error){
    if(token!==conversionToken)return;
    nextMetadata=null;
    if(window.DraftSession)DraftSession.pending=null;
    window.probeState.ready=true;
    fail(String(error));
    setBusy(false);
  }finally{
    if(tracing&&tracing!==canvas&&'width' in tracing)tracing.width=tracing.height=0;
    if(canvas&&'width' in canvas&&canvas instanceof HTMLCanvasElement)canvas.width=canvas.height=0;
  }
}
input.onchange=()=>{if(input.files[0])convertSelected({fromInput:true});};
convertButton.onclick=()=>convertSelected();
window.convertDraftSessionSource=(sourceId,page=null)=>convertSelected({sourceId,page});
for(const id of ['delete','merge','mergeArcs','mergeEllipse','align','linearize','corner','horizontal','vertical','rotateCW','rotateCCW','undo','redo'])document.getElementById(id).onclick=()=>editor.edit(id);
document.getElementById('mode').onchange=e=>editor.setMode(e.target.value);
document.getElementById('fit').onclick=()=>editor.fit();document.getElementById('zoomIn').onclick=()=>editor.zoom(1.5);document.getElementById('zoomOut').onclick=()=>editor.zoom(1/1.5);
for(const id of ['showOriginal','opacity'])document.getElementById(id).oninput=()=>editor.draw();
document.getElementById('dpi').oninput=()=>{
  const v=Number(document.getElementById('dpi').value);
  if(Number.isFinite(v)&&v>=1&&v<=9600)editor.dpi=v;
  if(editor.doc){editor.dirty=true;editor.editSeq=(editor.editSeq||0)+1;}
  editor.update();
};
function basename(){return(editor.name||'drawing').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120);}
for(const[id,kind]of[['exportDxf','dxf'],['exportPdf','pdf']])document.getElementById(id).onclick=()=>{
  try{
    if(!editor.doc)return;
    DraftExport.download(DraftExport[kind](editor.doc,Number(document.getElementById('dpi').value),editor.calibration?.mmPerPixel),basename()+'_edited.'+kind);
    status.textContent=kind.toUpperCase()+'のダウンロードを開始しました。作業再開には編集データも保存してください。';
  }catch(error){fail(String(error));}
};
document.getElementById('saveProject').onclick=()=>{
  try{
    const p=editor.project();
    if(!Number.isFinite(p.dpi)||p.dpi<1||p.dpi>9600)throw Error('解像度が不正です。');
    DraftExport.download(new Blob([JSON.stringify(p)],{type:'application/json'}),basename()+'.d2d.json');
    editor.saveRequested=true;editor.dirty=false;editor.update();
    status.textContent='編集データのダウンロードを開始しました。保存先を確認してください。';
  }catch(error){fail(String(error));}
};
function restoreProjectData(p){
  if(p.format!=='draft-to-dxf-project'||p.version!==1)throw Error('対応していない編集データです。');
  p=DraftPaths.project(p);
  p.calibration=DraftMeasure.validate(p.calibration);
  p.protection=DraftWorkflow.validate(p.protection);
  for(const key of ['backgroundTurns','baselineTurns'])if(p[key]!==undefined&&(!Number.isInteger(p[key])||p[key]<0||p[key]>3))throw Error('図面の回転状態が不正です。');
  if(p.baselineLabel!==undefined&&(typeof p.baselineLabel!=='string'||p.baselineLabel.length>100))throw Error('比較基準の名前が不正です。');
  if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>20000||p.height>20000||p.width*p.height>40000000)throw Error('画像寸法が不正です。');
  if(!Number.isFinite(p.dpi)||p.dpi<1||p.dpi>9600)throw Error('解像度が不正です。');
  if(typeof p.name!=='string'||p.name.length>1000)throw Error('図面名が不正です。');
  if(p.background!==null&&p.background!==undefined&&!(typeof p.background==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.background)))throw Error('下絵が不正です。');
  pendingProject=p;
  worker.postMessage({kind:'restore',paths:p.paths,baselinePaths:p.baselinePaths});
}
window.restoreDraftProject=p=>{
  if(editor.busy||!allowReplace())return;
  try{window.DraftSession?.store();}catch(_){}
  setBusy(true);
  try{restoreProjectData(p);}
  catch(error){pendingProject=null;fail(String(error));setBusy(false);}
};
window.openDraftSessionPage=p=>{
  if(editor.busy)return;
  setBusy(true);
  try{restoreProjectData(p);}
  catch(error){
    pendingProject=null;
    if(window.DraftSession){DraftSession.switching=null;DraftSession.pendingWorkspace=null;}
    fail(String(error));setBusy(false);
  }
};
document.getElementById('openProject').onchange=async event=>{
  const file=event.target.files[0];
  if(!file||editor.busy)return;
  if(!allowReplace()){event.target.value='';return;}
  try{window.DraftSession?.store();}catch(_){}
  setBusy(true);
  try{
    if(file.size>80*1024*1024)throw Error('編集データは80MB以下で指定してください。');
    restoreProjectData(JSON.parse(await file.text()));
  }catch(error){pendingProject=null;fail(String(error));setBusy(false);}
  finally{event.target.value='';}
};
DraftBackup.init(editor);
DraftWorkbench.init(editor);
DraftSession.init(editor);
