// Keep the original PNG and comparison geometry; rotate their canvas presentation losslessly.
window.DraftRotation={
  point(p,w,h,d){return d===1?[h-p[1],p[0]]:[p[1],w-p[0]];},
  turns(n){return (n%4+4)%4;},
  box(b,w,h,d){const pts=[[b[0],b[1]],[b[2],b[3]]].map(p=>this.point(p,w,h,d));return [Math.min(pts[0][0],pts[1][0]),Math.min(pts[0][1],pts[1][1]),Math.max(pts[0][0],pts[1][0]),Math.max(pts[0][1],pts[1][1])];},
  prepare(e,action){
    const d=action==='rotateCW'?1:action==='rotateCCW'?-1:action==='undo'?-(e.rotationUndo.at(-1)||0):action==='redo'?(e.rotationRedo.at(-1)||0):0;
    if(!d)return null;
    const w=e.doc.width,h=e.doc.height,rotate=p=>this.point(p,w,h,d);
    const calibration=c=>c?DraftMeasure.validate({...c,points:c.points.map(rotate)}):null;
    const measurePoints=e.measurePoints.map(rotate);
    if(measurePoints.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)))throw Error('回転後の測定点が範囲外です。');
    const protection=e.protection.map(b=>this.box(b,w,h,d).map(v=>Math.max(-1e7,Math.min(1e7,v))));
    return {width:h,height:w,backgroundTurns:this.turns(e.backgroundTurns+d),baselineTurns:this.turns(e.baselineTurns+d),calibration:calibration(e.calibration),scaleHistory:e.scaleHistory.map(calibration),measurePoints,protection,regionBox:e.regionBox?this.box(e.regionBox,w,h,d):null};
  },
  apply(e,meta){
    e.doc.width=meta.width;e.doc.height=meta.height;
    for(const key of ['backgroundTurns','baselineTurns','calibration','scaleHistory','measurePoints','protection','regionBox'])e[key]=meta[key];
    e.mode='select';document.getElementById('mode').value='select';
  },
  context(c,w,h,turns){
    if(turns===1){c.translate(w,0);c.rotate(Math.PI/2);}
    else if(turns===2){c.translate(w,h);c.rotate(Math.PI);}
    else if(turns===3){c.translate(0,h);c.rotate(-Math.PI/2);}
  },
  drawBackground(e,c){
    if(!e.background)return;c.save();this.context(c,e.doc.width,e.doc.height,e.backgroundTurns);
    const odd=e.backgroundTurns%2;c.drawImage(e.background,0,0,odd?e.doc.height:e.doc.width,odd?e.doc.width:e.doc.height);c.restore();
  }
};
