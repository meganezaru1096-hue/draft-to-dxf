// Local vector exporters. Each segment is independent: removed gaps are never reconnected.
window.DraftExport = (() => {
  const n = v => {if(!Number.isFinite(v))throw Error('不正な座標です。');const text=v.toFixed(8).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');return text==='-0'?'0':text;};
  function check(doc,dpi) {if(!doc || !Number.isFinite(dpi)||dpi<1||dpi>9600)throw Error('解像度は1〜9600dpiで指定してください。');}
  function dxf(doc,dpi,mmPerPixel=null) {
    check(doc,dpi); const scale=mmPerPixel??25.4/dpi;
    if(!Number.isFinite(scale)||scale<1e-6||scale>1e6)throw Error('DXFの縮尺が不正です。');
    const w=doc.width*scale,h=doc.height*scale,lines=[];
    const tag=(k,v)=>lines.push(String(k),String(v));
    tag(0,'SECTION');tag(2,'HEADER');tag(9,'$ACADVER');tag(1,'AC1009');
    tag(9,'$INSUNITS');tag(70,4);tag(9,'$MEASUREMENT');tag(70,1);
    for(const key of ['$EXTMIN','$LIMMIN']){tag(9,key);tag(10,0);tag(20,0);if(key==='$EXTMIN')tag(30,0);}
    for(const key of ['$EXTMAX','$LIMMAX']){tag(9,key);tag(10,n(w));tag(20,n(h));if(key==='$EXTMAX')tag(30,0);}
    tag(0,'ENDSEC');tag(0,'SECTION');tag(2,'TABLES');
    tag(0,'TABLE');tag(2,'LTYPE');tag(70,1);tag(0,'LTYPE');tag(2,'CONTINUOUS');tag(70,0);tag(3,'Solid line');tag(72,65);tag(73,0);tag(40,0);tag(0,'ENDTAB');
    tag(0,'TABLE');tag(2,'LAYER');tag(70,2);
    for(const [name,color] of [['0',7],['GEOMETRY',7]]){tag(0,'LAYER');tag(2,name);tag(70,0);tag(62,color);tag(6,'CONTINUOUS');}
    tag(0,'ENDTAB');tag(0,'ENDSEC');tag(0,'SECTION');tag(2,'ENTITIES');
    const point=(p,base)=>{tag(base,n(p[0]*scale));tag(base+10,n(h-p[1]*scale));tag(base+20,0);};
    for(const p of doc.paths){
      for(const s of p.segments){
        const circle=s.type==='arc' && Math.abs(s.extent_deg)>=359.999999;
        tag(0,s.type==='line'?'LINE':circle?'CIRCLE':'ARC');tag(8,'GEOMETRY');
        if(s.type==='line'){point(s.p0,10);point(s.p1,11);}
        else {point(s.center,10);tag(40,n(s.radius*scale));
          if(!circle){let a=-s.start_deg,b=-(s.start_deg+s.extent_deg);if(s.extent_deg>0)[a,b]=[b,a];tag(50,n((a%360+360)%360));tag(51,n((b%360+360)%360));}}
      }
    }
    tag(0,'ENDSEC');tag(0,'EOF');return new Blob([lines.join('\r\n')+'\r\n'],{type:'application/dxf'});
  }
  function pdf(doc,dpi) {
    check(doc,dpi);const scale=72/dpi,w=doc.width*scale,h=doc.height*scale;
    const xy=p=>`${n(p[0]*scale)} ${n(h-p[1]*scale)}`;
    const stream=['0.4 w','1 J','1 j','0 0 0 RG'];
    for(const p of doc.paths){
      for(const s of p.segments){
        if(s.type==='line'){stream.push(`${xy(s.p0)} m ${xy(s.p1)} l S`);continue;}
        // Cubic Bezier segments of at most 45 degrees keep circular arcs smooth.
        const count=Math.ceil(Math.abs(s.extent_deg)/45), delta=s.extent_deg*Math.PI/180/count;
        let a=s.start_deg*Math.PI/180;
        const pt=t=>[s.center[0]+s.radius*Math.cos(t),s.center[1]+s.radius*Math.sin(t)];
        stream.push(`${xy(pt(a))} m`);
        for(let i=0;i<count;i++){
          const b=a+delta,k=4/3*Math.tan(delta/4),u=pt(a),v=pt(b);
          const c1=[u[0]-k*s.radius*Math.sin(a),u[1]+k*s.radius*Math.cos(a)];
          const c2=[v[0]+k*s.radius*Math.sin(b),v[1]-k*s.radius*Math.cos(b)];
          stream.push(`${xy(c1)} ${xy(c2)} ${xy(v)} c`);a=b;
        }stream.push('S');
      }
    }
    const content=stream.join('\n')+'\n';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Resources << >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}endstream`];
    let file='%PDF-1.4\n',offsets=[0];
    objects.forEach((o,i)=>{offsets.push(file.length);file+=`${i+1} 0 obj\n${o}\nendobj\n`;});
    const start=file.length;
    file+=`xref\n0 5\n0000000000 65535 f \n`;
    for(const offset of offsets.slice(1))file+=`${String(offset).padStart(10,'0')} 00000 n \n`;
    file+=`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return new Blob([file],{type:'application/pdf'});
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  return {dxf,pdf,download};
})();
