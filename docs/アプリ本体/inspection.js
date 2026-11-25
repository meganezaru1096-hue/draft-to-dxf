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
    document.getElementById('selectCandidateBatch').onclick=()=>this.selectBatch(e);
    document.getElementById('deleteCandidateBatch').onclick=()=>this.deleteBatch(e);
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
  refreshAfterEdit(e){
    if(!e.inspection||!e.doc){this.reset(e,'図面を編集しました。候補を再検出してください。');return;}
    const prevIndex=e.inspection.index;
    const savedSelection=new Set(e.selected);
    const savedMode=e.mode;
    const threshold=Number(document.getElementById('shortThreshold').value);
    const gap=Number(document.getElementById('gapThreshold').value),gaps=document.getElementById('inspectGaps').checked,junctions=document.getElementById('inspectJunctions').checked;
    const overlapTolerance=Number(document.getElementById('overlapTolerance').value),isolationDistance=Number(document.getElementById('isolationDistance').value);
    try{
      const next=this.collect(e.doc.paths,threshold,gaps||junctions?gap:0,{overlaps:document.getElementById('inspectOverlap').checked,overlapTolerance,isolated:document.getElementById('inspectIsolated').checked,isolationDistance,junctions,endpointGaps:gaps,continuity:document.getElementById('inspectContinuity').checked});
      next.allItems=next.items;
      e.inspection=next;
      const kind=document.getElementById('candidateFilter').value,list=document.getElementById('candidateList');
      next.items=kind==='all'?next.allItems:next.buckets[kind];
      next.index=prevIndex>=0&&next.items.length?Math.min(prevIndex,next.items.length-1):-1;
      list.replaceChildren();
      next.items.forEach((item,i)=>list.add(new Option(`${i+1}. ${this.labels[item.kind]} (${item.length.toFixed(2)} px)`,String(i))));
      list.selectedIndex=next.index;
      const total=Object.keys(this.labels).reduce((n,k)=>n+next[k],0),displayedTotal=kind==='all'?total:next[kind];
      document.getElementById('candidateSummary').textContent=`短い線 ${next.short} / 完全重複 ${next.duplicate} / 部分重複 ${next.overlap} / 孤立 ${next.isolated} / 隙間 ${next.gap} / 接続不足 ${next.junction}件${displayedTotal>500?'（先頭500候補まで）':''}（編集後に自動更新）`;
      e.selected=savedSelection;e.mode=savedMode;
    }catch(_){this.reset(e,'図面を編集しました。候補を再検出してください。');}
  },
  collect(paths,threshold,gapThreshold=0,options={}){return DraftCandidateEngine.collect(paths,{threshold,gapThreshold,...options});},
  batchTargets(result,kind){
    if(!result)return new Map();
    result.batchTargets??=new Map();
    if(!result.batchTargets.has(kind)){
      const targets=new Map(),kinds=kind==='all'?['short','isolated','duplicate']:[kind];
      for(const key of kinds)for(const ref of result.deletionRefs?.[key]||[])targets.set(ref.join(':'),ref);
      result.batchTargets.set(kind,targets);
    }
    return result.batchTargets.get(kind);
  },
  selectedBatch(e){
    const batch=e.inspection?.batch;
    if(!batch||batch.paths!==e.doc?.paths||batch.kind!==document.getElementById('candidateFilter').value||!e.selected.size)return null;
    for(const key of e.selected)if(!batch.targets.has(key))return null;
    return batch;
  },
  selectBatch(e){
    if(e.busy||!e.doc||!e.inspection)return;
    const result=e.inspection,kind=document.getElementById('candidateFilter').value,targets=this.batchTargets(result,kind);
    if(!targets.size)return;
    e.setMode('select');
    result.batch={kind,targets,paths:e.doc.paths};result.index=-1;
    e.selected=new Set(targets.keys());e.anchors.clear();
    document.getElementById('candidateList').selectedIndex=-1;
    document.getElementById('candidateDetail').textContent='候補をまとめて選択しました。残したい線はCtrl＋クリックで選択から外せます。図形はまだ変更していません。';
    const shortcut=window.DraftSettings?.key('delete');
    document.getElementById('status').textContent=`気になる線を${targets.size}本選択しました。原図と確認してから「選んだ候補を一括削除」${shortcut?'、または'+shortcut+'キー':''}で削除できます。`;
    e.update();e.draw();e.canvas.focus({preventScroll:true});
  },
  deleteBatch(e){
    if(e.busy||!e.doc)return;
    const batch=this.selectedBatch(e);if(!batch)return;
    const refs=[...e.selected].map(key=>batch.targets.get(key));
    // One ordinary edit transaction: immediate application, one common Undo.
    e.send({kind:'edit',action:'delete',refs,label:'気になる線の一括削除'});
  },
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
    result.batch=null;
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
    if(['gap','junction'].includes(item.kind))document.getElementById('candidateDetail').textContent=`${item.kind==='junction'?'線・円弧の途中まで':'端点間'} ${item.length.toFixed(3)} px。青い点線は確認用です。${s.type==='line'?'「候補の端点を移動」で目標点をクリックして確定できます。':'「候補の円弧を数値編集」で開始角・開き角等を調整できます。'}意図的な隙間の場合もあります。`;
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
    const kind=document.getElementById('candidateFilter').value,targets=this.batchTargets(result,kind),batch=this.selectedBatch(e);
    document.getElementById('selectCandidateBatch').disabled=busy||!targets.size;
    document.getElementById('deleteCandidateBatch').disabled=busy||!batch;
    document.getElementById('deleteCandidateBatch').textContent=batch?`選んだ候補 ${e.selected.size}本を一括削除`:'選んだ候補を一括削除';
    const hint=document.getElementById('candidateBatchHint');
    if(!result)hint.textContent='検出後、種類で絞ってまとめて選択できます。選択しただけでは削除しません。';
    else if(!['all','short','isolated','duplicate'].includes(kind))hint.textContent='この種類は一括削除の対象外です。隙間・接続不足は補修、部分重複は「重複区間を削除」を使ってください。';
    else hint.textContent=`${kind==='all'?'短い線・孤立した短い線・完全重複の':'この種類の'}${targets.size}本が対象です。${targets.size>500?'一覧の500件制限に関係なく、検出した全対象を選びます。':''}${result.incomplete?'検索は上限に達したため、検出できた候補のみが対象です。':''}細部・小円・寸法矢印が含まれる場合があります。削除は「元に戻す」1回で取り消せます。`;
  },
  draw(e,c){
    const item=e.inspection?.items[e.inspection.index];if(!['gap','junction','overlap'].includes(item?.kind)||e.mode!=='select'||!e.selected.has(item.ref.join(':')))return;
    if(item.kind==='overlap'){
      const reference=e.doc.paths[item.reference[0]].segments[item.reference[1]];DraftWorkflow.stroke(e,c,reference,'#168547',true);
      c.strokeStyle='#dc2626';c.lineWidth=4/e.view.scale;c.beginPath();c.moveTo(...item.points[0]);c.lineTo(...item.points[1]);c.stroke();return;
    }
    const scale=e.view.scale;
    c.save();
    c.strokeStyle='rgba(255,255,255,.9)';c.lineWidth=4.5/scale;c.beginPath();c.moveTo(...item.points[0]);c.lineTo(...item.points[1]);c.stroke();
    c.strokeStyle='#0077b6';c.lineWidth=2.2/scale;c.setLineDash([4/scale,3/scale]);c.beginPath();c.moveTo(...item.points[0]);c.lineTo(...item.points[1]);c.stroke();c.setLineDash([]);
    for(const p of item.points){c.beginPath();c.arc(...p,5/scale,0,Math.PI*2);c.stroke();}
    c.restore();
  }
};
