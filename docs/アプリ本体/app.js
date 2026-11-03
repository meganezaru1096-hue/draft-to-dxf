const status=document.getElementById('status'),input=document.getElementById('input'),convertButton=document.getElementById('convert'),logBox=document.getElementById('log');
const workerUrl=URL.createObjectURL(new Blob([window.workerSource],{type:'text/javascript'}));
let worker=new Worker(workerUrl),recovering=false,conversionToken=0;
window.workerSource=null;
window.probeState={ready:false,results:[],errors:[]};
const editor=window.draftEditor=new DraftEditor(document.getElementById('preview'),message=>{if(!recovering&&message.action!=='historyRestore')DraftHistory.begin(editor,DraftCommandLabel(message));editor.lastRequest={...message};setBusy(true);worker.postMessage(message,message.pixels?[message.pixels]:[]);});
let pendingProject=null,nextMetadata=null;
function setBusy(value){input.disabled=value;convertButton.disabled=value;editor.setBusy(value);}
function fail(text){const matches=[...String(text).matchAll(/ValueError: ([^\n]+)/g)];status.textContent='エラー: '+(matches.length?matches.at(-1)[1]:text);logBox.textContent+='\n'+text;window.probeState.errors.push(text);}
function bindWorker(){const runtime=worker;
runtime.onerror=event=>{if(runtime!==worker)return;event.preventDefault();window.DraftRuntime.failed=true;DraftHistory.abort(editor);editor.comparing=false;editor.pendingMove=null;editor.pendingPreview=null;editor.drag=null;fail(event.message);setBusy(true);status.textContent+=' 編集データを保存できます。「処理を再起動」で復旧してください。';};
runtime.onmessage=async({data})=>{
  if(runtime!==worker)return;
  if(data.kind==='log')logBox.textContent+=data.text+'\n';
  if(data.kind==='progress')status.textContent=data.text;
  if(data.kind==='preview'){DraftWorkflow.showPreview(editor,data.response,data.label);status.textContent='編集を反映しています…';}
  if(data.kind==='error'){nextMetadata=null;DraftHistory.abort(editor);fail(data.text);if(!window.probeState.ready){window.DraftRuntime.failed=true;setBusy(true);}}
    if(data.kind==='editError'){pendingProject=null;editor.lastRequest=null;editor.pendingRotationMeta=null;editor.pendingMove=null;DraftHistory.abort(editor);fail(data.text);setBusy(false);editor.draw();}
  if(data.kind==='edited'){
    const editLabel=editor.lastRequest?DraftCommandLabel(editor.lastRequest):'編集';
    if(recovering){recovering=false;pendingProject=null;editor.revision=data.response.revision;window.DraftRuntime.failed=false;window.probeState.ready=true;setBusy(false);status.textContent='処理を再起動しました。直前の図面を維持して再開できます。';return;}
    if(data.restored&&pendingProject){
      const p=pendingProject;pendingProject=null;document.getElementById('dpi').value=p.dpi;
      editor.setDocument({...p,paths:data.response.paths},{background:p.background,dpi:p.dpi,name:p.name,dirty:false,calibration:p.calibration,baselineLabel:p.baselinePaths?(p.baselineLabel||'保存した比較基準'):'編集データの読込時',baselinePaths:data.response.baselinePaths,protection:p.protection,backgroundTurns:p.backgroundTurns??0,baselineTurns:p.baselinePaths?(p.baselineTurns??0):0});
      input.value='';document.getElementById('pageCount').textContent='';
      window.DraftSession?.restored(editor);
    }
    else editor.acceptEdit(data.response);
    setBusy(false);status.textContent=editLabel+'を反映しました。';
  }
  if(data.kind==='ready'){await DraftSettings.ready;if(runtime!==worker)return;if(recovering&&editor.doc){worker.postMessage({kind:'restore',paths:editor.doc.paths});return;}recovering=false;window.DraftRuntime.failed=false;window.probeState.ready=true;setBusy(false);if(!window.probeState.errors.length)status.textContent=editor.doc?'準備完了':'図面を開いてください';}
  if(data.kind==='result'&&!recovering){
    const r=data.result;window.probeState.results.push(r);if(window.probeState.results.length>2)window.probeState.results.shift();document.getElementById('summary').textContent=r.summary;
    if(r.versions)logBox.textContent+=JSON.stringify(r.versions,null,2)+'\n';
    const meta=nextMetadata||{name:'test-drawing',dpi:300,dirty:false};nextMetadata=null;document.getElementById('dpi').value=meta.dpi;
    if(meta.note){r.summary=meta.note+'\n'+r.summary;document.getElementById('summary').textContent=r.summary;}
    editor.setDocument(r,{...meta,background:r.trace?.gray_png?'data:image/png;base64,'+r.trace.gray_png:null});
    window.DraftSession?.converted(editor);
  }
};
}
window.DraftRuntime={failed:false,
  restart(){conversionToken++;window.cancelPdfRead?.();window.cancelTiffRead?.();worker.terminate();recovering=!!editor.doc;pendingProject=null;nextMetadata=null;if(window.DraftSession)DraftSession.pending=null;DraftHistory.abort(editor);editor.lastRequest=null;editor.comparing=false;editor.pendingRotationMeta=null;editor.pendingMove=null;editor.pendingPreview=null;editor.drag=null;editor.trimDraft=null;editor.stopBrush();window.probeState.ready=false;window.probeState.errors=[];setBusy(true);status.textContent='処理を再起動しています。図面の保存は引き続き使えます。';worker=new Worker(workerUrl);bindWorker();}
};
bindWorker();
function allowReplace(){return !editor.dirty||confirm('未保存の編集データがあります。保存せずに現在の作業を置き換えますか？');}
async function convertSelected(eventOrSource=null){
  let existingSourceId=typeof eventOrSource==='string'?eventOrSource:null;
  const currentPage=window.DraftSession?.pages.find(p=>p.id===DraftSession.current);
  const file=input.files[0]||window.DraftSession?.sources.get(currentPage?.sourceId)?.file;
  if(!input.files[0]&&file)existingSourceId=currentPage.sourceId;
  if(!file||editor.busy)return;if(!allowReplace())return;
  const token=++conversionToken;
  setBusy(true);window.probeState.errors=[];window.probeState.ready=false;
  try{
    window.DraftSession?.beforeConvert(file,Number(document.getElementById('pdfPage').value),existingSourceId);
    let canvas;const isPdf=file.name.toLowerCase().endsWith('.pdf')||file.type==='application/pdf',isTiff=isDraftTiff(file),page=Number(document.getElementById('pdfPage').value);
    document.getElementById('pdfVectorWarning').textContent='';
    if(isPdf){status.textContent='PDFを読み込んでいます…';canvas=await window.renderLocalPdf(file,page,Number(document.getElementById('pdfDpi').value),{mode:document.getElementById('pdfInputMode').value});}
    else if(isTiff){status.textContent='TIFFを読み込んでいます…';canvas=await renderLocalTiff(file,page);}
    else{document.getElementById('pageCount').textContent='';const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000){bitmap.close();throw Error('2400万画素以下でお試しください。');}canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();}
    if(token!==conversionToken)return;
    const channels=canvas.draftGrayPixels?1:4,pixels=canvas.draftGrayPixels||canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.buffer,dpi=canvas.draftDpi||(isPdf?300:Number(document.getElementById('dpi').value));
    if(!Number.isFinite(dpi)||dpi<1||dpi>9600)throw Error('出力解像度は1〜9600dpiで指定してください。');
    nextMetadata={name:file.name.replace(/\.[^.]+$/,'')+(isPdf||isTiff?'_p'+page:''),dpi,dirty:true,note:canvas.draftImportNote};status.textContent='変換中…';
    if(canvas.draftPaths){worker.postMessage({kind:'import',paths:canvas.draftPaths,width:canvas.width,height:canvas.height,background:canvas.toDataURL('image/png'),summary:canvas.draftSummary});return;}
    worker.postMessage({kind:'image',width:canvas.width,height:canvas.height,pixels,channels,noise:Number(document.getElementById('noise').value)},[pixels]);
    canvas.width=canvas.height=0;
  }catch(error){if(token!==conversionToken)return;nextMetadata=null;if(window.DraftSession)DraftSession.pending=null;window.probeState.ready=true;fail(String(error));setBusy(false);}
}
input.onchange=event=>{document.getElementById('pdfPage').value=1;convertSelected(event);};convertButton.onclick=convertSelected;
window.convertDraftSessionSource=sourceId=>convertSelected(sourceId);
for(const id of ['delete','merge','mergeArcs','align','linearize','corner','horizontal','vertical','rotateCW','rotateCCW','undo','redo'])document.getElementById(id).onclick=()=>editor.edit(id);
document.getElementById('mode').onchange=e=>editor.setMode(e.target.value);
document.getElementById('fit').onclick=()=>editor.fit();document.getElementById('zoomIn').onclick=()=>editor.zoom(1.5);document.getElementById('zoomOut').onclick=()=>editor.zoom(1/1.5);
for(const id of ['showOriginal','opacity'])document.getElementById(id).oninput=()=>editor.draw();
document.getElementById('dpi').oninput=()=>{if(editor.doc)editor.dirty=true;editor.update();};
function basename(){return(editor.name||'drawing').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120);}
for(const[id,kind]of[['exportDxf','dxf'],['exportPdf','pdf']])document.getElementById(id).onclick=()=>{try{if(!editor.doc)return;DraftExport.download(DraftExport[kind](editor.doc,Number(document.getElementById('dpi').value),editor.calibration?.mmPerPixel),basename()+'_edited.'+kind);status.textContent=kind.toUpperCase()+'のダウンロードを開始しました。作業再開には編集データも保存してください。';}catch(error){fail(String(error));}};
document.getElementById('saveProject').onclick=()=>{try{const p=editor.project();if(!Number.isFinite(p.dpi)||p.dpi<1||p.dpi>9600)throw Error('解像度が不正です。');DraftExport.download(new Blob([JSON.stringify(p)],{type:'application/json'}),basename()+'.d2d.json');editor.saveRequested=true;editor.dirty=false;editor.update();status.textContent='編集データのダウンロードを開始しました。保存先を確認してください。';}catch(error){fail(String(error));}};
function restoreProjectData(p){
    if(p.format!=='draft-to-dxf-project'||p.version!==1)throw Error('対応していない編集データです。');
    p=DraftPaths.project(p);
    p.calibration=DraftMeasure.validate(p.calibration);
    p.protection=DraftWorkflow.validate(p.protection);
    for(const key of ['backgroundTurns','baselineTurns'])if(p[key]!==undefined&&(!Number.isInteger(p[key])||p[key]<0||p[key]>3))throw Error('図面の回転状態が不正です。');
    if(p.baselineLabel!==undefined&&(typeof p.baselineLabel!=='string'||p.baselineLabel.length>100))throw Error('比較基準の名前が不正です。');
    if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>20000||p.height>20000||p.width*p.height>40000000)throw Error('画像寸法が不正です。');
    if(!Number.isFinite(p.dpi)||p.dpi<1||p.dpi>9600)throw Error('解像度が不正です。');if(typeof p.name!=='string'||p.name.length>1000)throw Error('図面名が不正です。');
    if(p.background!==null&&p.background!==undefined&&!(typeof p.background==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.background)))throw Error('下絵が不正です。');
    pendingProject=p;worker.postMessage({kind:'restore',paths:p.paths,baselinePaths:p.baselinePaths});
}
window.restoreDraftProject=p=>{if(editor.busy||!allowReplace())return;setBusy(true);try{restoreProjectData(p);}catch(error){pendingProject=null;fail(String(error));setBusy(false);}};
window.openDraftSessionPage=p=>{if(editor.busy)return;setBusy(true);try{restoreProjectData(p);}catch(error){pendingProject=null;if(window.DraftSession)DraftSession.switching=null;fail(String(error));setBusy(false);}};
document.getElementById('openProject').onchange=async event=>{
  const file=event.target.files[0];if(!file||editor.busy)return;if(!allowReplace()){event.target.value='';return;}setBusy(true);
  try{
    if(file.size>80*1024*1024)throw Error('編集データは80MB以下で指定してください。');restoreProjectData(JSON.parse(await file.text()));
  }catch(error){pendingProject=null;fail(String(error));setBusy(false);}finally{event.target.value='';}
};
DraftBackup.init(editor);
DraftWorkbench.init(editor);DraftSession.init(editor);
