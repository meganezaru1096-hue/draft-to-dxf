window.DraftWorkflow={
  init(e){
    document.getElementById('previewRegion').textContent='範囲を再変換';document.getElementById('previewArc').textContent='円・円弧を変更';
    e.protection=[];e.protectionUndo=[];e.protectionRedo=[];e.rotationUndo=[];e.rotationRedo=[];e.backgroundTurns=0;e.baselineTurns=0;e.pendingPreview=null;e.regionBox=null;e.revision=0;
    document.getElementById('regionMode').onclick=()=>e.setMode('region');
    document.getElementById('previewRegion').onclick=()=>this.region(e);
    document.getElementById('protectSelected').onclick=()=>{
      if(e.busy||!e.selected.size)return;
      window.DraftHistory?.begin(e,'保護範囲の追加');
      const boxes=[...e.selected].map(key=>{const [pi,si]=key.split(':').map(Number);return this.padded(e.bounds(e.doc.paths[pi].segments[si]));});
      e.protection=this.limit([...e.protection,...boxes]);e.dirty=true;e.editSeq=(e.editSeq||0)+1;
      window.DraftHistory?.commit(e);
      e.update();e.draw();
    };
    document.getElementById('clearProtection').onclick=()=>{
      if(e.busy||!e.protection.length)return;
      window.DraftHistory?.begin(e,'保護範囲を解除');
      e.protection=[];e.dirty=true;e.editSeq=(e.editSeq||0)+1;
      window.DraftHistory?.commit(e);
      e.update();e.draw();
      document.getElementById('status').textContent='保護範囲をすべて解除しました（「元に戻す」で復帰できます）。';
    };
    document.getElementById('showProtection').onchange=()=>e.draw();
    document.getElementById('readArc').onclick=()=>this.readArc(e);
    document.getElementById('previewArc').onclick=()=>this.arc(e);
    document.getElementById('applyPreview').onclick=()=>{
      if(e.processing||!e.pendingPreview)return;
      const p=e.pendingPreview;e.pendingPreview=null;
      e.send({kind:'edit',action:'applyPreview',paths:p.paths,revision:p.revision,sourceAction:p.action});e.draw();
    };
    document.getElementById('cancelPreview').onclick=()=>this.cancel(e);
    document.getElementById('selectAll').onclick=()=>{if(e.busy||!e.doc)return;e.selected.clear();e.anchors.clear();e.doc.paths.forEach((p,pi)=>{if(e.visible(p))p.segments.forEach((s,si)=>{if(DraftGeometry.allowed(p,s))e.selected.add(`${pi}:${si}`);});});e.update();e.draw();};
    document.getElementById('clearSelection').onclick=()=>{if(e.busy)return;e.selected.clear();e.anchors.clear();e.update();e.draw();};
    document.getElementById('selectFilter').onchange=()=>{e.selected.clear();e.anchors.clear();e.update();e.draw();};
    e.canvas.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&e.pendingPreview){ev.preventDefault();ev.stopImmediatePropagation();this.cancel(e);}},true);
  },
  padded(b){return [Math.max(-1e7,b[0]-4),Math.max(-1e7,b[1]-4),Math.min(1e7,b[2]+4),Math.min(1e7,b[3]+4)];},
  validate(boxes){
    if(boxes==null)return [];
    if(!Array.isArray(boxes)||boxes.length>2000||boxes.some(b=>!Array.isArray(b)||b.length!==4||b.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)||b[0]>b[2]||b[1]>b[3]))throw Error('保護範囲が不正です。');
    return boxes.map(b=>b.slice());
  },
  limit(boxes){
    const unique=[...new Map(boxes.map(b=>[JSON.stringify(b),b])).values()];
    if(unique.length<=2000)return unique;
    const total=[Infinity,Infinity,-Infinity,-Infinity];for(const b of unique){total[0]=Math.min(total[0],b[0]);total[1]=Math.min(total[1],b[1]);total[2]=Math.max(total[2],b[2]);total[3]=Math.max(total[3],b[3]);}return [total];
  },
  segmentKey(s){
    if(s.type==='line')return `L:${s.p0[0]},${s.p0[1]},${s.p1[0]},${s.p1[1]}`;
    if(s.type==='arc')return `A:${s.center[0]},${s.center[1]},${s.radius},${s.start_deg},${s.extent_deg}`;
    return `E:${s.center[0]},${s.center[1]},${s.rx},${s.ry},${s.rotation}`;
  },
  difference(before,after){
    const flatten=paths=>{const out=[];for(let pi=0;pi<paths.length;pi++){const segs=paths[pi].segments;for(let si=0;si<segs.length;si++)out.push({ref:[pi,si],s:segs[si],key:this.segmentKey(segs[si])});}return out;};
    const old=flatten(before),fresh=flatten(after),counts=new Map(),remaining=new Map();
    for(const x of fresh)counts.set(x.key,(counts.get(x.key)||0)+1);
    const removed=old.filter(x=>{const n=counts.get(x.key)||0;if(n){counts.set(x.key,n-1);return false;}return true;});
    for(const x of old)remaining.set(x.key,(remaining.get(x.key)||0)+1);
    const added=fresh.filter(x=>{const n=remaining.get(x.key)||0;if(n){remaining.set(x.key,n-1);return false;}return true;});
    return {removed,added};
  },
  accepted(e,response){
    const request=e.lastRequest||{},action=request.action;
    const rotated=response.revision!==e.revision&&!!e.pendingRotationMeta;
    if(response.revision!==e.revision){
      if(action==='undo'){
        e.rotationRedo.push(e.rotationUndo.pop()||0);e.protectionRedo.push(e.protection);
        if(rotated)DraftRotation.apply(e,e.pendingRotationMeta);
        e.protection=e.protectionUndo.pop()||e.protection;
      }else if(action==='redo'){
        e.rotationUndo.push(e.rotationRedo.pop()||0);e.protectionUndo.push(e.protection);
        if(rotated)DraftRotation.apply(e,e.pendingRotationMeta);
        e.protection=e.protectionRedo.pop()||e.protection;
      }else{
        e.rotationUndo.push(action==='rotateCW'?1:action==='rotateCCW'?-1:0);e.rotationUndo=e.rotationUndo.slice(-30);e.rotationRedo=[];
        e.protectionUndo.push(e.protection);e.protectionUndo=e.protectionUndo.slice(-30);e.protectionRedo=[];
        if(rotated)DraftRotation.apply(e,e.pendingRotationMeta);
        else if(document.getElementById('autoProtect').checked&&!['region','partialRepair'].includes(request.kind)&&!(action==='applyPreview'&&request.sourceAction==='region')){
          const diff=this.difference(e.doc.paths,response.paths);
          e.protection=this.limit([...e.protection,...[...diff.removed,...diff.added].map(x=>this.padded(e.bounds(x.s)))]);
        }
      }
    }
    e.revision=response.revision;e.lastRequest=null;e.pendingRotationMeta=null;return rotated;
  },
  showPreview(e,response,label){
    const sourceAction=e.lastRequest?.kind==='region'?'region':e.lastRequest?.action;
    e.send({kind:'edit',action:'applyPreview',paths:response.paths,revision:response.revision,sourceAction});
  },
  cancel(e){if(e.processing)return;e.pendingPreview=null;e.update();e.draw();},
  scale(e){return e.calibration?.mmPerPixel??25.4/Number(document.getElementById('dpi').value);},
  selectedArc(e){if(e.selected.size!==1)return null;const ref=[...e.selected][0].split(':').map(Number),s=e.doc.paths[ref[0]].segments[ref[1]];return s.type==='arc'?{s,ref}:null;},
  readArc(e){
    if(e.busy)return;const chosen=this.selectedArc(e);if(!chosen)return;const scale=this.scale(e),s=chosen.s;
    for(const [id,value] of [['arcX',s.center[0]*scale],['arcY',s.center[1]*scale],['arcRadius',s.radius*scale],['arcStart',s.start_deg],['arcExtent',s.extent_deg]])document.getElementById(id).value=Number(value.toPrecision(12));
    e.arcRef=chosen.ref.join(':');e.arcScale=scale;e.arcRevision=e.revision;
    document.getElementById('arcHint').textContent=`${e.calibration?'設定した実寸':'用紙上の寸法'}で表示。中心は左上基準、開始角・開き角は時計回りが正。「円・円弧を変更」で反映します。`;
  },
  arc(e){
    if(e.busy)return;const chosen=this.selectedArc(e);if(!chosen||chosen.ref.join(':')!==e.arcRef||e.arcScale!==this.scale(e)||e.arcRevision!==e.revision){document.getElementById('arcHint').textContent='対象を選び「値を表示」してから変更してください。縮尺変更後も読み直してください。';return;}
    const scale=this.scale(e),values=['arcX','arcY','arcRadius','arcStart','arcExtent'].map(id=>document.getElementById(id).value.trim());
    if(values.some(v=>!v||!Number.isFinite(Number(v)))){document.getElementById('arcHint').textContent='すべての値を数値で入力してください。';return;}
    const [x,y,r,start,extent]=values.map(Number);
    e.send({kind:'edit',action:'changeArc',refs:[chosen.ref],arc:{center:[x/scale,y/scale],radius:r/scale,start_deg:start,extent_deg:extent}});
  },
  box(e,a,b){
    const clamp=(v,max)=>Math.max(0,Math.min(max,v));
    e.regionBox=[clamp(Math.floor(Math.min(a[0],b[0])),e.doc.width),clamp(Math.floor(Math.min(a[1],b[1])),e.doc.height),clamp(Math.ceil(Math.max(a[0],b[0])),e.doc.width),clamp(Math.ceil(Math.max(a[1],b[1])),e.doc.height)];
    e.update();e.draw();
  },
  async region(e){
    if(e.busy||!e.regionBox||!e.background)return;
    try{
      const b=e.regionBox,pad=64,x=Math.max(0,b[0]-pad),y=Math.max(0,b[1]-pad),w=Math.min(e.doc.width,b[2]+pad)-x,h=Math.min(e.doc.height,b[3]+pad)-y;
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.translate(-x,-y);DraftRotation.drawBackground(e,ctx);
      const rgba=ctx.getImageData(0,0,w,h).data;
      const useAi=!!document.getElementById('regionAiRestore')?.checked&&!!window.DraftPreprocessMl;
      let pixels=rgba.buffer,channels=4,aiJuncBytes=null,aiCurveBytes=null,aiSemanticBytes=null,aiUpstreamOptions=null,aiRepair={};
      if(useAi){
        e.setBusy(true);
        try{
          const srcGray=new Uint8Array(w*h);
          for(let i=0,p=0;i<srcGray.length;i++,p+=4)srcGray[i]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
          const aiRes=await DraftPreprocessMl.restoreGray(srcGray,w,h,{progress:msg=>{document.getElementById('status').textContent=msg;}});
          if(!aiRes){e.setBusy(false);return;}
          pixels=aiRes.grayU8.buffer;channels=1;
          aiJuncBytes=aiRes.juncU8?aiRes.juncU8.buffer:null;
          aiCurveBytes=aiRes.curveU8?aiRes.curveU8.buffer:null;
          aiSemanticBytes=aiRes.semanticU8?aiRes.semanticU8.buffer:null;
          aiUpstreamOptions=window.DraftPreprocessMlModel?.metadata?.upstream||null;
          if(aiRes.localRepairOptions)aiRepair={aiInkBytes:aiRes.inkU8.buffer,aiSkelBytes:aiRes.skelU8.buffer,aiOriginalBytes:aiRes.normalizedOriginalU8.buffer,aiLocalRepairOptions:aiRes.localRepairOptions};
        }finally{e.setBusy(false);}
      }
      e.send({kind:'region',width:w,height:h,pixels,channels,aiPreprocessed:useAi,aiJuncBytes,aiCurveBytes,aiSemanticBytes,aiUpstreamOptions,...aiRepair,box:b,offset:[x,y],protection:e.protection,noise:Number(document.getElementById('regionNoise').value),dpi:Number(document.getElementById('dpi').value)||e.dpi||300});
      document.getElementById('status').textContent=useAi?'指定範囲を高精度変換で再変換しています…':'指定範囲を再変換しています…';
    }catch(error){document.getElementById('regionHint').textContent=error.message;}
  },
  update(e){
    const disabled=e.busy||!e.doc;
    for(const id of ['selectFilter','boxSelection','selectAll','clearSelection','regionMode','regionNoise','autoProtect','showProtection','snapMidpoint','snapCenter','drawAxis','drawExact','drawLength','drawAngle'])document.getElementById(id).disabled=disabled;
    document.getElementById('protectSelected').disabled=disabled||!e.selected.size;
    document.getElementById('clearProtection').disabled=disabled||!e.protection?.length;
    const box=e.regionBox,valid=box&&box[2]-box[0]>=2&&box[3]-box[1]>=2;
    document.getElementById('previewRegion').disabled=disabled||!valid||!e.background;
    document.getElementById('regionHint').textContent=`${valid?`範囲 ${box[2]-box[0]}×${box[3]-box[1]} px。`:'図面をドラッグして範囲を指定。'}保護 ${e.protection?.length||0}範囲。境界をまたぐ線と保護周辺は残します。${!e.background?'下絵がないため再変換できません。':''}`;
    const arc=!disabled&&!!this.selectedArc(e);
    for(const id of ['readArc','previewArc','arcX','arcY','arcRadius','arcStart','arcExtent'])document.getElementById(id).disabled=!arc;
    const pending=e.pendingPreview;document.getElementById('previewActions').classList.toggle('visible',!!pending);
    for(const id of ['applyPreview','cancelPreview'])document.getElementById(id).disabled=e.processing||!pending;
    if(pending){const s=pending.regionStats;document.getElementById('previewHint').textContent=`${pending.label||'変更案'}：赤 ${pending.diff.removed.length}要素を置換／削除、緑 ${pending.diff.added.length}要素を追加${s?`、維持 ${s.preserved}要素`:''}。確定するまで保存データには反映しません。`;}
  },
  stroke(e,c,s,color,dashed=false){c.strokeStyle=color;c.lineWidth=2/e.view.scale;c.setLineDash(dashed?[5/e.view.scale,3/e.view.scale]:[]);DraftCut.stroke(c,s,0,1);c.setLineDash([]);},
  draw(e,c){
    if(document.getElementById('showProtection').checked){c.strokeStyle='#a28122';c.fillStyle='rgba(207,177,76,.08)';c.lineWidth=1/e.view.scale;c.setLineDash([3/e.view.scale,4/e.view.scale]);for(const b of e.protection){c.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);c.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);}c.setLineDash([]);}
    if(e.mode==='region'&&e.regionBox){const b=e.regionBox;c.strokeStyle='#158483';c.lineWidth=2/e.view.scale;c.setLineDash([6/e.view.scale,4/e.view.scale]);c.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);c.setLineDash([]);}
    if(e.pendingPreview){for(const x of e.pendingPreview.diff.removed)this.stroke(e,c,x.s,'#dc2626',true);for(const x of e.pendingPreview.diff.added)this.stroke(e,c,x.s,'#168547');}
  }
};

