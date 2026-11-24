// Local recovery copy, stored in this browser profile. No background network or file writes.
window.DraftBackup={
  ready:false,db:null,latest:null,workspace:null,timer:null,last:null,writing:false,pending:false,
  async init(e){
    this.editor=e;
    document.getElementById('restoreBackup').onclick=()=>{
      if(e.busy)return;
      if(this.workspace?.pages?.length>1&&window.DraftSession){
        const w={format:'draft-to-dxf-workspace',version:1,current:this.workspace.current,pages:this.workspace.pages.map(p=>({...p,sourceId:null})),sources:[]};
        window.DraftSession.load(structuredClone(w)).catch(err=>{document.getElementById('backupHint').textContent='バックアップの復元に失敗しました：'+err.message;});
        return;
      }
      if(this.latest)window.restoreDraftProject(structuredClone(this.latest.project));
    };
    document.getElementById('downloadBackup').onclick=()=>{
      if(this.latest)DraftExport.download(new Blob([JSON.stringify(this.latest.project)],{type:'application/json'}),'draft-to-dxf-backup.d2d.json');
    };
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&this.ready&&e.doc&&e.dirty&&!e.busy)this.flush(e,{force:true});});
    try{
      this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('draft-to-dxf-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('recovery');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('バックアップを開けません。'));});
      // One-time release cleanup requested by the owner. Keep settings and future backups.
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('recovery','readwrite'),store=tx.objectStore('recovery'),key='release-clean-2026-10-17',r=store.get(key);r.onsuccess=()=>{if(!r.result){store.delete('latest');store.put(true,key);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      this.latest=await new Promise((resolve,reject)=>{const r=this.db.transaction('recovery').objectStore('recovery').get('latest');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});
      if(this.latest?.project){
        try{this.latest.project=window.DraftSession?DraftSession.validateProject(this.latest.project):DraftPaths.project(this.latest.project);}
        catch(_){this.latest.project=DraftPaths.project(this.latest.project);}
      }
      this.workspace=await new Promise((resolve)=>{const r=this.db.transaction('recovery').objectStore('recovery').get('workspace-v1');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>resolve(null);});
      if(this.workspace?.pages?.length){
        const validPages=[];
        for(const p of this.workspace.pages){
          try{validPages.push({...p,project:window.DraftSession?DraftSession.validateProject(p.project):DraftPaths.project(p.project)});}
          catch(_){}
        }
        this.workspace=validPages.length>1&&validPages.some(p=>p.id===this.workspace.current)?{time:this.workspace.time,current:this.workspace.current,pages:validPages}:null;
      }else this.workspace=null;
      this.ready=true;this.render(e);this.schedule(e);
    }catch(error){this.ready=false;document.getElementById('backupHint').textContent='自動バックアップを利用できません。編集データをファイル保存してください。';}
  },
  render(e){
    const hasBackup=!!(this.latest||this.workspace?.pages?.length);
    document.getElementById('restoreBackup').disabled=e.busy||!hasBackup;
    document.getElementById('downloadBackup').disabled=!this.latest;
    if(this.ready){
      const multi=this.workspace?.pages?.length>1?`（${this.workspace.pages.length}ページの編集内容・元ファイルは別途保存）`:'';
      document.getElementById('backupHint').textContent=this.latest?`自動バックアップ：${this.latest.project.name}${multi} ／ ${new Date(this.latest.time).toLocaleString()}。同じブラウザで再開できます。ファイル保存も併用してください。`:'編集後に自動バックアップします。同じブラウザで複数ページの最新状態を保持します。';
    }
  },
  schedule(e){
    if(!this.ready)return;
    this.render(e);
    if(!e.doc||!e.dirty){clearTimeout(this.timer);this.timer=null;this.last=null;return;}
    if(e.busy){clearTimeout(this.timer);this.timer=null;return;}
    const fingerprint=[e.doc.paths,e.doc.texts,e.calibration,e.protection,e.baseline,document.getElementById('dpi').value];
    if(this.last&&fingerprint.every((v,i)=>v===this.last[i]))return;
    this.last=fingerprint;clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(e),1200);
  },
  async flush(e=this.editor,{force=false}={}){
    if(!this.ready||!e?.doc)return false;
    if(!force&&e.busy)return false;
    if(this.writing){this.pending=true;return false;}
    const project=e.project();
    if(!Number.isFinite(project.dpi)||project.dpi<1||project.dpi>9600)return false;
    this.writing=true;
    try{
      const now=Date.now(),record={time:now,project};
      let workspaceRecord=null;
      if(window.DraftSession&&DraftSession.pages.length>1){
        const pages=[];
        let approxBytes=0;
        for(const p of DraftSession.pages.slice(0,20)){
          const proj=p.id===DraftSession.current?project:p.project;
          if(!proj||!Number.isFinite(proj.dpi)||proj.dpi<1||proj.dpi>9600)continue;
          const size=(proj.background?.length||0)+(proj.paths?.length||0)*120;
          if(approxBytes+size>40*1024*1024)continue;
          approxBytes+=size;
          pages.push({id:p.id,page:p.page||1,project:proj});
        }
        if(pages.length>1&&pages.some(p=>p.id===DraftSession.current)){
          workspaceRecord={time:now,current:DraftSession.current,pages};
        }
      }
      await new Promise((resolve,reject)=>{
        const tx=this.db.transaction('recovery','readwrite'),store=tx.objectStore('recovery');
        store.put(record,'latest');
        if(workspaceRecord)store.put(workspaceRecord,'workspace-v1');
        else store.delete('workspace-v1');
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      this.latest=record;this.workspace=workspaceRecord;this.render(e);return true;
    }catch(error){document.getElementById('backupHint').textContent='自動バックアップに失敗しました。編集データをファイル保存してください。';return false;}
    finally{this.writing=false;if(this.pending){this.pending=false;this.timer=setTimeout(()=>this.flush(e),1200);}}
  }
};
