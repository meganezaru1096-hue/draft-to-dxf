// Measurements use processing-image coordinates; calibration affects DXF only.
window.DraftMeasure = {
  method(){return document.getElementById('calibrationMethod').value;},
  reference(editor){
    if(this.method()==='points')return editor.measurePoints.length===2?editor.measurePoints.map(p=>p.slice()):null;
    if(editor.selected.size!==1)return null;
    const [pi,si]=[...editor.selected][0].split(':').map(Number),s=editor.doc?.paths[pi]?.segments[si];
    return s?.type==='line'&&DraftGeometry.length(s)>=1e-6?[s.p0.slice(),s.p1.slice()]:null;
  },
  validate(value){
    if(value==null)return null;
    if(typeof value!=='object'||!Array.isArray(value.points)||value.points.length!==2||value.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)))throw Error('縮尺の基準点が不正です。');
    const distance=Math.hypot(value.points[1][0]-value.points[0][0],value.points[1][1]-value.points[0][1]);
    if(distance<1e-6||!Number.isFinite(value.knownMm)||value.knownMm<=0||!Number.isFinite(value.mmPerPixel)||value.mmPerPixel<1e-6||value.mmPerPixel>1e6||Math.abs(value.knownMm/distance/value.mmPerPixel-1)>1e-8)throw Error('縮尺の値が不正です。');
    return {points:value.points.map(p=>p.slice()),knownMm:value.knownMm,mmPerPixel:value.mmPerPixel};
  },
  init(editor){
    editor.measurePoints=[];editor.calibration=null;editor.scaleHistory=[];
    document.getElementById('mode').add(new Option('距離・縮尺','measure'));
    document.getElementById('measureMode').onclick=()=>{if(this.method()==='points')editor.setMode('measure');else{if(editor.mode!=='select'){const selected=new Set(editor.selected);editor.setMode('select');editor.selected=selected;}window.DraftLayout?.reveal('measure');editor.update();editor.draw();}};
    document.getElementById('calibrationMethod').addEventListener('change',()=>{if(this.method()==='line'&&editor.mode==='measure')editor.setMode('select');editor.update();editor.draw();});
    editor.canvas.addEventListener('keydown',event=>{if(editor.mode!=='measure')return;if(event.key==='Escape'){editor.measurePoints=[];editor.update();editor.draw();}if(event.key==='Escape'||DraftSettings.is(event,'delete')){event.preventDefault();event.stopImmediatePropagation();}});
    document.getElementById('applyScale').onclick=()=>{
      if(editor.busy)return;
      try{
        const points=this.reference(editor),knownMm=Number(document.getElementById('knownMm').value);
        if(!points)throw Error(this.method()==='line'?'長さのある直線を1本だけ選択してください。':'基準になる2点を指定してください。');
        const distance=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
        const next=this.validate({points,knownMm,mmPerPixel:knownMm/distance});
        this.commit(editor,next);
      }catch(error){document.getElementById('measureResult').textContent=error.message;}
    };
    document.getElementById('resetScale').onclick=()=>{if(!editor.busy&&editor.calibration)this.commit(editor,null);};
    document.getElementById('undoScale').onclick=()=>{if(editor.busy||!editor.scaleHistory.length)return;editor.calibration=editor.scaleHistory.pop();editor.dirty=true;editor.update();editor.draw();};
    document.getElementById('clearMeasure').onclick=()=>{editor.measurePoints=[];editor.update();editor.draw();};
  },
  commit(editor,value){editor.scaleHistory.push(editor.calibration);if(editor.scaleHistory.length>30)editor.scaleHistory.shift();editor.calibration=value;editor.dirty=true;editor.update();editor.draw();},
  reset(editor,value){editor.calibration=this.validate(value);editor.scaleHistory=[];editor.measurePoints=[];},
  pick(editor,point){
    if(document.getElementById('measureSnap').checked){
      point=DraftGeometry.snap(editor,point).point;
    }
    if(editor.measurePoints.length===2)editor.measurePoints=[];
    editor.measurePoints.push(point);editor.update();editor.draw();
  },
  update(editor){
    const ready=!!editor.doc&&!editor.busy,points=editor.measurePoints||[],cal=editor.calibration;
    const lineMode=this.method()==='line',reference=this.reference(editor);
    document.getElementById('measureMode').textContent=lineMode?'直線を選んで実寸合わせ':'距離・縮尺を測る';
    document.getElementById('knownMm').closest('label').firstChild.textContent=lineMode?'選択した直線の実際の長さ':'指定した2点の実寸';
    document.getElementById('applyScale').textContent=lineMode?'この線の長さで実寸設定':'この寸法で縮尺設定';
    document.getElementById('measureMode').disabled=!ready;
    for(const id of ['knownMm','measureSnap'])document.getElementById(id).disabled=!ready;
    document.getElementById('applyScale').disabled=!ready||!reference;
    document.getElementById('resetScale').disabled=!ready||!cal;
    document.getElementById('undoScale').disabled=!ready||!editor.scaleHistory?.length;
    document.getElementById('clearMeasure').disabled=!ready||!points.length;
    const scale=cal?.mmPerPixel??25.4/Number(document.getElementById('dpi').value);
    let result=points.length===1?'1点目を指定しました。2点目をクリックしてください。':'「距離・縮尺」モードで2点をクリックしてください。';
    if(points.length===2){const dx=(points[1][0]-points[0][0])*scale,dy=(points[1][1]-points[0][1])*scale;
      result=Number.isFinite(scale)&&scale>0?`距離 ${Math.hypot(dx,dy).toFixed(3)} mm ／ 横 ${Math.abs(dx).toFixed(3)} mm ／ 縦 ${Math.abs(dy).toFixed(3)} mm（${cal?'設定した実寸':'用紙上の寸法・実寸未設定'}）`:'有効なDPIを入力してください。';
    }
    if(lineMode){const distance=reference?Math.hypot(reference[1][0]-reference[0][0],reference[1][1]-reference[0][1]):null;result=reference?Number.isFinite(scale)&&scale>0?`選択した直線：${(distance*scale).toFixed(3)} mm（${cal?'現在の実寸':'用紙上の寸法'}）。実際の長さをmmで入力して適用してください。`:'有効なDPIを入力してください。':'直線を1本だけ選択し、実際の長さをmmで入力してください。方式は「設定 → 縮尺設定」で変更できます。';}
    document.getElementById('measureResult').textContent=result;
    document.getElementById('scaleState').textContent=cal?`DXF：実寸設定済み（1 px = ${cal.mmPerPixel.toPrecision(7)} mm）`:'DXF：実寸未設定（用紙上の寸法）';
  },
  draw(editor,c){
    const pts=editor.measurePoints||[];if(editor.mode!=='measure'||pts.length!==1)return;
    c.strokeStyle='#148443';c.fillStyle='#148443';c.lineWidth=2/editor.view.scale;
    pts.forEach((p,i)=>{c.beginPath();c.arc(...p,5/editor.view.scale,0,Math.PI*2);c.stroke();c.font=`${14/editor.view.scale}px sans-serif`;c.fillText(String(i+1),p[0]+8/editor.view.scale,p[1]-8/editor.view.scale);});
  }
};
