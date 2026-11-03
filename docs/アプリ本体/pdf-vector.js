// PDF.js 5.x drawing commands -> image-coordinate paths. No raster tracing here.
window.DraftPdfVector={
  multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];},
  extract(list,OPS,viewport,pageSize=null){
    let matrix=viewport.slice(),clipBox=pageSize?[0,0,...pageSize]:null,fillLight=false,pendingClip=false,stack=[],paths=[],nativeOps=[],unsafeOverpaint=false,curves=0,images=0,text=0,fills=0,clipped=false,unsupported=false,dashes=0,total=0;
    const strokes=new Set(['stroke','closeStroke','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke'].map(k=>OPS[k]));
    const inside=p=>!clipBox||p[0]>=clipBox[0]-1e-7&&p[1]>=clipBox[1]-1e-7&&p[0]<=clipBox[2]+1e-7&&p[1]<=clipBox[3]+1e-7;
    const clipLine=s=>{
      if(!clipBox)return s;if(clipBox[0]>clipBox[2]||clipBox[1]>clipBox[3])return null;let lo=0,hi=1;const a=s.p0,d=s.p1.map((v,i)=>v-a[i]);
      for(let k=0;k<2;k++){if(Math.abs(d[k])<1e-12){if(a[k]<clipBox[k]||a[k]>clipBox[k+2])return null;}else{let x=(clipBox[k]-a[k])/d[k],y=(clipBox[k+2]-a[k])/d[k];if(x>y)[x,y]=[y,x];lo=Math.max(lo,x);hi=Math.min(hi,y);if(lo>hi)return null;}}
      if(hi-lo<1e-10)return null;return {type:'line',p0:a.map((v,k)=>v+lo*d[k]),p1:a.map((v,k)=>v+hi*d[k])};
    };
    const add=path=>{if(clipBox){path.closed=path.closed&&path.segments.every(s=>s.type!=='line'||inside(s.p0)&&inside(s.p1));path.segments=path.segments.map(s=>s.type==='line'?clipLine(s):s).filter(Boolean);}total+=path.segments.length;if(total>200000)throw Error('ベクターPDFは20万要素以下で指定してください。');if(path.segments.length)paths.push(path);};
    const point=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
    const rectangleClip=data=>{
      const points=[];let closed=false;
      for(let j=0;j<data.length;){const command=data[j++];if(command===0&&points.length===0||command===1)points.push(point(data[j++],data[j++]));else if(command===4)closed=true;else return false;}
      if(points.length===5&&Math.hypot(points[0][0]-points[4][0],points[0][1]-points[4][1])<1e-7){points.pop();closed=true;}
      if(!closed||points.length!==4||!points.every((p,i)=>Math.abs(p[0]-points[(i+1)%4][0])<1e-7||Math.abs(p[1]-points[(i+1)%4][1])<1e-7))return false;
      const box=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
      if(box[2]-box[0]<1e-7||box[3]-box[1]<1e-7)return false;
      clipBox=clipBox?[Math.max(box[0],clipBox[0]),Math.max(box[1],clipBox[1]),Math.min(box[2],clipBox[2]),Math.min(box[3],clipBox[3])]:box;return true;
    };
    const flatten=(a,b,c,d,out,depth=0)=>{const distance=p=>{const u=d.map((v,i)=>v-a[i]),len2=u[0]*u[0]+u[1]*u[1],t=len2?Math.max(0,Math.min(1,((p[0]-a[0])*u[0]+(p[1]-a[1])*u[1])/len2)):0;return Math.hypot(p[0]-a[0]-t*u[0],p[1]-a[1]-t*u[1]);};if(Math.max(distance(b),distance(c))<=.15){out.push(d);if(out.length>200000)throw Error('PDFの曲線が複雑すぎます。');return;}if(depth>=14)throw Error('PDFの曲線精度を保証できません。画像から抽出してください。');const mid=(p,q)=>p.map((v,i)=>(v+q[i])/2),ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);flatten(a,ab,abc,m,out,depth+1);flatten(m,bcd,cd,d,out,depth+1);};
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],args=list.argsArray[i]||[];
      if(pendingClip&&op===OPS.constructPath&&args[1]?.[0]){if(!rectangleClip(args[1][0]))clipped=true;if(strokes.has(args[0]))unsafeOverpaint=true;pendingClip=false;}
      if(op===OPS.save)stack.push({matrix:matrix.slice(),clipBox:clipBox?.slice(),fillLight});else if(op===OPS.restore){if(stack.length)({matrix,clipBox,fillLight}=stack.pop());}
      else if(op===OPS.transform)matrix=this.multiply(matrix,args);
      else if(op===OPS.paintFormXObjectBegin){
        stack.push({matrix:matrix.slice(),clipBox:clipBox?.slice(),fillLight});if(args[0])matrix=this.multiply(matrix,args[0]);
        if(args[1]){const b=args[1],corners=[point(b[0],b[1]),point(b[2],b[1]),point(b[2],b[3]),point(b[0],b[3])];
          if(!corners.every((p,j)=>Math.abs(p[0]-corners[(j+1)%4][0])<1e-7||Math.abs(p[1]-corners[(j+1)%4][1])<1e-7))clipped=true;
          else{const box=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];clipBox=clipBox?[Math.max(box[0],clipBox[0]),Math.max(box[1],clipBox[1]),Math.min(box[2],clipBox[2]),Math.min(box[3],clipBox[3])]:box;}
        }
      }
      else if(op===OPS.paintFormXObjectEnd){if(stack.length)({matrix,clipBox,fillLight}=stack.pop());}
      else if(op===OPS.setFillRGBColor){fillLight=typeof args[0]==='string'?/^#(?:[def][0-9a-f]){3}$/i.test(args[0]):args.slice(0,3).every(v=>v>.9);}
      else if(op===OPS.setFillGray)fillLight=args[0]>.9;
      else if(op===OPS.clip||op===OPS.eoClip)pendingClip=true;
      else if(op===OPS.beginMarkedContentProps&&args[0]==='OC')unsupported=true;
      else if(op===OPS.setGState){for(const [key,value] of args[0]||[])if(key==='SMask'&&value||['CA','ca'].includes(key)&&value<1||key==='BM'&&value!=='source-over')unsupported=true;}
      else if(op===OPS.setDash&&args[0]?.length)dashes++;
      else if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectRepeat,OPS.paintImageMaskXObjectGroup,OPS.paintInlineImageXObjectGroup,OPS.paintSolidColorImageMask,OPS.shadingFill].includes(op)){images++;if(paths.length)unsafeOverpaint=true;}
      else if([OPS.showText,OPS.showSpacedText,OPS.nextLineShowText,OPS.nextLineSetSpacingShowText].includes(op)){text++;if(fillLight&&paths.length)unsafeOverpaint=true;}
      else if(op===OPS.constructPath&&!strokes.has(args[0])){if([OPS.fill,OPS.eoFill].includes(args[0])){fills++;if(paths.length)unsafeOverpaint=true;}}
      else if(op===OPS.constructPath&&strokes.has(args[0])){
        if([OPS.stroke,OPS.closeStroke].includes(args[0]))nativeOps.push(i);else{fills++;unsafeOverpaint=true;}
        const data=args[1]?.[0];if(!data)continue;let points=[],closed=false,hasCurve=false;
        const flush=()=>{
          if(points.length<2){points=[];return;}
          if(points.length>2&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-5)closed=true;
          let segments=null;
          if(hasCurve&&points.length>=5&&points.every(inside)){try{const end=closed?points[Math.floor(points.length*2/3)]:points.at(-1),middle=points[Math.floor(points.length*(closed?1/3:.5))],arc=DraftDraw.segment('drawArc',[points[0],middle,end]);
            if(points.every(p=>Math.abs(Math.hypot(p[0]-arc.center[0],p[1]-arc.center[1])-arc.radius)<=.25)){
              const deltas=points.slice(1).map((p,j)=>{const angle=q=>Math.atan2(q[1]-arc.center[1],q[0]-arc.center[0])*180/Math.PI;let d=angle(p)-angle(points[j]);return (d+540)%360-180;});
              const sweep=deltas.reduce((a,b)=>a+b,0),direction=Math.sign(sweep);
              if(direction&&deltas.every(d=>direction*d>=-1e-7)&&Math.abs(sweep)<=360.001){arc.extent_deg=closed?direction*360:sweep;const b=DraftGeometry.bounds(arc);if(!clipBox||inside([b[0],b[1]])&&inside([b[2],b[3]]))segments=[arc];}
            }
          }catch(_){} }
          if(!segments)segments=points.slice(1).map((p,j)=>({type:'line',p0:points[j],p1:p})).filter(s=>Math.hypot(s.p1[0]-s.p0[0],s.p1[1]-s.p0[1])>1e-7);
          add({closed,segments});points=[];closed=false;hasCurve=false;
        };
        for(let j=0;j<data.length;){const cmd=data[j++];if(cmd===0){flush();points=[point(data[j++],data[j++])];}
          else if(cmd===1)points.push(point(data[j++],data[j++]));
          else if(cmd===2){const b=point(data[j++],data[j++]),c=point(data[j++],data[j++]),d=point(data[j++],data[j++]);if(!points.length)throw Error('PDF曲線の始点がありません。');flatten(points.at(-1),b,c,d,points);hasCurve=true;curves++;}
          else if(cmd===3){const b=point(data[j++],data[j++]),d=point(data[j++],data[j++]),a=points.at(-1);if(!a)throw Error('PDF曲線の始点がありません。');flatten(a,a.map((v,k)=>v+2/3*(b[k]-v)),d.map((v,k)=>v+2/3*(b[k]-v)),d,points);hasCurve=true;curves++;}
          else if(cmd===4){if(points.length){closed=true;if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])>1e-7)points.push(points[0].slice());}flush();}
          else throw Error('このPDFの描画命令は直接読込に対応していません。画像から抽出してください。');
        }
        if([OPS.closeStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(args[0])&&points.length){closed=true;points.push(points[0].slice());}flush();
      }
    }
    if(clipped||pendingClip){const error=Error('表示範囲の切り抜きを含むため、PDFの見た目どおりに画像から線を抽出します。');error.code='PDF_VECTOR_CLIPPING';throw error;}
    if(unsupported)throw Error('このPDFは透明効果・表示レイヤ等を含みます。「画像から抽出」で読み込んでください。');
    if(!paths.length)throw Error('直接利用できるベクター線がありません。「画像から抽出」を選択してください。');
    if(pageSize&&paths.some(p=>p.segments.some(s=>{const b=DraftGeometry.bounds(s);return b[0]<-.01||b[1]<-.01||b[2]>pageSize[0]+.01||b[3]>pageSize[1]+.01;})))throw Error('用紙外へ伸びる線を含むPDFです。「画像から抽出」で用紙範囲を維持してください。');
    return {paths,images,text,fills,nativeOps,unsafeOverpaint,summary:`PDFベクター線を直接読込：${total}要素 ／ 曲線 ${curves}命令（円弧判定の許容差0.25px・その他は0.15px以内の折線近似） ／ 併存：画像 ${images}命令・文字 ${text}命令・塗り図形 ${fills}命令。色・線幅・破線属性（${dashes}命令）は保持しません。`};
  }
};
