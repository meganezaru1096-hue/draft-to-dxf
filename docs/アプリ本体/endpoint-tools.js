window.DraftEndpoint={
  init(e){
    e.endpointDraft=null;e.endpointTarget=null;e.endpointScope=null;
    document.getElementById('mode').add(new Option('直線・円弧の端点','endpoint'));
    document.getElementById('moveEndpoint').textContent='直線・円弧の端点を編集';
    const complete=document.createElement('button');complete.id='completeEndpointCircle';complete.textContent='円まで伸ばす';complete.title='円弧の動かす端点を選んだ後、一周の円にする';
    document.getElementById('cancelEndpoint').before(complete);complete.onclick=()=>{const d=e.endpointDraft;if(e.busy||d?.segment.type!=='arc')return;this.commit(e,{point:DraftGeometry.point(d.segment,1-d.endpoint),arc_extent:Math.sign(d.segment.extent_deg)*360,valid:true});};
    document.getElementById('moveEndpoint').onclick=()=>{const scope=e.selected.size===1?[...e.selected][0]:null;e.setMode('endpoint');e.endpointScope=scope;this.update(e);};
    document.getElementById('cancelEndpoint').onclick=()=>{this.reset(e);this.update(e);e.draw();};
    e.canvas.addEventListener('keydown',ev=>{if(e.mode!=='endpoint')return;if(ev.key==='Escape'||DraftSettings.is(ev,'delete')||(DraftSettings.is(ev,'undo')&&e.endpointDraft)){ev.preventDefault();ev.stopImmediatePropagation();this.reset(e);this.update(e);e.draw();}});
  },
  reset(e){e.endpointDraft=null;e.endpointTarget=null;e.endpointScope=null;e.endpointSuggestedTarget=null;e.endpointHover=null;},
  update(e){
    for(const id of ['moveEndpoint','endpointSnap'])document.getElementById(id).disabled=e.busy||!e.doc;
    document.getElementById('cancelEndpoint').disabled=e.busy||!e.endpointDraft;
    document.getElementById('completeEndpointCircle').disabled=e.busy||e.endpointDraft?.segment.type!=='arc';
    document.getElementById('endpointHint').textContent=e.mode==='endpoint'?(e.endpointDraft?(e.endpointDraft.segment.type==='arc'?'円周に沿って動かし、クリックで確定。中心・半径は固定。最大360°（円まで伸ばすも使用可）':'移動先をクリックで確定（Escで中止）'):e.endpointScope?'選択した直線・円弧の動かす端点をクリック':'①動かす直線・円弧の端点 → ②移動先をクリック'):'直線・円弧の端点を指定 → 移動先をクリック。円弧は中心・半径を保って伸縮。隣接線は動かしません。';
  },
  intersection(a,b){
    const u=[a.p1[0]-a.p0[0],a.p1[1]-a.p0[1]],v=[b.p1[0]-b.p0[0],b.p1[1]-b.p0[1]],w=[b.p0[0]-a.p0[0],b.p0[1]-a.p0[1]];
    const cross=(p,q)=>p[0]*q[1]-p[1]*q[0],d=cross(u,v);
    if(Math.abs(d)<=1e-10*Math.max(1,Math.hypot(...u)*Math.hypot(...v)))return null;
    const t=cross(w,v)/d,s=cross(w,u)/d;
    return t>=-1e-9&&t<=1+1e-9&&s>=-1e-9&&s<=1+1e-9?[a.p0[0]+t*u[0],a.p0[1]+t*u[1]]:null;
  },
  target(e,p){
    let target=document.getElementById('endpointSnap').checked?DraftGeometry.snap(e,p,e.endpointDraft?.ref):{point:p.slice(),kind:'自由位置'};
    if(document.getElementById('endpointSnap').checked&&e.endpointSuggestedTarget&&Math.hypot(p[0]-e.endpointSuggestedTarget[0],p[1]-e.endpointSuggestedTarget[1])<10/e.view.scale)target={point:e.endpointSuggestedTarget.slice(),kind:'候補の接続位置に吸着'};
    const d=e.endpointDraft,s=d?.segment;if(s?.type!=='arc')return target;
    if(Math.hypot(target.point[0]-s.center[0],target.point[1]-s.center[1])<1e-6)return {...target,valid:false,kind:'円の中心では方向を決められません'};
    const angle=Math.atan2(target.point[1]-s.center[1],target.point[0]-s.center[0])*180/Math.PI,dir=Math.sign(s.extent_deg),delta=((angle-d.lastAngle+180)%360+360)%360-180;
    d.arcSweep=Math.max(0,Math.min(360,d.arcSweep+delta*dir*(d.endpoint===1?1:-1)));d.lastAngle=angle;
    const fixed=DraftGeometry.point(s,1-d.endpoint);
    if(document.getElementById('endpointSnap').checked&&d.arcSweep>180&&Math.hypot(target.point[0]-fixed[0],target.point[1]-fixed[1])<10/e.view.scale)d.arcSweep=360;
    if(d.arcSweep>=359.999999)d.arcSweep=360;
    const extent=dir*d.arcSweep,fixedAngle=s.start_deg+(d.endpoint===0?s.extent_deg:0),segment={...s,start_deg:d.endpoint===0?fixedAngle-extent:fixedAngle,extent_deg:extent};
    return {point:DraftGeometry.point(segment,d.endpoint),segment,arc_extent:extent,valid:d.arcSweep*s.radius*Math.PI/180>=1e-6,kind:`円弧 ${d.arcSweep.toFixed(1)}°（中心・半径固定）${d.arcSweep===360?'：一周の円':''}`};
  },
  find(e,p){let best=10/e.view.scale,found=null;e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{if((s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999)||(e.endpointScope&&e.endpointScope!==`${pi}:${si}`))return;[DraftGeometry.point(s,0),DraftGeometry.point(s,1)].forEach((q,endpoint)=>{const dist=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dist<best){best=dist;found={ref:[pi,si],endpoint,segment:s};}});});});return found;},
  pick(e,p){
    if(!e.endpointDraft){
      const found=this.find(e,p);
      if(!found){document.getElementById('endpointHint').textContent='直線・円弧の端点の近くをクリックしてください。重なる場合は先に1本選択。一周の円は区間削除で円弧にできます。';return;}
      if(found.segment.type==='arc'){found.arcSweep=Math.abs(found.segment.extent_deg);found.lastAngle=found.segment.start_deg+found.endpoint*found.segment.extent_deg;}
      e.endpointDraft=found;e.endpointTarget={point:DraftGeometry.point(found.segment,found.endpoint),kind:'元の端点'};e.endpointHover=null;this.update(e);e.draw();return;
    }
    this.commit(e,this.target(e,p));
  },
  commit(e,target){const draft=e.endpointDraft;if(!draft||e.busy)return;const other=DraftGeometry.point(draft.segment,1-draft.endpoint);
    if(target.valid===false||(draft.segment.type==='line'&&Math.hypot(target.point[0]-other[0],target.point[1]-other[1])<1e-6)){document.getElementById('endpointHint').textContent='長さがゼロになる移動はできません。円周付近の別の位置を指定してください。';return;}
    this.reset(e);e.setBusy(true);e.send({kind:'edit',action:'moveEndpoint',refs:[draft.ref],endpoint:draft.endpoint,point:target.point,arc_extent:target.arc_extent});
  },
  hover(e,p){if(!e.endpointDraft){e.endpointHover=this.find(e,p);return;}e.endpointTarget=this.target(e,p);document.getElementById('endpointHint').textContent=e.endpointTarget.kind+'：クリックで確定（Escで中止）';},
  draw(e,c){
    if(e.mode!=='endpoint')return;
    const scale=e.view.scale;if(!e.endpointDraft||!e.endpointTarget){const h=e.endpointHover;if(h){c.strokeStyle='#148443';c.lineWidth=2/scale;c.beginPath();c.arc(...DraftGeometry.point(h.segment,h.endpoint),5/scale,0,Math.PI*2);c.stroke();}return;}
    const d=e.endpointDraft,p=e.endpointTarget.point,other=DraftGeometry.point(d.segment,1-d.endpoint);
    c.strokeStyle='#d05b00';c.lineWidth=2/scale;c.setLineDash([5/scale,3/scale]);c.beginPath();if(d.segment.type==='arc'){const s=e.endpointTarget.segment||d.segment;c.arc(...s.center,s.radius,s.start_deg*Math.PI/180,(s.start_deg+s.extent_deg)*Math.PI/180,s.extent_deg<0);}else{c.moveTo(...other);c.lineTo(...p);}c.stroke();c.setLineDash([]);
    c.strokeStyle=e.endpointTarget.kind.includes('吸着')?'#148443':'#d05b00';c.strokeRect(p[0]-5/scale,p[1]-5/scale,10/scale,10/scale);
  }
};
