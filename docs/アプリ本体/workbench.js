// Trace-oriented commands. All geometry is validated again by the Python bridge.
(() => {
  const $=id=>document.getElementById(id);
  const make=(tag,id,text)=>{const n=document.createElement(tag);if(id)n.id=id;if(text)n.textContent=text;return n;};
  const labels={delete:'削除',merge:'直線統合',mergeArcs:'円・円弧統合',align:'整列',linearize:'直線化',corner:'角作成',horizontal:'水平化',vertical:'垂直化',translate:'移動',add:'図形追加',changeArc:'円弧変更',moveEndpoint:'端点変更',extendTo:'相手まで延長',splitLine:'分割',trimLine:'区間削除',rotateCW:'右90°回転',rotateCCW:'左90°回転',region:'範囲再変換',applyPreview:'編集'};
  window.DraftHistory={
    snapshot(e){const p=e.project();return {...p,calibration:structuredClone(p.calibration),protection:structuredClone(p.protection)};},
    reset(e){e.commandUndo=[];e.commandRedo=[];e.commandPending=null;e.historyTarget=null;},
    begin(e,label){if(!e.doc||e.historyTarget||e.commandPending)return;e.commandPending={label,before:this.snapshot(e)};},
    commit(e){if(!e.commandPending)return;const entry=e.commandPending;e.commandPending=null;entry.after=this.snapshot(e);e.commandUndo.push(entry);if(e.commandUndo.length>30)e.commandUndo.shift();e.commandRedo=[];},
    abort(e){e.commandPending=null;e.historyTarget=null;},
    step(e,direction){if(e.busy||!e.doc)return;const from=direction<0?e.commandUndo:e.commandRedo,entry=from.at(-1);if(!entry)return;e.historyTarget={entry,direction,target:direction<0?entry.before:entry.after};e.send({kind:'edit',action:'historyRestore',paths:e.historyTarget.target.paths,label:(direction<0?'取り消し：':'やり直し：')+entry.label});},
    accept(e,response){
      const h=e.historyTarget;if(!h){this.commit(e);return;}
      const undo=e.commandUndo,redo=e.commandRedo,view={...e.view},p=h.target;
      $('dpi').value=p.dpi;
      e.setDocument({...p,paths:response.paths},{...p,baselinePaths:p.baselinePaths,dirty:true});
      e.commandUndo=undo;e.commandRedo=redo;e.revision=response.revision;e.view=view;
      (h.direction<0?undo:redo).pop();(h.direction<0?redo:undo).push(h.entry);
      e.historyTarget=null;e.commandPending=null;e.dirty=true;e.draw();
    },
    init(e){
      this.reset(e);
      const set=e.setDocument.bind(e),accept=e.acceptEdit.bind(e),mode=e.setMode.bind(e);
      e.setDocument=(...args)=>{this.reset(e);set(...args);};
      e.acceptEdit=response=>{if(e.historyTarget)this.accept(e,response);else{const request=e.lastRequest,count=e.doc.paths.length;accept(response);if(request?.selectAdded){e.selected=new Set(e.doc.paths.slice(count).flatMap((p,i)=>p.segments.map((s,j)=>`${count+i}:${j}`)));}else if(request?.selectAfter){e.selected=new Set(request.selectAfter.filter(([pi,si])=>!!e.doc.paths[pi]?.segments[si]).map(ref=>ref.join(':')));}this.accept(e,response);}e.update();e.draw();};
      e.setMode=value=>{e.trimDraft=null;mode(value);const key={drawLine:'draw',drawCircle:'draw',drawArc:'draw',endpoint:'endpoint',extend:'extend',trimTo:'productivity',splitLine:'cut',trimLine:'cut',measure:'measure',region:'region'}[value];if(key)DraftLayout.reveal(key);};
      const commit=DraftMeasure.commit.bind(DraftMeasure);
      DraftMeasure.commit=(editor,value)=>{this.begin(editor,'実寸設定');commit(editor,value);this.commit(editor);editor.update();};
      $('undoScale').textContent='元に戻す（共通履歴）';$('undoScale').onclick=()=>this.step(e,-1);
    }
  };
  window.DraftWorkbench={
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
      const snapText=make('span','snapDetail');snaps.append(toggle,snapText);$('activeInstruction').before(snaps);
      const group=make('details','tools-properties');group.className='tool-group';group.open=true;group.append(make('summary',null,'選択した要素'));
      const body=make('div');body.className='tool-body';group.append(body);$('tools-edit').before(group);
      body.append(make('p','propertySummary','線を1つ選ぶと寸法を確認・編集できます。'));
      const form=make('div','propertyFields');form.className='property-fields';
      for(const [id,label] of [['propertySize','長さ / 直径 mm'],['propertyAngle','角度 °']]){const l=make('label',null,label),n=make('input',id);n.type='number';n.step='any';l.append(n);form.append(l);}
      const apply=make('button','applyProperties','寸法を変更');apply.type='button';apply.onclick=()=>this.applyProperties(e);form.append(apply);body.append(form,make('p','propertyHint','直線の角度は右0°・上90°。始点を維持。円・円弧は中心を維持します。'));
      const prod=make('details','tools-productivity');prod.className='tool-group';prod.open=true;prod.append(make('summary',null,'複写・オフセット・切り詰め'));
      const pb=make('div');pb.className='tool-body';prod.append(pb);$('tools-arc').before(prod);
      for(const [id,t,v] of [['copyX','複写 横 mm','10'],['copyY','複写 縦 mm','0'],['offsetDistance','オフセット mm','1']]){const l=make('label',null,t),n=make('input',id);n.type='number';n.step='any';n.value=v;l.append(n);pb.append(l);}
      for(const [id,t,f] of [['copySelected','選択を複写',()=>this.copy(e)],['offsetSelected','平行線 / 同心円を複写',()=>this.offset(e)],['trimTo','相手まで切り詰め',()=>e.setMode('trimTo')]]){const b=make('button',id,t);b.type='button';b.onclick=f;pb.append(b);}
      pb.append(make('p',null,'複写：右・上が正。オフセット：直線は始点→終点の左側、円・円弧は外側が正。選択要素ごとに独立して複写し、角の接続は行いません。'));
      document.getElementById('mode').add(new Option('相手まで切り詰め','trimTo'));
      const trimHint=make('p','trimToHint','①短くする側の端点 → ②相手の線をクリック。');pb.append(trimHint);
      // Register new groups with the same navigation mechanism as existing commands.
      DraftLayout.register('productivity',prod);DraftLayout.register('properties',group);
      for(const b of document.querySelectorAll('.tool-nav button'))b.addEventListener('click',()=>{for(const d of document.querySelectorAll('.tool-panel > details.tool-group'))if(d.id!=='tools-'+b.dataset.toolSection&&d.id!=='tools-properties')d.open=false;},true);
      e.canvas.addEventListener('pointermove',event=>{if(!e.doc||e.busy||!e.pointerInside)return;const p=e.world(e.position(event));if(e.mode==='trimTo'){this.hoverTrim(e,p);e.draw();}if(['drawLine','drawCircle','drawArc','endpoint','measure','splitLine','trimLine'].includes(e.mode)){const enabled=$(this.snapControl(e)).checked;let kind;if(DraftDraw.active(e))kind=e.drawSnapKind;else if(e.mode==='endpoint')kind=e.endpointTarget?.kind;else if(e.mode==='measure')kind=enabled?DraftGeometry.snap(e,p).kind:'自由位置';else kind=enabled?'切断位置：端点 / 交点への吸着':'切断位置：線上の自由位置';$('snapDetail').textContent=kind||'自由位置';}});
      document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&e.trimDraft&&!e.processing){e.trimDraft=null;e.draw();e.update();}},true);
      this.update(e);
    },
    snapControl(e){return e.mode==='measure'?'measureSnap':e.mode==='endpoint'?'endpointSnap':['trimTo','splitLine','trimLine'].includes(e.mode)?'cutSnap':'drawSnap';},
    update(e){
      if(!this.editor||!$('outputSummary'))return;
      const dpi=Number($('dpi').value),mm=this.scale(e),valid=Number.isFinite(dpi)&&dpi>=1&&dpi<=9600;
      $('outputSummary').textContent=e.doc&&valid?`DXF · mm · ${(e.doc.width*mm).toFixed(2)} × ${(e.doc.height*mm).toFixed(2)}（${e.calibration?'実寸設定済み':'用紙寸法・実寸未設定'}）\nPDF · ${(e.doc.width*25.4/dpi).toFixed(2)} × ${(e.doc.height*25.4/dpi).toFixed(2)} mm · ${dpi} dpi換算`:'用紙換算DPIを1〜9600で指定してください。';
      if(e.doc&&valid){if(this.boundsCache?.paths!==e.doc.paths){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const path of e.doc.paths){for(const s of path.segments){const q=e.bounds(s);b[0]=Math.min(b[0],q[0]);b[1]=Math.min(b[1],q[1]);b[2]=Math.max(b[2],q[2]);b[3]=Math.max(b[3],q[3]);}}this.boundsCache={paths:e.doc.paths,b};}const b=this.boundsCache.b;if(b.every(Number.isFinite)){$('outputSummary').textContent+=`\n出力する線の範囲 · ${((b[2]-b[0])*mm).toFixed(2)} × ${((b[3]-b[1])*mm).toFixed(2)} mm（DXF）`;if(b[0]<0||b[1]<0||b[2]>e.doc.width||b[3]>e.doc.height)$('outputSummary').textContent+='\n注意：用紙外の線があります。DXFには残りますが、PDFでは切れます。';}}
      for(const id of ['saveProject','exportPdf','exportDxf'])$(id).disabled=!e.doc||!!e.comparing||!!e.pendingPreview||!!e.pendingMove||!!e.drag?.move?.started;
      e.undo=!!e.commandUndo?.length;e.redo=!!e.commandRedo?.length;$('undo').disabled=e.busy||!e.undo;$('redo').disabled=e.busy||!e.redo;$('undoScale').disabled=$('undo').disabled;
      const last=e.commandUndo?.at(-1),next=e.commandRedo?.at(-1);$('undo').title=last?'取り消し：'+last.label:'取り消す操作はありません';$('redo').title=next?'やり直し：'+next.label:'やり直す操作はありません';$('historySummary').textContent=last?'元に戻す：'+last.label:'';
      const id=this.snapControl(e),on=$(id).checked,applicable=['drawLine','drawCircle','drawArc','endpoint','measure','splitLine','trimLine'].includes(e.mode);$('toggleSnap').textContent=applicable?'吸着 '+(on?'ON':'OFF'):'吸着 —';$('toggleSnap').setAttribute('aria-pressed',String(applicable&&on));$('toggleSnap').disabled=e.busy||!e.doc||!applicable;
      if(this.lastSnapMode!==e.mode||this.lastSnapOn!==on){$('snapDetail').textContent=!applicable?['extend','trimTo'].includes(e.mode)?'相手の線との交点を自動計算':'作図・測定・端点編集で使用':on?'端点 / 交点'+($('snapMidpoint').checked?' / 中点':'')+($('snapCenter').checked?' / 中心':''):'自由位置';this.lastSnapMode=e.mode;this.lastSnapOn=on;}
      for(const id of ['copySelected','offsetSelected'])$(id).disabled=e.busy||!e.selected.size||!Number.isFinite(mm)||mm<=0;
      $('trimTo').disabled=e.busy||!e.doc;
      const items=e.doc?this.selected(e):[],key=items.length===1?[...e.selected][0]+':'+e.revision+':'+mm:null;
      $('propertyFields').hidden=items.length!==1;$('applyProperties').disabled=e.busy||items.length!==1;
      if(items.length===1){const {s,path}=items[0],circle=s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999;
        $('propertySize').closest('label').firstChild.textContent=s.type==='line'?'長さ mm':circle?'直径 mm':'半径 mm';$('propertyAngle').closest('label').firstChild.textContent=s.type==='line'?'角度 °':'開き角 °';
        $('propertySummary').textContent=s.type==='line'?`直線 · 長さ ${(DraftGeometry.length(s)*mm).toFixed(3)} mm`:`${circle?'円':'円弧'} · 半径 ${(s.radius*mm).toFixed(3)} mm · 直径 ${(2*s.radius*mm).toFixed(3)} mm · 開き角 ${s.extent_deg.toFixed(3)}°`;
        $('propertyHint').textContent=(e.calibration?'設定した実寸':'用紙上の寸法（実寸未設定）')+'。直線は始点固定・右0°/上90°。円と円弧は中心固定。円弧の開き角は時計回りが正。';
        if(key!==this.propertyKey){$('propertySize').value=Number(((s.type==='line'?DraftGeometry.length(s):s.radius*(circle?2:1))*mm).toPrecision(12));$('propertyAngle').value=s.type==='line'?Number((-Math.atan2(s.p1[1]-s.p0[1],s.p1[0]-s.p0[0])*180/Math.PI).toPrecision(12)):s.extent_deg;$('propertyAngle').disabled=circle;this.propertyKey=key;}
      }else{$('propertySummary').textContent=items.length?`${items.length}要素 · 合計長さ ${(items.reduce((n,x)=>n+DraftGeometry.length(x.s),0)*mm).toFixed(3)} mm`:'線を1つ選ぶと寸法を確認・編集できます。';this.propertyKey=null;}
      if(e.mode==='trimTo'){$('activeMode').textContent='切り詰め';$('instructionText').textContent=e.trimDraft?'②相手の線をクリック。赤が削除される側（Escで中止）':'①短くする側の端点をクリック → ②相手の線をクリック';}
      window.DraftSession?.update();
    },
    applyProperties(e){try{if(e.busy||e.selected.size!==1)return;const {pi,si,s}=this.selected(e)[0],mm=this.scale(e),size=this.number('propertySize')/mm,angle=this.number('propertyAngle');if(!Number.isFinite(size)||size<=1e-6||size>1e7)throw Error('寸法は正の範囲内で指定してください。');const paths=structuredClone(e.doc.paths),p=paths[pi];let segment;
      if(s.type==='line'){const a=angle*Math.PI/180;segment={...s,p1:[s.p0[0]+size*Math.cos(a),s.p0[1]-size*Math.sin(a)]};}
      else{const circle=Math.abs(s.extent_deg)>=359.999999;if(!circle&&(!angle||Math.abs(angle)>360))throw Error('開き角は0°以外、±360°以内です。');segment={...s,radius:circle?size/2:size,extent_deg:circle?s.extent_deg:angle};}
      if(p.segments.length===1){p.segments[si]=segment;p.closed=segment.type==='arc'&&Math.abs(segment.extent_deg)>=359.999999;}
      else{p.segments.splice(si,1);p.closed=false;paths.push({segments:[segment],closed:segment.type==='arc'&&Math.abs(segment.extent_deg)>=359.999999});}
      this.replace(e,paths,'選択寸法変更',[p.segments.length===1&&e.doc.paths[pi].segments.length===1?[pi,si]:[paths.length-1,0]]);
    }catch(error){$('propertyHint').textContent=error.message;}},
    copy(e){try{if(e.busy)return;const mm=this.scale(e),dx=this.number('copyX')/mm,dy=-this.number('copyY')/mm;if(!Number.isFinite(dx+dy)||Math.hypot(dx,dy)<1e-9)throw Error('0以外の複写距離を指定してください。');const added=this.selected(e).map(({path,s})=>{s=structuredClone(s);if(s.type==='line'){s.p0=[s.p0[0]+dx,s.p0[1]+dy];s.p1=[s.p1[0]+dx,s.p1[1]+dy];}else s.center=[s.center[0]+dx,s.center[1]+dy];return {...path,segments:[s],closed:s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999};});e.send({kind:'edit',action:'add',paths:added,label:'複写',selectAdded:true});}catch(error){$('status').textContent=error.message;}},
    offset(e){try{if(e.busy)return;const distance=this.number('offsetDistance')/this.scale(e);if(!Number.isFinite(distance)||Math.abs(distance)<1e-9)throw Error('0以外のオフセットを指定してください。');const added=this.selected(e).map(({path,s})=>{s=structuredClone(s);if(s.type==='line'){const len=DraftGeometry.length(s);if(len<1e-6)throw Error('長さ0の線はオフセットできません。');const dx=(s.p1[1]-s.p0[1])/len*distance,dy=-(s.p1[0]-s.p0[0])/len*distance;s.p0=[s.p0[0]+dx,s.p0[1]+dy];s.p1=[s.p1[0]+dx,s.p1[1]+dy];}else{s.radius+=distance;if(s.radius<=1e-6)throw Error('オフセット後の半径が0以下です。');}return {...path,segments:[s],closed:s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999};});e.send({kind:'edit',action:'add',paths:added,label:'オフセット複写',selectAdded:true});}catch(error){$('status').textContent=error.message;}},
    trimCandidate(source,target,endpoint){
      if(source.type==='arc'&&Math.abs(source.extent_deg)>=359.999999)throw Error('円は区間削除を使用してください。');
      const length=DraftGeometry.length(source),hits=DraftGeometry.intersections(source,target).map(p=>({point:p,t:DraftGeometry.nearest(source,p).t})).filter(x=>x.t>1e-8&&x.t<1-1e-8).sort((a,b)=>endpoint===0?a.t-b.t:b.t-a.t);
      if(!hits.length||length<1e-6)throw Error('相手の有限の線と途中で交わりません。');
      const {point,t}=hits[0],segment=structuredClone(source);if(source.type==='line')segment['p'+endpoint]=point;else{if(endpoint===0)segment.start_deg+=t*source.extent_deg;segment.extent_deg*=endpoint===0?1-t:t;}return {point,segment};
    },
    nearest(e,p,exclude){let best=null,d=10/e.view.scale;e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{if(exclude&&pi===exclude[0]&&si===exclude[1])return;const dist=e.distance(s,p);if(dist<d){d=dist;best={ref:[pi,si],s};}});});return best;},
    hoverTrim(e,p){if(!e.trimDraft)return;const target=this.nearest(e,p,e.trimDraft.ref);e.trimDraft.preview=null;if(target)try{e.trimDraft.preview=this.trimCandidate(e.trimDraft.s,target.s,e.trimDraft.endpoint);}catch(_){}},
    pickTrim(e,p){if(!e.trimDraft){const item=this.nearest(e,p);if(!item)return;const ends=[0,1].map(t=>DraftGeometry.point(item.s,t)),dist=ends.map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]));if(Math.min(...dist)>12/e.view.scale||item.s.type==='arc'&&Math.abs(item.s.extent_deg)>=359.999999){$('trimToHint').textContent='直線・円弧の端点付近を指定してください。';return;}e.trimDraft={...item,endpoint:dist[0]<=dist[1]?0:1};e.update();return;}
      try{const d=e.trimDraft,target=this.nearest(e,p,d.ref);if(!target)throw Error('相手の線を指定してください。');const candidate=this.trimCandidate(d.s,target.s,d.endpoint),paths=structuredClone(e.doc.paths);paths[d.ref[0]].segments[d.ref[1]]=candidate.segment;paths[d.ref[0]].closed=false;e.trimDraft=null;this.replace(e,paths,'相手まで切り詰め');}catch(error){$('trimToHint').textContent=error.message;}
    },
    draw(e,c){const d=e.trimDraft,preview=d?.preview;if(!preview)return;const source=d.s,a=DraftGeometry.point(source,d.endpoint),b=preview.point;c.strokeStyle='#d43131';c.lineWidth=3/e.view.scale;c.setLineDash([5/e.view.scale,3/e.view.scale]);c.beginPath();if(source.type==='line'){c.moveTo(...a);c.lineTo(...b);}else{const sa=source.start_deg,extent=source.extent_deg,t=DraftGeometry.nearest(source,b).t;c.arc(...source.center,source.radius,(sa+(d.endpoint===0?0:t*extent))*Math.PI/180,(sa+(d.endpoint===0?t*extent:extent))*Math.PI/180,extent<0);}c.stroke();c.setLineDash([]);c.strokeStyle='#148443';c.beginPath();c.arc(...b,5/e.view.scale,0,Math.PI*2);c.stroke();}
  };
  window.DraftCommandLabel=request=>request.label||labels[request.action||request.kind]||'編集';
})();
