// The original PDF.js MJS bytes are imported from a local Blob, not converted to legacy JS.
let pdfLibrary;
let pdfWorkerUrl;
let activePdfTask=null,activePdfRender=null,pdfReadGeneration=0;
window.cancelPdfRead=()=>{pdfReadGeneration++;activePdfRender?.cancel();activePdfTask?.destroy();activePdfTask=null;activePdfRender=null;};
function decodeBase64Bytes(data) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data);
  const bin = atob(data), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pdfBytes(name) {
  const data = window.pdfAssets?.[name];
  if (!data) throw new Error('同梱PDFデータがありません: ' + name);
  return decodeBase64Bytes(data);
}
class LocalPdfBinaryData {
  async fetch({kind, filename}) {
    const folder = {cMapUrl:'cmaps', standardFontDataUrl:'standard_fonts', wasmUrl:'wasm'}[kind];
    if (!folder || filename.includes('..') || filename.includes('/')) throw new Error('不正なPDFデータ指定');
    return pdfBytes(folder + '/' + filename);
  }
}
async function ensurePdfAssets() {
  if (window.pdfAssets) return;
  const src = window.draftPdfAssetsSrc || document.querySelector('meta[name="draft-pdf-assets"]')?.content || 'pdf-assets.js';
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('PDF読込モジュールの読み込みに失敗しました。'));
    document.head.appendChild(s);
  });
}
async function getPdfLibrary() {
  if (!pdfLibrary) pdfLibrary = (async () => {
    await ensurePdfAssets();
    const moduleUrl = URL.createObjectURL(new Blob([pdfBytes('pdf.mjs')], {type:'text/javascript'}));
    try {
      const lib = await import(moduleUrl);
      pdfWorkerUrl = URL.createObjectURL(new Blob([pdfBytes('pdf.worker.mjs')], {type:'text/javascript'}));
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return lib;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  })().catch(error => { pdfLibrary = null; throw error; });
  return pdfLibrary;
}
window.renderLocalPdf = async (file, pageNumber, dpi=300, {vectors=false,mode=vectors?'vector':'raster'}={}) => {
  if(!Number.isFinite(dpi)||dpi<72||dpi>1200)throw Error('読込DPIは72〜1200で指定してください。');
  const generation=++pdfReadGeneration;
  const lib = await getPdfLibrary();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if(generation!==pdfReadGeneration)throw Error('PDF読込を中止しました。');
  const task = lib.getDocument({data:bytes,
    BinaryDataFactory:LocalPdfBinaryData, useWorkerFetch:false,
    cMapUrl:'local/',cMapPacked:true,standardFontDataUrl:'local/',wasmUrl:'local/',
    useSystemFonts:false,isEvalSupported:false,isImageDecoderSupported:false,stopAtErrors:true});
  // Do not display or execute embedded PDF JavaScript; password UI is deliberately unsupported.
  let passwordRejected = false;
  task.onPassword = () => { passwordRejected = true; task.destroy(); };
  activePdfTask=task;
  try {
    let doc;
    try { doc = await task.promise; }
    catch (err) {
      if (passwordRejected || err?.name === 'PasswordException') throw new Error('パスワード保護されたPDFには対応していません。');
      throw err;
    }
    if(generation!==pdfReadGeneration)throw Error('PDF読込を中止しました。');
    document.getElementById('pageCount').textContent = '全' + doc.numPages + 'ページ';
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new Error('ページは1〜' + doc.numPages + 'で指定してください。');
    const page = await doc.getPage(pageNumber);
    const wantTexts=document.getElementById('textMode')?.value!=='off';
    let textContent=wantTexts?await page.getTextContent():null;
    if(textContent&&!DraftTexts.safeNativePdfText(await page.getOperatorList(),lib.OPS))textContent=null;
    const fullViewport=page.getViewport({scale:dpi/72}),fullWidth=Math.ceil(fullViewport.width),fullHeight=Math.ceil(fullViewport.height);
    const rasterTooLarge=fullWidth*fullHeight>40000000||Math.max(fullWidth,fullHeight)>20000;
    const large=fullWidth*fullHeight>24000000||Math.max(fullWidth,fullHeight)>20000;
    const sizeError=()=>Error(`${dpi}dpiでは4000万画素または縦横2万pxの上限を超えます。読込DPIを下げるか、PDFを分割してください。`);
    if(rasterTooLarge&&mode==='raster')throw sizeError();
    const previewScale=large&&mode!=='raster'?Math.min(Math.sqrt(20000000/(fullViewport.width*fullViewport.height)),19000/fullViewport.width,19000/fullViewport.height):1;
    let effectiveDpi=dpi*previewScale,viewport=page.getViewport({scale:effectiveDpi/72});
    let width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    if (width*height > 40000000) throw sizeError();
    const canvas = document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    let method='raster',fallbackReason=null,extracted=null;
    if(mode!=='raster'){
      try{
        const operators=await page.getOperatorList();
        extracted=DraftPdfVector.extract(operators,lib.OPS,viewport.transform,[width,height]);
        if(extracted.images||extracted.fills||extracted.text){
          if(extracted.unsafeOverpaint)throw Error('線の上に画像・塗り等が重なるため、隠れた線を復元しないよう見た目から抽出します。');
          if(rasterTooLarge)throw sizeError();
          if(previewScale!==1){effectiveDpi=dpi;viewport=fullViewport;width=fullWidth;height=fullHeight;canvas.width=width;canvas.height=height;extracted=DraftPdfVector.extract(operators,lib.OPS,viewport.transform,[width,height]);}
          method='hybrid';
        }else{canvas.draftPaths=extracted.paths;method='vector';}
        canvas.draftSummary=extracted.summary+(large&&method==='vector'?' 大判プレビューのみ解像度調整（線の実寸は維持）。':'');
        document.getElementById('pdfVectorWarning').textContent='';
      }catch(error){
        // A requested vector import must not stop merely because visible clipping needs rendering.
        const clipping=error.code==='PDF_VECTOR_CLIPPING';
        if(mode==='vector'&&!clipping&&!extracted?.unsafeOverpaint)throw error;
        if(rasterTooLarge)throw sizeError();
        // Vector preview reduction must never lower raster tracing resolution.
        effectiveDpi=dpi;viewport=fullViewport;width=fullWidth;height=fullHeight;canvas.width=width;canvas.height=height;
        fallbackReason=error.message;
        canvas.draftImportNote=(clipping?'表示範囲を反映して画像から抽出':'自動判定：画像から抽出')+'（'+fallbackReason+'）';
        document.getElementById('pdfVectorWarning').textContent='';
      }
    }
    activePdfRender=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'});
    await activePdfRender.promise;
    let semantic=textContent?DraftTexts.fromPdf(textContent,viewport):{texts:[],rejected:0};
    if(extracted?.unsafeOverpaint||fallbackReason&&!fallbackReason.startsWith('直接利用できるベクター線がありません'))semantic={texts:[],rejected:semantic.texts.length};
    canvas.draftTexts=semantic.texts;
    if(method==='hybrid'){
      const remainder=document.createElement('canvas');remainder.width=width;remainder.height=height;
      const nativeOps=new Set(extracted.nativeOps);
      const textOps=new Set(['showText','showSpacedText','nextLineShowText','nextLineSetSpacingShowText'].map(k=>lib.OPS[k]));
      const operators=await page.getOperatorList();
      const skipText=semantic.texts.length>0&&semantic.rejected===0;
      activePdfRender=page.render({canvasContext:remainder.getContext('2d'),viewport,background:'rgb(255,255,255)',operationsFilter:index=>!nativeOps.has(index)&&!(skipText&&textOps.has(operators.fnArray[index]))});
      await activePdfRender.promise;
      canvas.draftTraceCanvas=remainder;canvas.draftNativePaths=extracted.paths;
      canvas.draftImportNote='ベクター線を直接保持'+(semantic.texts.length?'・文字情報を保持':'')+'し、その他の部分を追加抽出';
    }
    canvas.draftDpi=effectiveDpi;
    canvas.draftTotalPages=doc.numPages;
    window.lastPdfRender = {version:lib.version,page:pageNumber,pages:doc.numPages,width,height,dpi:effectiveDpi,requestedDpi:dpi,method,fallbackReason};
    return canvas;
  } finally { if(activePdfTask===task){activePdfTask=null;activePdfRender=null;}try{await task.destroy();}catch(_){} }
};
