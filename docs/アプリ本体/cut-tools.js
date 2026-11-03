window.DraftCut={
  active(e){return ['splitLine','trimLine'].includes(e.mode);},
  reset(e){e.cutDraft=null;e.cutScope=null;e.cutHover=null;e.cutCandidate=null;},
  full(s){return s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999;},
  init(e){
    this.reset(e);
    for(const [id,label] of [['splitLine','線・円弧を分割'],['trimLine','区間を削除']]){
      document.getElementById('mode').add(new Option(label,id));
      document.getElementById(id).onclick=()=>{const scope=e.selected.size===1?[...e.selected][0]:null;e.setMode(id);e.cutScope=scope;this.update(e);};
    }
    document.getElementById('cancelCut').onclick=()=>{this.reset(e);this.update(e);e.draw();};
    document.getElementById('confirmCut').onclick=()=>this.commit(e);
    const side=document.createElement('label');side.append('円で消す区間 ');const choice=document.createElement('select');choice.id='circleTrimSide';choice.add(new Option('短い側','short'));choice.add(new Option('長い側','long'));side.append(choice);document.getElementById('cancelCut').before(side);choice.onchange=()=>{this.update(e);e.draw();};
    const guide=document.createElement('p');guide.className='note cut-guide';guide.textContent='分割：線の途中を1回クリック。形は変わらず、別々に選べる2本になります。円は2か所を指定します。区間削除：消す区間の両端を順にクリック。マウス移動中の赤い部分が削除されます。';document.getElementById('cutHint').after(guide);
    e.canvas.addEventListener('pointermove',ev=>{
      if(!e.doc||e.busy||!this.active(e))return;
      const p=e.world(e.position(ev));if(!e.cutDraft){e.cutCandidate=this.find(e,p);if(e.cutCandidate)e.cutCandidate.t=this.position(e,e.cutCandidate,p);}else e.cutHover=e.distance(e.cutDraft.segment,p)<=10/e.view.scale?this.position(e,e.cutDraft,p):null;e.draw();
    });
    e.canvas.addEventListener('keydown',ev=>{if(!this.active(e))return;if(ev.key==='Escape'||DraftSettings.is(ev,'delete')||(DraftSettings.is(ev,'undo')&&e.cutDraft)){ev.preventDefault();ev.stopImmediatePropagation();this.reset(e);this.update(e);e.draw();}});
  },
  commit(e){const d=e.cutDraft;if(e.busy||!d||((e.mode==='trimLine'||this.full(d.segment))&&d.second==null))return;
    if(d.second!=null){const delta=Math.abs(d.second-d.first),span=this.full(d.segment)?Math.min(delta,1-delta):delta;if(span*DraftGeometry.length(d.segment)<1e-6){d.second=null;this.update(e);document.getElementById('cutHint').textContent='異なる2か所を指定してください。2点目を選び直せます。';e.draw();return;}}
    const action=e.mode,circle_side=document.getElementById('circleTrimSide').value;this.reset(e);e.send({kind:'edit',action,refs:[d.ref],first:d.first,second:d.second,circle_side});},
  update(e){
    for(const id of ['splitLine','trimLine','cutSnap'])document.getElementById(id).disabled=e.busy||!e.doc;
    document.getElementById('cancelCut').disabled=e.busy||!e.cutDraft;
    document.getElementById('confirmCut').disabled=e.busy||!e.cutDraft||((e.mode==='trimLine'||this.full(e.cutDraft.segment))&&e.cutDraft.second==null);
    document.getElementById('circleTrimSide').disabled=e.busy||e.mode!=='trimLine';
    document.getElementById('cutHint').textContent=!this.active(e)?'分割は形を変えずに別々の要素へ。区間削除は2点間を消します。直線・円弧・円に対応。':!e.cutDraft?(e.mode==='splitLine'?(e.selected.size>=2?'分割済み：丸印が切れ目です。「選択」に戻り、片側をクリックして移動・削除できます。':'①分けたい位置をクリック。円は円周上の2か所を指定。形は変わりません。'):'①消したい区間の端をクリック → ②反対側の端をクリック。赤い部分を削除。'):e.mode==='splitLine'?'②同じ円周の別の位置をクリックすると2本の円弧に分割します（Escで中止）':'②同じ線・円弧・円上の反対側の端をクリック。円は短い側／長い側を選択できます（Escで中止）';
  },
  point(s,t){if(s.type==='arc'){const a=(s.start_deg+t*s.extent_deg)*Math.PI/180;return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];}return [s.p0[0]+t*(s.p1[0]-s.p0[0]),s.p0[1]+t*(s.p1[1]-s.p0[1])];},
  stroke(c,s,a,b){c.beginPath();if(s.type==='arc')c.arc(...s.center,s.radius,(s.start_deg+a*s.extent_deg)*Math.PI/180,(s.start_deg+b*s.extent_deg)*Math.PI/180,s.extent_deg<0);else{c.moveTo(...this.point(s,a));c.lineTo(...this.point(s,b));}c.stroke();},
  position(e,d,p){
    if(document.getElementById('cutSnap').checked){
      let nearest=null,best=10/e.view.scale;
      const consider=q=>{const dist=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dist<best){nearest=q;best=dist;}};
      if(!this.full(d.segment))[this.point(d.segment,0),this.point(d.segment,1)].forEach(consider);
      e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((other,si)=>{if(d.ref&&pi===d.ref[0]&&si===d.ref[1])return;DraftGeometry.intersections(d.segment,other).forEach(consider);});});
      if(nearest){p=nearest;}
    }
    if(d.segment.type==='arc'){
      const s=d.segment,ends=[this.point(s,0),this.point(s,1)],dist=ends.map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]));
      if(this.full(s)){const angle=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI;return ((angle-s.start_deg)*Math.sign(s.extent_deg)%360+360)%360/360;}
      const nearest=dist[0]<=dist[1]?0:1;
      if(dist[nearest]<1e-7)return nearest;
      const angle=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI;
      const delta=((angle-s.start_deg)*Math.sign(s.extent_deg)%360+360)%360;
      return delta<=Math.abs(s.extent_deg)?delta/Math.abs(s.extent_deg):nearest;
    }
    const s=d.segment,u=[s.p1[0]-s.p0[0],s.p1[1]-s.p0[1]],length2=u[0]*u[0]+u[1]*u[1];
    const project=q=>Math.max(0,Math.min(1,((q[0]-s.p0[0])*u[0]+(q[1]-s.p0[1])*u[1])/length2));
    return project(p);
  },
  find(e,p){let best=10/e.view.scale,found=null;e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{if((e.cutScope&&e.cutScope!==`${pi}:${si}`)||DraftGeometry.length(s)<1e-6)return;const dist=e.distance(s,p);if(dist<best){best=dist;found={ref:[pi,si],segment:s};}});});return found;},
  pick(e,p){
    let d=e.cutDraft;
    if(!d){d=this.find(e,p);
      if(!d){document.getElementById('cutHint').textContent='直線・円弧・円の線上をクリックしてください。線が重なるときは、先に1本だけ選択してください。';return;}
      d.first=this.position(e,d,p);e.cutDraft=d;
    }else{
      if(e.distance(d.segment,p)>10/e.view.scale){document.getElementById('cutHint').textContent='同じ線・円弧・円上を指定してください。';return;}
      d.second=this.position(e,d,p);
    }
    e.cutHover=null;e.cutCandidate=null;if((e.mode==='splitLine'&&!this.full(d.segment))||d.second!=null){this.commit(e);return;}this.update(e);e.draw();
  },
  draw(e,c){
    const d=e.cutDraft;if(!this.active(e))return;
    if(!d){const cnd=e.cutCandidate;if(cnd){c.strokeStyle='#136e65';c.lineWidth=2/e.view.scale;c.beginPath();c.arc(...this.point(cnd.segment,cnd.t),5/e.view.scale,0,Math.PI*2);c.stroke();}
      if(e.mode==='splitLine'&&e.selected.size>=2){const points=[];for(const key of e.selected){const [pi,si]=key.split(':').map(Number),s=e.doc.paths[pi]?.segments[si];if(s)points.push(this.point(s,0),this.point(s,1));}c.strokeStyle='#136e65';c.lineWidth=2/e.view.scale;for(let i=0;i<points.length;i++)if(points.slice(i+1).some(q=>Math.hypot(q[0]-points[i][0],q[1]-points[i][1])<1e-6)){c.beginPath();c.arc(...points[i],5/e.view.scale,0,Math.PI*2);c.stroke();}}
      return;
    }
    const scale=e.view.scale,first=this.point(d.segment,d.first),second=d.second??e.cutHover;
    c.strokeStyle='#d05b00';c.lineWidth=1.5/scale;c.setLineDash([4/scale,3/scale]);this.stroke(c,d.segment,0,1);c.setLineDash([]);
    c.strokeStyle='#d05b00';c.lineWidth=2/scale;c.beginPath();c.arc(...first,5/scale,0,Math.PI*2);c.stroke();
    if(second!=null){const end=this.point(d.segment,second);if(e.mode==='trimLine'){let a=Math.min(d.first,second),b=Math.max(d.first,second);const short=document.getElementById('circleTrimSide').value==='short';if(this.full(d.segment)&&((b-a<=.5)!==short)){[a,b]=[b,a+1];}c.strokeStyle='#dc2626';c.lineWidth=4/scale;this.stroke(c,d.segment,a,b);}c.beginPath();c.arc(...end,5/scale,0,Math.PI*2);c.stroke();}
  }
};
