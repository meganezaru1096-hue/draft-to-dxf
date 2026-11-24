// PDF.js 5.x drawing commands -> image-coordinate paths. No raster tracing here.
window.DraftPdfVector={
  multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];},
  isLightColor(args){
    if(!args||!args.length)return false;
    if(typeof args[0]==='string'){
      const m=args[0].match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if(m)return parseInt(m[1],16)>235&&parseInt(m[2],16)>235&&parseInt(m[3],16)>235;
      return false;
    }
    if(args.length===1)return Number(args[0])>.92;
    return args.slice(0,3).every(v=>Number(v)>.92);
  },
  classifyDash(dashArray){
    if(!Array.isArray(dashArray)||!dashArray.length)return 'solid';
    const nums=dashArray.map(Number).filter(v=>Number.isFinite(v)&&v>0);
    if(!nums.length)return 'solid';
    if(nums.length>=4){
      const onLengths=nums.filter((_,idx)=>idx%2===0);
      const maxOn=Math.max(...onLengths),minOn=Math.min(...onLengths);
      if(maxOn>=minOn*2.2)return 'dashdot';
    }
    return 'dashed';
  },
  fitCirclePoints(pts){
    const n=pts.length;if(n<5)return null;
    let mx=0,my=0;for(const p of pts){mx+=p[0];my+=p[1];}mx/=n;my/=n;
    let sxx=0,sxy=0,syy=0,sxz=0,syz=0,szz=0;
    for(const p of pts){
      const x=p[0]-mx,y=p[1]-my,z=x*x+y*y;
      sxx+=x*x;sxy+=x*y;syy+=y*y;sxz+=x*z;syz+=y*z;szz+=z;
    }
    const mz=szz/n;
    // Center z for better conditioning (Kasa/Taubin linear system).
    let a00=sxx,a01=sxy,a11=syy,b0=sxz-0,b1=syz-0;
    // Subtract mean(z) contribution: sum(x*(z-mz)) = sxz since sum(x)=0.
    const det=a00*a11-a01*a01;
    if(Math.abs(det)<1e-12)return null;
    const cx=(b0*a11-b1*a01)/(2*det),cy=(a00*b1-a01*b0)/(2*det);
    const r2=mz+cx*cx+cy*cy;
    if(!Number.isFinite(r2)||r2<=1e-8)return null;
    const radius=Math.sqrt(r2),center=[mx+cx,my+cy];
    if(!Number.isFinite(radius)||radius>1e7)return null;
    for(const p of pts){if(Math.abs(Math.hypot(p[0]-center[0],p[1]-center[1])-radius)>.25)return null;}
    const deltas=[];
    for(let j=1;j<n;j++){
      const a0=Math.atan2(pts[j-1][1]-center[1],pts[j-1][0]-center[0])*180/Math.PI;
      const a1=Math.atan2(pts[j][1]-center[1],pts[j][0]-center[0])*180/Math.PI;
      deltas.push((a1-a0+540)%360-180);
    }
    const sweep=deltas.reduce((u,v)=>u+v,0),dir=Math.sign(sweep);
    if(!dir||!deltas.every(d=>dir*d>=-1e-5)||Math.abs(sweep)>360.001)return null;
    const closed=Math.hypot(pts[0][0]-pts[n-1][0],pts[0][1]-pts[n-1][1])<1e-4&&Math.abs(sweep)>355;
    const start_deg=Math.atan2(pts[0][1]-center[1],pts[0][0]-center[0])*180/Math.PI;
    return {type:'arc',center,radius,start_deg,extent_deg:closed?dir*360:sweep};
  },
  extract(list,OPS,viewport,pageSize=null){
    let matrix=viewport.slice(),clipBox=pageSize?[0,0,...pageSize]:null,fillLight=false,strokeLight=false,lineStyle='solid',pendingClip=false,stack=[],paths=[],pathBounds=[],nativeOps=[],unsafeOverpaint=false,curves=0,images=0,text=0,fills=0,clipped=false,unsupported=false,dashes=0,total=0;
    const strokes=new Set(['stroke','closeStroke','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke'].map(k=>OPS[k]));
    const inside=p=>!clipBox||p[0]>=clipBox[0]-1e-7&&p[1]>=clipBox[1]-1e-7&&p[0]<=clipBox[2]+1e-7&&p[1]<=clipBox[3]+1e-7;
    const boxesOverlap=(a,b)=>a[0]<=b[2]+1&&b[0]<=a[2]+1&&a[1]<=b[3]+1&&b[1]<=a[3]+1;
    const overlapsExisting=box=>pathBounds.some(b=>boxesOverlap(b,box));
    const clipLine=s=>{
      if(!clipBox)return s;if(clipBox[0]>clipBox[2]||clipBox[1]>clipBox[3])return null;let lo=0,hi=1;const a=s.p0,d=s.p1.map((v,i)=>v-a[i]);
      for(let k=0;k<2;k++){if(Math.abs(d[k])<1e-12){if(a[k]<clipBox[k]||a[k]>clipBox[k+2])return null;}else{let x=(clipBox[k]-a[k])/d[k],y=(clipBox[k+2]-a[k])/d[k];if(x>y)[x,y]=[y,x];lo=Math.max(lo,x);hi=Math.min(hi,y);if(lo>hi)return null;}}
      if(hi-lo<1e-10)return null;return {type:'line',p0:a.map((v,k)=>v+lo*d[k]),p1:a.map((v,k)=>v+hi*d[k])};
    };
    const clipArc=s=>{
      if(!clipBox)return [s];
      const b=DraftGeometry.bounds(s);
      if(inside([b[0],b[1]])&&inside([b[2],b[3]]))return [s];
      if(b[2]<clipBox[0]||b[0]>clipBox[2]||b[3]<clipBox[1]||b[1]>clipBox[3])return [];
      const edges=[
        {type:'line',p0:[clipBox[0],clipBox[1]],p1:[clipBox[2],clipBox[1]]},
        {type:'line',p0:[clipBox[2],clipBox[1]],p1:[clipBox[2],clipBox[3]]},
        {type:'line',p0:[clipBox[2],clipBox[3]],p1:[clipBox[0],clipBox[3]]},
        {type:'line',p0:[clipBox[0],clipBox[3]],p1:[clipBox[0],clipBox[1]]},
      ];
      const ts=[0,1];
      for(const edge of edges){
        for(const hit of DraftGeometry.intersections(s,edge)){
          const t=DraftGeometry.nearest(s,hit).t;
          if(t>1e-7&&t<1-1e-7)ts.push(t);
        }
      }
      ts.sort((u,v)=>u-v);
      const uniqueTs=[ts[0]];for(const t of ts)if(t-uniqueTs.at(-1)>1e-6)uniqueTs.push(t);
      const kept=[];
      for(let k=0;k<uniqueTs.length-1;k++){
        const t0=uniqueTs[k],t1=uniqueTs[k+1],mid=DraftGeometry.point(s,(t0+t1)/2);
        if(inside(mid)&&t1-t0>1e-6){
          kept.push({type:'arc',center:s.center.slice(),radius:s.radius,start_deg:s.start_deg+t0*s.extent_deg,extent_deg:(t1-t0)*s.extent_deg});
        }
      }
      return kept;
    };
    const add=path=>{
      if(strokeLight)return;
      if(clipBox){
        path.closed=path.closed&&path.segments.every(s=>{const b=DraftGeometry.bounds(s);return inside([b[0],b[1]])&&inside([b[2],b[3]]);});
        const next=[];
        for(const s of path.segments){
          if(s.type==='line'){const c=clipLine(s);if(c)next.push(c);}
          else if(s.type==='arc'){next.push(...clipArc(s));}
          else next.push(s);
        }
        path.segments=next;
      }
      total+=path.segments.length;
      if(total>200000)throw Error('ベクターPDFは20万要素以下で指定してください。');
      if(path.segments.length){
        if(lineStyle!=='solid')path.line_style=lineStyle;
        paths.push(path);
        const pb=[Infinity,Infinity,-Infinity,-Infinity];
        for(const s of path.segments){const b=DraftGeometry.bounds(s);pb[0]=Math.min(pb[0],b[0]);pb[1]=Math.min(pb[1],b[1]);pb[2]=Math.max(pb[2],b[2]);pb[3]=Math.max(pb[3],b[3]);}
        pathBounds.push(pb);
      }
    };
    const point=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
    const dataBounds=data=>{
      const b=[Infinity,Infinity,-Infinity,-Infinity];
      const include=pt=>{if(pt[0]<b[0])b[0]=pt[0];if(pt[1]<b[1])b[1]=pt[1];if(pt[0]>b[2])b[2]=pt[0];if(pt[1]>b[3])b[3]=pt[1];};
      for(let j=0;j<data.length;){
        const cmd=data[j++];
        if(cmd===0||cmd===1)include(point(data[j++],data[j++]));
        else if(cmd===2){include(point(data[j++],data[j++]));include(point(data[j++],data[j++]));include(point(data[j++],data[j++]));}
        else if(cmd===3){include(point(data[j++],data[j++]));include(point(data[j++],data[j++]));}
        else if(cmd===4){}
        else break;
      }
      return b[0]<=b[2]?b:null;
    };
    const rectangleClip=data=>{
      const points=[];let closed=false;
      for(let j=0;j<data.length;){const command=data[j++];if(command===0&&points.length===0||command===1)points.push(point(data[j++],data[j++]));else if(command===4)closed=true;else return false;}
      if(points.length===5&&Math.hypot(points[0][0]-points[4][0],points[0][1]-points[4][1])<1e-7){points.pop();closed=true;}
      if(!closed||points.length!==4||!points.every((p,i)=>Math.abs(p[0]-points[(i+1)%4][0])<1e-7||Math.abs(p[1]-points[(i+1)%4][1])<1e-7))return false;
      const box=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
      if(box[2]-box[0]<1e-7||box[3]-box[1]<1e-7)return false;
      clipBox=clipBox?[Math.max(box[0],clipBox[0]),Math.max(box[1],clipBox[1]),Math.min(box[2],clipBox[2]),Math.min(box[3],clipBox[3])]:box;return true;
    };
    // Deterministic second-derivative-bounded cubic Bezier flattening.
    const flatten=(a,b,c,d,out)=>{
      const d1x=a[0]-2*b[0]+c[0],d1y=a[1]-2*b[1]+c[1],d2x=b[0]-2*c[0]+d[0],d2y=b[1]-2*c[1]+d[1];
      const maxD2=Math.max(Math.hypot(d1x,d1y),Math.hypot(d2x,d2y));
      const tol=0.15;
      const steps=Math.max(1,Math.ceil(Math.sqrt(0.75*maxD2/tol)));
      if(!Number.isFinite(steps)||steps>4096)throw Error('PDFの曲線精度を保証できません。画像から抽出してください。');
      for(let s=1;s<=steps;s++){
        const t=s/steps,mt=1-t,mt2=mt*mt,t2=t*t;
        const x=mt2*mt*a[0]+3*mt2*t*b[0]+3*mt*t2*c[0]+t2*t*d[0];
        const y=mt2*mt*a[1]+3*mt2*t*b[1]+3*mt*t2*c[1]+t2*t*d[1];
        out.push([x,y]);
      }
      if(out.length>200000)throw Error('PDFの曲線が複雑すぎます。');
    };
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],args=list.argsArray[i]||[];
      if(pendingClip&&op===OPS.constructPath&&args[1]?.[0]){if(!rectangleClip(args[1][0]))clipped=true;if(strokes.has(args[0]))unsafeOverpaint=true;pendingClip=false;}
      if(op===OPS.save)stack.push({matrix:matrix.slice(),clipBox:clipBox?.slice(),fillLight,strokeLight,lineStyle});
      else if(op===OPS.restore){if(stack.length)({matrix,clipBox,fillLight,strokeLight,lineStyle}=stack.pop());}
      else if(op===OPS.transform)matrix=this.multiply(matrix,args);
      else if(op===OPS.paintFormXObjectBegin){
        stack.push({matrix:matrix.slice(),clipBox:clipBox?.slice(),fillLight,strokeLight,lineStyle});
        if(args[0])matrix=this.multiply(matrix,args[0]);
        if(args[1]){const b=args[1],corners=[point(b[0],b[1]),point(b[2],b[1]),point(b[2],b[3]),point(b[0],b[3])];
          if(!corners.every((p,j)=>Math.abs(p[0]-corners[(j+1)%4][0])<1e-7||Math.abs(p[1]-corners[(j+1)%4][1])<1e-7))clipped=true;
          else{const box=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];clipBox=clipBox?[Math.max(box[0],clipBox[0]),Math.max(box[1],clipBox[1]),Math.min(box[2],clipBox[2]),Math.min(box[3],clipBox[3])]:box;}
        }
      }
      else if(op===OPS.paintFormXObjectEnd){if(stack.length)({matrix,clipBox,fillLight,strokeLight,lineStyle}=stack.pop());}
      else if(op===OPS.setFillRGBColor)fillLight=this.isLightColor(args);
      else if(op===OPS.setFillGray)fillLight=this.isLightColor(args);
      else if(op===OPS.setStrokeRGBColor)strokeLight=this.isLightColor(args);
      else if(op===OPS.setStrokeGray)strokeLight=this.isLightColor(args);
      else if(op===OPS.clip||op===OPS.eoClip)pendingClip=true;
      else if(op===OPS.beginMarkedContentProps&&args[0]==='OC'){
        // OC properties are IDs/expressions, not a reliable `visible` flag.
        // Until evaluated with PDF.js optionalContentConfig, preserve visibility by rendering.
        unsupported=true;
      }
      else if(op===OPS.setGState){for(const [key,value] of args[0]||[])if(key==='SMask'&&value||['CA','ca'].includes(key)&&value<1||key==='BM'&&value!=='source-over')unsupported=true;}
      else if(op===OPS.setDash){lineStyle=this.classifyDash(args[0]);if(args[0]?.length)dashes++;}
      else if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectRepeat,OPS.paintImageMaskXObjectGroup,OPS.paintInlineImageXObjectGroup,OPS.paintSolidColorImageMask,OPS.shadingFill].includes(op)){
        images++;
        if(paths.length){
          const complex=[OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectRepeat,OPS.paintImageMaskXObjectGroup,OPS.paintInlineImageXObjectGroup,OPS.shadingFill].includes(op);
          if(complex)unsafeOverpaint=true;
          const corners=[point(0,0),point(1,0),point(1,1),point(0,1)];
          const imgBox=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];
          if(overlapsExisting(imgBox))unsafeOverpaint=true;
        }
      }
      else if([OPS.showText,OPS.showSpacedText,OPS.nextLineShowText,OPS.nextLineSetSpacingShowText].includes(op)){text++;if(fillLight&&paths.length)unsafeOverpaint=true;}
      else if(op===OPS.constructPath&&!strokes.has(args[0])){
        if([OPS.fill,OPS.eoFill].includes(args[0])){
          fills++;
          if(paths.length){
            const fb=args[1]?.[0]?dataBounds(args[1][0]):null;
            if(!fb||overlapsExisting(fb))unsafeOverpaint=true;
          }
        }
      }
      else if(op===OPS.constructPath&&strokes.has(args[0])){
        if([OPS.stroke,OPS.closeStroke].includes(args[0]))nativeOps.push(i);
        else{
          fills++;
          // The residual render retains this combined fill+stroke operation;
          // do not also retain its stroke as native geometry (double tracing).
          unsafeOverpaint=true;
        }
        const data=args[1]?.[0];if(!data)continue;
        let runs=[],curRun=null,subStart=null,curPt=null,closed=false;
        const pushLine=(a,b)=>{if(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-7){if(curRun?.kind==='curve'){runs.push(curRun);curRun=null;}runs.push({kind:'line',p0:a.slice(),p1:b.slice()});}};
        const pushCurvePoints=pts=>{
          if(!curRun||curRun.kind!=='curve'){curRun={kind:'curve',pts:[curPt.slice()]};}
          for(const p of pts)curRun.pts.push(p);
        };
        const flush=()=>{
          if(curRun){runs.push(curRun);curRun=null;}
          if(!runs.length){subStart=null;curPt=null;closed=false;return;}
          // If the entire subpath is a single curve run (e.g. full circle), check circle fit first.
          const segments=[];
          for(const run of runs){
            if(run.kind==='line'){
              segments.push({type:'line',p0:run.p0,p1:run.p1});
            }else{
              const arc=this.fitCirclePoints(run.pts);
              if(arc){segments.push(arc);}
              else{
                for(let k=1;k<run.pts.length;k++){
                  const p0=run.pts[k-1],p1=run.pts[k];
                  if(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])>1e-7)segments.push({type:'line',p0,p1});
                }
              }
            }
          }
          const isClosed=closed||(segments.length===1&&segments[0].type==='arc'&&Math.abs(segments[0].extent_deg)>=359.999999);
          add({closed:isClosed,segments});
          runs=[];subStart=null;curPt=null;closed=false;
        };
        for(let j=0;j<data.length;){
          const cmd=data[j++];
          if(cmd===0){flush();subStart=curPt=point(data[j++],data[j++]);}
          else if(cmd===1){const next=point(data[j++],data[j++]);if(curPt)pushLine(curPt,next);else subStart=next;curPt=next;}
          else if(cmd===2){
            const b=point(data[j++],data[j++]),c=point(data[j++],data[j++]),d=point(data[j++],data[j++]);
            if(!curPt)throw Error('PDF曲線の始点がありません。');
            const out=[];flatten(curPt,b,c,d,out);pushCurvePoints(out);curPt=d;curves++;
          }
          else if(cmd===3){
            const b=point(data[j++],data[j++]),d=point(data[j++],data[j++]);
            if(!curPt)throw Error('PDF曲線の始点がありません。');
            const a=curPt,out=[];
            flatten(a,a.map((v,k)=>v+2/3*(b[k]-v)),d.map((v,k)=>v+2/3*(b[k]-v)),d,out);
            pushCurvePoints(out);curPt=d;curves++;
          }
          else if(cmd===4){
            if(subStart&&curPt&&Math.hypot(subStart[0]-curPt[0],subStart[1]-curPt[1])>1e-7)pushLine(curPt,subStart);
            closed=true;flush();
          }
          else throw Error('このPDFの描画命令は直接読込に対応していません。画像から抽出してください。');
        }
        if([OPS.closeStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(args[0])&&subStart&&curPt){
          if(Math.hypot(subStart[0]-curPt[0],subStart[1]-curPt[1])>1e-7)pushLine(curPt,subStart);
          closed=true;
        }
        flush();
      }
    }
    if(clipped||pendingClip){const error=Error('表示範囲の切り抜きを含むため、PDFの見た目どおりに画像から線を抽出します。');error.code='PDF_VECTOR_CLIPPING';throw error;}
    if(unsupported)throw Error('このPDFは透明効果・非表示レイヤ等を含みます。「画像から抽出」で読み込んでください。');
    if(!paths.length)throw Error('直接利用できるベクター線がありません。「画像から抽出」を選択してください。');
    if(pageSize&&paths.some(p=>p.segments.some(s=>{const b=DraftGeometry.bounds(s);return b[0]<-.01||b[1]<-.01||b[2]>pageSize[0]+.01||b[3]>pageSize[1]+.01;})))throw Error('用紙外へ伸びる線を含むPDFです。「画像から抽出」で用紙範囲を維持してください。');
    return {paths,images,text,fills,nativeOps,unsafeOverpaint,summary:`PDFベクター線を直接読込：${total}要素 ／ 曲線 ${curves}命令（区間円弧復元・折線近似0.15px以内） ／ 線種反映（破線設定 ${dashes}命令） ／ 併存：画像 ${images}命令・文字 ${text}命令・塗り図形 ${fills}命令。`};
  }
};
