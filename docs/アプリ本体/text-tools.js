window.DraftTextTools={
  init(e){
    const style=document.createElement('style');style.textContent='#tools-text .tool-body{display:grid;gap:8px}#tools-text select,#tools-text textarea{width:100%;min-width:0;max-width:100%;box-sizing:border-box}#tools-text textarea{font:12px Meiryo,sans-serif;padding:8px;border:1px solid #c8d6d3;border-radius:6px;resize:vertical}#textRecognitionHint{overflow-wrap:anywhere}#acceptEngineeringSuggestion[hidden]{display:none}';document.head.append(style);
    this.editor=e;const make=(tag,id,text)=>{const n=document.createElement(tag);if(id)n.id=id;if(text)n.textContent=text;return n;};
    const group=make('details','tools-text');group.className='tool-group';group.open=true;group.append(make('summary',null,'文字'));
    const body=make('div');body.className='tool-body';group.append(body);
    const label=make('label',null,'文字を表示'),show=make('input','showSemanticText');show.type='checkbox';show.checked=true;show.onchange=()=>e.draw();label.prepend(show);body.append(label,make('p','textCount'));
    const list=make('select','semanticTextList');list.setAttribute('aria-label','文字を選択');list.onchange=()=>this.read(e);body.append(list);
    const content=make('textarea','semanticTextValue');content.rows=2;content.setAttribute('aria-label','文字内容');body.append(content);
    const apply=make('button','applySemanticText','文字を変更');apply.onclick=()=>{try{const index=Number(list.value),text=content.value;if(!text.trim())throw Error('文字を入力してください。');DraftHistory.begin(e,'文字を変更');e.doc.texts=DraftTexts.validate(e.doc.texts.map((t,i)=>i===index?{...t,text,source:'manual',confidence:100}:t));this.changed(e);}catch(error){DraftHistory.abort(e);document.getElementById('status').textContent=error.message;}};
    const remove=make('button','deleteSemanticText','この文字を削除');remove.onclick=()=>{if(e.busy||!e.doc)return;DraftHistory.begin(e,'文字を削除');e.doc.texts=e.doc.texts.filter((_,i)=>i!==Number(list.value));this.changed(e);};
    const ocr=make('button','recognizeSemanticText','日本語OCRを追加');ocr.onclick=()=>this.recognize(e);
    const verticalLabel=make('label',null,'縦向き・斜め文字も認識'),verticalCheck=make('input','includeVerticalOcr');verticalCheck.type='checkbox';verticalCheck.checked=true;verticalLabel.prepend(verticalCheck);
    const suggestion=make('button','acceptEngineeringSuggestion','工学用語の補正候補を反映');suggestion.onclick=()=>{if(e.busy)return;const t=e.doc?.texts?.[Number(list.value)],next=t?.source!=='pdf'&&window.DraftOcrDomain?.suggest(t.text);if(!next)return;content.value=next;apply.click();};
    body.append(apply,remove,verticalLabel,ocr,suggestion,make('p','textRecognitionHint','DXFのTEXTレイヤーに文字として保存します。スキャン図面のOCRは任意実行・元に戻す対応です。'));
    document.getElementById('tools-output').before(group);DraftLayout.register('text',group);
    const nav=document.createElement('button');nav.type='button';nav.className='nav-button';nav.dataset.toolSection='text';nav.textContent='文字';nav.onclick=()=>DraftLayout.reveal('text',true);document.querySelector('.tool-nav').append(nav);this.update(e);
  },
  changed(e){e.dirty=true;e.editSeq=(e.editSeq||0)+1;DraftHistory.commit(e);this.signature=null;e.update();e.draw();},
  read(e){const t=e.doc?.texts?.[Number(document.getElementById('semanticTextList').value)];document.getElementById('semanticTextValue').value=t?.text||'';document.getElementById('textRecognitionHint').textContent=t?(t.source==='pdf'?'PDFの文字情報':t.source==='ocr'?`日本語OCR・認識スコア ${t.confidence.toFixed(0)}`:'手修正')+' ／ DXF: TEXTレイヤー。原文：'+t.raw:'文字はTEXTレイヤーに保存します。';const button=document.getElementById('acceptEngineeringSuggestion');if(button){const next=t&&t.source!=='pdf'&&window.DraftOcrDomain?.suggest(t.text);button.hidden=!next;button.textContent=next?'補正候補：'+next:'工学用語の補正候補を反映';button.disabled=e.busy||!next;}},
  update(e){
    const list=document.getElementById('semanticTextList');if(!list)return;
    const texts=e.doc?.texts||[];
    document.getElementById('textCount').textContent=`文字 ${texts.length}要素 ／ 図形と別レイヤー`;
    if(this.signature!==texts){const previous=list.value;list.replaceChildren();texts.forEach((t,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${i+1}. ${t.text.slice(0,50)}`;list.append(o);});list.value=String(Math.min(Number(previous)||0,Math.max(0,texts.length-1)));this.signature=texts;this.read(e);}
    for(const id of ['semanticTextList','semanticTextValue','applySemanticText','deleteSemanticText'])document.getElementById(id).disabled=e.busy||!texts.length;
    document.getElementById('recognizeSemanticText').disabled=e.busy||!e.background;
    const vertical=document.getElementById('includeVerticalOcr');if(vertical)vertical.disabled=e.busy;
    const selected=texts[Number(list.value)];document.getElementById('acceptEngineeringSuggestion').disabled=e.busy||!selected;
  },
  async recognize(e){
    if(e.busy||!e.background)return;const doc=e.doc,generation=DraftJapaneseOcr.generation;let submitted=false;DraftHistory.begin(e,'日本語OCRを追加');e.setBusy(true);
    try{
      const canvas=document.createElement('canvas');canvas.width=doc.width;canvas.height=doc.height;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);DraftRotation.drawBackground(e,c);
      const includeVertical=!!document.getElementById('includeVerticalOcr')?.checked;
      let texts;try{texts=await DraftJapaneseOcr.recognize(canvas,{existing:doc.texts,includeVertical,progress:m=>{if(e.doc===doc&&generation===DraftJapaneseOcr.generation)document.getElementById('status').textContent=m;},cancelled:()=>e.doc!==doc||generation!==DraftJapaneseOcr.generation});}finally{canvas.width=canvas.height=0;}
      if(e.doc!==doc||generation!==DraftJapaneseOcr.generation)throw Error('図面または処理状態が変更されたため文字認識を中止しました。');
      if(!texts.length){DraftHistory.abort(e);document.getElementById('status').textContent='追加できる高スコアの文字はありません。';return;}
      e.pendingTexts=DraftTexts.validate([...doc.texts,...texts]);e.setBusy(false);
      e.send({kind:'edit',action:'replacePaths',paths:DraftTexts.removeOutlines(doc.paths,texts),label:'日本語OCRを追加'});
      submitted=true;
    }catch(error){if(e.doc===doc&&generation===DraftJapaneseOcr.generation){DraftHistory.abort(e);e.pendingTexts=null;document.getElementById('status').textContent=error.message;}}
    finally{if(!submitted&&e.doc===doc&&generation===DraftJapaneseOcr.generation)e.setBusy(false);}
  }
};
