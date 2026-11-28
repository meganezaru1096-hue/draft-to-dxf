// Trace-oriented commands. All geometry is validated again by the Python bridge.
(() => {
  const $=id=>document.getElementById(id);
  const make=(tag,id,text)=>{const n=document.createElement(tag);if(id)n.id=id;if(text)n.textContent=text;return n;};
  const labels={delete:'削除',merge:'直線統合',mergeArcs:'円・円弧統合',mergeEllipse:'楕円統合',align:'整列',linearize:'直線化',corner:'角作成',horizontal:'水平化',vertical:'垂直化',translate:'移動',add:'図形追加',changeArc:'円弧変更',moveEndpoint:'端点変更',extendTo:'相手まで延長',splitLine:'分割',trimLine:'区間削除',rotateCW:'右90°回転',rotateCCW:'左90°回転',region:'範囲再変換',applyPreview:'編集'};
  window.DraftHistory={
    snapshot(e){const p=e.project();return {...p,calibration:structuredClone(p.calibration),protection:structuredClone(p.protection)};},
    reset(e){e.commandUndo=[];e.commandRedo=[];e.commandPending=null;e.historyTarget=null;},
    begin(e,label){if(!e.doc||e.historyTarget||e.commandPending)return;e.commandPending={label,before:this.snapshot(e)};},
    commit(e){if(!e.commandPending)return;const entry=e.commandPending;e.commandPending=null;entry.after=this.snapshot(e);e.commandUndo.push(entry);if(e.commandUndo.length>30)e.commandUndo.shift();e.commandRedo=[];},
    abort(e){e.commandPending=null;e.historyTarget=null;},
    step(e,direction){if(e.busy||!e.doc)return;const from=direction<0?e.commandUndo:e.commandRedo,entry=from.at(-1);if(!entry)return;e.historyTarget={entry,direction,target:direction<0?entry.before:entry.after};e.send({kind:'edit',action:'historyRestore',paths:e.historyTarget.target.paths,label:(direction<0?'取り消し：':'やり直し：')+entry.label});},
    accept(e,response){
      const h=e.historyTarget;if(!h){this.commit(e);return;}
      const undo=e.commandUndo,redo=e.commandRedo,p=h.target;
      $('dpi').value=p.dpi;
      if(e.applySnapshot){
        e.applySnapshot(p,response.paths,response.revision);
      }else{
        const view={...e.view};
        e.setDocument({...p,paths:response.paths},{...p,baselinePaths:p.baselinePaths,dirty:true});
        e.view=view;e.revision=response.revision;
      }
      e.commandUndo=undo;e.commandRedo=redo;
      (h.direction<0?undo:redo).pop();(h.direction<0?redo:undo).push(h.entry);
      e.historyTarget=null;e.commandPending=null;e.dirty=true;e.draw();
    },
    init(e){
      this.reset(e);
      const set=e.setDocument.bind(e),accept=e.acceptEdit.bind(e),mode=e.setMode.bind(e);
      e.setDocument=(...args)=>{this.reset(e);set(...args);};
      e.acceptEdit=response=>{
        if(e.historyTarget)this.accept(e,response);
        else{
          const request=e.lastRequest,count=e.doc.paths.length;
          accept(response);
          if(request?.selectAdded){e.selected=new Set(e.doc.paths.slice(count).flatMap((p,i)=>p.segments.map((s,j)=>`${count+i}:${j}`)));}
          else if(request?.selectAfter){e.selected=new Set(request.selectAfter.filter(([pi,si])=>!!e.doc.paths[pi]?.segments[si]).map(ref=>ref.join(':')));}
          this.accept(e,response);
        }
        e.update();e.draw();
      };
      e.setMode=value=>{
        e.trimDraft=null;mode(value);
        const key={drawLine:'draw',drawCircle:'draw',drawArc:'draw',endpoint:'endpoint',extend:'extend',trimLine:'cut',partialRepair:'partialRepair',measure:'measure'}[e.mode];
        if(key)DraftLayout.reveal(key,false);
      };
      const commit=DraftMeasure.commit.bind(DraftMeasure);
      DraftMeasure.commit=(editor,value)=>{this.begin(editor,'実寸設定');commit(editor,value);this.commit(editor);editor.update();};
      $('undoScale').textContent='元に戻す（共通履歴）';$('undoScale').onclick=()=>this.step(e,-1);
    }
  };
  const rotatePoint=(pt,c,cos,sin)=>[c[0]+(pt[0]-c[0])*cos-(pt[1]-c[1])*sin,c[1]+(pt[0]-c[0])*sin+(pt[1]-c[1])*cos];
  const transformSegment=(s,fn,extra)=>{
    const copy=structuredClone(s);
    if(copy.type==='line'){copy.p0=fn(copy.p0);copy.p1=fn(copy.p1);}
    else if(copy.type==='arc'){copy.center=fn(copy.center);extra.arc(copy);}
    else{copy.center=fn(copy.center);extra.ellipse(copy);}
    return copy;
  };
  window.DraftWorkbench={
    offsetPreviewActive:false,
    refs(e){return [...e.selected].map(k=>k.split(':').map(Number));},
    selected(e){return this.refs(e).map(([pi,si])=>({pi,si,path:e.doc.paths[pi],s:e.doc.paths[pi].segments[si]}));},
    scale(e){return DraftWorkflow.scale(e);},
    number(id){const v=$(id).value;if(!v.trim()||!Number.isFinite(Number(v)))throw Error('数値を入力してください。');return Number(v);},
    replace(e,paths,label,selectAfter=[]){if(e.busy)return;e.send({kind:'edit',action:'replacePaths',paths,label,selectAfter});},
    init(e){
      this.editor=e;DraftHistory.init(e);
      const output=make('p','outputSummary');output.className='output-summary';output.setAttribute('aria-live','polite');$('tools-output').querySelector('.tool-body').prepend(output);
      const history=make('span','historySummary');history.className='history-summary';$('activeInstruction').append(history);
      const snaps=make('div','snapStatus');snaps.className='snap-status';
      const toggle=make('button','toggleSnap','吸着 ON');toggle.type='button';toggle.onclick=()=>{const id=this.snapControl(e),n=$(id);n.checked=!n.checked;n.dispatchEvent(new Event('change',{bubbles:true}));e.update();};
      const midBtn=make('button','toggleSnapMid','中点');midBtn.type='button';midBtn.title='中点への吸着を切り替え';midBtn.onclick=()=>{const n=$('snapMidpoint');n.checked=!n.checked;n.dispatchEvent(new Event('change',{bubbles:true}));e.update();};
      const cenBtn=make('button','toggleSnapCenter','中心');cenBtn.type='button';cenBtn.title='円・円弧の中心への吸着を切り替え';cenBtn.onclick=()=>{const n=$('snapCenter');n.checked=!n.checked;n.dispatchEvent(new Event('change',{bubbles:true}));e.update();};
      const snapText=make('span','snapDetail');snaps.append(toggle,midBtn,cenBtn,snapText);$('activeInstruction').before(snaps);

      const group=make('details','tools-properties');group.className='tool-group';group.open=true;group.append(make('summary',null,'選択した要素'));
      const body=make('div');body.className='tool-body';group.append(body);$('tools-edit').before(group);
      body.append(make('p','propertySummary','線を1つ選ぶと寸法を確認・編集できます。'));
      const form=make('div','propertyFields');form.className='property-fields';
      for(const [id,label] of [['propertySize','長さ / 直径 mm'],['propertyMinor','短径 mm'],['propertyAngle','角度 °']]){const l=make('label',null,label),n=make('input',id);n.type='number';n.step='any';l.hidden=id==='propertyMinor';l.append(n);form.append(l);}
      const apply=make('button','applyProperties','寸法を変更');apply.type='button';apply.onclick=()=>this.applyProperties(e);form.append(apply);body.append(form,make('p','propertyHint','直線の角度は右0°・上90°。始点を維持。円・円弧は中心を維持します。'));

      const prod=make('details','tools-productivity');prod.className='tool-group';prod.open=true;prod.append(make('summary',null,'複写・移動・変形'));
      const pb=make('div');pb.className='tool-body';prod.append(pb);$('tools-arc').before(prod);
      for(const [id,t,v] of [['copyX','移動 / 複写 横 mm','10'],['copyY','移動 / 複写 縦 mm','0'],['offsetDistance','オフセット mm','1']]){const l=make('label',null,t),n=make('input',id);n.type='number';n.step='any';n.value=v;l.append(n);pb.append(l);}
      for(const [id,t,f] of [['copySelected','選択を複写',()=>this.copy(e)],['moveSelected','選択を数値移動',()=>this.moveNumeric(e)],['offsetSelected','平行線 / 同心円を複写',()=>this.offset(e)]]){const b=make('button',id,t);b.type='button';b.onclick=f;pb.append(b);}
      const xformRow=make('div');xformRow.className='toolbar';
      const angLabel=make('label',null,'回転角 °'),angInput=make('input','transformAngle');angInput.type='number';angInput.step='any';angInput.value='90';angLabel.append(angInput);
      const rotBtn=make('button','rotateSelected','選択を回転');rotBtn.type='button';rotBtn.title='選択した要素を中心基準で反時計回りに回転';rotBtn.onclick=()=>this.rotateSelection(e);
      const mirH=make('button','mirrorH','左右反転');mirH.type='button';mirH.onclick=()=>this.mirrorSelection(e,'h');
      const mirV=make('button','mirrorV','上下反転');mirV.type='button';mirV.onclick=()=>this.mirrorSelection(e,'v');
      xformRow.append(angLabel,rotBtn,mirH,mirV);pb.append(xformRow);
      const filletRow=make('div');filletRow.className='toolbar';
      const filLabel=make('label',null,'R丸め半径 mm'),filInput=make('input','filletRadius');filInput.type='number';filInput.min='0.001';filInput.step='any';filInput.value='5';filLabel.append(filInput);
      const filBtn=make('button','filletSelected','2直線の角をR丸め');filBtn.type='button';filBtn.onclick=()=>this.fillet(e);
      filletRow.append(filLabel,filBtn);pb.append(filletRow);
      pb.append(make('p',null,'移動・複写：右・上が正。回転：反時計回りが正。オフセット：入力欄にカーソルを置くと緑破線で方向を事前表示します。'));

      // Offset direction preview while editing offset distance or hovering offset button.
      const setPreview=v=>{if(this.offsetPreviewActive!==v){this.offsetPreviewActive=v;e.scheduleDraw();}};
      $('offsetDistance').addEventListener('focus',()=>setPreview(true));
      $('offsetDistance').addEventListener('blur',()=>setPreview(false));
      $('offsetDistance').addEventListener('input',()=>{if(this.offsetPreviewActive)e.scheduleDraw();});
      $('offsetSelected').addEventListener('mouseenter',()=>setPreview(true));
      $('offsetSelected').addEventListener('mouseleave',()=>{if(document.activeElement!==$('offsetDistance'))setPreview(false);});

      // Register new groups with the same navigation mechanism as existing commands.
      DraftLayout.register('productivity',prod);DraftLayout.register('properties',group);
      e.canvas.addEventListener('pointermove',event=>{
        if(!e.doc||e.busy||!e.pointerInside)return;
        const p=e.world(e.position(event));
        if(e.mode==='trimTo'){this.hoverTrim(e,p);e.scheduleDraw();}
        if(['drawLine','drawCircle','drawArc','endpoint','measure','splitLine','trimLine'].includes(e.mode)){
          const enabled=$(this.snapControl(e)).checked;
          let kind;
          if(DraftDraw.active(e))kind=e.drawSnapKind;
          else if(e.mode==='endpoint')kind=e.endpointTarget?.kind;
          else if(e.mode==='measure')kind=enabled?(e.measureHover?.kind||DraftGeometry.snap(e,p).kind):'自由位置';
          else kind=enabled?'切断位置：端点 / 交点への吸着':'切断位置：線上の自由位置';
          $('snapDetail').textContent=kind||'自由位置';
        }
      });
      $('dxfLayerMode')?.addEventListener('change',()=>this.update(e));
      this.update(e);
    },
    snapControl(e){return e.mode==='measure'?'measureSnap':e.mode==='endpoint'?'endpointSnap':['trimTo','splitLine','trimLine'].includes(e.mode)?'cutSnap':'drawSnap';},
    update(e){
      if(!this.editor||!$('outputSummary'))return;
      const dpi=Number($('dpi').value),mm=this.scale(e),valid=Number.isFinite(dpi)&&dpi>=1&&dpi<=9600;
      const dxfLayerText=$('dxfLayerMode')?.value==='single'?'GEOMETRY統一':'AIレイヤー分け';
      $('outputSummary').textContent=e.doc&&valid?`DXF · mm · ${(e.doc.width*mm).toFixed(2)} × ${(e.doc.height*mm).toFixed(2)}（${e.calibration?'実寸設定済み':'用紙寸法・実寸未設定'} / ${dxfLayerText}）\nPDF · ${(e.doc.width*25.4/dpi).toFixed(2)} × ${(e.doc.height*25.4/dpi).toFixed(2)} mm · ${dpi} dpi換算`:'用紙換算DPIを1〜9600で指定してください。';
      if(e.doc&&valid){if(this.boundsCache?.paths!==e.doc.paths){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const path of e.doc.paths){for(const s of path.segments){const q=e.bounds(s);b[0]=Math.min(b[0],q[0]);b[1]=Math.min(b[1],q[1]);b[2]=Math.max(b[2],q[2]);b[3]=Math.max(b[3],q[3]);}}this.boundsCache={paths:e.doc.paths,b};}const b=this.boundsCache.b;if(b.every(Number.isFinite)){$('outputSummary').textContent+=`\n出力する線の範囲 · ${((b[2]-b[0])*mm).toFixed(2)} × ${((b[3]-b[1])*mm).toFixed(2)} mm（DXF）`;if(b[0]<0||b[1]<0||b[2]>e.doc.width||b[3]>e.doc.height)$('outputSummary').textContent+='\n注意：用紙外の線があります。DXFには残りますが、PDFでは切れます。';}}
      for(const id of ['saveProject','exportPdf','exportDxf'])$(id).disabled=!e.doc||!!e.comparing||!!e.pendingPreview||!!e.pendingMove||!!e.drag?.move?.started;
      e.undo=!!e.commandUndo?.length;e.redo=!!e.commandRedo?.length;$('undo').disabled=e.busy||!e.undo;$('redo').disabled=e.busy||!e.redo;$('undoScale').disabled=$('undo').disabled;
      const last=e.commandUndo?.at(-1),next=e.commandRedo?.at(-1);$('undo').title=last?'取り消し：'+last.label:'取り消す操作はありません';$('redo').title=next?'やり直し：'+next.label:'やり直す操作はありません';$('historySummary').textContent=last?'元に戻す：'+last.label:'';
      const id=this.snapControl(e),on=$(id).checked,applicable=['drawLine','drawCircle','drawArc','endpoint','measure','splitLine','trimLine'].includes(e.mode);
      $('toggleSnap').textContent=applicable?'吸着 '+(on?'ON':'OFF'):'吸着 —';$('toggleSnap').setAttribute('aria-pressed',String(applicable&&on));$('toggleSnap').disabled=e.busy||!e.doc||!applicable;
      const midOn=$('snapMidpoint').checked,cenOn=$('snapCenter').checked;
      $('toggleSnapMid').setAttribute('aria-pressed',String(midOn));$('toggleSnapMid').classList.toggle('active-tool',midOn);$('toggleSnapMid').disabled=e.busy||!e.doc||!applicable||!on;
      $('toggleSnapCenter').setAttribute('aria-pressed',String(cenOn));$('toggleSnapCenter').classList.toggle('active-tool',cenOn);$('toggleSnapCenter').disabled=e.busy||!e.doc||!applicable||!on;
      if(this.lastSnapMode!==e.mode||this.lastSnapOn!==on){$('snapDetail').textContent=!applicable?['extend','trimTo'].includes(e.mode)?'相手の線との交点を自動計算':'作図・測定・端点編集で使用':on?'端点 / 交点'+(midOn?' / 中点':'')+(cenOn?' / 中心':''):'自由位置';this.lastSnapMode=e.mode;this.lastSnapOn=on;}
      const items=e.doc?this.selected(e):[],key=items.length===1?[...e.selected][0]+':'+e.revision+':'+mm:null;
      const hasEllipse=items.some(({s})=>s.type==='ellipse');
      const onlyTwoLines=items.length===2&&items.every(({s})=>s.type==='line');
      for(const id of ['copySelected','moveSelected','offsetSelected'])$(id).disabled=e.busy||!e.selected.size||!Number.isFinite(mm)||mm<=0||(id==='offsetSelected'&&hasEllipse);
      for(const id of ['rotateSelected','mirrorH','mirrorV'])$(id).disabled=e.busy||!e.selected.size;
      $('filletSelected').disabled=e.busy||!onlyTwoLines||!Number.isFinite(mm)||mm<=0;
      $('offsetSelected').title=hasEllipse?'楕円はオフセットの対象外です。':'';
      $('propertyFields').hidden=items.length!==1;$('applyProperties').disabled=e.busy||items.length!==1;
      if(items.length===1){const {s}=items[0],ellipse=s.type==='ellipse',line=s.type==='line',circle=!ellipse&&DraftGeometry.closed(s);
        $('propertyMinor').closest('label').hidden=!ellipse;
        $('propertySize').closest('label').firstChild.textContent=ellipse?'長径 mm':line?'長さ mm':circle?'直径 mm':'半径 mm';$('propertyAngle').closest('label').firstChild.textContent=ellipse?'長軸の角度 °':line?'角度 °':'開き角 °';
        const axisAngle=ellipse?(-s.rotation*180/Math.PI%180+180)%180:null;
        $('propertySummary').textContent=ellipse?`楕円 · 長径 ${(2*s.rx*mm).toFixed(3)} mm · 短径 ${(2*s.ry*mm).toFixed(3)} mm · 角度 ${axisAngle.toFixed(3)}°`:line?`直線 · 長さ ${(DraftGeometry.length(s)*mm).toFixed(3)} mm`:`${circle?'円':'円弧'} · 半径 ${(s.radius*mm).toFixed(3)} mm · 直径 ${(2*s.radius*mm).toFixed(3)} mm · 開き角 ${s.extent_deg.toFixed(3)}°`;
        $('propertyHint').textContent=(e.calibration?'設定した実寸':'用紙上の寸法（実寸未設定）')+(ellipse?'。楕円は中心固定・長軸は右0°/上90°。':'。直線は始点固定・右0°/上90°。円と円弧は中心固定。円弧の開き角は時計回りが正。');
        if(key!==this.propertyKey){$('propertySize').value=Number(((ellipse?2*s.rx:line?DraftGeometry.length(s):s.radius*(circle?2:1))*mm).toPrecision(12));$('propertyAngle').value=ellipse?Number(axisAngle.toPrecision(12)):line?Number((-Math.atan2(s.p1[1]-s.p0[1],s.p1[0]-s.p0[0])*180/Math.PI).toPrecision(12)):s.extent_deg;if(ellipse)$('propertyMinor').value=Number((2*s.ry*mm).toPrecision(12));$('propertyAngle').disabled=circle;this.propertyKey=key;}
      }else{$('propertySummary').textContent=items.length?`${items.length}要素 · 合計長さ ${(items.reduce((n,x)=>n+DraftGeometry.length(x.s),0)*mm).toFixed(3)} mm`:'線を1つ選ぶと寸法を確認・編集できます。';this.propertyKey=null;}
      if(e.mode==='trimTo'){$('activeMode').textContent='切り詰め';$('instructionText').textContent=e.trimDraft?'②相手の線をクリック。赤が削除される側（Escで中止）':'①短くする側の端点をクリック → ②相手の線をクリック';}
      window.DraftSession?.update();
      DraftLayout.refreshPanels?.(e);
    },
    applyProperties(e){try{if(e.busy||e.selected.size!==1)return;const {pi,si,s}=this.selected(e)[0],mm=this.scale(e),size=this.number('propertySize')/mm,angle=this.number('propertyAngle');if(!Number.isFinite(size)||size<=1e-6||size>1e7)throw Error('寸法は正の範囲内で指定してください。');const paths=structuredClone(e.doc.paths),p=paths[pi];let segment;
      if(s.type==='line'){const a=angle*Math.PI/180;segment={...s,p1:[s.p0[0]+size*Math.cos(a),s.p0[1]-size*Math.sin(a)]};}
      else if(s.type==='ellipse'){const minor=this.number('propertyMinor')/mm;if(minor<=2e-6||minor>size)throw Error('短径は0より大きく、長径以下で指定してください。');segment={...s,rx:size/2,ry:minor/2,rotation:-(angle%180)*Math.PI/180};}
      else{const circle=DraftGeometry.closed(s);if(!circle&&(!angle||Math.abs(angle)>360))throw Error('開き角は0°以外、±360°以内です。');segment={...s,radius:circle?size/2:size,extent_deg:circle?s.extent_deg:angle};}
      if(p.segments.length===1){p.segments[si]=segment;p.closed=DraftGeometry.closed(segment);}
      else{p.segments.splice(si,1);p.closed=false;paths.push({...p,segments:[segment],closed:DraftGeometry.closed(segment)});}
      this.replace(e,paths,'選択寸法変更',[p.segments.length===1&&e.doc.paths[pi].segments.length===1?[pi,si]:[paths.length-1,0]]);
    }catch(error){$('propertyHint').textContent=error.message;}},
    copy(e){try{if(e.busy)return;const mm=this.scale(e),dx=this.number('copyX')/mm,dy=-this.number('copyY')/mm;if(!Number.isFinite(dx+dy)||Math.hypot(dx,dy)<1e-9)throw Error('0以外の複写距離を指定してください。');const added=this.selected(e).map(({path,s})=>{s=structuredClone(s);if(s.type==='line'){s.p0=[s.p0[0]+dx,s.p0[1]+dy];s.p1=[s.p1[0]+dx,s.p1[1]+dy];}else s.center=[s.center[0]+dx,s.center[1]+dy];return {...path,segments:[s],closed:DraftGeometry.closed(s)};});e.send({kind:'edit',action:'add',paths:added,label:'複写',selectAdded:true});}catch(error){$('status').textContent=error.message;}},
    moveNumeric(e){try{if(e.busy||!e.selected.size)return;const mm=this.scale(e),dx=this.number('copyX')/mm,dy=-this.number('copyY')/mm;if(!Number.isFinite(dx+dy)||Math.hypot(dx,dy)<1e-9)throw Error('0以外の移動距離を指定してください。');e.send({kind:'edit',action:'translate',refs:this.refs(e),delta:[dx,dy],label:'数値移動'});}catch(error){$('status').textContent=error.message;}},
    selectionCenter(items){
      const b=[Infinity,Infinity,-Infinity,-Infinity];
      for(const {s} of items){const q=DraftGeometry.bounds(s);b[0]=Math.min(b[0],q[0]);b[1]=Math.min(b[1],q[1]);b[2]=Math.max(b[2],q[2]);b[3]=Math.max(b[3],q[3]);}
      return [(b[0]+b[2])/2,(b[1]+b[3])/2];
    },
    applyTransform(e,label,fn,extra){
      const items=this.selected(e);if(!items.length)return;
      const selectedKeys=new Set(e.selected);
      const outPaths=[],selIdx=[];
      e.doc.paths.forEach((p,pi)=>{
        const keep=[],moved=[];
        p.segments.forEach((s,si)=>{
          if(selectedKeys.has(`${pi}:${si}`))moved.push(transformSegment(s,fn,extra));
          else keep.push(structuredClone(s));
        });
        if(keep.length)outPaths.push({...p,segments:keep,closed:keep.length===p.segments.length?p.closed:false});
        for(const ts of moved){selIdx.push([outPaths.length,0]);outPaths.push({...p,segments:[ts],closed:DraftGeometry.closed(ts)});}
      });
      this.replace(e,outPaths,label,selIdx);
    },
    rotateSelection(e){
      try{
        if(e.busy||!e.selected.size)return;
        const deg=this.number('transformAngle');
        if(!Number.isFinite(deg)||Math.abs(deg%360)<1e-9)throw Error('0°以外の回転角を指定してください。');
        const items=this.selected(e),center=this.selectionCenter(items);
        const rad=-deg*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
        this.applyTransform(e,`選択を${deg}°回転`,pt=>rotatePoint(pt,center,cos,sin),{
          arc:a=>{a.start_deg=DraftGeometry.mod(a.start_deg-deg);},
          ellipse:el=>{el.rotation+=rad;}
        });
      }catch(error){$('status').textContent=error.message;}
    },
    mirrorSelection(e,axis){
      try{
        if(e.busy||!e.selected.size)return;
        const items=this.selected(e),center=this.selectionCenter(items);
        if(axis==='h'){
          this.applyTransform(e,'選択を左右反転',pt=>[2*center[0]-pt[0],pt[1]],{
            arc:a=>{a.start_deg=DraftGeometry.mod(180-a.start_deg);a.extent_deg=-a.extent_deg;},
            ellipse:el=>{el.rotation=Math.PI-el.rotation;}
          });
        }else{
          this.applyTransform(e,'選択を上下反転',pt=>[pt[0],2*center[1]-pt[1]],{
            arc:a=>{a.start_deg=DraftGeometry.mod(-a.start_deg);a.extent_deg=-a.extent_deg;},
            ellipse:el=>{el.rotation=-el.rotation;}
          });
        }
      }catch(error){$('status').textContent=error.message;}
    },
    fillet(e){
      try{
        if(e.busy)return;
        const items=this.selected(e);
        if(items.length!==2||!items.every(x=>x.s.type==='line'))throw Error('フィレットする直線を2本選択してください。');
        const mm=this.scale(e),r=this.number('filletRadius')/mm;
        if(!Number.isFinite(r)||r<=1e-6||r>1e7)throw Error('R丸め半径は正の数値で指定してください。');
        const [a,b]=items.map(x=>x.s);
        const ua=[a.p1[0]-a.p0[0],a.p1[1]-a.p0[1]],ub=[b.p1[0]-b.p0[0],b.p1[1]-b.p0[1]];
        const la=Math.hypot(...ua),lb=Math.hypot(...ub);
        if(la<1e-6||lb<1e-6)throw Error('長さのある直線を選択してください。');
        const cross=ua[0]*ub[1]-ua[1]*ub[0];
        if(Math.abs(cross)<=1e-9*la*lb)throw Error('平行な直線にはR丸めできません。');
        const w=[b.p0[0]-a.p0[0],b.p0[1]-a.p0[1]];
        const ta=(w[0]*ub[1]-w[1]*ub[0])/cross;
        const I=[a.p0[0]+ta*ua[0],a.p0[1]+ta*ua[1]];
        const chooseSide=(line)=>{
          const d0=Math.hypot(line.p0[0]-I[0],line.p0[1]-I[1]),d1=Math.hypot(line.p1[0]-I[0],line.p1[1]-I[1]);
          const keepEnd=d0>=d1?0:1,far=keepEnd===0?line.p0:line.p1,dist=Math.max(d0,d1);
          return {keepEnd,far,dist,u:[(far[0]-I[0])/dist,(far[1]-I[1])/dist]};
        };
        const sa=chooseSide(a),sb=chooseSide(b);
        const dot=Math.max(-1,Math.min(1,sa.u[0]*sb.u[0]+sa.u[1]*sb.u[1]));
        const theta=Math.acos(dot);
        if(theta<1e-4||Math.PI-theta<1e-4)throw Error('角度が浅すぎるためR丸めできません。');
        const d=r/Math.tan(theta/2);
        if(d>=sa.dist-1e-6||d>=sb.dist-1e-6)throw Error('半径が大きすぎて直線に収まりません。小さい半径を指定してください。');
        const T1=[I[0]+d*sa.u[0],I[1]+d*sa.u[1]],T2=[I[0]+d*sb.u[0],I[1]+d*sb.u[1]];
        const bx=sa.u[0]+sb.u[0],by=sa.u[1]+sb.u[1],bl=Math.hypot(bx,by);
        const centerDist=r/Math.sin(theta/2);
        const O=[I[0]+centerDist*bx/bl,I[1]+centerDist*by/bl];
        const a1=Math.atan2(T1[1]-O[1],T1[0]-O[0])*180/Math.PI;
        const a2=Math.atan2(T2[1]-O[1],T2[0]-O[0])*180/Math.PI;
        const extent=((a2-a1+540)%360)-180;
        const lineA=sa.keepEnd===0?{type:'line',p0:sa.far.slice(),p1:T1}:{type:'line',p0:T1,p1:sa.far.slice()};
        const lineB=sb.keepEnd===0?{type:'line',p0:sb.far.slice(),p1:T2}:{type:'line',p0:T2,p1:sb.far.slice()};
        const arcSeg={type:'arc',center:O,radius:r,start_deg:a1,extent_deg:extent};
        const styleA=items[0].path.line_style||'solid',styleB=items[1].path.line_style||'solid';
        const arcStyle=styleA===styleB?styleA:document.getElementById('lineStyle').value;
        const selectedKeys=new Set(e.selected);
        const outPaths=[];
        e.doc.paths.forEach((p,pi)=>{
          const keep=[];
          p.segments.forEach((s,si)=>{if(!selectedKeys.has(`${pi}:${si}`))keep.push(structuredClone(s));});
          if(keep.length)outPaths.push({...p,segments:keep,closed:keep.length===p.segments.length?p.closed:false});
        });
        const idxA=outPaths.length;outPaths.push({closed:false,segments:[lineA],...(styleA==='solid'?{}:{line_style:styleA})});
        const idxB=outPaths.length;outPaths.push({closed:false,segments:[lineB],...(styleB==='solid'?{}:{line_style:styleB})});
        const idxArc=outPaths.length;outPaths.push({closed:false,segments:[arcSeg],...(arcStyle==='solid'?{}:{line_style:arcStyle})});
        this.replace(e,outPaths,'角のR丸め',[[idxA,0],[idxB,0],[idxArc,0]]);
      }catch(error){$('status').textContent=error.message;}
    },
    offsetPreviewSegments(e){
      if(!this.offsetPreviewActive||!e.doc||!e.selected.size||e.busy)return [];
      const raw=$('offsetDistance')?.value;if(!raw||!raw.trim()||!Number.isFinite(Number(raw)))return [];
      const mm=this.scale(e);if(!Number.isFinite(mm)||mm<=0)return [];
      const distance=Number(raw)/mm;if(!Number.isFinite(distance)||Math.abs(distance)<1e-9)return [];
      const out=[];
      for(const {s} of this.selected(e)){
        if(s.type==='ellipse')continue;
        if(s.type==='line'){
          const len=DraftGeometry.length(s);if(len<1e-6)continue;
          const dx=(s.p1[1]-s.p0[1])/len*distance,dy=-(s.p1[0]-s.p0[0])/len*distance;
          out.push({type:'line',p0:[s.p0[0]+dx,s.p0[1]+dy],p1:[s.p1[0]+dx,s.p1[1]+dy]});
        }else if(s.radius+distance>1e-6){
          out.push({...s,radius:s.radius+distance});
        }
      }
      return out;
    },
    offset(e){try{if(e.busy)return;const distance=this.number('offsetDistance')/this.scale(e);if(!Number.isFinite(distance)||Math.abs(distance)<1e-9)throw Error('0以外のオフセットを指定してください。');const added=this.selected(e).map(({path,s})=>{s=structuredClone(s);if(s.type==='ellipse')throw Error('楕円はオフセットの対象外です。');if(s.type==='line'){const len=DraftGeometry.length(s);if(len<1e-6)throw Error('長さ0の線はオフセットできません。');const dx=(s.p1[1]-s.p0[1])/len*distance,dy=-(s.p1[0]-s.p0[0])/len*distance;s.p0=[s.p0[0]+dx,s.p0[1]+dy];s.p1=[s.p1[0]+dx,s.p1[1]+dy];}else{s.radius+=distance;if(s.radius<=1e-6)throw Error('オフセット後の半径が0以下です。');}return {...path,segments:[s],closed:DraftGeometry.closed(s)};});e.send({kind:'edit',action:'add',paths:added,label:'オフセット複写',selectAdded:true});}catch(error){$('status').textContent=error.message;}},
    trimCandidate(source,target,endpoint){
      if(source.type==='ellipse'||target.type==='ellipse'&&source.type!=='line')throw Error('楕円を相手にした切り詰めは直線のみ対応しています。');
      if(DraftGeometry.closed(source))throw Error('円は区間削除を使用してください。');
      const length=DraftGeometry.length(source),hits=DraftGeometry.intersections(source,target).map(p=>({point:p,t:DraftGeometry.nearest(source,p).t})).filter(x=>x.t>1e-8&&x.t<1-1e-8).sort((a,b)=>endpoint===0?a.t-b.t:b.t-a.t);
      if(!hits.length||length<1e-6)throw Error('相手の有限の線と途中で交わりません。');
      const {point,t}=hits[0],segment=structuredClone(source);if(source.type==='line')segment['p'+endpoint]=point;else{if(endpoint===0)segment.start_deg+=t*source.extent_deg;segment.extent_deg*=endpoint===0?1-t:t;}return {point,segment};
    },
    nearest(e,p,exclude){
      const tol=10/e.view.scale;
      const index=DraftGeometry.spatialIndex(e.doc);
      const candidates=index?index.queryBox([p[0]-tol,p[1]-tol,p[0]+tol,p[1]+tol]):null;
      let best=null,d=tol;
      const visit=(path,pi,s,si)=>{
        if(!e.visible(path))return;
        if(exclude&&pi===exclude[0]&&si===exclude[1])return;
        const dist=e.distance(s,p);if(dist<d){d=dist;best={ref:[pi,si],s};}
      };
      if(candidates){for(const it of candidates)visit(it.path,it.pi,it.s,it.si);}
      else e.doc.paths.forEach((path,pi)=>path.segments.forEach((s,si)=>visit(path,pi,s,si)));
      return best;
    },
    hoverTrim(e,p){if(!e.trimDraft)return;const target=this.nearest(e,p,e.trimDraft.ref);e.trimDraft.preview=null;if(target)try{e.trimDraft.preview=this.trimCandidate(e.trimDraft.s,target.s,e.trimDraft.endpoint);}catch(_){}},
    pickTrim(e,p){
      if(!e.trimDraft){
        const item=this.nearest(e,p);if(!item)return;
        const ends=[0,1].map(t=>DraftGeometry.point(item.s,t)),dist=ends.map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]));
        if(Math.min(...dist)>12/e.view.scale||DraftGeometry.closed(item.s)){$('trimToHint').textContent='直線・円弧の端点付近を指定してください。';return;}
        e.trimDraft={...item,endpoint:dist[0]<=dist[1]?0:1};e.update();e.draw();return;
      }
      try{
        const d=e.trimDraft,target=this.nearest(e,p,d.ref);if(!target)throw Error('相手の線を指定してください。');
        const candidate=this.trimCandidate(d.s,target.s,d.endpoint),paths=structuredClone(e.doc.paths),path=paths[d.ref[0]];
        let selectAfter;
        if(path.segments.length===1){
          path.segments[d.ref[1]]=candidate.segment;path.closed=false;
          selectAfter=[[d.ref[0],d.ref[1]]];
        }else{
          path.segments.splice(d.ref[1],1);path.closed=false;
          selectAfter=[[paths.length,0]];
          paths.push({...path,segments:[candidate.segment],closed:false});
        }
        e.trimDraft=null;this.replace(e,paths,'相手まで切り詰め',selectAfter);
      }catch(error){$('trimToHint').textContent=error.message;}
    },
    draw(e,c){
      // Offset direction preview.
      const offsets=this.offsetPreviewSegments(e);
      if(offsets.length){
        c.save();c.strokeStyle='#0f7a3e';c.lineWidth=2/e.view.scale;c.setLineDash([5/e.view.scale,3/e.view.scale]);
        for(const s of offsets){c.beginPath();DraftGeometry.trace(c,s);c.stroke();}
        c.setLineDash([]);c.restore();
      }
      const d=e.trimDraft;if(!d)return;
      const source=d.s,a=DraftGeometry.point(source,d.endpoint);
      // Always highlight picked endpoint after click 1.
      c.save();
      c.strokeStyle='#006d77';c.lineWidth=2/e.view.scale;c.beginPath();c.arc(...a,5/e.view.scale,0,Math.PI*2);c.stroke();
      const preview=d.preview;
      if(preview){
        const b=preview.point;
        c.strokeStyle='#d43131';c.lineWidth=3/e.view.scale;c.setLineDash([5/e.view.scale,3/e.view.scale]);c.beginPath();
        if(source.type==='line'){c.moveTo(...a);c.lineTo(...b);}
        else{const sa=source.start_deg,extent=source.extent_deg,t=DraftGeometry.nearest(source,b).t;c.arc(...source.center,source.radius,(sa+(d.endpoint===0?0:t*extent))*Math.PI/180,(sa+(d.endpoint===0?t*extent:extent))*Math.PI/180,extent<0);}
        c.stroke();c.setLineDash([]);
        DraftGeometry.drawSnapMarker(c,b,'交点吸着',e.view.scale);
      }
      c.restore();
    }
  };
  window.DraftCommandLabel=request=>request.label||labels[request.action||request.kind]||'編集';
})();
