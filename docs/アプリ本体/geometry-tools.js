// Shared finite-segment geometry for selection and snapping. Image coordinates: y points down.
window.DraftGeometry={
  mod(a){return (a%360+360)%360;},
  point(s,t){if(s.type==='line')return s.p0.map((v,i)=>v+t*(s.p1[i]-v));const a=(s.start_deg+t*s.extent_deg)*Math.PI/180;return [s.center[0]+s.radius*Math.cos(a),s.center[1]+s.radius*Math.sin(a)];},
  length(s){return s.type==='line'?Math.hypot(s.p1[0]-s.p0[0],s.p1[1]-s.p0[1]):s.radius*Math.abs(s.extent_deg)*Math.PI/180;},
  bounds(s){const pts=[this.point(s,0),this.point(s,1)];if(s.type==='arc')for(const a of [0,90,180,270]){const p=[s.center[0]+s.radius*Math.cos(a*Math.PI/180),s.center[1]+s.radius*Math.sin(a*Math.PI/180)];if(this.onArc(s,p))pts.push(p);}return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];},
  nearest(s,p){
    let t;
    if(s.type==='line'){const u=s.p1.map((v,i)=>v-s.p0[i]),len2=u[0]*u[0]+u[1]*u[1];t=len2?Math.max(0,Math.min(1,((p[0]-s.p0[0])*u[0]+(p[1]-s.p0[1])*u[1])/len2)):0;}
    else{const angle=Math.atan2(p[1]-s.center[1],p[0]-s.center[0])*180/Math.PI,delta=this.mod((angle-s.start_deg)*Math.sign(s.extent_deg));t=delta/Math.abs(s.extent_deg);if(t>1){const ends=[this.point(s,0),this.point(s,1)];t=Math.hypot(p[0]-ends[0][0],p[1]-ends[0][1])<=Math.hypot(p[0]-ends[1][0],p[1]-ends[1][1])?0:1;}}
    const point=this.point(s,t);return {point,t,distance:Math.hypot(p[0]-point[0],p[1]-point[1])};
  },
  distance(a,b){
    if(this.intersections(a,b).length)return 0;
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
  snap(e,p,exclude=null,{midpoints=true,centers=true}={}){
    let point=p.slice(),kind='自由位置',best=10/e.view.scale;const nearby=[];
    const consider=(q,label)=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;point=q.slice();kind=label;}};
    e.doc.paths.forEach((path,pi)=>{if(!e.visible(path))return;path.segments.forEach((s,si)=>{
      if(exclude&&pi===exclude[0]&&si===exclude[1])return;
      if(s.type==='line'||Math.abs(s.extent_deg)<359.999999){consider(this.point(s,0),'端点吸着');consider(this.point(s,1),'端点吸着');}
      if(midpoints&&document.getElementById('snapMidpoint').checked)consider(this.point(s,.5),'中点吸着');
      if(centers&&s.type==='arc'&&document.getElementById('snapCenter').checked)consider(s.center,'中心吸着');
      const distance=e.distance(s,p);if(distance<=10/e.view.scale)nearby.push({s,distance});
    });});
    const segments=nearby.sort((a,b)=>a.distance-b.distance).slice(0,64);
    for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++)for(const q of this.intersections(segments[i].s,segments[j].s))consider(q,'交点吸着');
    return {point,kind};
  }
};
