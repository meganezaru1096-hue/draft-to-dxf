// Semantic text is independent of geometry and always exports to the TEXT layer.
window.DraftTexts={
  validate(items=[]){
    if(!Array.isArray(items)||items.length>20000)throw Error('文字データは2万要素以下で指定してください。');
    if(items.reduce((n,t)=>n+(typeof t?.text==='string'?t.text.length:0),0)>500000)throw Error('文字列の合計は50万文字以下にしてください。');
    return items.map((t,i)=>{
      if(!t||typeof t.text!=='string'||!t.text.trim()||t.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(t.text))throw Error('文字列が不正です。');
      for(const key of ['x','y','height','width','angle'])if(!Number.isFinite(t[key])||Math.abs(t[key])>1e7)throw Error('文字の位置・大きさが不正です。');
      if(t.height<=0||t.width<=0||!['pdf','ocr','manual'].includes(t.source))throw Error('文字の属性が不正です。');
      return {id:typeof t.id==='string'?t.id.slice(0,100):'text-'+i,text:t.text,x:t.x,y:t.y,height:t.height,width:t.width,angle:t.angle,
        source:t.source,confidence:Number.isFinite(t.confidence)?Math.max(0,Math.min(100,t.confidence)):100,raw:typeof t.raw==='string'?t.raw.slice(0,2000):t.text};
    });
  },
  corners(t){const a=t.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),bottom=t.source==='pdf'?.25*t.height:0;return [[0,bottom],[t.width,bottom],[t.width,-t.height],[0,-t.height]].map(([x,y])=>[t.x+x*c-y*s,t.y+x*s+y*c]);},
  bounds(t){const p=this.corners(t);return [Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))];},
  fromPdf(content,viewport){
    const texts=[];let rejected=0;
    for(const item of content.items||[]){
      if(typeof item.str!=='string'||!item.str.trim()||!item.transform)continue;
      // Do not pretend missing CMaps/private glyph encodings are reliable Unicode.
      if(/[\ufffd\ue000-\uf8ff\x00-\x08]/.test(item.str)){rejected++;continue;}
      const a=DraftPdfVector.multiply(viewport.transform,item.transform),style=content.styles?.[item.fontName]||{};
      const height=Math.hypot(a[2],a[3]);let angle=Math.atan2(a[1],a[0])*180/Math.PI;
      if(style.vertical)angle+=90;
      const width=Math.abs((style.vertical?item.height:item.width)*viewport.scale);
      if(height<.1||width<.1||!Number.isFinite(height+width+angle+a[4]+a[5])){rejected++;continue;}
      const text={id:'pdf-'+texts.length,text:item.str,x:a[4],y:a[5],height,width,angle,source:'pdf',confidence:100,raw:item.str};
      const b=this.bounds(text);
      if(b[2]<0||b[3]<0||b[0]>viewport.width||b[1]>viewport.height)continue;
      texts.push(text);
    }
    return {texts:this.validate(texts),rejected};
  },
  safeNativePdfText(list,OPS){
    // Prefer visible OCR over exporting hidden/redacted/clipped semantic text.
    let light=false,renderMode=0,shown=false;const stack=[];
    const textOps=new Set(['showText','showSpacedText','nextLineShowText','nextLineSetSpacingShowText'].map(k=>OPS[k]));
    const fills=new Set(['fill','eoFill','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke'].map(k=>OPS[k]));
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],args=list.argsArray[i]||[];
      if(op===OPS.save)stack.push([light,renderMode]);
      else if(op===OPS.restore){const state=stack.pop();if(state)[light,renderMode]=state;}
      else if(op===OPS.setTextRenderingMode)renderMode=Number(args[0]);
      else if([OPS.setFillRGBColor,OPS.setFillGray].includes(op))light=DraftPdfVector.isLightColor(args);
      else if(op===OPS.clip||op===OPS.eoClip)return false;
      if(textOps.has(op)){if(light||renderMode===3||renderMode>=4)return false;shown=true;}
      if(shown&&(fills.has(op)||op===OPS.constructPath&&fills.has(args[0])))return false;
    }return true;
  },
  rotate(items,w,h,d){return this.validate(items).map(t=>{const [x,y]=DraftRotation.point([t.x,t.y],w,h,d);return {...t,x,y,angle:t.angle+d*90};});},
  draw(e,c){
    if(e.hideVectors||document.getElementById('showSemanticText')?.checked===false)return;
    const items=e.comparing?(e.baselineTexts||[]):(e.doc.texts||[]);c.save();
    if(e.comparing)DraftRotation.context(c,e.doc.width,e.doc.height,e.baselineTurns);
    for(const t of items){
      c.save();c.translate(t.x,t.y);c.rotate(t.angle*Math.PI/180);c.font=t.height+'px "Yu Gothic",Meiryo,sans-serif';
      c.textBaseline='alphabetic';c.fillStyle=t.source==='ocr'?'#6643a4':'#24487c';
      const measured=c.measureText(t.text).width;if(measured>0)c.scale(t.width/measured,1);c.fillText(t.text,0,0);c.restore();
    }c.restore();
  },
  // Remove only small, fully enclosed vector strokes; never remove crossing lines.
  removeOutlines(paths,texts){
    if(!texts.length)return paths;
    const boxes=texts.map(t=>({b:this.bounds(t),h:t.height}));
    return paths.map(p=>({...p,segments:p.segments.filter(s=>{
      const b=DraftGeometry.bounds(s);
      return !boxes.some(({b:q,h})=>b[0]>=q[0]-1&&b[1]>=q[1]-1&&b[2]<=q[2]+1&&b[3]<=q[3]+1&&b[2]-b[0]<=h*2.5&&b[3]-b[1]<=h*1.6);
    })})).filter(p=>p.segments.length);
  },
  shiftJis(text){
    if(!this.sjisMap){
      const decoder=new TextDecoder('shift_jis'),map=new Map();
      for(let b=0;b<256;b++){const s=decoder.decode(new Uint8Array([b]));if(s.length===1&&s!=='\ufffd')map.set(s,[b]);}
      for(let a=0x81;a<=0xfc;a++){if(a>0x9f&&a<0xe0)continue;for(let b=0x40;b<=0xfc;b++){if(b===0x7f)continue;const s=decoder.decode(new Uint8Array([a,b]));if(s.length===1&&s!=='\ufffd'&&!map.has(s))map.set(s,[a,b]);}}
      this.sjisMap=map;
    }
    const bytes=[];
    for(const char of text){const encoded=this.sjisMap.get(char);if(encoded)bytes.push(...encoded);else{for(let i=0;i<char.length;i++){const escaped='\\U+'+char.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0');for(const c of escaped)bytes.push(c.charCodeAt(0));}}}
    return new Uint8Array(bytes);
  }
};
