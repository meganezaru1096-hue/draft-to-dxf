// Preview mirrors EditDocument.extension_candidate; the worker recomputes the final contact.
window.DraftExtend={
  reset(e){e.extendDraft=null;e.extendScope=null;e.extendHover=null;e.extendTarget=null;},
  init(e){
    this.reset(e);document.getElementById('mode').add(new Option('相手の線まで延長','extend'));
    document.getElementById('extendTo').onclick=()=>{const scope=e.selected.size===1?[...e.selected][0]:null;e.setMode('extend');e.extendScope=scope;this.update(e);};
    document.getElementById('cancelExtend').onclick=()=>{this.reset(e);this.update(e);e.draw();};
    e.canvas.addEventListener('keydown',ev=>{if(e.mode!=='extend')return;if(ev.key==='Escape'||DraftSettings.is(ev,'delete')||(DraftSettings.is(ev,'undo')&&e.extendDraft)){ev.preventDefault();ev.stopImmediatePropagation();this.reset(e);this.update(e);e.draw();}});
  },
  update(e){document.getElementById('extendTo').disabled=e.busy||!e.doc;document.getElementById('cancelExtend').disabled=e.busy||!e.extendDraft;document.getElementById('extendHint').textContent=e.mode==='extend'?(e.extendDraft?'②相手の線・円弧・円をクリック。破線が延長部分、緑の点が接触位置（Escで中止）':'①延長したい側の端点をクリック → ②ぶつけたい相手の線をクリック'):'直線はまっすぐ、円弧は中心・半径を保って、相手の線へ最初に接触する位置まで延長します。相手の有限の線上に交点がない場合は変更しません。';},
  candidate(source,target,endpoint){
    const length=DraftGeometry.length(source),targetLength=DraftGeometry.length(target),origin=DraftGeometry.point(source,endpoint);
    if(length<1e-6||targetLength<1e-6)throw Error('長さのある線・円弧を指定してください。');
    if(source.type==='arc'&&Math.abs(source.extent_deg)>=359.999999)throw Error('一周の円は延長できません。');
    const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],dot=(a,b)=>a[0]*b[0]+a[1]*b[1],sub=(a,b)=>a.map((v,i)=>v-b[i]);
    const onTarget=p=>{if(target.type==='arc')return Math.abs(Math.hypot(...sub(p,target.center))-target.radius)<1e-6&&DraftGeometry.onArc(target,p);const u=sub(target.p1,target.p0).map(v=>v/targetLength),w=sub(p,target.p0),t=dot(w,u);return Math.abs(cross(w,u))<1e-6&&t>=-1e-6&&t<=targetLength+1e-6;};
    if(onTarget(origin))throw Error('この端点はすでに相手の線に接触しています。');
    const lineCircle=(p,u,c,r)=>{const w=sub(c,p),projection=dot(w,u),perp=cross(w,u),h2=r*r-perp*perp;if(h2< -1e-10*Math.max(1,r*r,perp*perp))return [];const h=Math.sqrt(Math.max(0,h2));return [projection-h,projection+h].map(t=>p.map((v,i)=>v+t*u[i]));};
    let points,candidates,segment,point;
    if(source.type==='line'){
      const u=sub(source.p1,source.p0).map(v=>v/length*(endpoint===1?1:-1));
      if(target.type==='line'){const v=sub(target.p1,target.p0),w=sub(target.p0,origin),denom=cross(u,v);if(Math.abs(denom)<=1e-10*Math.max(1,targetLength))points=Math.abs(cross(w,u))<1e-6?[target.p0,target.p1]:[];else{const t=cross(w,v)/denom;points=[origin.map((v,i)=>v+t*u[i])];}}
      else points=lineCircle(origin,u,target.center,target.radius);
      candidates=points.filter(onTarget).map(p=>({t:dot(sub(p,origin),u),point:p})).filter(c=>c.t>1e-6).sort((a,b)=>a.t-b.t);
      if(candidates.length){point=candidates[0].point;segment={...source,['p'+endpoint]:point};}
    }else{
      if(target.type==='line'){const u=sub(target.p1,target.p0).map(v=>v/targetLength);points=lineCircle(target.p0,u,source.center,source.radius);}
      else{const [dx,dy]=sub(target.center,source.center),d=Math.hypot(dx,dy),r=source.radius,rb=target.radius;
        if(d<1e-7)points=Math.abs(r-rb)<1e-7?[DraftGeometry.point(target,0),DraftGeometry.point(target,1)]:[];
        else if(d>r+rb+1e-7||d<Math.abs(r-rb)-1e-7)points=[];
        else{const x=((r-rb)*(r+rb)+d*d)/(2*d),h2=r*r-x*x;if(h2< -1e-10*Math.max(1,r*r))points=[];else{const h=Math.sqrt(Math.max(0,h2)),p=[source.center[0]+x*dx/d,source.center[1]+x*dy/d];points=[[p[0]-h*dy/d,p[1]+h*dx/d],[p[0]+h*dy/d,p[1]-h*dx/d]];}}
      }
      const direction=Math.sign(source.extent_deg),outward=direction*(endpoint===1?1:-1),angle=source.start_deg+endpoint*source.extent_deg;
      candidates=points.filter(onTarget).map(p=>({t:DraftGeometry.mod((Math.atan2(p[1]-source.center[1],p[0]-source.center[0])*180/Math.PI-angle)*outward),point:p})).filter(c=>c.t>1e-7&&Math.abs(source.extent_deg)+c.t<=360+1e-7).sort((a,b)=>a.t-b.t);
      if(candidates.length){const delta=candidates[0].t;point=candidates[0].point;segment={...source,start_deg:endpoint===1?source.start_deg:source.start_deg-direction*delta,extent_deg:direction*Math.min(360,Math.abs(source.extent_deg)+delta)};}
    }
    if(!candidates.length)throw Error('この方向では相手に届きません。反対の端点か別の相手を指定してください。');
    if(!onTarget(DraftGeometry.point(segment,endpoint)))throw Error('交点の精度が不足しています。別の相手を指定してください。');
    if([...DraftGeometry.bounds(segment),...(segment.type==='arc'?[segment.start_deg,segment.extent_deg]:[])].some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))throw Error('延長後の座標が範囲外です。');
    return {segment,point};
  },
  findSource(e,p){let best=10/e.view.scale,found=null;e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{if(!DraftGeometry.allowed(path,s)||(e.extendScope&&e.extendScope!==`${pi}:${si}`)||(s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999))return;for(const endpoint of [0,1]){const q=DraftGeometry.point(s,endpoint),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;found={ref:[pi,si],endpoint,segment:s};}}});});return found;},
  findTarget(e,p){let best=8/e.view.scale,found=null;e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{if(e.extendDraft.ref[0]===pi&&e.extendDraft.ref[1]===si)return;const d=e.distance(s,p);if(d<best){best=d;found={ref:[pi,si],segment:s};}});});if(found){try{Object.assign(found,this.candidate(e.extendDraft.segment,found.segment,e.extendDraft.endpoint));found.targetSegment=e.doc.paths[found.ref[0]].segments[found.ref[1]];found.valid=true;}catch(error){found.error=error.message;found.valid=false;}}return found;},
  hover(e,p){if(!e.extendDraft){e.extendHover=this.findSource(e,p);return;}e.extendTarget=this.findTarget(e,p);const t=e.extendTarget;document.getElementById('extendHint').textContent=t?(t.valid?(t.segment.type==='arc'?`円弧を ${Math.abs(t.segment.extent_deg-e.extendDraft.segment.extent_deg).toFixed(1)}° 延長`:`${((DraftGeometry.length(t.segment)-DraftGeometry.length(e.extendDraft.segment))*DraftWorkflow.scale(e)).toFixed(2)} mm 延長`)+'：相手の線をクリックで反映（Escで中止）':t.error):'②ぶつけたい相手の線・円弧・円の上へ移動してクリックしてください。';},
  pick(e,p){if(!e.extendDraft){const d=this.findSource(e,p);if(!d){document.getElementById('extendHint').textContent='延長する直線・円弧の端点を指定してください。一周の円は相手としてのみ使えます。';return;}e.extendDraft=d;e.extendHover=null;this.update(e);e.draw();return;}const t=this.findTarget(e,p);if(!t?.valid){document.getElementById('extendHint').textContent=t?.error||'相手の線・円弧・円の上をクリックしてください。';e.extendTarget=t;e.draw();return;}const d=e.extendDraft;this.reset(e);e.send({kind:'edit',action:'extendTo',refs:[d.ref],target:t.ref,endpoint:d.endpoint});},
  draw(e,c){if(e.mode!=='extend')return;const d=e.extendDraft,scale=e.view.scale,source=d||e.extendHover;if(!source)return;const origin=DraftGeometry.point(source.segment,source.endpoint);c.strokeStyle='#148443';c.lineWidth=2/scale;c.beginPath();c.arc(...origin,5/scale,0,Math.PI*2);c.stroke();const t=e.extendTarget;if(!d||!t?.valid)return;
    const stroke=s=>{c.beginPath();if(s.type==='line'){c.moveTo(...s.p0);c.lineTo(...s.p1);}else c.arc(...s.center,s.radius,s.start_deg*Math.PI/180,(s.start_deg+s.extent_deg)*Math.PI/180,s.extent_deg<0);c.stroke();};
    c.strokeStyle='#148443';c.lineWidth=2/scale;stroke(t.targetSegment);c.strokeStyle='#d05b00';c.lineWidth=2.5/scale;c.setLineDash([5/scale,3/scale]);if(d.segment.type==='line')stroke({type:'line',p0:origin,p1:t.point});else{const delta=t.segment.extent_deg-d.segment.extent_deg;stroke({...d.segment,start_deg:d.endpoint===1?d.segment.start_deg+d.segment.extent_deg:t.segment.start_deg,extent_deg:delta});}c.setLineDash([]);c.strokeStyle='#148443';c.beginPath();c.arc(...t.point,5/scale,0,Math.PI*2);c.stroke();
  }
};
