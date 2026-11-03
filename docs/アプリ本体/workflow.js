window.DraftWorkflow={
  init(e){
    document.getElementById('previewRegion').textContent='範囲を再変換';document.getElementById('previewArc').textContent='円・円弧を変更';
    e.protection=[];e.protectionUndo=[];e.protectionRedo=[];e.rotationUndo=[];e.rotationRedo=[];e.backgroundTurns=0;e.baselineTurns=0;e.pendingPreview=null;e.regionBox=null;e.revision=0;
    document.getElementById('mode').add(new Option('範囲再変換','region'));
    document.getElementById('regionMode').onclick=()=>e.setMode('region');
    document.getElementById('previewRegion').onclick=()=>this.region(e);
    document.getElementById('protectSelected').onclick=()=>{
      if(e.busy||!e.selected.size)return;
      const boxes=[...e.selected].map(key=>{const [pi,si]=key.split(':').map(Number);return this.padded(e.bounds(e.doc.paths[pi].segments[si]));});
      e.protection=this.limit([...e.protection,...boxes]);e.dirty=true;e.update();e.draw();
    };
    document.getElementById('clearProtection').onclick=()=>{if(e.busy||!e.protection.length)return;if(!confirm('再変換から守る保護範囲をすべて解除しますか？図形自体は変更しません。'))return;e.protection=[];e.dirty=true;e.update();e.draw();};
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
  difference(before,after){
    const flatten=paths=>paths.flatMap((p,pi)=>p.segments.map((s,si)=>({ref:[pi,si],s,key:JSON.stringify(s)})));
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
        else if(document.getElementById('autoProtect').checked&&request.kind!=='region'&&!(action==='applyPreview'&&request.sourceAction==='region')){
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
  region(e){
    if(e.busy||!e.regionBox||!e.background)return;
    try{
      const b=e.regionBox,pad=64,x=Math.max(0,b[0]-pad),y=Math.max(0,b[1]-pad),w=Math.min(e.doc.width,b[2]+pad)-x,h=Math.min(e.doc.height,b[3]+pad)-y;
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.translate(-x,-y);DraftRotation.drawBackground(e,ctx);
      const pixels=ctx.getImageData(0,0,w,h).data.buffer;
      e.send({kind:'region',width:w,height:h,pixels,box:b,offset:[x,y],protection:e.protection,noise:Number(document.getElementById('regionNoise').value)});
      document.getElementById('status').textContent='指定範囲を再変換しています…';
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
