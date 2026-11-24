window.DraftEditor = class {
  get busy(){return !!this.processing||!!this.comparing||!!this.pendingPreview||!!this.pendingMove||!!this.drag?.move?.started;}
  set busy(value){this.processing=value;}
  constructor(canvas,send){
    this.canvas=canvas;this.send=send;this.doc=null;this.selected=new Set();this.mode='select';this.dirty=false;this.busy=false;
    this.view={scale:1,x:0,y:0};this.background=null;this.drag=null;this.undo=false;this.redo=false;this.anchors=new Map();
    this.comparing=false;this.baseline=null;this.overlayBaseline=false;this.lineWeight=1;this.hideVectors=false;
    this.hoverKey=null;this.editSeq=0;this._drawFrame=0;this.moveSnap=null;
    document.getElementById('compareBefore').onclick=()=>{if(this.processing||this.pendingPreview||!this.doc)return;this.comparing=!this.comparing;this.drag=null;this.setMode('select');};
    DraftMeasure.init(this);DraftDraw.init(this);DraftEndpoint.init(this);DraftExtend.init(this);DraftCut.init(this);DraftWorkflow.init(this);DraftInspect.init(this);this.attach();new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  scheduleDraw(){
    if(this._drawFrame)return;
    this._drawFrame=requestAnimationFrame(()=>{this._drawFrame=0;this.draw();});
  }
  setDocument(r,{background=null,dpi=300,name='drawing',dirty=true,calibration=null,baselineLabel='変換直後',baselinePaths=null,protection=[],backgroundTurns=0,baselineTurns=0}={}){
    this.drag=null;this.pendingMove=null;this.comparing=false;this.saveRequested=false;this.baseline=structuredClone(DraftPaths.normalize(baselinePaths||r.paths));this.baselineLabel=baselineLabel;
    this.pendingPreview=null;this.regionBox=null;this.protection=DraftWorkflow.validate(protection);this.protectionUndo=[];this.protectionRedo=[];this.revision=0;this.lastRequest=null;this.arcRef=null;
    this.rotationUndo=[];this.rotationRedo=[];this.pendingRotationMeta=null;this.backgroundTurns=backgroundTurns;this.baselineTurns=baselineTurns;
    DraftMeasure.reset(this,calibration);
    DraftInspect.reset(this);
    DraftEndpoint.reset(this);
    DraftExtend.reset(this);this.stopBrush();this.cyclePick=null;this.hoverKey=null;this.moveSnap=null;
    DraftCut.reset(this);
    this.drawPoints=[];this.drawHover=null;
    this.doc={width:r.width,height:r.height,paths:DraftPaths.normalize(r.paths)};this.name=name;this.dpi=dpi;
    this.undo=this.redo=false;this.dirty=dirty;this.selected.clear();this.anchors.clear();this.editSeq=0;
    if(background&&background===this.backgroundData&&this.background){
      // Reuse already decoded background image when identical.
    }else{
      this.backgroundData=background;this.background=null;
      if(background){const image=new Image();image.onload=()=>{if(this.backgroundData===background){this.background=image;this.update();this.draw();}};image.src=background;}
    }
    this.fit();this.update();
  }
  applySnapshot(p,paths,revision){
    // Restore history snapshot without re-decoding unchanged background or resetting viewport.
    this.drag=null;this.pendingMove=null;this.comparing=false;this.pendingPreview=null;this.regionBox=null;
    this.lastRequest=null;this.arcRef=null;this.pendingRotationMeta=null;this.hoverKey=null;this.moveSnap=null;
    this.stopBrush();this.cyclePick=null;
    DraftEndpoint.reset(this);DraftExtend.reset(this);DraftCut.reset(this);
    this.drawPoints=[];this.drawHover=null;
    this.doc={width:p.width,height:p.height,paths:DraftPaths.normalize(paths)};
    this.name=p.name;this.dpi=p.dpi;
    this.backgroundTurns=p.backgroundTurns??0;this.baselineTurns=p.baselineTurns??0;
    this.baseline=structuredClone(DraftPaths.normalize(p.baselinePaths||paths));
    this.baselineLabel=p.baselineLabel||this.baselineLabel;
    this.protection=DraftWorkflow.validate(p.protection);
    DraftMeasure.reset(this,p.calibration);
    this.revision=revision;
    this.selected.clear();this.anchors.clear();
    this.dirty=true;this.editSeq=(this.editSeq||0)+1;
    if(p.background!==this.backgroundData){
      this.backgroundData=p.background;this.background=null;
      if(p.background){const image=new Image();image.onload=()=>{if(this.backgroundData===p.background){this.background=image;this.draw();}};image.src=p.background;}
    }
    if(DraftInspect.refreshAfterEdit)DraftInspect.refreshAfterEdit(this);
    else DraftInspect.reset(this);
  }
  acceptEdit(response){
    const rotated=DraftWorkflow.accepted(this,response);
    this.pendingMove=null;this.stopBrush();this.cyclePick=null;this.hoverKey=null;this.moveSnap=null;
    DraftCut.reset(this);DraftEndpoint.reset(this);DraftExtend.reset(this);
    this.doc.paths=DraftPaths.normalize(response.paths);
    this.doc._spatialCache=null;
    this.undo=response.undo;this.redo=response.redo;
    this.selected=new Set((response.selected||[]).map(ref=>ref.join(':')));
    this.anchors.clear();this.drawPoints=[];this.drawHover=null;this.arcRef=null;
    this.dirty=true;this.editSeq=(this.editSeq||0)+1;
    if(DraftInspect.refreshAfterEdit)DraftInspect.refreshAfterEdit(this);
    else DraftInspect.reset(this,'図面を編集しました。候補を再検出してください。');
    this.setBusy(false);
    if(rotated)this.fit();else this.draw();
  }
  setMode(mode){
    if(this.mode==='measure'&&mode!=='measure'&&this.measurePoints.length===1)this.measurePoints=[];
    DraftMeasure.dismiss(this);
    this.drag=null;this.stopBrush();this.cyclePick=null;this.hoverKey=null;this.moveSnap=null;
    DraftCut.reset(this);DraftEndpoint.reset(this);DraftExtend.reset(this);
    this.mode=mode;document.getElementById('mode').value=mode;
    this.drawPoints=[];this.drawHover=null;this.selected.clear();this.anchors.clear();
    this.update();this.draw();
  }
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
    const types=[...this.selected].map(key=>{const [p,s]=key.split(':').map(Number);return this.doc?.paths[p]?.segments[s]?.type;});
    const noSelection=this.busy||!types.length,hasEllipse=types.includes('ellipse'),onlyLines=types.every(t=>t==='line');
    document.getElementById('repairLines').disabled=this.busy||types.filter(t=>t==='line').length<2;
    document.getElementById('repairStrength').disabled=this.busy;
    document.getElementById('selectConnected').disabled=this.busy||!types.length;
    document.getElementById('applyLineStyle').disabled=this.busy||!types.length;
    document.getElementById('lineStyle').disabled=this.busy;
    const styles=new Set([...this.selected].map(key=>{const [p]=key.split(':').map(Number);return this.doc?.paths[p]?.line_style||'solid';}));
    document.getElementById('selectedLineStyle').textContent=styles.size>1?'選択：複数の線種が混在':styles.size?'選択：'+DraftLineStyle.get({line_style:[...styles][0]}).label:'';
    document.getElementById('delete').disabled=noSelection;
    for(const id of ['merge','align'])document.getElementById(id).disabled=noSelection||hasEllipse;
    for(const id of ['horizontal','vertical','corner'])document.getElementById(id).disabled=noSelection||!onlyLines||(id==='corner'&&types.length!==2);
    document.getElementById('linearize').disabled=this.busy||hasEllipse||!types.includes('arc');
    document.getElementById('mergeArcs').disabled=this.busy||hasEllipse||types.length<2;
    document.getElementById('mergeEllipse').disabled=this.busy||hasEllipse||types.length<(onlyLines?5:3);
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
  fit(){
    if(!this.doc)return;
    const r=this.canvas.getBoundingClientRect();
    this.view.scale=Math.max(.005,Math.min(100,Math.min(Math.max(1,r.width-36)/this.doc.width,Math.max(1,r.height-36)/this.doc.height)));
    this.view.x=(r.width-this.doc.width*this.view.scale)/2;
    this.view.y=(r.height-this.doc.height*this.view.scale)/2;
    this.draw();
  }
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
    const v=this.view;
    // Draw bounded paper sheet shadow in screen space to avoid extreme high-zoom shadowBlur stalls.
    const sx0=Math.max(-24,v.x),sy0=Math.max(-24,v.y),sx1=Math.min(r.width+24,v.x+this.doc.width*v.scale),sy1=Math.min(r.height+24,v.y+this.doc.height*v.scale);
    if(sx1>sx0&&sy1>sy0){
      c.save();c.fillStyle='white';c.shadowColor='rgba(25,44,50,.16)';c.shadowBlur=14;c.shadowOffsetY=3;
      c.fillRect(sx0,sy0,sx1-sx0,sy1-sy0);c.restore();
    }
    c.translate(v.x,v.y);c.scale(v.scale,v.scale);
    if(this.background&&document.getElementById('showOriginal').checked){c.globalAlpha=Number(document.getElementById('opacity').value);DraftRotation.drawBackground(this,c);c.globalAlpha=1;}
    const pad=16/v.scale;
    const viewBox=[-v.x/v.scale-pad,-v.y/v.scale-pad,(r.width-v.x)/v.scale+pad,(r.height-v.y)/v.scale+pad];
    const intersectsView=b=>!(b[0]>viewBox[2]||b[2]<viewBox[0]||b[1]>viewBox[3]||b[3]<viewBox[1]);
    const weight=this.lineWeight||1;
    // Optional baseline overlay behind edited vectors.
    if(!this.comparing&&this.overlayBaseline&&this.baseline&&!this.hideVectors){
      c.save();DraftRotation.context(c,this.doc.width,this.doc.height,this.baselineTurns);
      c.strokeStyle='rgba(88,104,116,.45)';c.lineWidth=1/v.scale;c.beginPath();
      for(const p of this.baseline){for(const s of p.segments){if(s.type==='line')DraftGeometry.trace(c,s);else{c.stroke();c.beginPath();DraftGeometry.trace(c,s);c.stroke();c.beginPath();}}}
      c.stroke();c.restore();
    }
    const displayed=this.comparing?this.baseline:this.doc.paths;
    if(!this.hideVectors){
      c.save();
      if(this.comparing)DraftRotation.context(c,this.doc.width,this.doc.height,this.baselineTurns);
      const moving=this.drag?.move?.started?this.drag.move.delta:this.pendingMove?.delta;
      const buckets={solid:[],dashed:[],dashdot:[]};
      const selectedItems=[];
      if(!this.comparing){
        const index=DraftGeometry.spatialIndex(this.doc);
        const visibleItems=index?index.queryBox(viewBox):null;
        if(visibleItems){
          for(let i=0;i<visibleItems.length;i++){
            const it=visibleItems[i];
            if(!this.visible(it.path))continue;
            if(this.selected.has(it.key))selectedItems.push(it);
            else (buckets[it.path.line_style||'solid']||buckets.solid).push(it.s);
          }
        }
        // Include moving selected items even if their original bounds are slightly outside viewBox.
        if(moving&&this.selected.size){
          const seen=new Set(selectedItems.map(it=>it.key));
          for(const key of this.selected){
            if(seen.has(key))continue;
            const [pi,si]=key.split(':').map(Number),path=this.doc.paths[pi],s=path?.segments[si];
            if(s&&this.visible(path))selectedItems.push({key,path,s});
          }
        }
      }else{
        for(let pi=0;pi<displayed.length;pi++){
          const p=displayed[pi];if(!this.visible(p))continue;
          const bucket=buckets[p.line_style||'solid']||buckets.solid;
          for(let si=0;si<p.segments.length;si++){const s=p.segments[si];if(intersectsView(this.bounds(s)))bucket.push(s);}
        }
      }
      // Batch unselected segments by line style (at most 3 styles instead of N stroke() calls).
      const strokeSegments=list=>{
        let hasLine=false;
        c.beginPath();
        for(let i=0;i<list.length;i++){
          const s=list[i];
          if(s.type==='line'){c.moveTo(s.p0[0],s.p0[1]);c.lineTo(s.p1[0],s.p1[1]);hasLine=true;}
          else{
            if(hasLine){c.stroke();c.beginPath();hasLine=false;}
            DraftGeometry.trace(c,s);c.stroke();c.beginPath();
          }
        }
        if(hasLine)c.stroke();
      };
      c.lineWidth=weight/v.scale;
      for(const styleKey of ['solid','dashed','dashdot']){
        const list=buckets[styleKey];if(!list.length)continue;
        const style=DraftLineStyle[styleKey];
        c.strokeStyle=style.color;
        c.lineCap=styleKey==='dashdot'?'round':'butt';
        c.setLineDash(style.pattern.map(n=>n*3/v.scale));
        strokeSegments(list);
      }
      c.lineCap='butt';
      // Hover pre-highlight in select mode.
      if(!this.comparing&&this.mode==='select'&&this.hoverKey&&!this.selected.has(this.hoverKey)&&!this.drag){
        const [pi,si]=this.hoverKey.split(':').map(Number),s=this.doc.paths[pi]?.segments[si];
        if(s){
          c.setLineDash([]);c.strokeStyle='rgba(8,145,178,.45)';c.lineWidth=(4.5*weight)/v.scale;
          c.beginPath();DraftGeometry.trace(c,s);c.stroke();
        }
      }
      // Selected segments.
      if(selectedItems.length){
        c.save();if(moving)c.translate(...moving);
        c.strokeStyle='#0057d9';c.lineWidth=(2.5*weight)/v.scale;
        const selBuckets={solid:[],dashed:[],dashdot:[]};
        for(const it of selectedItems)(selBuckets[it.path.line_style||'solid']||selBuckets.solid).push(it.s);
        for(const styleKey of ['solid','dashed','dashdot']){
          const list=selBuckets[styleKey];if(!list.length)continue;
          const style=DraftLineStyle[styleKey];
          c.lineCap=styleKey==='dashdot'?'round':'butt';
          c.setLineDash(style.pattern.map(n=>n*3/v.scale));
          strokeSegments(list);
        }
        c.restore();
      }
      c.lineCap='butt';c.setLineDash([]);c.restore();
    }
    if(!this.comparing){
      DraftMeasure.draw(this,c);
      DraftDraw.draw(this,c);
      DraftEndpoint.draw(this,c);
      DraftExtend.draw(this,c);
      DraftCut.draw(this,c);
      if(!this.drag?.move?.started&&!this.pendingMove)DraftInspect.draw(this,c);
      DraftWorkflow.draw(this,c);
      if(window.DraftWorkbench)DraftWorkbench.draw(this,c);
      if(this.drag?.move?.started&&this.moveSnap){
        DraftGeometry.drawSnapMarker(c,this.moveSnap.point,this.moveSnap.kind,v.scale);
      }
      if(this.altPainting&&this.pointerInside&&this.pointerPosition){
        const wp=this.world(this.pointerPosition);
        c.save();c.strokeStyle=this.altSubtract?'#dc2626':'#0057d9';c.lineWidth=1.5/v.scale;c.beginPath();c.arc(wp[0],wp[1],4/v.scale,0,Math.PI*2);c.stroke();c.restore();
      }
    }
    if(this.drag&&!this.drag.pan&&!this.drag.move&&!this.drag.paint&&['select','region'].includes(this.mode)){
      const a=this.world(this.drag.start),b=this.world(this.drag.last);
      const boxMode=this.resolveBoxMode(this.drag.start,this.drag.last);
      const isTouch=this.mode==='select'&&boxMode==='touch';
      const isSubtract=this.mode==='select'&&this.drag.subtract;
      c.save();
      c.strokeStyle=this.mode==='region'?'#158483':isSubtract?'#dc2626':isTouch?'#0f7a3e':'#0057d9';
      c.fillStyle=this.mode==='region'?'rgba(21,132,131,.08)':isSubtract?'rgba(220,38,38,.08)':isTouch?'rgba(15,122,62,.08)':'rgba(0,87,217,.08)';
      c.lineWidth=1.2/v.scale;
      c.setLineDash(isTouch||this.mode==='region'?[5/v.scale,3/v.scale]:[]);
      c.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
      c.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
      c.setLineDash([]);c.restore();
    }
    document.getElementById('zoomLevel').textContent=`表示 ${Math.round(v.scale*100)}%`;
  }
  resolveBoxMode(start,end){
    const val=document.getElementById('boxSelection').value;
    if(val==='auto')return end[0]<start[0]?'touch':'inside';
    return val;
  }
  arcPoint(s,angle){const a=angle*Math.PI/180;return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];}
  inArc(s,angle){return Math.abs(s.extent_deg)>=359.999999 || ((s.extent_deg>=0?angle-s.start_deg:s.start_deg-angle)%360+360)%360 <=Math.abs(s.extent_deg)+1e-8;}
  bounds(s){return DraftGeometry.bounds(s);}
  distance(s,p){if(s.type==='ellipse')return DraftGeometry.nearestEllipse(s,p).distance;if(s.type==='line'){const dx=s.p1[0]-s.p0[0],dy=s.p1[1]-s.p0[1],t=Math.max(0,Math.min(1,((p[0]-s.p0[0])*dx+(p[1]-s.p0[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-s.p0[0]-t*dx,p[1]-s.p0[1]-t*dy);}const a=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI;if(this.inArc(s,a))return Math.abs(Math.hypot(p[0]-s.center[0],p[1]-s.center[1])-s.radius);return Math.min(...[s.start_deg,s.start_deg+s.extent_deg].map(a=>{const q=this.arcPoint(s,a);return Math.hypot(p[0]-q[0],p[1]-q[1]);}));}
  selectedAt(point){
    if(!this.doc||this.mode!=='select'||this.busy||!this.selected.size)return false;
    const tol=7/this.view.scale;
    const index=DraftGeometry.spatialIndex(this.doc);
    if(index){
      const near=index.queryBox([point[0]-tol,point[1]-tol,point[0]+tol,point[1]+tol]);
      for(const it of near)if(this.selected.has(it.key)&&this.visible(it.path)&&DraftGeometry.allowed(it.path,it.s)&&this.distance(it.s,point)<tol)return true;
      return false;
    }
    for(const key of this.selected){const [pi,si]=key.split(':').map(Number),p=this.doc.paths[pi],s=p?.segments[si];if(s&&this.visible(p)&&DraftGeometry.allowed(p,s)&&this.distance(s,point)<tol)return true;}
    return false;
  }
  nearestKeyAt(point){
    if(!this.doc||this.mode!=='select'||this.busy)return null;
    const tol=7/this.view.scale;
    const index=DraftGeometry.spatialIndex(this.doc);
    const candidates=index?index.queryBox([point[0]-tol,point[1]-tol,point[0]+tol,point[1]+tol]):null;
    let best=null,dist=tol;
    const visit=(path,s,key)=>{if(!this.visible(path)||!DraftGeometry.allowed(path,s))return;const d=this.distance(s,point);if(d<dist){dist=d;best=key;}};
    if(candidates){for(const it of candidates)visit(it.path,it.s,it.key);}
    else this.doc.paths.forEach((p,pi)=>p.segments.forEach((s,si)=>visit(p,s,`${pi}:${si}`)));
    return best;
  }
  findMoveAnchor(worldPoint){
    let best=null,bestDist=14/this.view.scale;
    for(const key of this.selected){
      const [pi,si]=key.split(':').map(Number),s=this.doc?.paths[pi]?.segments[si];
      if(!s)continue;
      const pts=DraftGeometry.closed(s)?(s.center?[s.center]:[]):[DraftGeometry.point(s,0),DraftGeometry.point(s,1)];
      for(const q of pts){
        const d=Math.hypot(q[0]-worldPoint[0],q[1]-worldPoint[1]);
        if(d<bestDist){bestDist=d;best=q.slice();}
      }
    }
    return best;
  }
  computeMoveDelta(d,screenPoint,ortho=false){
    let delta=[0,1].map(i=>(screenPoint[i]-d.start[i])/this.view.scale);
    this.moveSnap=null;
    if(ortho){
      if(Math.abs(delta[0])>=Math.abs(delta[1]))delta[1]=0;
      else delta[0]=0;
    }
    if(d.move.anchor&&document.getElementById('drawSnap')?.checked){
      const moved=[d.move.anchor[0]+delta[0],d.move.anchor[1]+delta[1]];
      const snap=DraftGeometry.snap(this,moved,null,{excludeSet:this.selected,radiusPx:8,midpoints:false,centers:false});
      if(snap.kind!=='自由位置'){
        delta=[snap.point[0]-d.move.anchor[0],snap.point[1]-d.move.anchor[1]];
        if(ortho){
          if(Math.abs(delta[0])>=Math.abs(delta[1]))delta[1]=0;
          else delta[0]=0;
        }
        this.moveSnap={point:[d.move.anchor[0]+delta[0],d.move.anchor[1]+delta[1]],kind:snap.kind};
      }
    }
    return delta;
  }
  stopBrush(){this.altPainting=false;this.altSubtract=false;this.brushLast=null;this.brushCache=null;this.canvas.classList.remove('is-brushing');}
  paintSelection(from,to,subtract=false){
    if(this.mode!=='select'||this.busy||!this.doc||DraftSettings.isOpen)return;
    const a=this.world(from),b=this.world(to),trace={type:'line',p0:a,p1:b},radius=4/this.view.scale;
    const box=[Math.min(a[0],b[0])-radius,Math.min(a[1],b[1])-radius,Math.max(a[0],b[0])+radius,Math.max(a[1],b[1])+radius];
    const index=DraftGeometry.spatialIndex(this.doc);
    const items=index?index.queryBox(box):null;
    let changed=false;
    const handle=(key,path,s)=>{
      if(!this.visible(path)||!DraftGeometry.allowed(path,s))return;
      if(subtract?!this.selected.has(key):this.selected.has(key))return;
      if(DraftGeometry.distance(s,trace)<=radius){
        if(subtract){this.selected.delete(key);this.anchors.delete(key);}
        else{this.selected.add(key);this.anchors.set(key,DraftGeometry.nearest(s,b).point);}
        changed=true;
      }
    };
    if(items){for(const it of items)handle(it.key,it.path,it.s);}
    else this.doc.paths.forEach((p,pi)=>p.segments.forEach((s,si)=>handle(`${pi}:${si}`,p,s)));
    this.cyclePick=null;if(changed){this.update();this.draw();}
  }
  choose(start,end,add,cycle=false,subtract=false){
    if(this.busy)return;
    if(this.mode==='trimTo'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftWorkbench.pickTrim(this,this.world(end));return;}
    if(this.mode==='region'){DraftWorkflow.box(this,this.world(start),this.world(end));return;}
    if(DraftCut.active(this)){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftCut.pick(this,this.world(end));return;}
    if(this.mode==='endpoint'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftEndpoint.pick(this,this.world(end));return;}
    if(this.mode==='extend'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftExtend.pick(this,this.world(end));return;}
    if(DraftDraw.active(this)){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftDraw.pick(this,this.world(end));return;}
    if(this.mode==='measure'){if(Math.hypot(end[0]-start[0],end[1]-start[1])<4)DraftMeasure.pick(this,this.world(end));return;}
    const prior=[...this.selected];
    const click=Math.hypot(end[0]-start[0],end[1]-start[1])<4;
    if(!add&&!subtract&&!(cycle&&click)){this.selected.clear();this.anchors.clear();}
    const a=this.world(start),b=this.world(end),box=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    const tol=7/this.view.scale;
    const index=DraftGeometry.spatialIndex(this.doc);
    const queryBox=click?[b[0]-tol,b[1]-tol,b[0]+tol,b[1]+tol]:box;
    const candidates=index?index.queryBox(queryBox):null;
    const boxMode=this.resolveBoxMode(start,end);
    let best=null,dist=tol;const hits=[];
    const visit=(path,s,key,bounds)=>{
      if(!this.visible(path)||!DraftGeometry.allowed(path,s))return;
      if(click){
        const d=this.distance(s,b);
        if(d<tol)hits.push({key,d});
        if(d<dist){dist=d;best=key;}
      }else{
        const hit=boxMode==='touch'?DraftGeometry.touches(s,box):bounds[0]>=box[0]&&bounds[1]>=box[1]&&bounds[2]<=box[2]&&bounds[3]<=box[3];
        if(hit){
          if(subtract){this.selected.delete(key);this.anchors.delete(key);}
          else this.selected.add(key);
        }
      }
    };
    if(candidates){for(const it of candidates)visit(it.path,it.s,it.key,it.bounds);}
    else this.doc.paths.forEach((p,pi)=>p.segments.forEach((s,si)=>visit(p,s,`${pi}:${si}`,this.bounds(s))));
    if(cycle&&click&&hits.length){
      hits.sort((x,y)=>x.d-y.d);
      const sameSpot=this.cyclePick&&Math.hypot(b[0]-this.cyclePick.point[0],b[1]-this.cyclePick.point[1])<3/this.view.scale;
      const last=sameSpot?this.cyclePick.key:null;
      const prevIdx=hits.findIndex(h=>last?h.key===last:prior.includes(h.key));
      const nextIdx=(prevIdx+1)%hits.length;
      best=hits[nextIdx].key;
      // Replace only the cycled item instead of accumulating all overlapping candidates.
      if(prevIdx>=0){this.selected.delete(hits[prevIdx].key);this.anchors.delete(hits[prevIdx].key);}
      else{this.selected.clear();this.anchors.clear();}
      this.selected.add(best);this.anchors.set(best,b);
      this.cyclePick={point:b,key:best,index:nextIdx+1,total:hits.length};
    }else{
      this.cyclePick=null;
      if(click&&best){
        if(subtract||(add&&this.selected.has(best))){this.selected.delete(best);this.anchors.delete(best);}
        else{this.selected.add(best);this.anchors.set(best,b);}
      }
    }
    this.update();this.draw();
  }
  edit(action){
    if(this.busy||!this.doc||document.getElementById(action)?.disabled)return;
    if(['undo','redo'].includes(action)&&window.DraftHistory){DraftHistory.step(this,action==='undo'?-1:1);return;}
    if(!['undo','redo','rotateCW','rotateCCW'].includes(action)&&!this.selected.size)return;
    const tolerance=action==='mergeArcs'?null:Number(document.getElementById('tolerance').value);
    if(['merge','align'].includes(action)&&(!Number.isFinite(tolerance)||tolerance<=0)){
      document.getElementById('status').textContent='エラー: 許容ずれには正の数値を指定してください。';
      return;
    }
    try{this.pendingRotationMeta=DraftRotation.prepare(this,action);}catch(error){document.getElementById('status').textContent=error.message;return;}
    let reference={};if(action==='mergeArcs')try{reference=DraftCircleReference.raster(this);}catch(_){/* Geometry restoration remains available if the underlay cannot be sampled. */}
    this.setBusy(true);
    this.send({kind:'edit',action,refs:[...this.selected].map(key=>key.split(':').map(Number)),anchors:Object.fromEntries(this.anchors),tolerance,relaxed:action==='mergeArcs',width:this.doc.width,height:this.doc.height,...reference});
  }
  project(){return {format:'draft-to-dxf-project',version:1,width:this.doc.width,height:this.doc.height,dpi:Number(document.getElementById('dpi').value),name:this.name,paths:this.doc.paths,background:this.backgroundData,backgroundTurns:this.backgroundTurns,baselineTurns:this.baselineTurns,calibration:this.calibration,protection:this.protection,baselinePaths:this.baseline,baselineLabel:this.baselineLabel};}
  attach(){
    const canvas=this.canvas;
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{
      if(!this.doc)return;e.preventDefault();if(this.drag?.move)return;
      this.stopBrush();
      this.zoom(e.deltaY<0?1.15:1/1.15,this.position(e));
    },{passive:false});
    canvas.addEventListener('pointerdown',e=>{
      if(this.processing||!this.doc||this.drag)return;e.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
      const point=this.position(e);
      const subtract=(e.ctrlKey||e.metaKey)&&e.shiftKey&&!e.altKey&&this.mode==='select'&&e.button===0;
      const pan=this.comparing||!!this.pendingPreview||this.mode==='pan'||e.button===1||e.button===2||(e.shiftKey&&!subtract&&!(e.altKey&&this.mode==='select'))||this.spacePan;
      this.pointerInside=true;this.pointerPosition=point;
      const paint=!pan&&this.mode==='select'&&e.altKey&&!e.ctrlKey&&!e.metaKey&&e.button===0;
      if(paint){this.altPainting=true;this.altSubtract=e.shiftKey;this.paintSelection(point,point,e.shiftKey);this.brushLast=point;canvas.classList.add('is-brushing');}else this.stopBrush();
      const worldPt=this.world(point);
      const move=!pan&&e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&this.selectedAt(worldPt);
      this.drag={
        start:point,last:point,pointerId:e.pointerId,pan,paint,
        add:(e.ctrlKey||e.metaKey)&&!e.altKey&&!subtract,
        subtract,
        cycle:e.altKey&&(e.ctrlKey||e.metaKey),
        move:move?{refs:[...this.selected].map(key=>key.split(':').map(Number)),delta:[0,0],started:false,anchor:this.findMoveAnchor(worldPt)}:null
      };
      canvas.classList.remove('can-move');canvas.classList.toggle('is-panning',!!pan);
    });
    canvas.addEventListener('pointermove',e=>{
      const point=this.position(e),r=canvas.getBoundingClientRect();this.pointerPosition=point;this.pointerInside=point[0]>=0&&point[1]>=0&&point[0]<=r.width&&point[1]<=r.height;
      if(this.pointerInside&&e.altKey&&!e.ctrlKey&&!e.metaKey&&!this.spacePan&&!typing(document.activeElement)&&(e.buttons===0||e.buttons===1)&&(!this.drag||!this.drag.pan&&!this.drag.move)&&this.mode==='select'&&!this.busy&&!DraftSettings.isOpen){
        const active=this.altPainting;this.altPainting=true;this.altSubtract=e.shiftKey;
        if(this.drag){this.drag.paint=true;this.drag.last=point;}
        canvas.classList.add('is-brushing');canvas.classList.remove('can-move');
        this.paintSelection(this.brushLast||point,point,e.shiftKey);this.brushLast=point;
        if(!active)this.update();
        this.scheduleDraw();
        return;
      }
      if(this.altPainting){this.stopBrush();this.update();this.scheduleDraw();}
      if(this.drag){
        const d=this.drag;
        if(d.pan){this.view.x+=point[0]-d.last[0];this.view.y+=point[1]-d.last[1];}
        else if(d.move){
          const started=d.move.started;d.move.started||=Math.hypot(point[0]-d.start[0],point[1]-d.start[1])>=4;
          if(d.move.started)d.move.delta=this.computeMoveDelta(d,point,e.shiftKey);
          if(!started&&d.move.started)this.update();
          if(d.move.started)window.DraftLayout?.updateDrag(this);
        }
        d.last=point;
      }
      const worldPt=this.world(point);
      let needDraw=!!this.drag;
      if(!this.drag&&this.doc&&!this.busy&&this.mode==='select'){
        const canMove=this.selectedAt(worldPt);
        canvas.classList.toggle('can-move',canMove);
        const nextHover=canMove?null:this.nearestKeyAt(worldPt);
        if(nextHover!==this.hoverKey){this.hoverKey=nextHover;needDraw=true;}
      }else if(this.hoverKey){this.hoverKey=null;needDraw=true;}
      if(this.doc&&!this.busy&&DraftDraw.active(this)){this.drawHover=DraftDraw.snap(this,worldPt);needDraw=true;}
      if(this.doc&&!this.busy&&this.mode==='endpoint'){DraftEndpoint.hover(this,worldPt);needDraw=true;}
      if(this.doc&&!this.busy&&this.mode==='extend'){DraftExtend.hover(this,worldPt);needDraw=true;}
      if(this.doc&&!this.busy&&this.mode==='measure'){DraftMeasure.hover?.(this,worldPt);needDraw=true;}
      if(needDraw)this.scheduleDraw();
    });
    const cancelDrag=()=>{this.drag=null;this.moveSnap=null;this.stopBrush();canvas.classList.toggle('is-panning',!!this.spacePan);this.update();this.draw();};
    canvas.addEventListener('pointerup',e=>{
      if(!this.drag||this.drag.pointerId!==e.pointerId)return;
      const d=this.drag;this.drag=null;
      if(d.move?.started){
        const delta=this.computeMoveDelta(d,this.position(e),e.shiftKey);
        this.moveSnap=null;
        if(Math.hypot(...delta)>1e-9){this.pendingMove={refs:d.move.refs,delta};this.send({kind:'edit',action:'translate',refs:d.move.refs,delta});}
        else this.update();
      }else if(!d.pan&&!d.paint)this.choose(d.start,this.position(e),d.add,d.cycle,d.subtract);
      this.moveSnap=null;
      canvas.classList.toggle('is-panning',!!this.spacePan);window.DraftLayout?.update(this);this.draw();
    });
    canvas.addEventListener('pointercancel',cancelDrag);
    canvas.addEventListener('pointerleave',()=>{this.pointerInside=false;this.hoverKey=null;this.measureHover=null;this.stopBrush();this.update();this.scheduleDraw();});
    canvas.addEventListener('lostpointercapture',()=>{if(this.drag)cancelDrag();});
    const typing=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    // Capture Escape before tool-specific handlers: first cancel points, then leave the tool.
    document.addEventListener('keydown',e=>{
      if(DraftSettings.isOpen||e.key!=='Escape'||e.isComposing||typing(e.target)||this.processing||!this.doc)return;
      e.preventDefault();e.stopImmediatePropagation();const wasMoving=!!this.drag?.move;this.drag=null;this.moveSnap=null;this.spacePan=false;this.stopBrush();
      if(wasMoving){/* Cancel only the uncommitted movement; keep selection. */}
      else if(this.comparing){document.getElementById('compareBefore').click();}
      else if(this.pendingPreview){DraftWorkflow.cancel(this);}
      else if(this.drawPoints.length){DraftDraw.cancel(this);}
      else if(this.cutDraft){DraftCut.reset(this);}
      else if(this.endpointDraft){DraftEndpoint.reset(this);}
      else if(this.extendDraft){DraftExtend.reset(this);}
      else if(this.trimDraft){this.trimDraft=null;}
      else if(this.mode==='measure'&&this.measurePoints.length){this.measurePoints=[];}
      else this.setMode('select');
      this.update();this.draw();
    },true);
    document.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.isComposing||DraftSettings.isOpen||!this.doc)return;
      if(e.key==='Alt'&&!e.ctrlKey&&!e.metaKey&&this.mode==='select'&&this.pointerInside&&!this.drag&&!typing(e.target)&&!this.busy){e.preventDefault();this.altPainting=true;this.altSubtract=e.shiftKey;canvas.classList.add('is-brushing');if(this.pointerPosition){this.paintSelection(this.pointerPosition,this.pointerPosition,e.shiftKey);this.brushLast=this.pointerPosition;}this.update();this.scheduleDraw();return;}
      const action=DraftSettings.action(e),ctrl=e.ctrlKey||e.metaKey;
      // Never download a webpage when the user has reassigned the project save key.
      if(ctrl&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='s'&&!action){e.preventDefault();return;}
      // A modified save binding also works from document input fields.
      if(action==='saveProject'&&ctrl){e.preventDefault();if(!e.repeat)DraftSettings.run(action,this);return;}
      if(typing(e.target))return;
      // Handle active tool draft cancellation regardless of canvas focus.
      if(!e.repeat&&(DraftSettings.is(e,'delete')||DraftSettings.is(e,'undo'))){
        if(DraftDraw.active(this)&&this.drawPoints.length){e.preventDefault();DraftDraw.cancel(this);return;}
        if(this.mode==='endpoint'&&this.endpointDraft){e.preventDefault();DraftEndpoint.reset(this);DraftEndpoint.update(this);this.draw();return;}
        if(this.mode==='extend'&&this.extendDraft){e.preventDefault();DraftExtend.reset(this);DraftExtend.update(this);this.draw();return;}
        if(DraftCut.active(this)&&this.cutDraft){e.preventDefault();DraftCut.reset(this);DraftCut.update(this);this.draw();return;}
        if(this.mode==='trimTo'&&this.trimDraft){e.preventDefault();this.trimDraft=null;this.update();this.draw();return;}
      }
      if(!ctrl&&!e.altKey&&e.code==='Space'&&!this.processing){if(e.target instanceof Element&&e.target.closest('button,summary,a'))return;e.preventDefault();this.spacePan=true;canvas.classList.add('is-panning');return;}
      if(action){e.preventDefault();if(!e.repeat)DraftSettings.run(action,this);}
    });
    document.addEventListener('keyup',e=>{if(e.key==='Alt'){if(this.altPainting)e.preventDefault();this.stopBrush();this.update();this.scheduleDraw();}if(e.code==='Space'){this.spacePan=false;canvas.classList.toggle('is-panning',!!this.drag?.pan);}});
    window.addEventListener('blur',()=>{this.spacePan=false;this.drag=null;this.moveSnap=null;this.pointerInside=false;this.hoverKey=null;this.stopBrush();canvas.classList.remove('is-panning');this.update();this.draw();});
    window.addEventListener('beforeunload',e=>{if(!window.DraftSession&&this.dirty){e.preventDefault();e.returnValue='';}});
  }
};
