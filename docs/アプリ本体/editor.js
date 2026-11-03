window.DraftEditor = class {
  get busy(){return !!this.processing||!!this.comparing||!!this.pendingPreview||!!this.pendingMove||!!this.drag?.move?.started;}
  set busy(value){this.processing=value;}
  constructor(canvas,send){
    this.canvas=canvas;this.send=send;this.doc=null;this.selected=new Set();this.mode='select';this.dirty=false;this.busy=false;
    this.view={scale:1,x:0,y:0};this.background=null;this.drag=null;this.undo=false;this.redo=false;this.anchors=new Map();
    this.comparing=false;this.baseline=null;
    document.getElementById('compareBefore').onclick=()=>{if(this.processing||this.pendingPreview||!this.doc)return;this.comparing=!this.comparing;this.drag=null;this.setMode('select');};
    DraftMeasure.init(this);DraftDraw.init(this);DraftEndpoint.init(this);DraftExtend.init(this);DraftCut.init(this);DraftWorkflow.init(this);DraftInspect.init(this);this.attach();new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  setDocument(r,{background=null,dpi=300,name='drawing',dirty=true,calibration=null,baselineLabel='変換直後',baselinePaths=null,protection=[],backgroundTurns=0,baselineTurns=0}={}){
    this.drag=null;this.pendingMove=null;this.comparing=false;this.saveRequested=false;this.baseline=structuredClone(DraftPaths.normalize(baselinePaths||r.paths));this.baselineLabel=baselineLabel;
    this.pendingPreview=null;this.regionBox=null;this.protection=DraftWorkflow.validate(protection);this.protectionUndo=[];this.protectionRedo=[];this.revision=0;this.lastRequest=null;this.arcRef=null;
    this.rotationUndo=[];this.rotationRedo=[];this.pendingRotationMeta=null;this.backgroundTurns=backgroundTurns;this.baselineTurns=baselineTurns;
    DraftMeasure.reset(this,calibration);
    DraftInspect.reset(this);
    DraftEndpoint.reset(this);
    DraftExtend.reset(this);this.stopBrush();this.cyclePick=null;
    DraftCut.reset(this);
    this.drawPoints=[];this.drawHover=null;
    this.doc={width:r.width,height:r.height,paths:DraftPaths.normalize(r.paths)};this.name=name;this.dpi=dpi;this.backgroundData=background;
    this.undo=this.redo=false;this.dirty=dirty;this.selected.clear();this.anchors.clear();this.background=null;
    if(background){const image=new Image();image.onload=()=>{if(this.backgroundData===background){this.background=image;this.update();this.draw();}};image.src=background;}
    this.fit();this.update();
  }
  acceptEdit(response){const rotated=DraftWorkflow.accepted(this,response);this.pendingMove=null;this.stopBrush();this.cyclePick=null;DraftInspect.reset(this,'図面を編集しました。候補を再検出してください。');DraftCut.reset(this);DraftEndpoint.reset(this);DraftExtend.reset(this);this.doc.paths=DraftPaths.normalize(response.paths);this.undo=response.undo;this.redo=response.redo;this.selected=new Set((response.selected||[]).map(ref=>ref.join(':')));this.anchors.clear();this.drawPoints=[];this.drawHover=null;this.arcRef=null;this.dirty=true;this.setBusy(false);if(rotated)this.fit();else this.draw();}
  setMode(mode){if(this.mode==='measure'&&mode!=='measure'&&this.measurePoints.length===1)this.measurePoints=[];DraftMeasure.dismiss(this);this.drag=null;this.stopBrush();this.cyclePick=null;DraftCut.reset(this);DraftEndpoint.reset(this);DraftExtend.reset(this);this.mode=mode;document.getElementById('mode').value=mode;this.drawPoints=[];this.drawHover=null;this.selected.clear();this.anchors.clear();this.update();this.draw();}
  setBusy(v){this.busy=v;this.update();}
  update(){
    const compare=document.getElementById('compareBefore');compare.disabled=!!this.processing||!!this.pendingPreview||!this.doc;compare.textContent=this.comparing?'編集後に戻る':'修正前を比較';compare.setAttribute('aria-pressed',String(!!this.comparing));compare.classList.toggle('active-tool',!!this.comparing);
    document.getElementById('comparisonState').textContent=this.comparing?`修正前：${this.baselineLabel}（閲覧のみ）`:'編集後を表示';
    for(const id of ['input','convert','dpi','noise','pdfPage','pdfDpi'])document.getElementById(id).disabled=this.busy||!window.probeState.ready;
    for(const id of ['mode','tolerance'])document.getElementById(id).disabled=this.busy||!this.doc;
    DraftMeasure.update(this);
    DraftDraw.update(this);
    DraftEndpoint.update(this);
    DraftExtend.update(this);
    DraftCut.update(this);
    DraftInspect.update(this);
    DraftWorkflow.update(this);
    document.getElementById('selection').textContent=`選択 ${this.selected.size} 要素`;
    document.getElementById('savedState').textContent=this.doc?(this.dirty?'未保存':this.saveRequested?'保存先を確認':'変更なし'):'';
    const count=this.doc?this.doc.paths.reduce((sum,p)=>sum+p.segments.length,0):0;
    document.getElementById('elementCount').textContent=this.comparing?`修正前 ${this.baseline.reduce((n,p)=>n+p.segments.length,0)} ／ 編集後 ${count} 要素`:`全 ${count} 要素`;
    for(const id of ['delete','merge','align','horizontal','vertical'])document.getElementById(id).disabled=this.busy || !this.selected.size;
    document.getElementById('linearize').disabled=this.busy||![...this.selected].some(key=>{const [p,s]=key.split(':').map(Number);return this.doc.paths[p].segments[s].type==='arc';});
    document.getElementById('corner').disabled=this.busy||this.selected.size!==2;
    document.getElementById('mergeArcs').disabled=this.busy||this.selected.size<2;
    document.getElementById('undo').disabled=this.busy||!this.undo;document.getElementById('redo').disabled=this.busy||!this.redo;
    for(const id of ['saveProject','exportPdf','exportDxf'])document.getElementById(id).disabled=this.busy||!this.doc;
    for(const id of ['rotateCW','rotateCCW'])document.getElementById(id).disabled=this.busy||!this.doc;
    document.getElementById('openProject').disabled=this.busy;
    if(this.doc){const dpi=Number(document.getElementById('dpi').value);document.getElementById('paperSize').textContent=Number.isFinite(dpi)&&dpi>0?`${(this.doc.width*25.4/dpi).toFixed(1)} × ${(this.doc.height*25.4/dpi).toFixed(1)} mm（用紙寸法）`:'';}
    if(window.DraftLayout)DraftLayout.update(this);
    if(window.DraftWorkbench)DraftWorkbench.update(this);
    if(window.DraftSettings)DraftSettings.update(this);
    if(window.DraftBackup)DraftBackup.schedule(this);
  }
  fit(){if(!this.doc)return;const r=this.canvas.getBoundingClientRect();this.view.scale=Math.min((r.width-36)/this.doc.width,(r.height-36)/this.doc.height);this.view.x=(r.width-this.doc.width*this.view.scale)/2;this.view.y=(r.height-this.doc.height*this.view.scale)/2;this.draw();}
  fitSelection(){
    if(this.busy||!this.doc||!this.selected.size)return;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const key of this.selected){const [pi,si]=key.split(':').map(Number),path=this.doc.paths[pi],segment=path?.segments[si];if(!segment||!this.visible(path))continue;const b=this.bounds(segment);bounds[0]=Math.min(bounds[0],b[0]);bounds[1]=Math.min(bounds[1],b[1]);bounds[2]=Math.max(bounds[2],b[2]);bounds[3]=Math.max(bounds[3],b[3]);}
    if(!bounds.every(Number.isFinite))return;
    const r=this.canvas.getBoundingClientRect(),w=Math.max(1,bounds[2]-bounds[0]),h=Math.max(1,bounds[3]-bounds[1]);
    this.view.scale=Math.max(.005,Math.min(100,Math.max(1,r.width-60)/w,Math.max(1,r.height-60)/h));
    this.view.x=r.width/2-(bounds[0]+bounds[2])*this.view.scale/2;this.view.y=r.height/2-(bounds[1]+bounds[3])*this.view.scale/2;this.draw();
  }
  position(event){const r=this.canvas.getBoundingClientRect();return [event.clientX-r.left,event.clientY-r.top];}
  world(point){return [(point[0]-this.view.x)/this.view.scale,(point[1]-this.view.y)/this.view.scale];}
  zoom(factor,at){const r=this.canvas.getBoundingClientRect();at??=[r.width/2,r.height/2];const p=this.world(at);this.view.scale=Math.max(.005,Math.min(100,this.view.scale*factor));this.view.x=at[0]-p[0]*this.view.scale;this.view.y=at[1]-p[1]*this.view.scale;this.draw();}
  visible(){return true;}
  draw(){
    const canvas=this.canvas,r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
    const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#e5ebeb';c.fillRect(0,0,r.width,r.height);
    if(!this.doc){c.fillStyle='#52666b';c.font='16px system-ui';c.textAlign='center';c.fillText('図面を開いてください',r.width/2,r.height/2);return;}
    const v=this.view;c.translate(v.x,v.y);c.scale(v.scale,v.scale);c.save();c.fillStyle='white';c.shadowColor='rgba(25,44,50,.16)';c.shadowBlur=14*dpr;c.shadowOffsetY=3*dpr;c.fillRect(0,0,this.doc.width,this.doc.height);c.restore();
    if(this.background&&document.getElementById('showOriginal').checked){c.globalAlpha=Number(document.getElementById('opacity').value);DraftRotation.drawBackground(this,c);c.globalAlpha=1;}
    const displayed=this.comparing?this.baseline:this.doc.paths;
    c.save();if(this.comparing)DraftRotation.context(c,this.doc.width,this.doc.height,this.baselineTurns);
    const moving=this.drag?.move?.started?this.drag.move.delta:this.pendingMove?.delta;
    for(let pi=0;pi<displayed.length;pi++){const p=displayed[pi];if(!this.visible(p))continue;
      for(let si=0;si<p.segments.length;si++){const s=p.segments[si],selected=this.selected.has(`${pi}:${si}`);c.strokeStyle=selected?'#0057d9':'#d100b4';c.lineWidth=(selected?2.5:1)/v.scale;c.beginPath();
        if(selected&&moving){c.save();c.translate(...moving);}
        if(s.type==='line'){c.moveTo(...s.p0);c.lineTo(...s.p1);}else c.arc(...s.center,s.radius,s.start_deg*Math.PI/180,(s.start_deg+s.extent_deg)*Math.PI/180,s.extent_deg<0);c.stroke();if(selected&&moving)c.restore();
      }
    }
    c.restore();if(!this.comparing){DraftMeasure.draw(this,c);
    DraftDraw.draw(this,c);
    DraftEndpoint.draw(this,c);
    DraftExtend.draw(this,c);
    DraftCut.draw(this,c);
    if(!moving)DraftInspect.draw(this,c);
    DraftWorkflow.draw(this,c);
    if(window.DraftWorkbench)DraftWorkbench.draw(this,c);
    }
    if(this.drag&&!this.drag.pan&&!this.drag.move&&!this.drag.paint&&['select','region'].includes(this.mode)){const a=this.world(this.drag.start),b=this.world(this.drag.last);c.strokeStyle=this.mode==='region'?'#158483':'#0057d9';c.lineWidth=1/v.scale;c.setLineDash([5/v.scale,3/v.scale]);c.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);c.setLineDash([]);}
    document.getElementById('zoomLevel').textContent=`表示 ${Math.round(v.scale*100)}%`;
  }
  arcPoint(s,angle){const a=angle*Math.PI/180;return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];}
  inArc(s,angle){return Math.abs(s.extent_deg)>=359.999999 || ((s.extent_deg>=0?angle-s.start_deg:s.start_deg-angle)%360+360)%360 <=Math.abs(s.extent_deg)+1e-8;}
  bounds(s){const pts=s.type==='line'?[s.p0,s.p1]:[this.arcPoint(s,s.start_deg),this.arcPoint(s,s.start_deg+s.extent_deg),...[0,90,180,270].filter(a=>this.inArc(s,a)).map(a=>this.arcPoint(s,a))];return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];}
  distance(s,p){if(s.type==='line'){const dx=s.p1[0]-s.p0[0],dy=s.p1[1]-s.p0[1],t=Math.max(0,Math.min(1,((p[0]-s.p0[0])*dx+(p[1]-s.p0[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-s.p0[0]-t*dx,p[1]-s.p0[1]-t*dy);}const a=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI;if(this.inArc(s,a))return Math.abs(Math.hypot(p[0]-s.center[0],p[1]-s.center[1])-s.radius);return Math.min(...[s.start_deg,s.start_deg+s.extent_deg].map(a=>{const q=this.arcPoint(s,a);return Math.hypot(p[0]-q[0],p[1]-q[1]);}));}
  selectedAt(point){
    if(!this.doc||this.mode!=='select'||this.busy)return false;
    for(const key of this.selected){const [pi,si]=key.split(':').map(Number),p=this.doc.paths[pi],s=p?.segments[si];if(s&&this.visible(p)&&DraftGeometry.allowed(p,s)&&this.distance(s,point)<7/this.view.scale)return true;}
    return false;
  }
  stopBrush(){this.altPainting=false;this.brushLast=null;this.brushCache=null;this.canvas.classList.remove('is-brushing');}
  paintSelection(from,to){
    if(this.mode!=='select'||this.busy||!this.doc||DraftSettings.isOpen)return;
    const filter=document.getElementById('selectFilter').value;
    if(this.brushCache?.paths!==this.doc.paths||this.brushCache.filter!==filter){const items=[];this.doc.paths.forEach((p,pi)=>{if(this.visible(p))p.segments.forEach((s,si)=>{if(DraftGeometry.allowed(p,s))items.push({key:`${pi}:${si}`,s,b:this.bounds(s)});});});this.brushCache={paths:this.doc.paths,filter,items};}
    const a=this.world(from),b=this.world(to),trace={type:'line',p0:a,p1:b},radius=4/this.view.scale,box=[Math.min(a[0],b[0])-radius,Math.min(a[1],b[1])-radius,Math.max(a[0],b[0])+radius,Math.max(a[1],b[1])+radius];let changed=false;
    for(const item of this.brushCache.items){if(this.selected.has(item.key)||item.b[0]>box[2]||item.b[2]<box[0]||item.b[1]>box[3]||item.b[3]<box[1])continue;if(DraftGeometry.distance(item.s,trace)<=radius){this.selected.add(item.key);this.anchors.set(item.key,DraftGeometry.nearest(item.s,b).point);changed=true;}}
    this.cyclePick=null;if(changed){this.update();this.draw();}
  }
  choose(start,end,add,cycle=false){
    if(this.busy)return;
    if(this.mode==='trimTo'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftWorkbench.pickTrim(this,this.world(end));return;}
    if(this.mode==='region'){DraftWorkflow.box(this,this.world(start),this.world(end));return;}
    if(DraftCut.active(this)){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftCut.pick(this,this.world(end));return;}
    if(this.mode==='endpoint'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftEndpoint.pick(this,this.world(end));return;}
    if(this.mode==='extend'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftExtend.pick(this,this.world(end));return;}
    if(DraftDraw.active(this)){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftDraw.pick(this,this.world(end));return;}
    if(this.mode==='measure'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftMeasure.pick(this,this.world(end));return;}
    const prior=[...this.selected];if(!add){this.selected.clear();this.anchors.clear();}const a=this.world(start),b=this.world(end),box=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    const click=Math.hypot(end[0]-start[0],end[1]-start[1])<4;let best=null,dist=7/this.view.scale;const hits=[];
    this.doc.paths.forEach((p,pi)=>{if(!this.visible(p))return;p.segments.forEach((s,si)=>{if(!DraftGeometry.allowed(p,s))return;const key=`${pi}:${si}`;if(click){const d=this.distance(s,b);if(d<7/this.view.scale)hits.push({key,d});if(d<dist){dist=d;best=key;}}else{const bounds=this.bounds(s);if(document.getElementById('boxSelection').value==='touch'?DraftGeometry.touches(s,box):bounds[0]>=box[0]&&bounds[1]>=box[1]&&bounds[2]<=box[2]&&bounds[3]<=box[3])this.selected.add(key);}});});
    if(cycle&&hits.length){hits.sort((a,b)=>a.d-b.d);const last=this.cyclePick&&Math.hypot(b[0]-this.cyclePick.point[0],b[1]-this.cyclePick.point[1])<2/this.view.scale?this.cyclePick.key:null,index=hits.findIndex(h=>last?h.key===last:prior.includes(h.key));best=hits[(index+1)%hits.length].key;this.cyclePick={point:b,key:best};}else this.cyclePick=null;
    if(best){if(add&&this.selected.has(best)){this.selected.delete(best);this.anchors.delete(best);}else{this.selected.add(best);this.anchors.set(best,b);}}this.update();this.draw();
  }
  edit(action){if(this.busy||!this.doc)return;if(['undo','redo'].includes(action)&&window.DraftHistory){DraftHistory.step(this,action==='undo'?-1:1);return;} if(!['undo','redo','rotateCW','rotateCCW'].includes(action)&&!this.selected.size)return;
    const tolerance=action==='mergeArcs'?null:Number(document.getElementById('tolerance').value);
    if(['merge','align'].includes(action)&&(!Number.isFinite(tolerance)||tolerance<=0)){window.alert('許容ずれには正の数値を指定してください。');return;}
    try{this.pendingRotationMeta=DraftRotation.prepare(this,action);}catch(error){document.getElementById('status').textContent=error.message;return;}
    let reference={};if(action==='mergeArcs')try{reference=DraftCircleReference.raster(this);}catch(_){/* Geometry restoration remains available if the underlay cannot be sampled. */}
    this.setBusy(true);this.send({kind:'edit',action,refs:[...this.selected].map(key=>key.split(':').map(Number)),anchors:Object.fromEntries(this.anchors),tolerance,relaxed:action==='mergeArcs',width:this.doc.width,height:this.doc.height,...reference});
  }
  project(){return {format:'draft-to-dxf-project',version:1,width:this.doc.width,height:this.doc.height,dpi:Number(document.getElementById('dpi').value),name:this.name,paths:this.doc.paths,background:this.backgroundData,backgroundTurns:this.backgroundTurns,baselineTurns:this.baselineTurns,calibration:this.calibration,protection:this.protection,baselinePaths:this.baseline,baselineLabel:this.baselineLabel};}
  attach(){const canvas=this.canvas;
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{if(!this.doc)return;e.preventDefault();if(this.drag?.move)return;this.stopBrush();this.update();this.zoom(e.deltaY<0?1.15:1/1.15,this.position(e));},{passive:false});
    canvas.addEventListener('pointerdown',e=>{
      if(this.processing||!this.doc||this.drag)return;e.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
      const point=this.position(e),pan=this.comparing||!!this.pendingPreview||this.mode==='pan'||e.button===1||e.button===2||e.shiftKey||this.spacePan;
      this.pointerInside=true;this.pointerPosition=point;
      const paint=!pan&&this.mode==='select'&&e.altKey&&!e.ctrlKey&&!e.metaKey&&e.button===0;
      if(paint){this.altPainting=true;this.paintSelection(point,point);this.brushLast=point;canvas.classList.add('is-brushing');}else this.stopBrush();
      const move=!pan&&e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&this.selectedAt(this.world(point));
      this.drag={start:point,last:point,pointerId:e.pointerId,pan,paint,add:e.ctrlKey||e.metaKey,cycle:e.altKey&&(e.ctrlKey||e.metaKey),move:move?{refs:[...this.selected].map(key=>key.split(':').map(Number)),delta:[0,0],started:false}:null};
      canvas.classList.remove('can-move');canvas.classList.toggle('is-panning',!!pan);
    });
    canvas.addEventListener('pointermove',e=>{
      const point=this.position(e),r=canvas.getBoundingClientRect();this.pointerPosition=point;this.pointerInside=point[0]>=0&&point[1]>=0&&point[0]<=r.width&&point[1]<=r.height;
      if(this.pointerInside&&e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!this.spacePan&&!typing(document.activeElement)&&(e.buttons===0||e.buttons===1)&&(!this.drag||!this.drag.pan&&!this.drag.move)&&this.mode==='select'&&!this.busy&&!DraftSettings.isOpen){const active=this.altPainting;this.altPainting=true;if(this.drag){this.drag.paint=true;this.drag.last=point;}canvas.classList.add('is-brushing');canvas.classList.remove('can-move');this.paintSelection(this.brushLast||point,point);this.brushLast=point;if(!active)this.update();return;}
      if(this.altPainting){this.stopBrush();this.update();}
      if(this.drag){const d=this.drag;if(d.pan){this.view.x+=point[0]-d.last[0];this.view.y+=point[1]-d.last[1];}else if(d.move){
        const started=d.move.started;d.move.started||=Math.hypot(point[0]-d.start[0],point[1]-d.start[1])>=4;
        if(d.move.started)d.move.delta=point.map((v,i)=>(v-d.start[i])/this.view.scale);
        if(!started&&d.move.started)this.update();if(d.move.started)window.DraftLayout?.updateDrag(this);
      }d.last=point;}
      if(!this.drag)canvas.classList.toggle('can-move',this.selectedAt(this.world(point)));
      if(this.doc&&!this.busy&&DraftDraw.active(this))this.drawHover=DraftDraw.snap(this,this.world(point));if(this.doc&&!this.busy&&this.mode==='endpoint')DraftEndpoint.hover(this,this.world(point));if(this.doc&&!this.busy&&this.mode==='extend')DraftExtend.hover(this,this.world(point));if(this.drag||DraftDraw.active(this)||this.mode==='endpoint'||this.mode==='extend')this.draw();
    });
    const cancelDrag=()=>{this.drag=null;this.stopBrush();canvas.classList.toggle('is-panning',!!this.spacePan);this.update();this.draw();};
    canvas.addEventListener('pointerup',e=>{
      if(!this.drag||this.drag.pointerId!==e.pointerId)return;const d=this.drag;this.drag=null;
      if(d.move?.started){
        const delta=this.position(e).map((v,i)=>(v-d.start[i])/this.view.scale);
        if(Math.hypot(...delta)>1e-9){this.pendingMove={refs:d.move.refs,delta};this.send({kind:'edit',action:'translate',refs:d.move.refs,delta});}else this.update();
      }else if(!d.pan&&!d.paint)this.choose(d.start,this.position(e),d.add,d.cycle);
      canvas.classList.toggle('is-panning',!!this.spacePan);window.DraftLayout?.update(this);this.draw();
    });
    canvas.addEventListener('pointercancel',cancelDrag);
    canvas.addEventListener('pointerleave',()=>{this.pointerInside=false;this.stopBrush();this.update();});
    canvas.addEventListener('lostpointercapture',()=>{if(this.drag)cancelDrag();});
    const typing=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    // Capture Escape before tool-specific handlers: first cancel points, then leave the tool.
    document.addEventListener('keydown',e=>{
      if(DraftSettings.isOpen||e.key!=='Escape'||e.isComposing||typing(e.target)||this.processing||!this.doc)return;
      e.preventDefault();e.stopImmediatePropagation();const wasMoving=!!this.drag?.move;this.drag=null;this.spacePan=false;this.stopBrush();
      if(wasMoving){/* Cancel only the uncommitted movement; keep selection. */}
      else if(this.comparing){document.getElementById('compareBefore').click();}
      else if(this.pendingPreview){DraftWorkflow.cancel(this);}
      else if(this.drawPoints.length){DraftDraw.cancel(this);}
      else if(this.cutDraft){DraftCut.reset(this);}
      else if(this.endpointDraft){DraftEndpoint.reset(this);}
      else if(this.extendDraft){DraftExtend.reset(this);}
      else if(this.mode==='measure'&&this.measurePoints.length){this.measurePoints=[];}
      else this.setMode('select');
      this.update();this.draw();
    },true);
    document.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.isComposing||DraftSettings.isOpen||!this.doc)return;
      if(e.key==='Alt'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&this.mode==='select'&&this.pointerInside&&!this.drag&&!typing(e.target)&&!this.busy){e.preventDefault();this.altPainting=true;canvas.classList.add('is-brushing');if(this.pointerPosition){this.paintSelection(this.pointerPosition,this.pointerPosition);this.brushLast=this.pointerPosition;}this.update();return;}
      const action=DraftSettings.action(e),ctrl=e.ctrlKey||e.metaKey;
      // Never download a webpage when the user has reassigned the project save key.
      if(ctrl&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='s'&&!action){e.preventDefault();return;}
      // A modified save binding also works from document input fields.
      if(action==='saveProject'&&ctrl){e.preventDefault();if(!e.repeat)DraftSettings.run(action,this);return;}
      if(typing(e.target))return;
      if(!ctrl&&!e.altKey&&e.code==='Space'&&!this.processing){if(e.target instanceof Element&&e.target.closest('button,summary,a'))return;e.preventDefault();this.spacePan=true;canvas.classList.add('is-panning');return;}
      if(action){e.preventDefault();if(!e.repeat)DraftSettings.run(action,this);}
    });
    document.addEventListener('keyup',e=>{if(e.key==='Alt'){if(this.altPainting)e.preventDefault();this.stopBrush();this.update();}if(e.code==='Space'){this.spacePan=false;canvas.classList.toggle('is-panning',!!this.drag?.pan);}});
    window.addEventListener('blur',()=>{this.spacePan=false;this.drag=null;this.pointerInside=false;this.stopBrush();canvas.classList.remove('is-panning');this.update();this.draw();});
    window.addEventListener('beforeunload',e=>{if(this.dirty){e.preventDefault();e.returnValue='';}});
  }
};
