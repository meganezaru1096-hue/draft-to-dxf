// Read-only review candidates. No geometry is removed or changed by a scan.
window.DraftInspect={
  labels:{short:'短い線',duplicate:'完全重複',overlap:'部分重複',isolated:'孤立した短い線',gap:'端点の隙間',junction:'線の途中への接続不足'},
  init(e){
    document.getElementById('trimOverlap').textContent='重複区間を削除';
    e.inspection=null;
    document.getElementById('scanCandidates').onclick=()=>this.scan(e);
    document.getElementById('candidateList').onchange=ev=>this.focus(e,Number(ev.target.value));
    for(const [id,delta] of [['previousCandidate',-1],['nextCandidate',1]])document.getElementById(id).onclick=()=>this.focus(e,(e.inspection?.index??-1)+delta);
    for(const id of ['shortThreshold','gapThreshold','inspectGaps','inspectOverlap','overlapTolerance','inspectIsolated','isolationDistance','inspectJunctions','inspectContinuity'])document.getElementById(id).onchange=()=>{this.reset(e,'条件が変わりました。再検出してください。');this.update(e);e.draw();};
    document.getElementById('candidateFilter').onchange=()=>this.filter(e);
    document.getElementById('trimOverlap').onclick=()=>{
      const item=e.inspection?.items[e.inspection.index];if(e.busy||item?.kind!=='overlap')return;
      e.send({kind:'edit',action:'trimLine',refs:[item.ref],first:item.interval[0],second:item.interval[1]});
    };
    document.getElementById('editCandidateArc').onclick=()=>{const item=e.inspection?.items[e.inspection.index];if(e.busy||!item)return;e.setMode('select');e.selected.add(item.ref.join(':'));e.update();e.draw();DraftWorkflow.readArc(e);const button=document.getElementById('readArc');button.closest('details').open=true;button.scrollIntoView({block:'nearest'});};
    document.getElementById('moveGapEndpoint').onclick=()=>{
      const item=e.inspection?.items[e.inspection.index];if(e.busy||!['gap','junction'].includes(item?.kind)||e.doc.paths[item.ref[0]].segments[item.ref[1]].type!=='line')return;
      e.setMode('endpoint');const segment=e.doc.paths[item.ref[0]].segments[item.ref[1]];
      e.endpointDraft={ref:item.ref.slice(),endpoint:item.endpoint,segment};
      e.endpointTarget={point:item.points[0].slice(),kind:'元の端点'};e.endpointSuggestedTarget=item.points[1].slice();e.update();e.draw();
      const button=document.getElementById('cancelEndpoint');button.closest('details').open=true;button.scrollIntoView({block:'nearest'});
    };
  },
  reset(e,message='候補は未検出です。'){
    e.inspection=null;document.getElementById('candidateList').replaceChildren();document.getElementById('candidateSummary').textContent=message;document.getElementById('candidateDetail').textContent='候補は誤りと限りません。形状を確認してから編集してください。';
  },
  collect(paths,threshold,gapThreshold=0,options={}){return DraftCandidateEngine.collect(paths,{threshold,gapThreshold,...options});},
  scan(e){
    if(e.busy||!e.doc)return;
    const threshold=Number(document.getElementById('shortThreshold').value);
    if(!Number.isFinite(threshold)||threshold<=0||threshold>10000){this.reset(e,'短い線の基準は0より大きく10000px以下にしてください。');this.update(e);e.draw();return;}
    const gap=Number(document.getElementById('gapThreshold').value),gaps=document.getElementById('inspectGaps').checked,junctions=document.getElementById('inspectJunctions').checked;
    if((gaps||junctions)&&(!Number.isFinite(gap)||gap<=0.01||gap>100)){this.reset(e,'隙間の基準は0.01pxより大きく100px以下にしてください。');this.update(e);e.draw();return;}
    const overlapTolerance=Number(document.getElementById('overlapTolerance').value),isolationDistance=Number(document.getElementById('isolationDistance').value);
    if(document.getElementById('inspectOverlap').checked&&(!Number.isFinite(overlapTolerance)||overlapTolerance<0||overlapTolerance>10)){this.reset(e,'部分重複の許容ずれは0〜10pxで指定してください。');this.update(e);e.draw();return;}
    if(document.getElementById('inspectIsolated').checked&&(!Number.isFinite(isolationDistance)||isolationDistance<0||isolationDistance>100)){this.reset(e,'孤立判定の距離は0〜100pxで指定してください。');this.update(e);e.draw();return;}
    e.setMode('select');
    e.inspection=this.collect(e.doc.paths,threshold,gaps||junctions?gap:0,{overlaps:document.getElementById('inspectOverlap').checked,overlapTolerance,isolated:document.getElementById('inspectIsolated').checked,isolationDistance,junctions,endpointGaps:gaps,continuity:document.getElementById('inspectContinuity').checked});
    e.inspection.allItems=e.inspection.items;
    this.filter(e);
  },
  filter(e){
    if(e.busy||!e.inspection)return;
    e.setMode('select');
    const result=e.inspection,kind=document.getElementById('candidateFilter').value,list=document.getElementById('candidateList');
    result.items=kind==='all'?result.allItems:result.buckets[kind];result.index=-1;e.selected.clear();e.anchors.clear();list.replaceChildren();
    result.items.forEach((item,i)=>list.add(new Option(`${i+1}. ${this.labels[item.kind]} (${item.length.toFixed(2)} px)`,String(i))));list.selectedIndex=-1;
    const total=Object.keys(this.labels).reduce((n,k)=>n+result[k],0),displayedTotal=kind==='all'?total:result[kind];
    document.getElementById('candidateSummary').textContent=`短い線 ${result.short} / 完全重複 ${result.duplicate} / 部分重複 ${result.overlap} / 孤立 ${result.isolated} / 隙間 ${result.gap} / 接続不足 ${result.junction}件${displayedTotal>500?'（表示中の種類は先頭500候補まで）':''}${result.incomplete?' ※計算量の上限に達したため、一部の検索・件数は途中までです。':''}`;
    document.getElementById('candidateDetail').textContent='種類で絞って候補を選ぶと拡大します。検出だけでは図面を変更しません。';this.update(e);e.draw();
  },
  focus(e,index){
    if(e.busy||!e.inspection||index<0||index>=e.inspection.items.length)return;
    const result=e.inspection,item=result.items[index];result.index=index;e.setMode('select');
    e.selected.add(item.ref.join(':'));
    const s=e.doc.paths[item.ref[0]].segments[item.ref[1]],b=item.points?[Math.min(...item.points.map(p=>p[0])),Math.min(...item.points.map(p=>p[1])),Math.max(...item.points.map(p=>p[0])),Math.max(...item.points.map(p=>p[1]))]:e.bounds(s),r=e.canvas.getBoundingClientRect();
    e.view.scale=Math.max(.005,Math.min(8,(r.width-40)/Math.max(40,b[2]-b[0]+30),(r.height-40)/Math.max(40,b[3]-b[1]+30)));
    e.view.x=r.width/2-(b[0]+b[2])/2*e.view.scale;e.view.y=r.height/2-(b[1]+b[3])/2*e.view.scale;
    document.getElementById('candidateList').value=String(index);
    document.getElementById('candidateDetail').textContent=item.kind==='duplicate'?'端点が完全一致する直線です。重複側の1本だけを選択しています。残す線があることを確認してから削除してください。':'短い線・円弧の候補です。寸法線や細部の場合があります。孤立ノイズと断定するものではありません。';
    if(['gap','junction'].includes(item.kind))document.getElementById('candidateDetail').textContent=`${item.kind==='junction'?'線・円弧の途中まで':'端点間'} ${item.length.toFixed(3)} px。紫の点線は確認用です。${s.type==='line'?'「候補の端点を移動」で紫の目標点をクリックして確定できます。':'「候補の円弧を数値編集」で開始角・開き角等を調整できます。'}意図的な隙間の場合もあります。`;
    if(item.kind==='overlap')document.getElementById('candidateDetail').textContent=`約 ${item.length.toFixed(3)} pxの重なり候補です。「重複区間を削除」で赤い区間だけを削除します。元に戻すで取消できます。線全体を削除すると重複以外の部分も消えます。原図を確認してください。`;
    if(item.kind==='isolated')document.getElementById('candidateDetail').textContent='周囲の表示中の要素から離れた短い線・円弧です。ノイズとは限りません。点、寸法矢印、図面の細部を原図で確認してから編集してください。';
    e.update();e.draw();
  },
  update(e){
    const busy=e.busy||!e.doc,result=e.inspection;
    for(const id of ['scanCandidates','shortThreshold','gapThreshold','inspectGaps','inspectOverlap','overlapTolerance','inspectIsolated','isolationDistance','inspectJunctions','inspectContinuity'])document.getElementById(id).disabled=busy;
    const item=result?.items[result.index],segment=item?e.doc.paths[item.ref[0]].segments[item.ref[1]]:null;
    document.getElementById('moveGapEndpoint').disabled=busy||!['gap','junction'].includes(item?.kind)||segment?.type!=='line';
    document.getElementById('trimOverlap').disabled=busy||item?.kind!=='overlap';
    document.getElementById('editCandidateArc').disabled=busy||segment?.type!=='arc';
    document.getElementById('candidateFilter').disabled=busy||!result;
    document.getElementById('candidateList').disabled=busy||!result?.items.length;
    document.getElementById('previousCandidate').disabled=busy||!result||result.index<=0;
    document.getElementById('nextCandidate').disabled=busy||!result||result.index>=result.items.length-1;
  },
  draw(e,c){
    const item=e.inspection?.items[e.inspection.index];if(!['gap','junction','overlap'].includes(item?.kind)||e.mode!=='select'||!e.selected.has(item.ref.join(':')))return;
    if(item.kind==='overlap'){
      const reference=e.doc.paths[item.reference[0]].segments[item.reference[1]];DraftWorkflow.stroke(e,c,reference,'#168547',true);
      c.strokeStyle='#dc2626';c.lineWidth=4/e.view.scale;c.beginPath();c.moveTo(...item.points[0]);c.lineTo(...item.points[1]);c.stroke();return;
    }
    const scale=e.view.scale;c.strokeStyle='#b01ea3';c.lineWidth=2/scale;c.setLineDash([3/scale,3/scale]);c.beginPath();c.moveTo(...item.points[0]);c.lineTo(...item.points[1]);c.stroke();c.setLineDash([]);
    for(const p of item.points){c.beginPath();c.arc(...p,5/scale,0,Math.PI*2);c.stroke();}
  }
};
