window.DraftWorkflow={
  init(e){
    document.getElementById('previewRegion').textContent='範囲を再変換';document.getElementById('previewArc').textContent='円・円弧を変更';
    e.protection=[];e.protectionUndo=[];e.protectionRedo=[];e.rotationUndo=[];e.rotationRedo=[];e.backgroundTurns=0;e.baselineTurns=0;e.pendingPreview=null;e.regionBox=null;e.revision=0;
    document.getElementById('regionMode').onclick=()=>e.setMode('region');
    document.getElementById('previewRegion').onclick=()=>this.region(e);
    document.getElementById('outlineMode').onclick=()=>{if(e.busy||!e.doc||!e.background)return;e.setMode('outline');e.canvas.focus({preventScroll:true});};
    document.getElementById('outlineRegion').onclick=()=>this.outline(e);
    document.getElementById('outlineMethod').onchange=()=>e.update();
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
  async outline(e){
    if(e.busy||!e.regionBox||!e.background||!e.doc)return;
    try{
      const b=e.regionBox.map(Math.round),x=b[0],y=b[1],w=b[2]-x,h=b[3]-y;
      if(w<3||h<3)throw Error('塊全体が入るよう、もう少し大きく囲んでください。');
      if(w*h>16000000)throw Error('選択範囲が大きすぎます。小さい範囲に分けてください。');
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.translate(-x,-y);DraftRotation.drawBackground(e,ctx);
      const rgba=ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(w*h);
      for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
      // Decide polarity from the whole underlay, never a mostly-black crop.
      const probe=document.createElement('canvas');probe.width=probe.height=64;
      const pc=probe.getContext('2d');pc.fillStyle='white';pc.fillRect(0,0,64,64);pc.drawImage(e.background,0,0,64,64);
      const sample=pc.getImageData(0,0,64,64).data,levels=new Uint8Array(4096);
      for(let i=0,p=0;i<levels.length;i++,p+=4)levels[i]=(sample[p]*77+sample[p+1]*150+sample[p+2]*29)>>8;
      levels.sort();const invert=levels[2048]<115?'light_lines':'dark_lines';
      const outlineMethod=document.getElementById('outlineMethod').value;
      e.send({kind:'outline',label:'輪郭に置換',width:w,height:h,pixels:gray.buffer,box:b,offset:[x,y],protection:document.getElementById('outlineKeepProtected').checked?e.protection:[],invert,outlineMethod});
      document.getElementById('status').textContent='指定範囲の輪郭を抽出しています…';
    }catch(error){document.getElementById('outlineHint').textContent=error.message;}
  },
  outlineMessage(stats){
    const skipped=(stats.boundary_components_skipped||0)+(stats.skipped_components||0);
    if(!stats.changed){
      if(stats.protected_components_skipped)return '変更なし：手修正の保護が重なっています。ここを置き換える場合は「手修正した部分を残す」をOFFにして再実行できます。元に戻すで取り消せます。';
      if(stats.boundary_components_skipped||stats.replacement_boundary_components_skipped)return '変更なし：対象の線が枠の端につながっています。つながった部分全体が入るよう、もう少し広く囲んでください。';
      if(stats.mode!=='tangle'&&stats.degenerate_contours_skipped)return '変更なし：細い線の集まりです。「輪郭の作り方」を「細かい線をまとめる」にして再実行してください。';
      return '変更なし：'+(skipped?'輪郭が重なりすぎています。小さな範囲に分けてください。':'置換できる輪郭が元画像に見つかりませんでした。対象全体を囲んでください。');
    }
    if(!stats.removed)return `輪郭を${stats.added_paths||0}個追加しましたが、元の線は削除できていません。${stats.mode!=='tangle'?'「細かい線をまとめる」で再実行できます。':''}${stats.protected_components_skipped?'手修正の保護も重なっています。':''}不要な追加は「元に戻す」で取り消せます。`;
    return `${stats.mode==='tangle'?'細かい線をまとめて':'輪郭に'}置換：${stats.added_paths||0}輪郭（穴${stats.added_holes||0}）、${stats.removed||0}要素を置換。${stats.trimmed_segments?`接続線${stats.trimmed_segments}本は外側を維持。`:''}${skipped?'枠の端や保護部分は維持。':''}「元に戻す」で取り消せます。`;
  },
  update(e){
    const disabled=e.busy||!e.doc;
    for(const id of ['selectFilter','boxSelection','selectAll','clearSelection','regionMode','regionNoise','autoProtect','showProtection','snapMidpoint','snapCenter','drawAxis','drawExact','drawLength','drawAngle'])document.getElementById(id).disabled=disabled;
    document.getElementById('protectSelected').disabled=disabled||!e.selected.size;
    document.getElementById('clearProtection').disabled=disabled||!e.protection?.length;
    const box=e.regionBox,valid=box&&box[2]-box[0]>=2&&box[3]-box[1]>=2;
    document.getElementById('previewRegion').disabled=disabled||!valid||!e.background;
    document.getElementById('outlineMode').disabled=disabled||!e.background;
    document.getElementById('outlineKeepProtected').disabled=disabled||!e.background;
    document.getElementById('outlineMethod').disabled=disabled||!e.background;
    document.getElementById('outlineTangleWarning').hidden=document.getElementById('outlineMethod').value!=='tangle';
    document.getElementById('outlineRegion').disabled=disabled||!valid||!e.background;
    const outlineHint=document.getElementById('outlineHint');
    if(!e.doc||!e.background)outlineHint.textContent='下絵が必要です。元の画像・PDFから変換した図面を開いてください。';
    else if(e.mode==='outline')outlineHint.textContent=valid?`範囲 ${e.regionBox[2]-e.regionBox[0]}×${e.regionBox[3]-e.regionBox[1]} px。「輪郭に置換」で反映します。`:'細い線のもつれや黒い塊の全体をドラッグで囲んでください。';
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
    if(['region','outline'].includes(e.mode)&&e.regionBox){const b=e.regionBox;c.strokeStyle='#158483';c.lineWidth=2/e.view.scale;c.setLineDash([6/e.view.scale,4/e.view.scale]);c.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);c.setLineDash([]);}
    if(e.pendingPreview){for(const x of e.pendingPreview.diff.removed)this.stroke(e,c,x.s,'#dc2626',true);for(const x of e.pendingPreview.diff.added)this.stroke(e,c,x.s,'#168547');}
  }
};

