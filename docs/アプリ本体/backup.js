// One local recovery copy, stored in this browser profile. No background network or file writes.
window.DraftBackup={
  ready:false,db:null,latest:null,timer:null,last:null,writing:false,pending:false,
  async init(e){
    this.editor=e;
    document.getElementById('restoreBackup').onclick=()=>{if(this.latest&&!e.busy)window.restoreDraftProject(structuredClone(this.latest.project));};
    document.getElementById('downloadBackup').onclick=()=>{if(this.latest)DraftExport.download(new Blob([JSON.stringify(this.latest.project)],{type:'application/json'}),'draft-to-dxf-backup.d2d.json');};
    try{
      this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('draft-to-dxf-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('recovery');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('バックアップを開けません。'));});
      // One-time release cleanup requested by the owner. Keep settings and future backups.
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('recovery','readwrite'),store=tx.objectStore('recovery'),key='release-clean-2026-10-17',r=store.get(key);r.onsuccess=()=>{if(!r.result){store.delete('latest');store.put(true,key);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      this.latest=await new Promise((resolve,reject)=>{const r=this.db.transaction('recovery').objectStore('recovery').get('latest');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});
      if(this.latest?.project)this.latest.project=DraftPaths.project(this.latest.project);
      this.ready=true;this.render(e);this.schedule(e);
    }catch(error){this.ready=false;document.getElementById('backupHint').textContent='自動バックアップを利用できません。編集データをファイル保存してください。';}
  },
  render(e){
    document.getElementById('restoreBackup').disabled=e.busy||!this.latest;
    document.getElementById('downloadBackup').disabled=!this.latest;
    if(this.ready)document.getElementById('backupHint').textContent=this.latest?`自動バックアップ：${this.latest.project.name} ／ ${new Date(this.latest.time).toLocaleString()}。同じブラウザで再開できます。ファイル保存も併用してください。`:'編集後に自動バックアップします。同じブラウザの最新1件を保持します。';
  },
  schedule(e){
    if(!this.ready)return;this.render(e);
    if(!e.doc||!e.dirty){clearTimeout(this.timer);this.timer=null;this.last=null;return;}
    if(e.busy)return;
    const fingerprint=[e.doc.paths,e.calibration,e.protection,e.baseline,document.getElementById('dpi').value];
    if(this.last&&fingerprint.every((v,i)=>v===this.last[i]))return;
    this.last=fingerprint;clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(e),1200);
  },
  async flush(e=this.editor){
    if(!this.ready||!e?.doc)return false;
    if(this.writing){this.pending=true;return false;}
    const project=e.project();
    if(!Number.isFinite(project.dpi)||project.dpi<1||project.dpi>9600)return false;
    this.writing=true;
    try{
      const record={time:Date.now(),project};
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('recovery','readwrite');tx.objectStore('recovery').put(record,'latest');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      this.latest=record;this.render(e);return true;
    }catch(error){document.getElementById('backupHint').textContent='自動バックアップに失敗しました。編集データをファイル保存してください。';return false;}
    finally{this.writing=false;if(this.pending){this.pending=false;this.timer=setTimeout(()=>this.flush(e),1200);}}
  }
};