// Manual local redraw. The worker validates geometry/revision; these guides are
// temporary and never become exported drawing paths until a candidate is chosen.
window.DraftPartialRepair={
  validBox(box){return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]-box[0]>=3&&box[3]-box[1]>=3;},
  boxesOf(e){
    if(Array.isArray(e.partialRepairBoxes)&&e.partialRepairBoxes.length){
      return e.partialRepairBoxes.filter(b=>this.validBox(b));
    }
    const single=e.partialRepairBox||e.partialRepairSession?.box||e.regionBox;
    return this.validBox(single)?[single]:[];
  },
  reset(e,clearBox=false){
    const previousBoxes=!clearBox?this.boxesOf(e).map(b=>b.slice()):[];
    if(clearBox&&e.mode==='partialRepair')e.regionBox=null;
    e.partialRepairBoxes=previousBoxes;
    e.partialRepairBox=previousBoxes.length?previousBoxes.at(-1).slice():null;
    e.partialRepairSession=null;e.partialRepairHover=null;
    e.partialRepairStatus=previousBoxes.length?'図面が変わったため候補を解除しました。指定した範囲は残っているため再実行できます。':'修正したい部分を囲み、「一括修復」または「消去・候補を出す」を実行します。下絵と枠外の線は残ります。';
    e.partialRepairRenderKey=null;
  },
  setHover(e,id){
    const next=id??null;
    if(next===e.partialRepairHover)return;
    e.partialRepairHover=next;
    this.syncHover(e);
    e.scheduleDraw();
  },
  syncHover(e){
    const container=document.getElementById('partialCandidates');
    if(!container)return;
    const active=e.partialRepairHover==null?null:String(e.partialRepairHover);
    for(const button of container.querySelectorAll('button')){
      button.classList.toggle('is-hovered',active!==null&&button.dataset.candidateId===active);
    }
  },
  onError(e,message,kind){
    if(kind==='partialRepairApply'||kind==='partialRepairApplyAll'){e.partialRepairSession=null;e.partialRepairRenderKey=null;}
    e.partialRepairHover=null;
    e.partialRepairStatus='エラー: '+message;
    this.update(e);
  },
  batchEligibleCount(candidates){
    if(!Array.isArray(candidates)||!candidates.length)return 0;
    const rejectedIds=new Set();
    for(const c of candidates)if(c.underlay_rejected)rejectedIds.add(String(c.id));
    let rejChanged=true;
    while(rejChanged){
      rejChanged=false;
      for(const c of candidates){
        const cid=String(c.id);
        if(!rejectedIds.has(cid)&&c.depends_on!=null&&rejectedIds.has(String(c.depends_on))){
          rejectedIds.add(cid);rejChanged=true;
        }
      }
    }
    const activeIdx=[];
    for(let i=0;i<candidates.length;i++)if(!rejectedIds.has(String(candidates[i].id)))activeIdx.push(i);
    const eps=candidates.map(c=>Array.isArray(c.endpoints)&&c.endpoints.length?c.endpoints:[c.p0,c.p1]);
    const conflict=new Array(candidates.length).fill(true);
    for(const i of activeIdx)conflict[i]=!!candidates[i].ambiguous;
    for(let a=0;a<activeIdx.length;a++){
      const i=activeIdx[a];
      for(let b=a+1;b<activeIdx.length;b++){
        const j=activeIdx[b];
        let hit=false;
        for(const p of eps[i]){for(const q of eps[j]){if(Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6){hit=true;break;}}if(hit)break;}
        if(hit){conflict[i]=true;conflict[j]=true;}
      }
    }
    const remIds=new Set();
    for(let i=0;i<candidates.length;i++)if(conflict[i])remIds.add(String(candidates[i].id));
    let changed=true;
    while(changed){
      changed=false;
      for(const i of activeIdx){
        if(!conflict[i]&&candidates[i].depends_on!=null&&remIds.has(String(candidates[i].depends_on))){
          conflict[i]=true;remIds.add(String(candidates[i].id));changed=true;
        }
      }
    }
    let count=0;
    for(const i of activeIdx)if(!conflict[i])count++;
    return count;
  },
  sampleUnderlays(e,boxes){
    if(!e.background||!e.doc||!boxes.length)return null;
    try{
      const crops=boxes.map(b=>{
        const x0=Math.max(0,Math.floor(b[0])-2),y0=Math.max(0,Math.floor(b[1])-2);
        const x1=Math.min(e.doc.width,Math.ceil(b[2])+2),y1=Math.min(e.doc.height,Math.ceil(b[3])+2);
        return {ox:x0,oy:y0,w:x1-x0,h:y1-y0};
      });
      const totalPx=crops.reduce((s,c)=>s+Math.max(0,c.w)*Math.max(0,c.h),0);
      if(totalPx<=0||totalPx>4000000)return null;
      const probe=document.createElement('canvas');probe.width=probe.height=32;
      const pc=probe.getContext('2d');pc.fillStyle='white';pc.fillRect(0,0,32,32);pc.drawImage(e.background,0,0,32,32);
      const sample=pc.getImageData(0,0,32,32).data,levels=new Uint8Array(1024);
      for(let i=0,p=0;i<levels.length;i++,p+=4)levels[i]=(sample[p]*77+sample[p+1]*150+sample[p+2]*29)>>8;
      levels.sort();const darkLines=levels[512]>=115;
      return crops.map(c=>{
        if(c.w<3||c.h<3)return null;
        const cv=document.createElement('canvas');cv.width=c.w;cv.height=c.h;
        const ctx=cv.getContext('2d');ctx.fillStyle=darkLines?'white':'black';ctx.fillRect(0,0,c.w,c.h);
        ctx.translate(-c.ox,-c.oy);DraftRotation.drawBackground(e,ctx);
        const rgba=ctx.getImageData(0,0,c.w,c.h).data,gray=new Uint8Array(c.w*c.h);
        for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
        return {ox:c.ox,oy:c.oy,w:c.w,h:c.h,darkLines,bytes:gray};
      });
    }catch(_){return null;}
  },
  init(e){
    this.reset(e,true);
    const mode=document.getElementById('mode');
    if(![...mode.options].some(o=>o.value==='partialRepair'))mode.add(new Option('部分修復の範囲','partialRepair'));
    document.getElementById('partialRepairMode').onclick=()=>{
      if(e.busy||!e.doc)return;
      this.reset(e,true);e.regionBox=null;e.setMode('partialRepair');
      window.DraftLayout?.reveal('partialRepair');e.canvas.focus({preventScroll:true});
    };
    const batchBtn=document.getElementById('partialBatchRun');
    if(batchBtn)batchBtn.onclick=()=>this.prepare(e,{autoApply:true});
    document.getElementById('partialErase').onclick=()=>this.prepare(e,{autoApply:false});
    const applyAllBtn=document.getElementById('partialApplyAll');
    if(applyAllBtn)applyAllBtn.onclick=()=>this.applyAll(e);
    const multiBox=document.getElementById('partialMultiBox');
    if(multiBox)multiBox.onchange=()=>{
      if(e.mode==='partialRepair'){
        e.partialRepairStatus=multiBox.checked?'複数範囲モード：ドラッグするたびに修復範囲を追加します。囲み終えたら「一括修復」を押してください。':'単一範囲モード：ドラッグで1つの範囲を指定します（Ctrl＋ドラッグで追加も可）。';
      }
      this.update(e);
    };
    const popBtn=document.getElementById('partialPopBox');
    if(popBtn)popBtn.onclick=()=>{
      if(e.busy)return;
      const boxes=this.boxesOf(e).map(b=>b.slice());
      if(!boxes.length)return;
      boxes.pop();
      e.partialRepairBoxes=boxes;
      e.partialRepairBox=boxes.length?boxes.at(-1).slice():null;
      e.regionBox=e.partialRepairBox?e.partialRepairBox.slice():null;
      e.partialRepairSession=null;e.partialRepairHover=null;e.partialRepairRenderKey=null;
      e.partialRepairStatus=boxes.length?`最後の枠を取り消しました（残り${boxes.length}範囲）。`:'指定した範囲をすべて取り消しました。新しく囲んでください。';
      this.update(e);e.draw();
    };
    const clearBtn=document.getElementById('partialClearBoxes');
    if(clearBtn)clearBtn.onclick=()=>{
      if(e.busy)return;
      this.reset(e,true);e.regionBox=null;
      e.partialRepairStatus='指定した範囲をクリアしました。新しく囲んでください。';
      this.update(e);e.draw();
    };
    document.getElementById('partialKeepProtected').onchange=()=>this.update(e);
    const proposalMode=document.getElementById('partialProposalMode');
    if(proposalMode)proposalMode.onchange=()=>{
      if(this.boxesOf(e).length){
        e.partialRepairStatus='候補の種類を変更しました。「一括修復」または「範囲内を消去・候補を出す」で再検出できます。';
      }
      this.update(e);
    };
    e.canvas.addEventListener('pointermove',event=>{
      if(e.mode!=='partialRepair'||!e.doc||e.busy||e.drag)return;
      const candidate=this.nearest(e,e.world(e.position(event)));
      this.setHover(e,candidate?.id??null);
    });
    e.canvas.addEventListener('pointerleave',()=>{
      this.setHover(e,null);
    });
    this.update(e);
  },
  box(e,a,b,add=false){
    if(!e.doc||![...a,...b].every(Number.isFinite))return;
    const clamp=(value,max)=>Math.max(0,Math.min(max,value));
    const box=[clamp(Math.floor(Math.min(a[0],b[0])),e.doc.width),clamp(Math.floor(Math.min(a[1],b[1])),e.doc.height),
      clamp(Math.ceil(Math.max(a[0],b[0])),e.doc.width),clamp(Math.ceil(Math.max(a[1],b[1])),e.doc.height)];
    e.partialRepairSession=null;e.partialRepairHover=null;e.partialRepairRenderKey=null;
    if(!this.validBox(box)){
      if(!add&&!document.getElementById('partialMultiBox')?.checked){
        e.regionBox=box;e.partialRepairBox=box.slice();e.partialRepairBoxes=[];
      }
      e.partialRepairStatus='もう少し大きな範囲を指定してください。';
      e.update();e.draw();return;
    }
    const append=!!add||!!document.getElementById('partialMultiBox')?.checked;
    const current=append?this.boxesOf(e).map(x=>x.slice()):[];
    if(current.length>=100){
      e.partialRepairStatus='複数範囲の上限（100範囲）に達しています。一度「一括修復」を実行してください。';
      e.update();e.draw();return;
    }
    current.push(box.slice());
    e.partialRepairBoxes=current;
    e.regionBox=box.slice();e.partialRepairBox=box.slice();
    e.partialRepairStatus=current.length>1
      ?`${current.length}範囲を指定中。「${current.length}範囲を一括修復」でまとめて実行できます（続けてドラッグで追加可）。`
      :'範囲を指定しました。「一括修復（消去＋接続）」または「範囲内を消去・候補を出す」を実行できます。';
    e.update();e.draw();
  },
  prepare(e,{autoApply=false}={}){
    const boxes=this.boxesOf(e);
    if(e.busy||!e.doc||!boxes.length)return;
    e.partialRepairBoxes=boxes.map(b=>b.slice());
    e.partialRepairBox=boxes.at(-1).slice();
    if(e.mode!=='partialRepair')e.setMode('partialRepair');
    const extended=document.getElementById('partialProposalMode')?.value==='extended';
    e.partialRepairStatus=autoApply
      ?(boxes.length>1?`${boxes.length}範囲の消去と候補接続を一括実行しています…`:'範囲内の消去と候補接続を一括実行しています…')
      :(boxes.length>1?`${boxes.length}範囲内の線と接続候補を調べています…`:'範囲内の線と、外側からの接続候補を調べています…');
    const label=autoApply
      ?(boxes.length>1?`部分修復：${boxes.length}範囲を一括修復`:'部分修復：一括修復')
      :(boxes.length>1?`部分修復：${boxes.length}範囲内消去`:'部分修復：範囲内消去');
    const underlayPatches=this.sampleUnderlays(e,boxes);
    e.send({kind:'partialRepair',label,box:boxes.at(-1).slice(),boxes:boxes.map(b=>b.slice()),
      autoApply:!!autoApply,includeCorners:extended,includeArcs:extended,ignoreAiLayer:true,
      ...(underlayPatches?{underlayPatches}:{}),
      protection:document.getElementById('partialKeepProtected').checked?(e.protection||[]).map(b=>b.slice()):[]});
  },
  applyAll(e){
    if(e.busy||!e.doc)return;
    const session=this.session(e);
    if(!session||!this.batchEligibleCount(session.candidates))return;
    if(e.mode!=='partialRepair')e.setMode('partialRepair');
    e.partialRepairStatus='競合しない候補を一括接続しています…';
    e.send({kind:'partialRepairApplyAll',label:'部分修復：候補を一括接続',revision:session.revision});
  },
  candidate(raw){
    const segments=(Array.isArray(raw?.paths)?raw.paths:[]).flatMap(p=>Array.isArray(p?.segments)?p.segments:[]);
    const first=segments[0];
    const p0=raw?.p0||first?.p0,p1=raw?.p1||first?.p1;
    if(!raw||!['number','string'].includes(typeof raw.id)||!Array.isArray(p0)||!Array.isArray(p1)
       ||p0.length!==2||p1.length!==2||![...p0,...p1].every(Number.isFinite)
       ||Math.hypot(p1[0]-p0[0],p1[1]-p0[1])<1e-6)return null;
    const style=raw.line_style||raw.style||raw.paths?.[0]?.line_style||'solid';
    const kind=['line','corner','t_junction','arc','line_arc'].includes(raw.kind)?raw.kind:(first?.type==='arc'?'arc':'line');
    const validSegs=segments.length?segments:[{type:'line',p0:p0.slice(),p1:p1.slice()}];
    const corner=Array.isArray(raw.corner)&&raw.corner.length===2&&raw.corner.every(Number.isFinite)?raw.corner.slice():null;
    return {...raw,kind,p0:p0.slice(),p1:p1.slice(),corner,segments:validSegs,style:['solid','dashed','dashdot'].includes(style)?style:'solid'};
  },
  receive(e,payload){
    if(!payload||!e.doc)return;
    const boxes=Array.isArray(payload.boxes)&&payload.boxes.length
      ?payload.boxes.filter(b=>this.validBox(b)).map(b=>b.slice())
      :(this.validBox(payload.box)?[payload.box.slice()]:this.boxesOf(e).map(b=>b.slice()));
    const box=boxes.length?boxes.at(-1):null;
    const candidates=(Array.isArray(payload.candidates)?payload.candidates:[]).slice(0,64).map(c=>this.candidate(c)).filter(Boolean);
    const revision=Number.isInteger(payload.revision)?payload.revision:e.revision;
    const stats=payload.stats||{};
    const changed=payload.changed??stats.changed;
    let finalBoxes=boxes;
    if(payload.phase==='batchApplied'&&changed&&Array.isArray(payload.remainingBoxes)){
      finalBoxes=payload.remainingBoxes.filter(b=>this.validBox(b)).map(b=>b.slice());
    }
    const finalBox=finalBoxes.length?finalBoxes.at(-1):null;
    e.partialRepairBoxes=finalBoxes;
    e.partialRepairBox=finalBox?finalBox.slice():null;
    if(payload.phase==='batchApplied'&&changed)e.regionBox=finalBox?finalBox.slice():null;
    e.partialRepairSession={box:finalBox?finalBox.slice():null,boxes:finalBoxes.map(b=>b.slice()),candidates,revision,stats};e.partialRepairHover=null;
    const protectedCount=Number(stats.protected||stats.protected_regions||stats.protected_count||stats.protected_components_skipped||0);
    const protectedBoxes=Number(stats.protected_boxes||0);
    const skippedNoCand=Number(stats.skipped_no_candidates||0);
    const skippedAmbigOnly=Number(stats.skipped_ambiguous_only||0);
    const skippedAmbig=Number(stats.skipped_ambiguous||0);
    const applied=Number(stats.applied||0);
    const boxesTotal=Number(stats.boxes_total||boxes.length||1);
    const boxesChanged=Number(stats.boxes_changed||0);
    const ambiguous=candidates.some(c=>c.ambiguous);
    const clipped=stats.truncated||stats.anchors_truncated||stats.candidates_truncated||stats.anchor_limit_reached||stats.candidate_limit_reached||stats.crowded_bins>0;
    if(payload.phase==='batchApplied'){
      if(changed===false){
        e.partialRepairStatus=protectedCount
          ?'変更なし：手修正の保護が範囲に重なっています。ここを消去してよい場合だけ「手修正した部分を残す」をOFFにして再実行してください。'
          :skippedAmbigOnly>0
            ?`変更なし：接続先が複数ある候補（${skippedAmbig}件）のみのため、元の線を消さずに残しました。「範囲内を消去・候補を出す」で候補を確認しながら選んでください。`
            :skippedNoCand>0
              ?'変更なし：接続できる候補が見つからないため、元の線を消さずに残しました。外側の正常な線が枠の辺を横切るように囲むか、消去のみ行う場合は「範囲内を消去・候補を出す」を使ってください。'
              :'変更なし：範囲内に修復できる線がありません。修正したい部分を囲み直してください。';
      }else{
        const removed=Number(stats.removed_segments||0);
        const head=boxesTotal>1
          ?(boxesChanged<boxesTotal
            ?`${boxesTotal}範囲中${boxesChanged}範囲を一括修復しました（消去${removed}要素・接続${applied}件）。`
            :`${boxesTotal}範囲を一括修復しました（消去${removed}要素・接続${applied}件）。`)
          :(removed>0
            ?`範囲内を一括修復しました（消去${removed}要素・接続${applied}件）。`
            :`候補${applied}件を一括接続しました。`);
        const notes=[];
        if(protectedBoxes>0)notes.push(`保護範囲に重なる${protectedBoxes}範囲はスキップ`);
        if(skippedNoCand>0)notes.push(`接続候補がない${skippedNoCand}範囲は元の線を維持`);
        if(skippedAmbigOnly>0)notes.push(`接続先が複数ある${skippedAmbigOnly}範囲は元の線を維持`);
        const skipNote=notes.length?`（${notes.join('／')}）。`:'';
        const remNote=candidates.length?` 接続先が複数ある候補${candidates.length}件は残しています（図面か一覧で選択してください）。`:'';
        e.partialRepairStatus=`${head}${skipNote}${remNote}「元に戻す」1回でまとめて取り消せます。`;
      }
    }else if(payload.phase==='appliedAll'){
      if(applied>0){
        e.partialRepairStatus=`候補${applied}件を一括接続しました。${candidates.length?`接続先が複数ある候補${candidates.length}件は残しています。`:'接続候補は残っていません。'}「元に戻す」1回でまとめて取り消せます。`;
      }else{
        e.partialRepairStatus=candidates.length
          ?`自動確定できる候補がありません。接続先が複数ある候補${candidates.length}件を図面か一覧で選んでください。`
          :'接続候補は残っていません。';
      }
    }else if(payload.phase==='applied'){
      e.partialRepairStatus=`候補を接続しました。${candidates.length?`残り${candidates.length}件。続けて必要な候補を選べます。`:'接続候補は残っていません。'}「元に戻す」で取り消せます。`;
    }else if(changed===false){
      e.partialRepairStatus=protectedCount?'変更なし：手修正の保護が範囲に重なっています。ここを消去してよい場合だけ「手修正した部分を残す」をOFFにして再実行してください。':candidates.length?`範囲内に消去する線はありません。接続候補${candidates.length}件を図面か一覧でクリック、または「候補を一括適用」できます。`:'変更なし：範囲内に消去できる線がありません。修正したい部分を囲み直してください。';
    }else{
      e.partialRepairStatus=`範囲内の線を消去しました。${candidates.length?`接続候補${candidates.length}件。個別クリックまたは「候補を一括適用」で接続します。`:'接続候補はありません。必要な線・円弧は作図ツールで描き足せます。'}「元に戻す」で消去前へ戻せます。`;
    }
    if(ambiguous&&payload.phase!=='batchApplied'&&payload.phase!=='appliedAll')e.partialRepairStatus+=' 接続先が複数ある候補は、下絵と照合して選んでください。';
    if(clipped)e.partialRepairStatus+=' 候補数を制限しています。必要なら範囲を小さく指定してください。';
    this.update(e);e.draw();
    document.getElementById('status').textContent=e.partialRepairStatus;
    e.canvas.focus({preventScroll:true});
  },
  session(e){
    const session=e.partialRepairSession;
    return session&&session.revision===e.revision?session:null;
  },
  apply(e,id){
    if(e.busy||!e.doc)return;
    const session=this.session(e),candidate=session?.candidates.find(c=>String(c.id)===String(id));
    if(!candidate)return;
    if(e.mode!=='partialRepair')e.setMode('partialRepair');
    e.partialRepairStatus='選んだ候補を接続しています…';
    e.send({kind:'partialRepairApply',label:'部分修復：接続',candidateId:candidate.id,revision:session.revision});
  },
  update(e){
    const start=document.getElementById('partialRepairMode'),erase=document.getElementById('partialErase'),keep=document.getElementById('partialKeepProtected'),modeSelect=document.getElementById('partialProposalMode');
    const batchBtn=document.getElementById('partialBatchRun'),applyAllBtn=document.getElementById('partialApplyAll'),multiBox=document.getElementById('partialMultiBox'),popBtn=document.getElementById('partialPopBox'),clearBtn=document.getElementById('partialClearBoxes');
    if(!start||!erase||!keep)return;
    const disabled=e.busy||!e.doc;
    const boxes=this.boxesOf(e);
    start.disabled=disabled;keep.disabled=disabled;
    if(modeSelect)modeSelect.disabled=disabled;
    if(multiBox)multiBox.disabled=disabled;
    erase.disabled=disabled||!boxes.length;
    if(batchBtn){
      batchBtn.disabled=disabled||!boxes.length;
      batchBtn.textContent=boxes.length>1?`${boxes.length}範囲を一括修復`:'一括修復（消去＋接続）';
    }
    const showMultiActions=boxes.length>1||(!!multiBox?.checked&&boxes.length>0);
    if(popBtn){
      popBtn.hidden=!showMultiActions;
      popBtn.disabled=disabled||!boxes.length;
    }
    if(clearBtn){
      clearBtn.hidden=!showMultiActions;
      clearBtn.disabled=disabled||!boxes.length;
      if(showMultiActions)clearBtn.textContent=`範囲をクリア（${boxes.length}）`;
    }
    if(e.partialRepairSession&&e.partialRepairSession.revision!==e.revision&&!e.busy){
      e.partialRepairSession=null;e.partialRepairHover=null;e.partialRepairRenderKey=null;
      e.partialRepairStatus='図面が変更されたため接続候補を解除しました。「一括修復」または「範囲内を消去・候補を出す」で再検出できます。';
    }
    const session=this.session(e),candidates=session?.candidates||[],container=document.getElementById('partialCandidates');
    if(applyAllBtn){
      const safeCount=this.batchEligibleCount(candidates);
      applyAllBtn.disabled=disabled||safeCount===0;
      applyAllBtn.textContent=safeCount>0?`候補を一括適用（${safeCount}件）`:'候補を一括適用';
    }
    const key=JSON.stringify([session?.revision,candidates.map(c=>[c.id,c.kind,c.p0,c.p1,c.style,!!c.ambiguous])]);
    if(container&&key!==e.partialRepairRenderKey){
      container.replaceChildren();
      const styleNames={solid:'実線',dashed:'破線',dashdot:'一点鎖線'};
      const kindNames={line:'直線を接続',corner:'角（L字）を接続',t_junction:'T字で接続',arc:'円弧を接続',line_arc:'直線と円弧を接続'};
      for(const [index,candidate] of candidates.entries()){
        const button=document.createElement('button');button.type='button';button.dataset.candidateId=String(candidate.id);
        const badge=candidate.underlay_resolved?'・下絵一致':candidate.ambiguous?'・接続先が複数':candidate.ink_supported?'・下絵一致':'';
        button.textContent=`候補${index+1} ${kindNames[candidate.kind]||'直線を接続'}（${styleNames[candidate.style]}）${badge}`;
        button.title='この候補だけを即反映します。間違えたら「元に戻す」で取り消せます。';
        button.onclick=()=>this.apply(e,candidate.id);
        button.onpointerenter=()=>this.setHover(e,candidate.id);
        button.onpointerleave=()=>this.setHover(e,null);
        button.onfocus=()=>this.setHover(e,candidate.id);
        button.onblur=()=>this.setHover(e,null);
        container.append(button);
      }
      e.partialRepairRenderKey=key;
    }
    this.syncHover(e);
    if(container)for(const button of container.querySelectorAll('button'))button.disabled=disabled;
    const hint=document.getElementById('partialRepairHint');
    if(hint)hint.textContent=!e.doc?'図面を開いてください。下絵のない編集データでも利用できます。':e.partialRepairStatus||'修正したい部分を囲んでください。';
  },
  nearest(e,p){
    const session=this.session(e);if(!session||e.mode!=='partialRepair')return null;
    let best=8/e.view.scale,found=null;
    for(const candidate of session.candidates){
      let distance=Infinity;
      for(const seg of candidate.segments){
        const d=e.distance(seg,p);
        if(d<distance)distance=d;
      }
      if(distance<best-1e-9||(Math.abs(distance-best)<1e-9&&candidate.id===e.partialRepairHover)){best=distance;found=candidate;}
    }
    return found;
  },
  pick(e,p){
    if(e.busy||e.mode!=='partialRepair')return false;
    const candidate=this.nearest(e,p);if(!candidate)return false;
    this.apply(e,candidate.id);return true;
  },
  labelPoint(e,candidate){
    if(candidate.corner)return candidate.corner;
    const first=candidate.segments?.[0];
    if(first?.type==='arc')return e.arcPoint(first,first.start_deg+first.extent_deg/2);
    return [(candidate.p0[0]+candidate.p1[0])/2,(candidate.p0[1]+candidate.p1[1])/2];
  },
  draw(e,c){
    const session=this.session(e);
    const previewOnly=e.mode!=='partialRepair';
    if(previewOnly&&(!session||e.partialRepairHover==null))return;
    const scale=e.view.scale,boxes=this.boxesOf(e);
    c.save();
    for(const [bi,box] of boxes.entries()){
      c.strokeStyle='#158483';c.lineWidth=1.5/scale;c.setLineDash([6/scale,4/scale]);
      c.strokeRect(box[0],box[1],box[2]-box[0],box[3]-box[1]);
      if(boxes.length>1){
        c.setLineDash([]);c.fillStyle='#158483';
        c.font=`bold ${11/scale}px "Segoe UI",Meiryo,sans-serif`;c.textAlign='left';c.textBaseline='bottom';
        c.fillText(`#${bi+1}`,box[0]+2/scale,box[1]-2/scale);
      }
    }
    if(session)for(const [index,candidate] of session.candidates.entries()){
      const active=candidate.id===e.partialRepairHover;
      if(previewOnly&&!active)continue;
      c.strokeStyle=active?'#0064c8':candidate.ambiguous?'#b77920':'#168574';c.lineWidth=(active?3.5:2)/scale;
      c.setLineDash([6/scale,4/scale]);
      for(const seg of candidate.segments){c.beginPath();DraftGeometry.trace(c,seg);c.stroke();}
      c.setLineDash([]);c.fillStyle=c.strokeStyle;
      const dots=candidate.corner?[candidate.p0,candidate.corner,candidate.p1]:[candidate.p0,candidate.p1];
      for(const point of dots){c.beginPath();c.arc(...point,(active?4:3)/scale,0,Math.PI*2);c.fill();}
      if(active||session.candidates.length<=12){
        const [mx,my]=this.labelPoint(e,candidate);
        c.font=`${11/scale}px "Segoe UI",Meiryo,sans-serif`;c.textAlign='center';c.textBaseline='bottom';c.fillText(String(index+1),mx,my-5/scale);
      }
    }
    c.restore();
  }
};