// Manual local redraw. The worker validates geometry/revision; these guides are
// temporary and never become exported drawing paths until a candidate is chosen.
window.DraftPartialRepair={
  validBox(box){return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]-box[0]>=3&&box[3]-box[1]>=3;},
  reset(e,clearBox=false){
    const previous=e.partialRepairBox||e.partialRepairSession?.box;
    if(clearBox&&e.mode==='partialRepair')e.regionBox=null;
    e.partialRepairBox=!clearBox&&this.validBox(previous)?previous.slice():null;
    e.partialRepairSession=null;e.partialRepairHover=null;
    e.partialRepairStatus=e.partialRepairBox?'図面が変わったため候補を再検出してください。指定した範囲は残っています。':'修正したい部分を囲み、範囲内の線を消去します。下絵と枠外の線は残ります。';
    e.partialRepairRenderKey=null;
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
    document.getElementById('partialErase').onclick=()=>this.prepare(e);
    document.getElementById('partialKeepProtected').onchange=()=>this.update(e);
    e.canvas.addEventListener('pointermove',event=>{
      if(e.mode!=='partialRepair'||!e.doc||e.busy||e.drag)return;
      const candidate=this.nearest(e,e.world(e.position(event))),id=candidate?.id??null;
      if(id!==e.partialRepairHover){e.partialRepairHover=id;e.scheduleDraw();}
    });
    e.canvas.addEventListener('pointerleave',()=>{
      if(e.partialRepairHover!=null){e.partialRepairHover=null;e.scheduleDraw();}
    });
    this.update(e);
  },
  box(e,a,b){
    if(!e.doc||![...a,...b].every(Number.isFinite))return;
    const clamp=(value,max)=>Math.max(0,Math.min(max,value));
    const box=[clamp(Math.floor(Math.min(a[0],b[0])),e.doc.width),clamp(Math.floor(Math.min(a[1],b[1])),e.doc.height),
      clamp(Math.ceil(Math.max(a[0],b[0])),e.doc.width),clamp(Math.ceil(Math.max(a[1],b[1])),e.doc.height)];
    e.regionBox=box;e.partialRepairBox=box.slice();e.partialRepairSession=null;e.partialRepairHover=null;e.partialRepairRenderKey=null;
    e.partialRepairStatus=this.validBox(box)?'範囲を指定しました。「範囲内を消去・候補を出す」で反映します。':'もう少し大きな範囲を指定してください。';
    e.update();e.draw();
  },
  prepare(e){
    const box=e.partialRepairBox||e.regionBox;
    if(e.busy||!e.doc||!this.validBox(box))return;
    e.partialRepairBox=box.slice();
    if(e.mode!=='partialRepair')e.setMode('partialRepair');
    e.partialRepairStatus='範囲内の線と、外側からの接続候補を調べています…';
    e.send({kind:'partialRepair',label:'部分修復：範囲内消去',box:box.slice(),
      protection:document.getElementById('partialKeepProtected').checked?(e.protection||[]).map(b=>b.slice()):[]});
  },
  candidate(raw){
    const segment=raw?.paths?.[0]?.segments?.[0];
    const p0=raw?.p0||segment?.p0,p1=raw?.p1||segment?.p1;
    if(!raw||!['number','string'].includes(typeof raw.id)||!Array.isArray(p0)||!Array.isArray(p1)
       ||p0.length!==2||p1.length!==2||![...p0,...p1].every(Number.isFinite)
       ||Math.hypot(p1[0]-p0[0],p1[1]-p0[1])<1e-6)return null;
    const style=raw.line_style||raw.style||raw.paths?.[0]?.line_style||'solid';
    return {...raw,p0:p0.slice(),p1:p1.slice(),style:['solid','dashed','dashdot'].includes(style)?style:'solid'};
  },
  receive(e,payload){
    if(!payload||!e.doc)return;
    const box=this.validBox(payload.box)?payload.box.slice():e.partialRepairBox;
    const candidates=(Array.isArray(payload.candidates)?payload.candidates:[]).slice(0,64).map(c=>this.candidate(c)).filter(Boolean);
    const revision=Number.isInteger(payload.revision)?payload.revision:e.revision;
    const stats=payload.stats||{};
    e.partialRepairBox=box?box.slice():null;
    e.partialRepairSession={box:box?box.slice():null,candidates,revision,stats};e.partialRepairHover=null;
    const changed=payload.changed??stats.changed;
    const protectedCount=Number(stats.protected||stats.protected_regions||stats.protected_count||stats.protected_components_skipped||0);
    const ambiguous=candidates.some(c=>c.ambiguous);
    const clipped=stats.truncated||stats.anchors_truncated||stats.candidates_truncated||stats.anchor_limit_reached||stats.candidate_limit_reached||stats.crowded_bins>0;
    if(payload.phase==='applied'){
      e.partialRepairStatus=`候補を接続しました。${candidates.length?`残り${candidates.length}件。続けて必要な候補を選べます。`:'接続候補は残っていません。'}「元に戻す」で取り消せます。`;
    }else if(changed===false){
      e.partialRepairStatus=protectedCount?'変更なし：手修正の保護が範囲に重なっています。ここを消去してよい場合だけ「手修正した部分を残す」をOFFにして再実行してください。':candidates.length?`範囲内に消去する線はありません。接続候補${candidates.length}件を図面か一覧でクリックできます。`:'変更なし：範囲内に消去できる線がありません。修正したい部分を囲み直してください。';
    }else{
      e.partialRepairStatus=`範囲内の線を消去しました。${candidates.length?`接続候補${candidates.length}件。図面か一覧の候補をクリックして接続します。`:'接続候補はありません。必要な線・円弧は作図ツールで描き足せます。'}「元に戻す」で消去前へ戻せます。`;
    }
    if(ambiguous)e.partialRepairStatus+=' 接続先が複数ある候補は、下絵と照合して選んでください。';
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
    e.partialRepairStatus='選んだ候補を接続しています…';
    e.send({kind:'partialRepairApply',label:'部分修復：接続',candidateId:candidate.id,revision:session.revision});
  },
  update(e){
    const start=document.getElementById('partialRepairMode'),erase=document.getElementById('partialErase'),keep=document.getElementById('partialKeepProtected');
    if(!start||!erase||!keep)return;
    const disabled=e.busy||!e.doc;
    start.disabled=disabled;keep.disabled=disabled;
    erase.disabled=disabled||!this.validBox(e.partialRepairBox||e.regionBox);
    if(e.partialRepairSession&&e.partialRepairSession.revision!==e.revision&&!e.busy){
      e.partialRepairSession=null;e.partialRepairHover=null;e.partialRepairRenderKey=null;
      e.partialRepairStatus='図面が変更されたため接続候補を解除しました。「範囲内を消去・候補を出す」で再検出できます。';
    }
    const session=this.session(e),candidates=session?.candidates||[],container=document.getElementById('partialCandidates');
    const key=JSON.stringify([session?.revision,candidates.map(c=>[c.id,c.p0,c.p1,c.style,!!c.ambiguous])]);
    if(container&&key!==e.partialRepairRenderKey){
      container.replaceChildren();
      const styleNames={solid:'実線',dashed:'破線',dashdot:'一点鎖線'};
      for(const [index,candidate] of candidates.entries()){
        const button=document.createElement('button');button.type='button';button.dataset.candidateId=String(candidate.id);
        button.textContent=`候補${index+1} 直線を接続（${styleNames[candidate.style]}）${candidate.ambiguous?'・接続先が複数':''}`;
        button.title='この候補だけを即反映します。間違えたら「元に戻す」で取り消せます。';
        button.onclick=()=>this.apply(e,candidate.id);
        button.onpointerenter=()=>{e.partialRepairHover=candidate.id;e.scheduleDraw();};
        button.onpointerleave=()=>{e.partialRepairHover=null;e.scheduleDraw();};
        button.onfocus=()=>{e.partialRepairHover=candidate.id;e.scheduleDraw();};
        button.onblur=()=>{e.partialRepairHover=null;e.scheduleDraw();};
        container.append(button);
      }
      e.partialRepairRenderKey=key;
    }
    if(container)for(const button of container.querySelectorAll('button'))button.disabled=disabled;
    const hint=document.getElementById('partialRepairHint');
    if(hint)hint.textContent=!e.doc?'図面を開いてください。下絵のない編集データでも利用できます。':e.partialRepairStatus||'修正したい部分を囲んでください。';
  },
  nearest(e,p){
    const session=this.session(e);if(!session||e.mode!=='partialRepair')return null;
    let best=8/e.view.scale,found=null;
    for(const candidate of session.candidates){
      const [x,y]=candidate.p0,dx=candidate.p1[0]-x,dy=candidate.p1[1]-y,den=dx*dx+dy*dy;
      const t=Math.max(0,Math.min(1,((p[0]-x)*dx+(p[1]-y)*dy)/den));
      const distance=Math.hypot(p[0]-x-t*dx,p[1]-y-t*dy);
      if(distance<best-1e-9||(Math.abs(distance-best)<1e-9&&candidate.id===e.partialRepairHover)){best=distance;found=candidate;}
    }
    return found;
  },
  pick(e,p){
    if(e.busy||e.mode!=='partialRepair')return false;
    const candidate=this.nearest(e,p);if(!candidate)return false;
    this.apply(e,candidate.id);return true;
  },
  draw(e,c){
    if(e.mode!=='partialRepair')return;
    const scale=e.view.scale,box=e.partialRepairBox,session=this.session(e);
    c.save();
    if(this.validBox(box)){
      c.strokeStyle='#158483';c.lineWidth=1.5/scale;c.setLineDash([6/scale,4/scale]);
      c.strokeRect(box[0],box[1],box[2]-box[0],box[3]-box[1]);
    }
    if(session)for(const [index,candidate] of session.candidates.entries()){
      const active=candidate.id===e.partialRepairHover;
      c.strokeStyle=active?'#0064c8':candidate.ambiguous?'#b77920':'#168574';c.lineWidth=(active?3.5:2)/scale;
      c.setLineDash([6/scale,4/scale]);c.beginPath();c.moveTo(...candidate.p0);c.lineTo(...candidate.p1);c.stroke();
      c.setLineDash([]);c.fillStyle=c.strokeStyle;
      for(const point of [candidate.p0,candidate.p1]){c.beginPath();c.arc(...point,(active?4:3)/scale,0,Math.PI*2);c.fill();}
      if(active||session.candidates.length<=12){
        const mx=(candidate.p0[0]+candidate.p1[0])/2,my=(candidate.p0[1]+candidate.p1[1])/2;
        c.font=`${11/scale}px "Segoe UI",Meiryo,sans-serif`;c.textAlign='center';c.textBaseline='bottom';c.fillText(String(index+1),mx,my-5/scale);
      }
    }
    c.restore();
  }
};
