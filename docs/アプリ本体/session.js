// Page-local projects and source files. Workspace export is explicit, never a silent replacement.
(() => {
  const $=id=>document.getElementById(id),make=(tag,id,text)=>{const n=document.createElement(tag);if(id)n.id=id;if(text)n.textContent=text;return n;};
  const decodeBase64=text=>{
    if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(text);
    const bin=atob(text),out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  };
  const encodeBase64=bytes=>{
    const chunks=[];
    for(let i=0;i<bytes.length;i+=32768){
      chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    }
    return btoa(chunks.join(''));
  };
  const validateProject=p=>{
    if(!p||p.format!=='draft-to-dxf-project'||p.version!==1||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>20000||p.height>20000||p.width*p.height>40000000||!Number.isFinite(p.dpi)||p.dpi<1||p.dpi>9600||typeof p.name!=='string'||p.name.length>1000)throw Error('ページの編集データが不正です。');
    DraftMeasure.validate(p.calibration);DraftWorkflow.validate(p.protection);
    if(!Array.isArray(p.paths)||p.baselineLabel!==undefined&&(typeof p.baselineLabel!=='string'||p.baselineLabel.length>100))throw Error('ページの線データ・比較基準が不正です。');
    if(p.background!=null&&(typeof p.background!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.background)))throw Error('下絵が不正です。');
    for(const k of ['backgroundTurns','baselineTurns'])if(p[k]!==undefined&&(!Number.isInteger(p[k])||p[k]<0||p[k]>3))throw Error('回転状態が不正です。');
    for(const paths of [p.paths,p.baselinePaths].filter(x=>x!==undefined)){
      if(!Array.isArray(paths)||paths.length>200000)throw Error('線データが不正です。');
      let count=0;
      const num=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7;
      const point=v=>Array.isArray(v)&&v.length===2&&v.every(num);
      const valid=s=>s?.type==='line'?point(s.p0)&&point(s.p1):s?.type==='ellipse'?point(s.center)&&num(s.rx)&&num(s.ry)&&s.rx>=s.ry&&s.ry>1e-6&&num(s.rotation)&&DraftGeometry.bounds(s).every(num):s?.type==='arc'&&point(s.center)&&num(s.radius)&&s.radius>0&&num(s.start_deg)&&num(s.extent_deg)&&Math.abs(s.extent_deg)>0&&Math.abs(s.extent_deg)<=360.001;
      for(const path of paths){
        if(!path||!Array.isArray(path.segments)||!['solid','dashed','dashdot'].includes(path.line_style??'solid'))throw Error('線データ・線種が不正です。');
        for(const k of ['closed'])if(path[k]!==undefined&&typeof path[k]!=='boolean')throw Error('線の属性が不正です。');
        for(const s of path.segments){
          if(++count>200000||!valid(s)||s.type==='ellipse'&&path.segments.length!==1)throw Error('線の座標が不正です。');
        }
      }
    }
    return DraftPaths.project(p);
  };
  const isMultipageSource=source=>!!source&&(/\.(pdf|tiff?)$/i.test(source.name)||source.type==='application/pdf'||/^image\/(?:x-)?tiff$/i.test(source.type));
  window.DraftSession={
    pages:[],sources:new Map(),current:null,pending:null,switching:null,pendingWorkspace:null,saving:false,
    validateProject,
    init(e){
      this.editor=e;
      const group=make('details','tools-pages');group.className='tool-group';group.open=true;group.append(make('summary',null,'図面・ページ管理'));
      const body=make('div');body.className='tool-body';group.append(body);$('tools-input').after(group);
      const list=make('select','workspacePages');list.setAttribute('aria-label','作業中の図面・ページ');list.onchange=()=>this.switchPage(list.value);body.append(list);
      const row=make('div');row.className='toolbar';
      const previous=make('button','previousPage','前の作業'),next=make('button','nextPage','次の作業');
      previous.onclick=()=>this.relative(-1);next.onclick=()=>this.relative(1);row.append(previous,next);body.append(row);
      const convertNext=make('button','convertNextPage','次ページを変換');convertNext.onclick=()=>this.nextPdf();body.append(convertNext);
      const save=make('button','saveWorkspace','作業を保存');save.title='全ページと元の入力ファイルをまとめて保存';save.onclick=()=>this.save();
      const label=make('label',null,'作業を開く'),open=make('input','openWorkspace');open.type='file';open.accept='.d2dw.json,application/json';
      open.onchange=async()=>{
        try{
          if(!open.files[0])return;
          if(e.busy||this.saving)throw Error('処理を中止または完了してから開いてください。');
          const dirtyPages=this.dirtyPageNames();
          if(dirtyPages.length&&!confirm(`未保存の作業（${dirtyPages.join('、')}）があります。現在の全ページを置き換えて開きますか？`)){return;}
          if(open.files[0].size>256*1024*1024)throw Error('まとめた作業は256MB以下で指定してください。');
          await this.load(JSON.parse(await open.files[0].text()));
        }catch(err){$('status').textContent=err.message;}
        finally{open.value='';}
      };
      label.append(open);body.append(save,label,make('p','workspaceHint',''));
      const cancel=make('button','cancelProcessing','処理を中止'),restart=make('button','restartProcessing','処理を再起動');
      cancel.onclick=()=>DraftRuntime.restart();restart.onclick=()=>DraftRuntime.restart();
      $('status').parentElement.append(cancel,restart);
      const progress=make('progress','processingProgress');progress.max=100;progress.setAttribute('aria-label','図面の処理進捗');
      $('status').parentElement.append(progress);
      new MutationObserver(()=>this.update()).observe($('status'),{childList:true,subtree:true,characterData:true});
      this.update();
      window.addEventListener('beforeunload',event=>{
        if(e.dirty||this.pages.some(p=>p.dirty)){event.preventDefault();event.returnValue='';}
      });
    },
    dirtyPageNames(){
      const names=[];
      for(const p of this.pages){
        const isDirty=p.id===this.current?!!this.editor?.dirty:!!p.dirty;
        if(isDirty)names.push(p.project?.name||'図面');
      }
      if(!names.length&&this.editor?.dirty)names.push(this.editor.name||'現在の図面');
      return names;
    },
    syncInputControls(page){
      if(!page)return;
      const source=this.sources.get(page.sourceId);
      if(isMultipageSource(source)){
        $('pdfPage').value=page.page||1;
        $('pageCount').textContent=page.totalPages?'全'+page.totalPages+'ページ':'';
      }else{
        $('pdfPage').value=1;
        $('pageCount').textContent='';
      }
      $('workspaceHint').textContent=source?`元ファイル：${source.name}${isMultipageSource(source)?'（ページ '+(page.page||1)+'）':''}`:'';
    },
    store({strictDpi=false}={}){
      const e=this.editor;
      if(!e.doc||!this.current&&e.name==='test-drawing'&&!e.dirty)return;
      let page=this.pages.find(p=>p.id===this.current);
      if(!page){
        if(this.pages.length>=100)throw Error('ページ管理は100ページまでです。この図面は編集データ保存で個別に保存してください。');
        page={id:crypto.randomUUID(),sourceId:null,page:1,totalPages:null};
        this.pages.push(page);this.current=page.id;
      }
      const snap=DraftHistory.snapshot(e);
      const validDpi=Number.isFinite(snap.dpi)&&snap.dpi>=1&&snap.dpi<=9600;
      if(!validDpi){
        if(strictDpi)throw Error(`ページ「${snap.name||'図面'}」の用紙換算DPIが不正です。1〜9600の数値を指定してください。`);
        const fallback=Number.isFinite(e.dpi)&&e.dpi>=1&&e.dpi<=9600?e.dpi:300;
        snap.dpi=fallback;
        page.invalidDpi=true;
      }else{
        e.dpi=snap.dpi;
        page.invalidDpi=false;
      }
      page.project=snap;
      page.undo=e.commandUndo;
      page.redo=e.commandRedo;
      page.dirty=e.dirty;
      page.saveRequested=e.saveRequested;
      page.editSeq=e.editSeq||0;
    },
    beforeConvert(file,page,existingSourceId=null){
      if(file.size>80*1024*1024)throw Error('入力ファイルは80MB以下で指定してください。');
      this.store();
      const sourceId=existingSourceId&&this.sources.has(existingSourceId)?existingSourceId:file.name+'|'+file.size+'|'+file.lastModified;
      if(this.pages.length>=100&&!this.pages.some(p=>p.sourceId===sourceId&&p.page===page))throw Error('ページ管理は100ページまでです。作業を保存して新しい作業を開いてください。');
      this.pending={file,page,sourceId};
    },
    converted(e,totalPages=null){
      if(!this.pending)return;
      const {file,page,sourceId}=this.pending;
      this.sources.set(sourceId,{file,name:file.name,type:file.type,totalPages:totalPages||this.sources.get(sourceId)?.totalPages||null});
      let entry=this.pages.find(p=>p.sourceId===sourceId&&p.page===page);
      if(!entry){entry={id:crypto.randomUUID(),sourceId,page,totalPages};this.pages.push(entry);}
      else if(totalPages)entry.totalPages=totalPages;
      this.current=entry.id;this.pending=null;
      this.store();
      this.syncInputControls(entry);
      this.update();
    },
    restored(e){
      if(this.pendingWorkspace){
        const pw=this.pendingWorkspace;
        this.pendingWorkspace=null;
        this.pages=pw.pages;this.sources=pw.sources;this.listSignature=null;
      }
      if(this.switching){
        const page=this.pages.find(p=>p.id===this.switching);
        this.switching=null;
        if(page){
          this.current=page.id;
          e.commandUndo=page.undo||[];
          e.commandRedo=page.redo||[];
          e.dirty=!!page.dirty;
          e.saveRequested=!!page.saveRequested;
          e.editSeq=page.editSeq||0;
          this.syncInputControls(page);
        }
      }else{
        this.current=null;
        try{this.store();}catch(error){$('workspaceHint').textContent=error.message;}
        const cur=this.pages.find(p=>p.id===this.current);
        if(cur)this.syncInputControls(cur);
      }
      this.update();
    },
    switchPage(id){
      const e=this.editor;
      if(e.busy||this.saving||id===this.current)return;
      const page=this.pages.find(p=>p.id===id);
      if(!page)return;
      this.store();
      if(window.DraftBackup?.ready&&e.dirty)DraftBackup.flush(e,{force:true});
      this.switching=id;
      window.openDraftSessionPage(page.project);
      this.update();
    },
    relative(delta){
      const i=this.pages.findIndex(p=>p.id===this.current),page=this.pages[i+delta];
      if(page)this.switchPage(page.id);
    },
    async nextPdf(){
      const e=this.editor,page=this.pages.find(p=>p.id===this.current),source=this.sources.get(page?.sourceId);
      if(e.busy||this.saving||!isMultipageSource(source))return;
      const known=this.pages.find(p=>p.sourceId===page.sourceId&&p.page===page.page+1);
      if(known){this.switchPage(known.id);return;}
      window.convertDraftSessionSource(page.sourceId,page.page+1);
    },
    update(){
      const e=this.editor;
      if(!e||!$('workspacePages'))return;
      const list=$('workspacePages'),signature=this.pages.map(p=>p.id+':'+p.project?.name).join('|');
      if(signature!==this.listSignature){
        list.replaceChildren();
        for(const p of this.pages)list.add(new Option(p.project?.name||'図面',p.id));
        this.listSignature=signature;
      }
      list.value=this.current||'';
      const locked=e.busy||this.saving;
      list.disabled=locked||!this.pages.length;
      const i=this.pages.findIndex(p=>p.id===this.current);
      $('previousPage').disabled=locked||i<=0;
      $('nextPage').disabled=locked||i<0||i>=this.pages.length-1;
      $('convertNextPage').disabled=locked||!isMultipageSource(this.sources.get(this.pages[i]?.sourceId));
      $('saveWorkspace').disabled=this.saving||!e.doc;
      $('openWorkspace').disabled=locked;
      $('pdfInputMode').disabled=locked;
      $('cancelProcessing').disabled=!e.processing||DraftRuntime.failed;
      $('restartProcessing').hidden=!DraftRuntime.failed;
      $('processingProgress').hidden=!e.processing;
      if(e.processing){
        const t=$('status').textContent;
        if(t.includes('再起動')||t.includes('準備'))$('processingProgress').removeAttribute('value');
        else if(t.includes('PDF'))$('processingProgress').value=10;
        else if(t.includes('画像'))$('processingProgress').value=20;
        else if(t.includes('細線'))$('processingProgress').value=45;
        else if(t.includes('接続'))$('processingProgress').value=60;
        else if(t.includes('整形'))$('processingProgress').value=85;
        else $('processingProgress').removeAttribute('value');
      }
    },
    async save(){
      if(this.saving||this.editor?.busy)return;
      this.saving=true;
      const e=this.editor;
      const prevBusy=e.processing;
      e.setBusy(true);
      try{
        this.store({strictDpi:true});
        const validatedPages=this.pages.map(({id,sourceId,page,totalPages,project,editSeq})=>{
          let clean;
          try{clean=validateProject(project);}
          catch(err){throw Error(`ページ「${project?.name||'図面'}」の検証に失敗：${err.message}`);}
          return {id,sourceId,page,totalPages:totalPages||undefined,project:clean,editSeq:editSeq||0};
        });
        const current=this.current,sourceEntries=[...this.sources],sources=[];
        for(const [id,s] of sourceEntries){
          if(s.file.size>80*1024*1024)throw Error('入力ファイルは80MB以下で保存してください。');
          const bytes=new Uint8Array(await s.file.arrayBuffer());
          sources.push({id,name:s.name,type:s.type,data:encodeBase64(bytes)});
        }
        const pages=validatedPages.map(({id,sourceId,page,totalPages,project})=>({id,sourceId,page,...(totalPages?{totalPages}:{}),project}));
        const workspace={format:'draft-to-dxf-workspace',version:1,current,pages,sources};
        const blob=new Blob([JSON.stringify(workspace)],{type:'application/json'});
        if(blob.size>256*1024*1024)throw Error('作業ファイルが256MBを超えます。ページ別に編集データを保存してください。');
        DraftExport.download(blob,'Draft-to-DXF.d2dw.json');
        for(const saved of validatedPages){
          const page=this.pages.find(p=>p.id===saved.id);
          if(page&&(page.editSeq||0)===saved.editSeq){
            page.dirty=false;page.saveRequested=true;
            if(page.id===this.current){e.dirty=false;e.saveRequested=true;}
          }
        }
        $('status').textContent='全ページと入力ファイルのダウンロードを開始しました。保存先を確認してください。';
      }catch(err){
        $('status').textContent=err.message;
      }finally{
        this.saving=false;
        e.setBusy(prevBusy);
        e.update();
      }
    },
    async load(w){
      if(!w||w.format!=='draft-to-dxf-workspace'||w.version!==1||!Array.isArray(w.pages)||w.pages.length<1||w.pages.length>100||!Array.isArray(w.sources)||w.sources.length>100)throw Error('まとめた作業の形式が不正です。');
      const sources=new Map(),ids=new Set();
      for(const s of w.sources){
        if(typeof s.id!=='string'||sources.has(s.id)||typeof s.name!=='string'||s.name.length>1000||typeof s.type!=='string'||typeof s.data!=='string'||s.data.length>112000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(s.data))throw Error('入力ファイルのデータが不正です。');
        const data=decodeBase64(s.data);
        sources.set(s.id,{file:new File([data],s.name,{type:s.type}),name:s.name,type:s.type});
      }
      const pages=w.pages.map(p=>{
        if(typeof p.id!=='string'||ids.has(p.id)||!Number.isInteger(p.page)||p.page<1||p.sourceId!==null&&!sources.has(p.sourceId))throw Error('ページ管理のデータが不正です。');
        ids.add(p.id);
        return {...p,project:validateProject(p.project),undo:[],redo:[],dirty:false,saveRequested:false,editSeq:0};
      });
      if(!ids.has(w.current))throw Error('現在のページが不正です。');
      this.pendingWorkspace={pages,sources,current:w.current};
      this.switching=w.current;
      window.openDraftSessionPage(pages.find(p=>p.id===w.current).project);
      this.update();
    }
  };
})();
