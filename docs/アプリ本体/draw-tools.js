window.DraftDraw = {
  active(editor){return ['drawLine','drawCircle','drawArc'].includes(editor.mode);},
  init(editor){
    editor.drawPoints=[];editor.drawHover=null;
    for(const [mode,label] of [['drawLine','直線を追加'],['drawCircle','円を追加'],['drawArc','3点円弧を追加']]){
      document.getElementById('mode').add(new Option(label,mode));
      document.getElementById(mode).onclick=()=>editor.setMode(mode);
    }
    document.getElementById('cancelDraw').onclick=()=>this.cancel(editor);
    editor.canvas.addEventListener('keydown',event=>{
      if(!this.active(editor))return;
      if(event.key==='Escape'||DraftSettings.is(event,'delete')||(DraftSettings.is(event,'undo')&&editor.drawPoints.length)){
        event.preventDefault();event.stopImmediatePropagation();this.cancel(editor);
      }
    });
  },
  cancel(editor){editor.drawPoints=[];editor.drawHover=null;this.update(editor);editor.draw();},
  update(editor){
    for(const id of ['drawLine','drawCircle','drawArc','drawSnap'])document.getElementById(id).disabled=editor.busy||!editor.doc;
    document.getElementById('cancelDraw').disabled=!editor.drawPoints?.length||editor.busy;
    const n=editor.drawPoints?.length||0;
    const messages={drawLine:['始点をクリック','終点をクリックして確定'],drawCircle:['中心をクリック','円周上の点をクリックして確定'],drawArc:['始点をクリック','円弧が通る中間点をクリック','終点をクリックして確定']};
    document.getElementById('drawHint').textContent=this.active(editor)?messages[editor.mode][n]+'（Escで中止）':'直線：2点 ／ 円：中心・円周 ／ 円弧：始点・中間点・終点';
  },
  snap(editor,point){
    const hit=document.getElementById('drawSnap').checked?DraftGeometry.snap(editor,point):{point:point.slice(),kind:'自由位置'};
    let result=hit.point;editor.drawSnapKind=hit.kind;
    if(editor.mode==='drawLine'&&editor.drawPoints.length){
      const start=editor.drawPoints[0],axis=document.getElementById('drawAxis').value;
      if(document.getElementById('drawExact').checked){
        const length=Number(document.getElementById('drawLength').value),angle=Number(document.getElementById('drawAngle').value)*Math.PI/180;
        const scale=editor.calibration?.mmPerPixel??25.4/Number(document.getElementById('dpi').value);
        if(Number.isFinite(length)&&length>0&&Number.isFinite(angle)&&Number.isFinite(scale)&&scale>0){const r=length/scale;result=[start[0]+r*Math.cos(angle),start[1]-r*Math.sin(angle)];editor.drawSnapKind='長さ・角度の数値指定';}
      }else if(axis==='horizontal'||axis==='orthogonal'&&Math.abs(result[0]-start[0])>=Math.abs(result[1]-start[1]))result[1]=start[1];
      else if(axis==='vertical'||axis==='orthogonal')result[0]=start[0];
      if(!document.getElementById('drawExact').checked&&axis!=='free')editor.drawSnapKind=axis==='horizontal'?'水平拘束':axis==='vertical'?'垂直拘束':'直交拘束';
    }
    return result;
  },
  segment(mode,points){
    const [a,b,c]=points;
    if(points.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)))throw Error('座標が不正です。');
    const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(distance<1e-6)throw Error('異なる点を指定してください。');
    if(mode==='drawLine')return {type:'line',p0:a.slice(),p1:b.slice()};
    if(mode==='drawCircle')return {type:'arc',center:a.slice(),radius:distance,start_deg:0,extent_deg:360};
    const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],cross=ux*vy-uy*vx;
    if(Math.abs(cross)<1e-6*Math.max(distance*Math.hypot(vx,vy),1))throw Error('3点が一直線または近すぎます。中間点を選び直してください。');
    const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy;
    const center=[a[0]+(uu*vy-vv*uy)/(2*cross),a[1]+(ux*vv-vx*uu)/(2*cross)];
    const radius=Math.hypot(a[0]-center[0],a[1]-center[1]);
    if(!Number.isFinite(radius)||radius>1e7||center.some(v=>Math.abs(v)>1e7))throw Error('円弧の半径が大きすぎます。');
    const angle=p=>Math.atan2(p[1]-center[1],p[0]-center[0])*180/Math.PI,mod=v=>(v%360+360)%360;
    const start=angle(a),middle=mod(angle(b)-start),end=mod(angle(c)-start);
    return {type:'arc',center,radius,start_deg:start,extent_deg:middle<end?end:end-360};
  },
  pick(editor,point){
    if(editor.mode==='drawLine'&&editor.drawPoints.length&&document.getElementById('drawExact').checked){
      const length=Number(document.getElementById('drawLength').value),angle=Number(document.getElementById('drawAngle').value);
      if(!Number.isFinite(length)||length<=0||!Number.isFinite(angle)){document.getElementById('drawHint').textContent='長さは正のmm、角度は数値で入力してください。';return;}
    }
    point=this.snap(editor,point);
    const count=editor.mode==='drawArc'?3:2,points=[...editor.drawPoints,point];
    if(points.length<count){
      if(points.length===2&&Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])<1e-6){document.getElementById('drawHint').textContent='異なる点を指定してください。';return;}
      editor.drawPoints=points;this.update(editor);editor.draw();return;
    }
    try{
      const segment=this.segment(editor.mode,points),closed=editor.mode==='drawCircle';
      this.cancel(editor);editor.setBusy(true);editor.send({kind:'edit',action:'add',paths:[{closed,segments:[segment]}]});
    }catch(error){document.getElementById('drawHint').textContent=error.message+' Escで描き直せます。';}
  },
  draw(editor,c){
    if(!this.active(editor))return;
    const pts=editor.drawPoints,hover=editor.drawHover,scale=editor.view.scale;
    c.strokeStyle='#d05b00';c.fillStyle='#d05b00';c.lineWidth=2/scale;
    for(const p of pts){c.beginPath();c.arc(...p,4/scale,0,Math.PI*2);c.stroke();}
    if(!hover)return;
    c.strokeRect(hover[0]-4/scale,hover[1]-4/scale,8/scale,8/scale);
    if(!pts.length)return;
    c.setLineDash([5/scale,3/scale]);c.beginPath();
    try{
      if(editor.mode==='drawArc'&&pts.length===1){c.moveTo(...pts[0]);c.lineTo(...hover);}
      else{const s=this.segment(editor.mode,[...pts,hover]);if(s.type==='line'){c.moveTo(...s.p0);c.lineTo(...s.p1);}else c.arc(...s.center,s.radius,s.start_deg*Math.PI/180,(s.start_deg+s.extent_deg)*Math.PI/180,s.extent_deg<0);}
      c.stroke();
    }catch(_){/* Invalid candidates are not committed or rendered as geometry. */}
    c.setLineDash([]);
  }
};
