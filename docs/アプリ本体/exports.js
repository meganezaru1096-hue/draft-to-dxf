// Local vector exporters. Each segment is independent: removed gaps are never reconnected.
window.DraftExport = (() => {
  const n = v => {if(!Number.isFinite(v))throw Error('不正な座標です。');const text=v.toFixed(8).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');return text==='-0'?'0':text;};
  const normDeg = deg => {const text=n((deg%360+360)%360);return text==='360'?'0':text;};
  function check(doc,dpi) {if(!doc || !Number.isFinite(dpi)||dpi<1||dpi>9600)throw Error('解像度は1〜9600dpiで指定してください。');}
  function ellipse(s) {
    const [x,y]=s.center,c=Math.cos(s.rotation),q=Math.sin(s.rotation);
    const ux=s.rx*c,uy=s.rx*q,vx=-s.ry*q,vy=s.ry*c;
    return {
      at(t){const ct=Math.cos(t),st=Math.sin(t);return [x+ux*ct+vx*st,y+uy*ct+vy*st];},
      tangent(t){const ct=Math.cos(t),st=Math.sin(t);return [vx*ct-ux*st,vy*ct-uy*st];}
    };
  }
  function dxf(doc,dpi,mmPerPixel=null) {
    check(doc,dpi); const scale=mmPerPixel??25.4/dpi;
    if(!Number.isFinite(scale)||scale<1e-6||scale>1e6)throw Error('DXFの縮尺が不正です。');
    const w=doc.width*scale,h=doc.height*scale;
    const entityLines=[];
    const texts=window.DraftTexts?DraftTexts.validate(doc.texts):[];
    const etag=(k,v)=>entityLines.push(String(k),String(v));
    let minX=0,minY=0,maxX=w,maxY=h;
    const track=(mx,my)=>{if(mx<minX)minX=mx;if(mx>maxX)maxX=mx;if(my<minY)minY=my;if(my>maxY)maxY=my;};
    const point=(p,base)=>{const mx=p[0]*scale,my=h-p[1]*scale;track(mx,my);etag(base,n(mx));etag(base+10,n(my));etag(base+20,0);};
    for(const p of doc.paths){
      const style=DraftLineStyle.get(p),attributes=()=>{etag(6,style.name);etag(62,style.aci);};
      for(const s of p.segments){
        if(s.type==='ellipse'){
          // R12 has no ELLIPSE entity. Use a single closed 2D POLYLINE.
          // The circle of radius max(rx,ry) bounds chord error after the affine ellipse transform.
          const curve=ellipse(s),radius=Math.max(s.rx,s.ry)*scale;
          if(radius<1e-6)continue;
          const needed=Math.PI/(2*Math.asin(Math.sqrt(Math.min(1,0.02/(2*radius)))));
          const count=Math.min(2048,Math.max(24,4*Math.ceil(needed/4)));
          etag(0,'POLYLINE');etag(8,'GEOMETRY');attributes();etag(66,1);etag(10,0);etag(20,0);etag(30,0);etag(70,129);
          for(let i=0;i<count;i++){etag(0,'VERTEX');etag(8,'GEOMETRY');point(curve.at(i*2*Math.PI/count),10);}
          etag(0,'SEQEND');etag(8,'GEOMETRY');
          continue;
        }
        if(s.type==='line'){
          const x0=s.p0[0]*scale,y0=h-s.p0[1]*scale,x1=s.p1[0]*scale,y1=h-s.p1[1]*scale;
          if(Math.hypot(x1-x0,y1-y0)<1e-6)continue;
          const sx0=n(x0),sy0=n(y0),sx1=n(x1),sy1=n(y1);
          if(sx0===sx1&&sy0===sy1)continue;
          etag(0,'LINE');etag(8,'GEOMETRY');attributes();
          track(x0,y0);track(x1,y1);
          etag(10,sx0);etag(20,sy0);etag(30,0);etag(11,sx1);etag(21,sy1);etag(31,0);
          continue;
        }
        const radiusMm=s.radius*scale;
        if(radiusMm<1e-6||Math.abs(s.extent_deg)<1e-6)continue;
        const circle=Math.abs(s.extent_deg)>=359.999999;
        let aStr=null,bStr=null;
        if(!circle){
          let a=-s.start_deg,b=-(s.start_deg+s.extent_deg);
          if(s.extent_deg>0)[a,b]=[b,a];
          aStr=normDeg(a);bStr=normDeg(b);
          if(aStr===bStr)continue;
        }
        etag(0,circle?'CIRCLE':'ARC');etag(8,'GEOMETRY');attributes();
        const cx=s.center[0]*scale,cy=h-s.center[1]*scale;
        track(cx-radiusMm,cy-radiusMm);track(cx+radiusMm,cy+radiusMm);
        etag(10,n(cx));etag(20,n(cy));etag(30,0);etag(40,n(radiusMm));
        if(!circle){etag(50,aStr);etag(51,bStr);}
      }
    }
    for(const text of texts){
      const value=text.text.replace(/[\r\n\t]/g,' ');
      etag(0,'TEXT');etag(8,'TEXT');etag(7,'JP');point([text.x,text.y],10);
      etag(40,n(text.height*scale));etag(1,value);etag(50,normDeg(-text.angle));
      const units=[...value].reduce((sum,c)=>sum+(/^[\x00-\x7f]$/.test(c)?.55:1),0);
      etag(41,n(Math.max(.1,Math.min(10,text.width/Math.max(1,units*text.height)))));
      for(const p of DraftTexts.corners(text))track(p[0]*scale,h-p[1]*scale);
    }
    const maxSpan=Math.max(maxX-minX,maxY-minY,w,h);
    const ltscale=maxSpan>1000?Math.max(1,Math.round(maxSpan/420)):1;
    const lines=[],tag=(k,v)=>lines.push(String(k),String(v));
    tag(0,'SECTION');tag(2,'HEADER');tag(9,'$ACADVER');tag(1,'AC1009');
    if(texts.length){tag(9,'$DWGCODEPAGE');tag(3,'ANSI_932');}
    tag(9,'$INSUNITS');tag(70,4);tag(9,'$MEASUREMENT');tag(70,1);
    tag(9,'$LTSCALE');tag(40,n(ltscale));
    tag(9,'$EXTMIN');tag(10,n(minX));tag(20,n(minY));tag(30,0);
    tag(9,'$EXTMAX');tag(10,n(maxX));tag(20,n(maxY));tag(30,0);
    tag(9,'$LIMMIN');tag(10,0);tag(20,0);
    tag(9,'$LIMMAX');tag(10,n(w));tag(20,n(h));
    tag(0,'ENDSEC');tag(0,'SECTION');tag(2,'TABLES');
    tag(0,'TABLE');tag(2,'LTYPE');tag(70,3);
    for(const [name,parts] of [['CONTINUOUS',[]],['DASHED',[4,-2]],['DASHDOT',[8,-2,.4,-2]]]){tag(0,'LTYPE');tag(2,name);tag(70,0);tag(3,name);tag(72,65);tag(73,parts.length);tag(40,n(parts.reduce((a,b)=>a+Math.abs(b),0)));for(const value of parts)tag(49,value);}
    tag(0,'ENDTAB');
    tag(0,'TABLE');tag(2,'LAYER');tag(70,texts.length?3:2);
    for(const [name,color] of [['0',7],['GEOMETRY',7],...(texts.length?[['TEXT',5]]:[])]){tag(0,'LAYER');tag(2,name);tag(70,0);tag(62,color);tag(6,'CONTINUOUS');}
    tag(0,'ENDTAB');
    if(texts.length){tag(0,'TABLE');tag(2,'STYLE');tag(70,1);tag(0,'STYLE');tag(2,'JP');tag(70,0);tag(40,0);tag(41,1);tag(50,0);tag(71,0);tag(42,2.5);tag(3,'msgothic.ttc');tag(4,'');tag(0,'ENDTAB');}
    tag(0,'ENDSEC');tag(0,'SECTION');tag(2,'ENTITIES');
    for(let i=0;i<entityLines.length;i++)lines.push(entityLines[i]);
    tag(0,'ENDSEC');tag(0,'EOF');const content=lines.join('\r\n')+'\r\n';return new Blob([texts.length?DraftTexts.shiftJis(content):content],{type:'application/dxf'});
  }
  function pdf(doc,dpi) {
    check(doc,dpi);const scale=72/dpi,w=doc.width*scale,h=doc.height*scale;
    const xy=p=>`${n(p[0]*scale)} ${n(h-p[1]*scale)}`;
    const stream=['0.4 w','1 J','1 j','0 0 0 RG'];
    let lastColor=null,lastDash=null;
    for(const p of doc.paths){
      const style=DraftLineStyle.get(p),color=style.color.slice(1).match(/../g).map(v=>n(parseInt(v,16)/255)).join(' ')+' RG';
      const dash=`[${style.pattern.map(v=>n(v*72/25.4)).join(' ')}] 0 d`;
      if(color!==lastColor){stream.push(color);lastColor=color;}
      if(dash!==lastDash){stream.push(dash);lastDash=dash;}
      for(const s of p.segments){
        if(s.type==='line'){stream.push(`${xy(s.p0)} m ${xy(s.p1)} l S`);continue;}
        if(s.type==='ellipse'){
          const curve=ellipse(s),delta=Math.PI/4,k=4/3*Math.tan(delta/4);
          stream.push(`${xy(curve.at(0))} m`);
          for(let i=0;i<8;i++){
            const a=i*delta,b=(i+1)*delta,u=curve.at(a),v=curve.at(b),du=curve.tangent(a),dv=curve.tangent(b);
            const c1=[u[0]+k*du[0],u[1]+k*du[1]],c2=[v[0]-k*dv[0],v[1]-k*dv[1]];
            stream.push(`${xy(c1)} ${xy(c2)} ${xy(v)} c`);
          }
          stream.push('h S');continue;
        }
        // Cubic Bezier segments of at most 45 degrees keep circular arcs smooth.
        const count=Math.ceil(Math.abs(s.extent_deg)/45), delta=s.extent_deg*Math.PI/180/count;
        const fullCircle=Math.abs(s.extent_deg)>=359.999999;
        let a=s.start_deg*Math.PI/180;
        const pt=t=>[s.center[0]+s.radius*Math.cos(t),s.center[1]+s.radius*Math.sin(t)];
        stream.push(`${xy(pt(a))} m`);
        for(let i=0;i<count;i++){
          const b=a+delta,k=4/3*Math.tan(delta/4),u=pt(a),v=pt(b);
          const c1=[u[0]-k*s.radius*Math.sin(a),u[1]+k*s.radius*Math.cos(a)];
          const c2=[v[0]+k*s.radius*Math.sin(b),v[1]-k*s.radius*Math.cos(b)];
          stream.push(`${xy(c1)} ${xy(c2)} ${xy(v)} c`);a=b;
        }
        stream.push(fullCircle?'h S':'S');
      }
    }
    const texts=window.DraftTexts?DraftTexts.validate(doc.texts):[];
    const font=window.DraftPdfTextFont;
    for(const t of texts){
      const angle=-t.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),units=[...t.text].reduce((sum,ch)=>sum+(font?.widths[ch.codePointAt(0)]??1000)/1000,0),stretch=t.width/Math.max(1,units*t.height);
      const hex=[...t.text.replace(/[\r\n\t]/g,' ')].map(ch=>{let h='';for(let i=0;i<ch.length;i++)h+=ch.charCodeAt(i).toString(16).padStart(4,'0');return h;}).join('');
      stream.push(`0 0 0 rg BT /FJ ${n(t.height*scale)} Tf ${n(c*stretch)} ${n(s*stretch)} ${n(-s)} ${n(c)} ${xy([t.x,t.y])} Tm <${hex}> Tj ET`);
    }
    const content=stream.join('\n')+'\n';
    const encoder=typeof TextEncoder!=='undefined'?new TextEncoder():null;
    const byteLen=str=>encoder?encoder.encode(str).length:str.length;
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Resources << ${texts.length?'/Font << /FJ 5 0 R >>':''} >> /Contents 4 0 R >>`,
      `<< /Length ${byteLen(content)} >>\nstream\n${content}endstream`];
    if(texts.length){
      if(!font)throw Error('PDF文字フォントが見つかりません。');
      const used=[...new Set(texts.flatMap(t=>[...t.text].map(ch=>ch.codePointAt(0))))].filter(code=>code<=65535).sort((a,b)=>a-b);
      const widths=used.map(code=>`${code} [${font.widths[code]??1000}]`).join(' ');
      const toUnicode='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /DraftUnicode def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange 1 beginbfrange <0000> <ffff> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
      const binaryStream=(hex,extra='')=>`<< /Length ${hex.length+1} /Filter [/ASCIIHexDecode /FlateDecode] ${extra} >>\nstream\n${hex}>\nendstream`;
      objects.push('<< /Type /Font /Subtype /Type0 /BaseFont /DraftDrawingJapanese /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 10 0 R >>',
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DraftDrawingJapanese /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /CIDToGIDMap 9 0 R /DW 1000 /W [${widths}] >>`,
        `<< /Type /FontDescriptor /FontName /DraftDrawingJapanese /Flags 4 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight 733 /StemV 80 /FontFile2 8 0 R >>`,
        binaryStream(font.fontHex,`/Length1 ${font.fontLength}`),binaryStream(font.gidHex),
        `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`);
    }
    let file='%PDF-1.4\n',offsets=[0],cursor=byteLen(file);
    objects.forEach((o,i)=>{offsets.push(cursor);const chunk=`${i+1} 0 obj\n${o}\nendobj\n`;file+=chunk;cursor+=byteLen(chunk);});
    const start=cursor;
    file+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(const offset of offsets.slice(1))file+=`${String(offset).padStart(10,'0')} 00000 n \n`;
    file+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return new Blob([file],{type:'application/pdf'});
  }
  let pdfFontPromise=null;
  function ensurePdfFont(){
    if(window.DraftPdfTextFont)return Promise.resolve(window.DraftPdfTextFont);
    if(pdfFontPromise)return pdfFontPromise;
    const src=window.draftPdfTextFontSrc||document.querySelector('meta[name="draft-pdf-text-font"]')?.content||'pdf-text-font.js';
    pdfFontPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.onload=()=>window.DraftPdfTextFont?resolve(window.DraftPdfTextFont):reject(Error('PDF文字フォントが見つかりません。'));
      s.onerror=()=>reject(Error('PDF文字フォントの読み込みに失敗しました。'));
      document.head.appendChild(s);
    }).catch(error=>{pdfFontPromise=null;throw error;});
    return pdfFontPromise;
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  return {dxf,pdf,ensurePdfFont,download};
})();
