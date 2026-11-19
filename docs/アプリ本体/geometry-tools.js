// Shared finite-segment geometry for selection and snapping. Image coordinates: y points down.
window.DraftGeometry={
  mod(a){return (a%360+360)%360;},
  closed(s){return s.type==='ellipse'||s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999;},
  ellipseLocal(s,p){const c=Math.cos(s.rotation),n=Math.sin(s.rotation),x=p[0]-s.center[0],y=p[1]-s.center[1];return [c*x+n*y,-n*x+c*y];},
  ellipseWorld(s,x,y){const c=Math.cos(s.rotation),n=Math.sin(s.rotation);return [s.center[0]+c*x-n*y,s.center[1]+n*x+c*y];},
  point(s,t){if(s.type==='line')return s.p0.map((v,i)=>v+t*(s.p1[i]-v));if(s.type==='ellipse'){const a=t*2*Math.PI;return this.ellipseWorld(s,s.rx*Math.cos(a),s.ry*Math.sin(a));}const a=(s.start_deg+t*s.extent_deg)*Math.PI/180;return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];},
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
    const pts=[this.point(s,0),this.point(s,1)];if(s.type==='arc')for(const a of [0,90,180,270]){const p=[s.center[0]+s.radius*Math.cos(a*Math.PI/180),s.center[1]+s.radius*Math.sin(a*Math.PI/180)];if(this.onArc(s,p))pts.push(p);}return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
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
  allowed(path,s){const v=document.getElementById('selectFilter').value;return v==='all'||v===s.type;},
  connected(e,gap){
    if(!Number.isFinite(gap)||gap<0||gap>100)throw Error('つながり選択の隙間は0〜100pxです。');
    const radius=Math.max(gap,1e-6),items=[],grid=new Map(),ends=[];
    e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{
      const index=items.length,item={s,key:`${pi}:${si}`,allowed:this.allowed(path,s),bounds:this.bounds(s)};items.push(item);
      if(this.closed(s)||this.length(s)<1e-6)return;
      for(const t of [0,1]){const p=this.point(s,t),id=ends.length;ends.push({index,t,p});const key=`${Math.floor(p[0]/radius)},${Math.floor(p[1]/radius)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(id);}
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
      const blocked=items.some((item,k)=>{if(k===a.index||k===b.index)return false;const box=item.bounds;if(box[0]>Math.max(a.p[0],b.p[0])+epsilon||box[2]<Math.min(a.p[0],b.p[0])-epsilon||box[1]>Math.max(a.p[1],b.p[1])+epsilon||box[3]<Math.min(a.p[1],b.p[1])-epsilon)return false;return [a.p,b.p,mid].some(p=>this.nearest(item.s,p).distance<=epsilon);});
      if(!blocked)choices.set(id,j);
    }
    const graph=items.map(()=>[]);
    for(const [a,b] of choices)if(choices.get(b)===a)graph[ends[a].index].push(ends[b].index);
    const selected=new Set(e.selected),queue=items.map((item,i)=>selected.has(item.key)?i:-1).filter(i=>i>=0),visited=new Set(queue);
    for(let k=0;k<queue.length;k++)for(const i of graph[queue[k]])if(!visited.has(i)){visited.add(i);queue.push(i);selected.add(items[i].key);}
    return selected;
  },
  snap(e,p,exclude=null,{midpoints=true,centers=true}={}){
    let point=p.slice(),kind='自由位置',best=10/e.view.scale;const nearby=[];
    const consider=(q,label)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;point=q.slice();kind=label;}};
    e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{
      if(exclude&&pi===exclude[0]&&si===exclude[1])return;
      if(!this.closed(s)){consider(this.point(s,0),'端点吸着');consider(this.point(s,1),'端点吸着');}
      if(midpoints&&s.type!=='ellipse'&&document.getElementById('snapMidpoint').checked)consider(this.point(s,.5),'中点吸着');
      if(centers&&s.type!=='line'&&document.getElementById('snapCenter').checked)consider(s.center,'中心吸着');
      const distance=e.distance(s,p);if(distance<=10/e.view.scale)nearby.push({s,distance});
    });});
    const segments=nearby.sort((a,b)=>a.distance-b.distance).slice(0,64);
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++)for(const q of this.intersections(segments[i].s,segments[j].s))consider(q,'交点吸着');
    return {point,kind};
  }
};
