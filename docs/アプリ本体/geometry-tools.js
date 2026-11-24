// Shared finite-segment geometry for selection, spatial queries, and snapping. Image coordinates: y points down.
window.DraftGeometry={
  mod(a){return (a%360+360)%360;},
  closed(s){return s.type==='ellipse'||s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999;},
  ellipseLocal(s,p){const c=Math.cos(s.rotation),n=Math.sin(s.rotation),x=p[0]-s.center[0],y=p[1]-s.center[1];return [c*x+n*y,-n*x+c*y];},
  ellipseWorld(s,x,y){const c=Math.cos(s.rotation),n=Math.sin(s.rotation);return [s.center[0]+c*x-n*y,s.center[1]+n*x+c*y];},
  point(s,t){
    if(s.type==='line')return s.p0.map((v,i)=>v+t*(s.p1[i]-v));
    if(s.type==='ellipse'){const a=t*2*Math.PI;return this.ellipseWorld(s,s.rx*Math.cos(a),s.ry*Math.sin(a));}
    const a=(s.start_deg+t*s.extent_deg)*Math.PI/180;
    return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];
  },
  trace(c,s,a=0,b=1){
    if(s.type==='ellipse'){c.ellipse(...s.center,s.rx,s.ry,s.rotation,a*2*Math.PI,b*2*Math.PI);return;}
    if(s.type==='arc'){c.arc(...s.center,s.radius,(s.start_deg+a*s.extent_deg)*Math.PI/180,(s.start_deg+b*s.extent_deg)*Math.PI/180,s.extent_deg<0);return;}
    c.moveTo(...(a===0?s.p0:this.point(s,a)));c.lineTo(...(b===1?s.p1:this.point(s,b)));
  },
  length(s){
    if(s.type==='ellipse'){const h=((s.rx-s.ry)/(s.rx+s.ry))**2;return Math.PI*(s.rx+s.ry)*(1+3*h/(10+Math.sqrt(4-3*h)));}
    return s.type==='line'?Math.hypot(s.p1[0]-s.p0[0],s.p1[1]-s.p0[1]):s.radius*Math.abs(s.extent_deg)*Math.PI/180;
  },
  bounds(s){
    if(s.type==='ellipse'){const c=Math.cos(s.rotation),n=Math.sin(s.rotation),x=Math.hypot(s.rx*c,s.ry*n),y=Math.hypot(s.rx*n,s.ry*c);return [s.center[0]-x,s.center[1]-y,s.center[0]+x,s.center[1]+y];}
    const pts=[this.point(s,0),this.point(s,1)];
    if(s.type==='arc')for(const a of [0,90,180,270]){const p=[s.center[0]+s.radius*Math.cos(a*Math.PI/180),s.center[1]+s.radius*Math.sin(a*Math.PI/180)];if(this.onArc(s,p))pts.push(p);}
    return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
  },
  spatialIndex(doc){
    if(!doc?.paths)return null;
    if(doc._spatialCache?.paths===doc.paths)return doc._spatialCache;
    const w=Math.max(1,doc.width||1000),h=Math.max(1,doc.height||1000);
    const cellSize=Math.max(24,Math.min(256,Math.hypot(w,h)/48));
    const items=[],cells=new Map(),large=[];
    for(let pi=0;pi<doc.paths.length;pi++){
      const path=doc.paths[pi];
      for(let si=0;si<path.segments.length;si++){
        const s=path.segments[si],b=this.bounds(s);
        const item={index:items.length,pi,si,key:`${pi}:${si}`,path,s,bounds:b};
        items.push(item);
        const x0=Math.floor(b[0]/cellSize),y0=Math.floor(b[1]/cellSize),x1=Math.floor(b[2]/cellSize),y1=Math.floor(b[3]/cellSize);
        if((x1-x0+1)*(y1-y0+1)>64){large.push(item);continue;}
        for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){
          const ck=`${cx},${cy}`;let list=cells.get(ck);if(!list){list=[];cells.set(ck,list);}list.push(item);
        }
      }
    }
    const cache={
      paths:doc.paths,items,cells,large,cellSize,_stamp:0,
      queryBox(box){
        const x0=Math.floor(box[0]/cellSize),y0=Math.floor(box[1]/cellSize),x1=Math.floor(box[2]/cellSize),y1=Math.floor(box[3]/cellSize);
        if((x1-x0+1)*(y1-y0+1)>512)return items.filter(it=>!(it.bounds[0]>box[2]||it.bounds[2]<box[0]||it.bounds[1]>box[3]||it.bounds[3]<box[1]));
        const stamp=++this._stamp,out=[];
        const visit=it=>{if(it._s===stamp)return;it._s=stamp;const b=it.bounds;if(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1])return;out.push(it);};
        for(let i=0;i<large.length;i++)visit(large[i]);
        for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){const list=cells.get(`${cx},${cy}`);if(list)for(let i=0;i<list.length;i++)visit(list[i]);}
        return out;
      }
    };
    doc._spatialCache=cache;
    return cache;
  },
  nearestEllipse(s,p){
    const [px,py]=this.ellipseLocal(s,p),x=Math.abs(px),y=Math.abs(py),{rx,ry}=s,diff=(rx-ry)*(rx+ry);
    let qx,qy;
    if(y===0){
      const u=x*rx;
      if(u<diff){qx=rx*u/diff;qy=ry*Math.sqrt(Math.max(0,1-(qx/rx)**2));}else{qx=rx;qy=0;}
    }else{
      // The closest first-quadrant point solves a monotone constraint for v>0.
      // Geometric bisection handles points very close to a principal axis.
      const u=rx*x,w=ry*y;
      let lo=w,hi=Math.hypot(u,w);
      for(let i=0;i<48&&hi-lo>1e-14*hi;i++){
        const v=hi>4*lo?Math.sqrt(lo*hi):lo+(hi-lo)/2;
        if((u/(diff+v))**2+(w/v)**2>1)lo=v;else hi=v;
      }
      qx=rx*u/(diff+hi);qy=ry*w/hi;
    }
    if(px<0)qx=-qx;if(py<0)qy=-qy;
    const a=Math.atan2(qy/ry,qx/rx);
    return {point:this.ellipseWorld(s,qx,qy),t:(a<0?a+2*Math.PI:a)/(2*Math.PI),distance:Math.hypot(px-qx,py-qy)};
  },
  nearest(s,p){
    if(s.type==='ellipse')return this.nearestEllipse(s,p);
    let t;
    if(s.type==='line'){const u=s.p1.map((v,i)=>v-s.p0[i]),len2=u[0]*u[0]+u[1]*u[1];t=len2?Math.max(0,Math.min(1,((p[0]-s.p0[0])*u[0]+(p[1]-s.p0[1])*u[1])/len2)):0;}
    else{const angle=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI,delta=this.mod((angle-s.start_deg)*Math.sign(s.extent_deg));t=delta/Math.abs(s.extent_deg);if(t>1){const ends=[this.point(s,0),this.point(s,1)];t=Math.hypot(p[0]-ends[0][0],p[1]-ends[0][1])<=Math.hypot(p[0]-ends[1][0],p[1]-ends[1][1])?0:1;}}
    const point=this.point(s,t);return {point,t,distance:Math.hypot(p[0]-point[0],p[1]-point[1])};
  },
  distance(a,b){
    if(this.intersections(a,b).length)return 0;
    if(a.type==='ellipse'||b.type==='ellipse'){
      if(a.type!=='ellipse')[a,b]=[b,a];
      let best=Infinity;
      if(b.type==='line'){
        best=Math.min(this.nearestEllipse(a,b.p0).distance,this.nearestEllipse(a,b.p1).distance);
        const p=this.ellipseLocal(a,b.p0),q=this.ellipseLocal(a,b.p1),dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);
        if(len){const nx=-dy/len,ny=dx/len,u=a.rx*nx,v=a.ry*ny,h=Math.hypot(u,v);
          for(const sign of [-1,1]){const x=sign*a.rx*u/h-p[0],y=sign*a.ry*v/h-p[1],t=(x*dx+y*dy)/len;if(t>=0&&t<=len)best=Math.min(best,Math.abs(x*nx+y*ny));}}
        return best;
      }
      // Read-only isolation check for curved pairs (not used for picking or edits).
      for(let i=0;i<=32;i++)best=Math.min(best,this.nearest(b,this.point(a,i/32)).distance,this.nearest(a,this.point(b,i/32)).distance);
      return best;
    }
    let best=Infinity;const consider=(s,p)=>{best=Math.min(best,this.nearest(s,p).distance);};
    for(const t of [0,1]){consider(a,this.point(b,t));consider(b,this.point(a,t));}
    if(a.type==='line'&&b.type==='line')return best;
    if(a.type==='line'||b.type==='line'){
      if(a.type!=='line')[a,b]=[b,a];
      const q=this.nearest(a,b.center).point;consider(b,q);
    }else{
      const d=Math.hypot(b.center[0]-a.center[0],b.center[1]-a.center[1]);
      if(d>1e-12){const u=b.center.map((v,i)=>(v-a.center[i])/d);for(const sign of [-1,1]){const p=a.center.map((v,i)=>v+sign*a.radius*u[i]);if(this.onArc(a,p))consider(b,p);const q=b.center.map((v,i)=>v+sign*b.radius*u[i]);if(this.onArc(b,q))consider(a,q);}}
    }
    return best;
  },
  outward(s,endpoint){
    let u;if(s.type==='line')u=s.p1.map((v,i)=>v-s.p0[i]);else{const angle=(s.start_deg+endpoint*s.extent_deg)*Math.PI/180;u=[-Math.sin(angle)*Math.sign(s.extent_deg),Math.cos(angle)*Math.sign(s.extent_deg)];}
    const length=Math.hypot(...u);return length?u.map(v=>v/length*(endpoint===0?-1:1)):[0,0];
  },
  onArc(s,p){const delta=this.mod((Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI-s.start_deg)*Math.sign(s.extent_deg));return Math.abs(s.extent_deg)>=359.999999||delta<=Math.abs(s.extent_deg)+1e-7||delta>=360-1e-7;},
  intersections(a,b){
    if(a.type==='ellipse'||b.type==='ellipse'){
      if(a.type!=='ellipse')[a,b]=[b,a];
      if(b.type!=='line')return [];
      // Use the inverse ellipse transform to intersect a unit circle.
      const p=this.ellipseLocal(a,b.p0),q=this.ellipseLocal(a,b.p1),x=p[0]/a.rx,y=p[1]/a.ry;
      const dx=(q[0]-p[0])/a.rx,dy=(q[1]-p[1])/a.ry,len=Math.hypot(dx,dy);
      if(len<1e-20)return [];
      const ux=dx/len,uy=dy/len,p1=x*uy,p2=y*ux,h2=1-(p1-p2)**2;
      const eps=16*Number.EPSILON*Math.max(1,Math.abs(p1)+Math.abs(p2));
      if(h2< -eps)return [];
      const t0=-(x*ux+y*uy),h=Math.sqrt(Math.max(0,h2));
      return (h2>eps?[t0-h,t0+h]:[t0]).map(t=>t/len).filter(t=>t>=-1e-9&&t<=1+1e-9).map(t=>this.point(b,t));
    }
    if(a.type==='line'&&b.type==='line'){const p=DraftEndpoint.intersection(a,b);return p?[p]:[];}
    let points=[];
    if(a.type==='line'||b.type==='line'){
      if(a.type!=='line')[a,b]=[b,a];
      const u=a.p1.map((v,i)=>v-a.p0[i]),w=a.p0.map((v,i)=>v-b.center[i]);
      const A=u[0]*u[0]+u[1]*u[1],B=2*(u[0]*w[0]+u[1]*w[1]),C=w[0]*w[0]+w[1]*w[1]-b.radius*b.radius;
      const disc=B*B-4*A*C,eps=1e-10*Math.max(1,B*B,Math.abs(4*A*C));
      if(A<1e-20||disc< -eps)return [];
      for(const t of [(-B-Math.sqrt(Math.max(0,disc)))/(2*A),(-B+Math.sqrt(Math.max(0,disc)))/(2*A)])
        if(t>=-1e-9&&t<=1+1e-9){const p=u.map((v,i)=>a.p0[i]+t*v);if(this.onArc(b,p))points.push(p);}
    }else{
      const dx=b.center[0]-a.center[0],dy=b.center[1]-a.center[1],d=Math.hypot(dx,dy),eps=1e-8*Math.max(1,a.radius,b.radius);
      if(d<eps||d>a.radius+b.radius+eps||d<Math.abs(a.radius-b.radius)-eps)return [];
      const x=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),h2=a.radius*a.radius-x*x;
      if(h2< -eps*Math.max(1,a.radius))return [];
      const h=Math.sqrt(Math.max(0,h2)),p=[a.center[0]+x*dx/d,a.center[1]+x*dy/d];
      points=[[p[0]-h*dy/d,p[1]+h*dx/d],[p[0]+h*dy/d,p[1]-h*dx/d]].filter(q=>this.onArc(a,q)&&this.onArc(b,q));
    }
    return points.filter((p,i)=>!points.slice(0,i).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7));
  },
  inside(p,b){return p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];},
  touches(s,b){
    if([this.point(s,0),this.point(s,1)].some(p=>this.inside(p,b)))return true;
    const corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
    return corners.some((p,i)=>this.intersections(s,{type:'line',p0:p,p1:corners[(i+1)%4]}).length);
  },
  allowed(path,s){const v=typeof document!=='undefined'?document.getElementById('selectFilter')?.value:'all';return !v||v==='all'||v===s.type;},
  continuations(e,seedKey,{gap,offset,angle}){
    for(const [value,max] of [[gap,1000],[offset,100],[angle,60]])if(!Number.isFinite(value)||value<=0||value>max)throw Error('設定の「ダブルクリック選択」で隙間・許容幅・角度差を確認してください。');
    const selected=new Set(),index=this.spatialIndex(e.doc),[pi,si]=seedKey.split(':').map(Number),path=e.doc?.paths[pi],seed=path?.segments[si];
    if(!index||seed?.type!=='line'||!e.visible(path)||!this.allowed(path,seed))return {selected,limited:false};
    const length=this.length(seed);if(!Number.isFinite(length)||length<1e-6)return {selected,limited:false};
    const origin=seed.p0,u=seed.p1.map((v,i)=>(v-origin[i])/length),cos=Math.cos(angle*Math.PI/180),style=path.line_style||'solid',cache=new Map(),epsilon=1e-7;
    const candidate=item=>{
      if(cache.has(item.key))return cache.get(item.key);
      const {s,path}=item;let result=null;
      if(s.type==='line'&&e.visible(path)&&this.allowed(path,s)&&(path.line_style||'solid')===style){
        const len=this.length(s),dx=s.p1[0]-s.p0[0],dy=s.p1[1]-s.p0[1];
        if(Number.isFinite(len)&&len>=1e-6&&Math.abs(dx*u[0]+dy*u[1])/len>=cos-1e-12){
          const points=[s.p0,s.p1],along=points.map(p=>(p[0]-origin[0])*u[0]+(p[1]-origin[1])*u[1]);
          // Keep the original line as the reference: repeated small steps must
          // not gradually walk onto a neighbouring parallel or a curved outline.
          if(points.every(p=>Math.abs((p[0]-origin[0])*u[1]-(p[1]-origin[1])*u[0])<=offset+epsilon)){
            const first=along[0]<=along[1]?0:1;
            result={...item,lo:along[first],hi:along[1-first],left:points[first],right:points[1-first]};
          }
        }
      }
      cache.set(item.key,result);return result;
    };
    const start=candidate({key:seedKey,path,s:seed,bounds:this.bounds(seed)}),queue=[];
    if(!start)return {selected,limited:false};selected.add(seedKey);queue.push(start);
    for(let i=0;i<queue.length;i++){
      const current=queue[i],b=current.bounds,box=[b[0]-gap-epsilon,b[1]-gap-epsilon,b[2]+gap+epsilon,b[3]+gap+epsilon];
      for(const item of index.queryBox(box)){
        if(selected.has(item.key))continue;
        const next=candidate(item);if(!next)continue;
        const overlap=Math.min(current.hi,next.hi)-Math.max(current.lo,next.lo);
        // Small end overlaps are common in scans; substantial overlaps are
        // side-by-side lines or duplicates, not a continuation of an endpoint.
        if(overlap>Math.min(gap,.25*(current.hi-current.lo),.25*(next.hi-next.lo))+epsilon)continue;
        const [left,right]=current.lo<=next.lo?[current,next]:[next,current],dx=right.left[0]-left.right[0],dy=right.left[1]-left.right[1];
        if(Math.hypot(dx,dy)>gap+epsilon||Math.abs(dx*u[1]-dy*u[0])>offset+epsilon)continue;
        if(selected.size>=5000)return {selected,limited:true};
        selected.add(next.key);queue.push(next);
      }
    }
    return {selected,limited:false};
  },
  fitCirclePoints(points){
    const n=points.length;if(n<3)return null;
    let mx=0,my=0;for(const p of points){mx+=p[0];my+=p[1];}mx/=n;my/=n;
    let sxx=0,sxy=0,syy=0,sxz=0,syz=0,sz=0;
    for(const p of points){const x=p[0]-mx,y=p[1]-my,z=x*x+y*y;sxx+=x*x;sxy+=x*y;syy+=y*y;sxz+=x*z;syz+=y*z;sz+=z;}
    // Solve centered 3x3 normal equations: [2*sxx, 2*sxy, 0; 2*sxy, 2*syy, 0; 0, 0, n] * [a, b, c] = [sxz, syz, sz]
    const det=sxx*syy-sxy*sxy;if(!Number.isFinite(det)||Math.abs(det)<1e-10)return null;
    const a=(sxz*syy-syz*sxy)/(2*det),b=(sxx*syz-sxy*sxz)/(2*det),r2=a*a+b*b+sz/n;
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(r2)||r2<=1e-6)return null;
    return {center:[mx+a,my+b],radius:Math.sqrt(r2)};
  },
  circleCandidates(e,seedKey,{offset,angle}){
    for(const [value,max] of [[offset,100],[angle,60]])if(!Number.isFinite(value)||value<=0||value>max)throw Error('設定の「ダブルクリック選択」で許容幅・角度差を確認してください。');
    const selected=new Set(),index=this.spatialIndex(e.doc),[pi,si]=seedKey.split(':').map(Number),seedPath=e.doc?.paths[pi],seed=seedPath?.segments[si];
    if(!index||seed?.type!=='arc'||!e.visible(seedPath)||!this.allowed(seedPath,seed))return {selected,limited:false};
    if(!Number.isFinite(seed.radius)||seed.radius<1e-3||this.length(seed)<1e-6)return {selected,limited:false};
    const style=seedPath.line_style||'solid',isText=!!seedPath.is_text,isDim=!!seedPath.is_dimension;
    const cos=Math.cos(angle*Math.PI/180),epsilon=1e-7;
    const compatible=item=>{
      const {path,s}=item;
      if(s.type!=='arc'&&s.type!=='line')return false;
      if(!e.visible(path)||!this.allowed(path,s))return false;
      if((path.line_style||'solid')!==style)return false;
      return !!path.is_text===isText&&!!path.is_dimension===isDim;
    };
    const matches=(s,cx,cy,r)=>{
      const len=this.length(s);if(!Number.isFinite(len)||len<1e-6)return false;
      if(s.type==='arc'){
        if(!Number.isFinite(s.radius)||s.radius<1e-3)return false;
        const sweep=Math.abs(s.extent_deg);
        if(sweep>=60&&Math.abs(s.radius-r)>Math.max(r*.65,offset*4))return false;
        const steps=Math.max(4,Math.min(24,Math.ceil(sweep/18)));
        for(let i=0;i<=steps;i++){
          const p=this.point(s,i/steps);
          if(Math.abs(Math.hypot(p[0]-cx,p[1]-cy)-r)>offset+epsilon)return false;
        }
        // Reject arcs curving the opposite way (externally tangent fillets).
        const pm=this.point(s,.5);
        if((s.center[0]-pm[0])*(cx-pm[0])+(s.center[1]-pm[1])*(cy-pm[1])<=0)return false;
        for(const t of [0,.5,1]){
          const p=this.point(s,t),dx=p[0]-cx,dy=p[1]-cy,d=Math.hypot(dx,dy);if(d<1e-6)return false;
          const a=(s.start_deg+t*s.extent_deg)*Math.PI/180;
          if(Math.abs((-Math.sin(a))*(-dy/d)+Math.cos(a)*(dx/d))<cos-1e-9)return false;
        }
        return true;
      }
      // Straight chord fragment on the circle circumference (reject long tangent walls & crossing secants).
      if(len>r*.95)return false;
      const p0=s.p0,p1=s.p1,pm=[(p0[0]+p1[0])/2,(p0[1]+p1[1])/2];
      const r0=Math.hypot(p0[0]-cx,p0[1]-cy),r1=Math.hypot(p1[0]-cx,p1[1]-cy),rm=Math.hypot(pm[0]-cx,pm[1]-cy);
      if(rm<1e-6)return false;
      const rExp=Math.sqrt(Math.max(0,r*r-len*len/4));
      if(Math.abs(r0-r)>offset+epsilon||Math.abs(r1-r)>offset+epsilon)return false;
      if(Math.abs(rm-rExp)>offset+epsilon||rm>r+offset*.6+epsilon)return false;
      const rExpQ=Math.sqrt(Math.max(0,r*r-len*len/16));
      for(const t of [.25,.75]){
        const pq=this.point(s,t);
        if(Math.abs(Math.hypot(pq[0]-cx,pq[1]-cy)-rExpQ)>offset+epsilon)return false;
      }
      const ux=(p1[0]-p0[0])/len,uy=(p1[1]-p0[1])/len;
      if(Math.abs(ux*(-(pm[1]-cy)/rm)+uy*((pm[0]-cx)/rm))<cos-1e-9)return false;
      return true;
    };
    const collect=(cx,cy,r,target,foundItems)=>{
      const pad=r+offset+epsilon;
      for(const item of index.queryBox([cx-pad,cy-pad,cx+pad,cy+pad])){
        if(target.has(item.key)||!compatible(item))continue;
        if(!matches(item.s,cx,cy,r))continue;
        if(target.size>=5000)return true;
        target.add(item.key);foundItems.push(item);
      }
      return false;
    };
    const foundItems=[{key:seedKey,path:seedPath,s:seed}];
    selected.add(seedKey);
    let limited=collect(seed.center[0],seed.center[1],seed.radius,selected,foundItems);
    // Stage 2: refine circle from Pass-1 fragments so short noisy seed arcs still catch the far side.
    if(!limited&&foundItems.length>=2){
      const samplePts=[];
      for(const it of foundItems){
        const n=Math.max(3,Math.min(24,Math.ceil(this.length(it.s)/10)+1));
        for(let i=0;i<=n&&samplePts.length<240;i++)samplePts.push(this.point(it.s,i/n));
      }
      const fit=this.fitCirclePoints(samplePts);
      if(fit&&Math.hypot(fit.center[0]-seed.center[0],fit.center[1]-seed.center[1])+Math.abs(fit.radius-seed.radius)<=Math.max(offset*3,seed.radius*.12)){
        if(foundItems.every(it=>matches(it.s,fit.center[0],fit.center[1],fit.radius))){
          limited=collect(fit.center[0],fit.center[1],fit.radius,selected,foundItems);
        }
      }
    }
    return {selected,limited};
  },
  connected(e,gap){
    if(!Number.isFinite(gap)||gap<0||gap>100)throw Error('つながり選択の隙間は0〜100pxです。');
    const radius=Math.max(gap,1e-6),items=[],grid=new Map(),ends=[];
    const index=this.spatialIndex(e.doc);
    const keyToIndex=new Map();
    e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{
      const idx=items.length,key=`${pi}:${si}`,item={s,key,allowed:this.allowed(path,s),bounds:this.bounds(s)};
      items.push(item);keyToIndex.set(key,idx);
      if(this.closed(s)||this.length(s)<1e-6)return;
      for(const t of [0,1]){const p=this.point(s,t),id=ends.length;ends.push({index:idx,t,p});const ck=`${Math.floor(p[0]/radius)},${Math.floor(p[1]/radius)}`;if(!grid.has(ck))grid.set(ck,[]);grid.get(ck).push(id);}
    });});
    if(items.length>10000)throw Error('つながり選択は表示中の1万要素まで対応しています。範囲選択をご利用ください。');
    const choices=new Map();
    for(let id=0;id<ends.length;id++){
      const a=ends[id],cell=a.p.map(v=>Math.floor(v/radius)),near=[];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of grid.get(`${cell[0]+dx},${cell[1]+dy}`)||[]){
        const b=ends[j];if(a.index===b.index)continue;const distance=Math.hypot(a.p[0]-b.p[0],a.p[1]-b.p[1]);if(distance>gap+1e-8)continue;
        near.push(j);
      }
      if(near.length!==1)continue;
      const j=near[0],b=ends[j],sa=items[a.index].s,sb=items[b.index].s;
      if(!items[a.index].allowed||!items[b.index].allowed)continue;
      const d=Math.hypot(a.p[0]-b.p[0],a.p[1]-b.p[1]);
      if(d>1e-5){const u=this.outward(sa,a.t),v=this.outward(sb,b.t),w=[(b.p[0]-a.p[0])/d,(b.p[1]-a.p[1])/d];if(u[0]*w[0]+u[1]*w[1]<.7||v[0]*w[0]+v[1]*w[1]>-.7)continue;}
      // A third shape near the join (including an unselectable one) is a branch.
      const epsilon=Math.max(1e-5,gap),mid=a.p.map((v,k)=>(v+b.p[k])/2);
      const qbox=[Math.min(a.p[0],b.p[0])-epsilon,Math.min(a.p[1],b.p[1])-epsilon,Math.max(a.p[0],b.p[0])+epsilon,Math.max(a.p[1],b.p[1])+epsilon];
      const candidates=index?index.queryBox(qbox):items;
      let blocked=false;
      for(let ci=0;ci<candidates.length;ci++){
        const cand=candidates[ci],k=index?keyToIndex.get(cand.key):ci;
        if(k===undefined||k===a.index||k===b.index)continue;
        const box=cand.bounds;
        if(box[0]>qbox[2]||box[2]<qbox[0]||box[1]>qbox[3]||box[3]<qbox[1])continue;
        if([a.p,b.p,mid].some(pt=>this.nearest(cand.s,pt).distance<=epsilon)){blocked=true;break;}
      }
      if(!blocked)choices.set(id,j);
    }
    const graph=items.map(()=>[]);
    for(const [a,b] of choices)if(choices.get(b)===a)graph[ends[a].index].push(ends[b].index);
    const selected=new Set(e.selected),queue=items.map((item,i)=>selected.has(item.key)?i:-1).filter(i=>i>=0),visited=new Set(queue);
    for(let k=0;k<queue.length;k++)for(const i of graph[queue[k]])if(!visited.has(i)){visited.add(i);queue.push(i);selected.add(items[i].key);}
    return selected;
  },
  snap(e,p,exclude=null,{midpoints=true,centers=true,origin=null,excludeSet=null,radiusPx=10}={}){
    const radius=radiusPx/e.view.scale;
    let point=p.slice(),kind='自由位置',best=radius;
    const nearby=[];
    const consider=(q,label)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;point=q.slice();kind=label;}};
    const useMid=midpoints&&(typeof document==='undefined'||document.getElementById('snapMidpoint')?.checked);
    const useCenter=centers&&(typeof document==='undefined'||document.getElementById('snapCenter')?.checked);
    const index=this.spatialIndex(e.doc);
    const candidates=index?index.queryBox([p[0]-radius,p[1]-radius,p[0]+radius,p[1]+radius]):null;
    const visit=(path,pi,s,si)=>{
      if(!e.visible(path))return;
      if(exclude&&pi===exclude[0]&&si===exclude[1])return;
      if(excludeSet&&excludeSet.has(`${pi}:${si}`))return;
      if(!this.closed(s)){consider(this.point(s,0),'端点吸着');consider(this.point(s,1),'端点吸着');}
      if(useMid&&s.type!=='ellipse')consider(this.point(s,.5),'中点吸着');
      if(useCenter&&s.type!=='line')consider(s.center,'中心吸着');
      if(s.type==='arc'){
        for(const deg of [0,90,180,270]){
          const q=[s.center[0]+s.radius*Math.cos(deg*Math.PI/180),s.center[1]+s.radius*Math.sin(deg*Math.PI/180)];
          if(this.onArc(s,q))consider(q,'四分円吸着');
        }
      }
      if(origin&&s.type==='line'){
        const dx=s.p1[0]-s.p0[0],dy=s.p1[1]-s.p0[1],len2=dx*dx+dy*dy;
        if(len2>1e-12){
          const t=((origin[0]-s.p0[0])*dx+(origin[1]-s.p0[1])*dy)/len2;
          if(t>=0&&t<=1){const foot=[s.p0[0]+t*dx,s.p0[1]+t*dy];if(Math.hypot(foot[0]-origin[0],foot[1]-origin[1])>1e-6)consider(foot,'垂線吸着');}
        }
      }
      const distance=e.distance(s,p);
      if(distance<=radius)nearby.push({s,distance});
    };
    if(candidates){for(const it of candidates)visit(it.path,it.pi,it.s,it.si);}
    else e.doc.paths.forEach((path,pi)=>path.segments.forEach((s,si)=>visit(path,pi,s,si)));
    // Center snaps can lie outside segment bounds for large arcs when pointer is near the center.
    if(useCenter&&index){
      for(const it of index.items){
        if(it.s.type==='line'||!e.visible(it.path))continue;
        if(exclude&&it.pi===exclude[0]&&it.si===exclude[1])continue;
        if(excludeSet&&excludeSet.has(it.key))continue;
        consider(it.s.center,'中心吸着');
      }
    }
    const segments=nearby.sort((a,b)=>a.distance-b.distance).slice(0,64);
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++)for(const q of this.intersections(segments[i].s,segments[j].s))consider(q,'交点吸着');
    return {point,kind};
  },
  drawSnapMarker(c,point,kind,scale){
    if(!point)return;
    const r=5/scale;
    c.save();
    const isSnap=kind&&kind!=='自由位置';
    const color=kind?.includes('交点')||kind?.includes('中心')?'#0057d9':kind?.includes('中点')||kind?.includes('四分円')?'#0d7490':isSnap?'#0f7a3e':'#006d77';
    const traceShape=()=>{
      c.beginPath();
      if(kind?.includes('中点')){c.moveTo(point[0],point[1]-r*1.2);c.lineTo(point[0]+r*1.1,point[1]+r);c.lineTo(point[0]-r*1.1,point[1]+r);c.closePath();}
      else if(kind?.includes('交点')){c.moveTo(point[0]-r,point[1]-r);c.lineTo(point[0]+r,point[1]+r);c.moveTo(point[0]+r,point[1]-r);c.lineTo(point[0]-r,point[1]+r);}
      else if(kind?.includes('中心')){c.arc(point[0],point[1],r,0,Math.PI*2);}
      else if(kind?.includes('四分円')){c.moveTo(point[0],point[1]-r*1.2);c.lineTo(point[0]+r*1.2,point[1]);c.lineTo(point[0],point[1]+r*1.2);c.lineTo(point[0]-r*1.2,point[1]);c.closePath();}
      else if(kind?.includes('垂線')){c.moveTo(point[0]-r,point[1]+r);c.lineTo(point[0]+r,point[1]+r);c.moveTo(point[0],point[1]-r);c.lineTo(point[0],point[1]+r);}
      else if(isSnap){c.rect(point[0]-r,point[1]-r,r*2,r*2);}
      else{c.moveTo(point[0]-r*.9,point[1]);c.lineTo(point[0]+r*.9,point[1]);c.moveTo(point[0],point[1]-r*.9);c.lineTo(point[0],point[1]+r*.9);}
    };
    c.strokeStyle='rgba(255,255,255,.92)';c.lineWidth=4/scale;traceShape();c.stroke();
    c.strokeStyle=color;c.lineWidth=2/scale;traceShape();c.stroke();
    c.restore();
  },
  drawHud(c,point,text,scale){
    if(!point||!text)return;
    c.save();
    const fontSize=11/scale,padX=5/scale,padY=3/scale;
    c.font=`${fontSize}px system-ui,sans-serif`;
    const w=c.measureText(text).width+padX*2,h=fontSize+padY*2;
    const x=point[0]+10/scale,y=point[1]-10/scale-h;
    c.fillStyle='rgba(255,255,255,.92)';c.strokeStyle='rgba(24,48,68,.35)';c.lineWidth=1/scale;
    c.fillRect(x,y,w,h);c.strokeRect(x,y,w,h);
    c.fillStyle='#183044';c.textBaseline='top';c.fillText(text,x+padX,y+padY);
    c.restore();
  }
};
