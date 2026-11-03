// Read-only, bounded geometric checks. Candidate coordinates never enter the document.
window.DraftCandidateEngine={
  collect(paths,options){
    const G=DraftGeometry,o={threshold:5,gapThreshold:0,overlaps:false,overlapTolerance:.25,isolated:false,isolationDistance:3,junctions:false,endpointGaps:true,continuity:false,maxChecks:2000000,...options};
    const result={items:[],buckets:{short:[],duplicate:[],overlap:[],isolated:[],gap:[],junction:[]},short:0,duplicate:0,overlap:0,isolated:0,gap:0,junction:0,gapIncomplete:false,incomplete:false,index:-1,checks:0};
    const add=item=>{result[item.kind]++;if(result.items.length<500)result.items.push(item);if(result.buckets[item.kind].length<500)result.buckets[item.kind].push(item);};
    const group=()=> 'geometry';
    const visible=()=>true;
    const eligible=()=>true;
    const segments=[],endpoints=[],counts=new Map(),seen=new Map();
    paths.forEach((p,pi)=>{if(!visible(p))return;p.segments.forEach((s,si)=>{
      const ref=[pi,si],length=G.length(s),entry={s,ref,length,group:group(p),eligible:eligible(p),bounds:G.bounds(s),id:segments.length};segments.push(entry);
      if(entry.eligible){
        if(length<=o.threshold)add({kind:'short',ref,length});
        if(s.type==='line'){entry.exact=JSON.stringify([entry.group,...[JSON.stringify(s.p0),JSON.stringify(s.p1)].sort()]);if(seen.has(entry.exact))add({kind:'duplicate',ref,reference:seen.get(entry.exact),length});else seen.set(entry.exact,ref);}
      }
      if(s.type==='arc'&&Math.abs(s.extent_deg)>=359.999999)return;
      for(const endpoint of [0,1]){const point=G.point(s,endpoint),key=JSON.stringify([entry.group,...point]);counts.set(key,(counts.get(key)||0)+1);endpoints.push({entry,endpoint,point,key,id:endpoints.length});}
    });});
    if(!o.overlaps&&!o.isolated&&!(o.gapThreshold>0))return result;
    const cellSize=Math.max(16,2*o.gapThreshold,2*o.isolationDistance),cells=new Map(),global=[];let entries=0;
    const overlap=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
    const expand=(b,r)=>[b[0]-r,b[1]-r,b[2]+r,b[3]+r];
    const range=b=>[Math.floor(b[0]/cellSize),Math.floor(b[1]/cellSize),Math.floor(b[2]/cellSize),Math.floor(b[3]/cellSize)];
    for(const s of segments){const [x0,y0,x1,y1]=range(s.bounds),area=(x1-x0+1)*(y1-y0+1);if(area>256||entries+area>500000){global.push(s.id);continue;}for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=`${x}:${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(s.id);entries++;}}
    const query=box=>{
      const [x0,y0,x1,y1]=range(box);let ids;
      if((x1-x0+1)*(y1-y0+1)>4096)ids=segments.map(s=>s.id);
      else{const set=new Set(global);for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const id of cells.get(`${x}:${y}`)||[])set.add(id);ids=set;}
      const found=[];for(const id of ids){if(result.checks>=o.maxChecks){result.incomplete=true;return {found,complete:false};}result.checks++;const s=segments[id];if(overlap(box,s.bounds))found.push(s);}return {found,complete:true};
    };
    if(o.overlaps){
      overlapSearch:for(const a of segments){
        if(!a.eligible||a.s.type!=='line'||a.length<=.01)continue;
        const nearby=query(expand(a.bounds,o.overlapTolerance));if(!nearby.complete)break;
        const u=a.s.p1.map((v,i)=>(v-a.s.p0[i])/a.length),dot=p=>(p[0]-a.s.p0[0])*u[0]+(p[1]-a.s.p0[1])*u[1],cross=p=>Math.abs((p[0]-a.s.p0[0])*u[1]-(p[1]-a.s.p0[1])*u[0]);
        for(const b of nearby.found){
          if(b.id<=a.id||!b.eligible||a.group!==b.group||b.s.type!=='line'||b.length<=.01||a.exact===b.exact)continue;
          const v=b.s.p1.map((n,i)=>(n-b.s.p0[i])/b.length);
          if(Math.abs(u[0]*v[1]-u[1]*v[0])>Math.sin(.5*Math.PI/180)||Math.max(cross(b.s.p0),cross(b.s.p1))>o.overlapTolerance+1e-9)continue;
          const p=dot(b.s.p0),q=dot(b.s.p1),lo=Math.max(0,Math.min(p,q)),hi=Math.min(a.length,Math.max(p,q));
          if(hi-lo<=.01)continue;
          const interval=[(lo-p)/(q-p),(hi-p)/(q-p)].sort((x,y)=>x-y).map(t=>Math.max(0,Math.min(1,t)));
          add({kind:'overlap',ref:b.ref,reference:a.ref,interval,points:interval.map(t=>G.point(b.s,t)),length:(interval[1]-interval[0])*b.length});
          if(result.checks>=o.maxChecks){result.incomplete=true;break overlapSearch;}
        }
      }
    }
    if(o.isolated){
      for(const a of segments){
        if(!a.eligible||a.length>o.threshold)continue;
        const nearby=query(expand(a.bounds,o.isolationDistance));if(!nearby.complete)break;
        let near=false;for(const b of nearby.found){if(a.id===b.id)continue;if(G.distance(a.s,b.s)<=o.isolationDistance+1e-9){near=true;break;}}
        if(!near)add({kind:'isolated',ref:a.ref,length:a.length});
      }
    }
    if(o.gapThreshold>0){
      const free=endpoints.filter(p=>p.entry.eligible&&counts.get(p.key)===1),freeIds=new Set(free.map(p=>p.id)),endCells=new Map();
      for(const p of free){const key=`${Math.floor(p.point[0]/cellSize)}:${Math.floor(p.point[1]/cellSize)}`;if(!endCells.has(key))endCells.set(key,[]);endCells.get(key).push(p);}
      const pairs=new Set(),cos=Math.cos(30*Math.PI/180);
      const faces=(a,p)=>{if(!o.continuity)return true;const d=Math.hypot(p[0]-a.point[0],p[1]-a.point[1]),u=G.outward(a.entry.s,a.endpoint);return d>.01&&(u[0]*(p[0]-a.point[0])+u[1]*(p[1]-a.point[1]))/d>=cos-1e-9;};
      endpointSearch:for(const a of free){
        const nearby=query(expand([a.point[0],a.point[1],a.point[0],a.point[1]],o.gapThreshold));if(!nearby.complete){result.gapIncomplete=true;break;}
        let connected=false,junction=null,junctionDistance=o.gapThreshold+1e-9;
        for(const b of nearby.found){
          if(a.entry.id===b.id||a.entry.group!==b.group)continue;
          const q=G.nearest(b.s,a.point);if(q.distance<=.01){connected=true;break;}
          const interior=b.s.type==='arc'&&Math.abs(b.s.extent_deg)>=359.999999||q.t*b.length>.01&&(1-q.t)*b.length>.01;
          if(o.junctions&&interior&&q.distance<junctionDistance&&faces(a,q.point)){junctionDistance=q.distance;junction={kind:'junction',ref:a.entry.ref,reference:b.ref,endpoint:a.endpoint,points:[a.point.slice(),q.point],length:q.distance};}
        }
        if(connected)continue;
        const [x0,y0,x1,y1]=range(expand([a.point[0],a.point[1],a.point[0],a.point[1]],o.gapThreshold));let best=o.gapThreshold+1e-9,match=null;
        for(let x=x0;o.endpointGaps&&x<=x1;x++)for(let y=y0;y<=y1;y++)for(const b of endCells.get(`${x}:${y}`)||[]){
          if(result.checks>=o.maxChecks){result.incomplete=true;result.gapIncomplete=true;break endpointSearch;}result.checks++;
          if(a.id===b.id||a.entry.id===b.entry.id||a.entry.group!==b.entry.group||!freeIds.has(b.id))continue;
          const distance=Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1]);if(distance>.01&&distance<best&&faces(a,b.point)&&faces(b,a.point)){best=distance;match=b;}
        }
        if(junction&&junctionDistance<best){add(junction);continue;}
        if(match){const key=[Math.min(a.id,match.id),Math.max(a.id,match.id)].join(':');if(pairs.has(key))continue;pairs.add(key);let source=a,target=match;
          if(source.entry.s.type==='arc'&&target.entry.s.type==='line')[source,target]=[target,source];
          add({kind:'gap',ref:source.entry.ref,reference:target.entry.ref,endpoint:source.endpoint,points:[source.point.slice(),target.point.slice()],length:best});
        }else if(junction)add(junction);
      }
    }
    return result;
  }
};
