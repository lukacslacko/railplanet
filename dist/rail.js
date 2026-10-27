// Railway metrics, engineering validation, and a continuous-heading fallback.
import {R} from './scale.js?v=2.2.0';
export {R} from './scale.js?v=2.2.0';
export const DEFAULTS=Object.freeze({speed:120,maxGrade:.03,minRadius:300,maxEarthwork:60,earthworkCost:.025,timeWeight:.6,maxBridge:300,bridgeCost:5,passPreference:1});
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit=v=>{const r=Math.hypot(...v);return v.map(x=>x/r);};
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const angle=(a,b)=>Math.atan2(Math.hypot(...cross(a,b)),clamp(dot(a,b),-1,1));
export const distance=(a,b)=>angle(a,b)*R;
export function rotate(v,axis,a){const c=Math.cos(a),s=Math.sin(a),k=dot(axis,v),t=cross(axis,v);return v.map((x,i)=>x*c+t[i]*s+axis[i]*k*(1-c));}
export function tangent(a,b){const k=dot(a,b),v=b.map((x,i)=>x-a[i]*k);return Math.hypot(...v)>1e-9?unit(v):unit(cross(a,Math.abs(a[1])<.9?[0,1,0]:[1,0,0]));}
export function parameters(p={}){return {speed:clamp(+p.speed||120,40,200),maxGrade:clamp(+p.maxGrade||.03,.005,.1),minRadius:clamp(+p.minRadius||300,80,2000),maxEarthwork:clamp(Number.isFinite(+p.maxEarthwork)?+p.maxEarthwork:60,0,150),earthworkCost:clamp(Number.isFinite(+p.earthworkCost)?+p.earthworkCost:.025,.001,.15),timeWeight:clamp(Number.isFinite(+p.timeWeight)?+p.timeWeight:.6,0,2),maxBridge:clamp(Number.isFinite(+p.maxBridge)?+p.maxBridge:300,0,1500),bridgeCost:clamp(+p.bridgeCost||5,1,30),passPreference:clamp(Number.isFinite(+p.passPreference)?+p.passPreference:1,0,2)};}
export function speedLimit(grade,curvature,p){
  const cruise=p.speed/3.6,curve=curvature>1e-10?Math.sqrt(.65/curvature):cruise;
  const slope=cruise/(1+.45*(Math.abs(grade)/.015)**1.5);
  return Math.min(cruise,curve,slope);
}
export function area(depth,slope=0){
  const d=Math.abs(depth),s=Math.abs(slope),edge=4*s,width=6+1.5*(d+edge);
  const formation=s>1e-8&&d<edge?(d*d+edge*edge)/s:8*d;
  return formation+.5*(width-4)*(Math.abs(depth-edge)+Math.abs(depth+edge));
}
// Open cuts may go below ground; elevated sections can use a viaduct.
// Water classification excludes river masks, so rivers never add routing cost.
export function construction(depth,slope,p){
  const edge=4*Math.abs(slope),work=Math.abs(depth)+edge;
  const bridge=depth-edge>2 && depth+edge<=p.maxBridge+.1 &&
    (work>p.maxEarthwork+.1 || depth>8 && p.earthworkCost*area(depth,slope)>p.bridgeCost+.025*depth);
  if(bridge)return {bridge:true,width:4.5,cost:p.bridgeCost+.025*depth,area:0,work:0};
  if(work>p.maxEarthwork+.1)return null;
  return {bridge:false,width:6+1.5*work,cost:p.earthworkCost*area(depth,slope),area:area(depth,slope),work};
}
export function motion(n,forward,length,turn,spacing=40){
  // A constant geodesic curvature is an exact rotation about a fixed world axis.
  // Evaluating it analytically keeps search and render stations identical even
  // when they use different sampling densities.
  const side=cross(n,forward),k=turn/length,omega=side.map((v,i)=>v/R+n[i]*k),rate=Math.hypot(...omega),axis=omega.map(v=>v/rate);
  const steps=Math.max(2,Math.ceil(length/spacing)),points=[];
  for(let i=1;i<=steps;i++){const s=length*i/steps;points.push({n:unit(rotate(n,axis,rate*s)),f:unit(rotate(forward,axis,rate*s)),s});}
  return points;
}

class Heap{
  constructor(){this.a=[];}
  push(v){const a=this.a;let i=a.length;a.push(v);while(i){const j=(i-1)>>1;if(a[j].priority<=v.priority)break;a[i]=a[j];i=j;}a[i]=v;}
  pop(){const a=this.a,first=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].priority<a[j].priority)j++;if(a[j].priority>=v.priority)break;a[i]=a[j];i=j;}a[i]=v;}return first;}
  get size(){return this.a.length;}
}
function stateKey(n,f,h,spacing,p){
  const east=unit(cross(Math.abs(n[1])<.999?[0,1,0]:[1,0,0],n)),north=cross(n,east);
  const heading=Math.round(Math.atan2(dot(f,east),dot(f,north))*48/(2*Math.PI));
  const cell=spacing*.6/R,height=Math.max(1,spacing*p.maxGrade*.4);
  return `${Math.round(n[0]/cell)},${Math.round(n[1]/cell)},${Math.round(n[2]/cell)},${heading},${Math.round(h/height)}`;
}
function corridorTest(points,width){
  if(!points)return ()=>true;
  const cell=width/R,bins=new Map();
  for(const p of points){const k=p.n.map(x=>Math.round(x/cell));const key=k.join(',');if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p.n);}
  return n=>{const k=n.map(x=>Math.round(x/cell)),threshold=(width/R)**2;
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const p of bins.get([k[0]+x,k[1]+y,k[2]+z].join(','))||[])if((n[0]-p[0])**2+(n[1]-p[1])**2+(n[2]-p[2])**2<threshold)return true;
    return false;
  };
}
function connector(node,goal,goalHeight,world,p){
  const length=distance(node.n,goal);if(length<.01)return Math.abs(node.h-goalHeight)<.01?[]:null;
  const chord=tangent(node.n,goal),alpha=Math.atan2(dot(cross(node.f,chord),node.n),dot(node.f,chord));
  if(Math.abs(alpha)>1.0)return null;
  const endForward=unit(rotate(tangent(goal,node.n).map(x=>-x),goal,alpha));
  const controlLength=length/3/Math.max(.6,Math.cos(alpha/2));
  const p0=node.n.map(x=>x*R),p3=goal.map(x=>x*R),p1=p0.map((x,i)=>x+node.f[i]*controlLength),p2=p3.map((x,i)=>x-endForward[i]*controlLength);
  const count=Math.max(3,Math.ceil(length/15)),points=[];let previous=node.n,total=0;
  for(let i=1;i<=count;i++){
    const t=i/count,u=1-t,n=i===count?goal.slice():unit(p0.map((x,k)=>x*u**3+3*p1[k]*u*u*t+3*p2[k]*u*t*t+p3[k]*t**3));
    total+=distance(previous,n);points.push({n,s:total});previous=n;
  }
  const grade=(goalHeight-node.h)/total;if(Math.abs(grade)>p.maxGrade+1e-8)return null;
  let f=node.f,prior=node.n,previousLength=distance(prior,points[0].n);
  for(let i=0;i<points.length;i++){
    const point=points[i],sample=world(point.n);if(!sample.land)return null;
    point.h=node.h+grade*point.s;point.ground=sample.height;
    if(Math.abs(point.h-sample.height)>p.maxEarthwork+.01)return null;
    const next=i+1<points.length?tangent(point.n,points[i+1].n):endForward;
    const incoming=tangent(point.n,prior).map(x=>-x),ds=distance(prior,point.n);
    const k=angle(incoming,next)/Math.max(1,(ds+(i+1<points.length?distance(point.n,points[i+1].n):ds))/2);
    if(k>1/p.minRadius*1.0001)return null;
    if(i===0&&angle(f,tangent(prior,point.n))/Math.max(1,previousLength/2)>1/p.minRadius*1.0001)return null;
    point.f=next;point.limit=speedLimit(grade,k,p);prior=point.n;f=next;
  }
  return points;
}
function reconstruct(node,world){
  const chain=[];for(let n=node;n.parent;n=n.parent)chain.push(n);chain.reverse();
  let root=node;while(root.parent)root=root.parent;
  const points=[{n:root.n.slice(),f:root.f.slice(),h:root.h,ground:root.h,station:0}];
  let station=0;
  for(const child of chain){
    const parent=child.parent;
    if(child.connection){for(const p of child.connection)points.push({...p,station:station+p.s});station=points.at(-1).station;continue;}
    for(const point of motion(parent.n,parent.f,child.length,child.turn,20))points.push({...point,h:parent.h+child.grade*point.s,ground:world(point.n).height,station:station+point.s});
    station+=child.length;
  }
  return points;
}
// Validate at <= 10 m station spacing, including the formation's side slopes.
// This is independent of the lower-resolution search and rejects unsafe results.
export function evaluate(points,world,p,{footprint=true}={}){
  if(points.length<2)return null;
  const limits=new Float64Array(points.length).fill(p.speed/3.6),lengths=new Float64Array(points.length),grades=new Float64Array(points.length);
  let length=0,volume=0,cut=0,fill=0,maxGrade=0,maxWork=0,minRadius=Infinity,bridgeLength=0,maxBridgeHeight=0,bridgeCost=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],ds=Number.isFinite(b.station)&&Number.isFinite(a.station)?b.station-a.station:distance(a.n,b.n);if(ds<.001)continue;
    const grade=(b.h-a.h)/ds;if(Math.abs(grade)>p.maxGrade+1e-6)return null;
    lengths[i]=ds;grades[i]=grade;length+=ds;maxGrade=Math.max(maxGrade,Math.abs(grade));
    let k=0;if(i<points.length-1){const incoming=tangent(b.n,a.n).map(v=>-v),outgoing=tangent(b.n,points[i+1].n);k=angle(incoming,outgoing)/Math.max(1,(ds+distance(b.n,points[i+1].n))/2);}
    if(k>1/p.minRadius*1.0001)return null;
    if(k>1e-7)minRadius=Math.min(minRadius,1/k);
    const limit=speedLimit(grade,k,p);limits[i]=Math.min(limits[i],limit);limits[i-1]=Math.min(limits[i-1],limit);
    const samples=Math.max(1,Math.ceil(ds/10)),f=tangent(a.n,b.n),side=unit(cross(a.n,f));
    for(let j=1;j<=samples;j++){
      const t=j/samples,n=unit(a.n.map((x,k)=>x*(1-t)+b.n[k]*t)),h=a.h+(b.h-a.h)*t,s=world(n),depth=h-s.height;
      if(!s.land)return null;
      const plus=world(unit(n.map((x,k)=>x+side[k]*4/R))).height,minus=world(unit(n.map((x,k)=>x-side[k]*4/R))).height,crossSlope=(plus-minus)/8;
      const build=construction(depth,crossSlope,p);if(!build)return null;
      const width=build.width;
      if(build.bridge){bridgeLength+=ds/samples;maxBridgeHeight=Math.max(maxBridgeHeight,depth);bridgeCost+=build.cost*ds/samples;}
      if(footprint)for(const sign of [-1,-.5,.5,1])if(!world(unit(n.map((x,k)=>x+side[k]*width/R*sign))).land)return null;
      const v=build.area*ds/samples;volume+=v;const net=(width+4)*depth*ds/samples;if(!build.bridge){cut+=Math.max(0,(v-net)/2);fill+=Math.max(0,(v+net)/2);}maxWork=Math.max(maxWork,build.work);
    }
  }
  // Junctions and grade-separated self-crossings are not modeled yet.
  // A spatial hash rejects overlapping formations, including viaducts.
  const occupied=new Map();let station=0;
  for(let i=0;i<points.length;i++){
    const point=points[i];if(i)station+=lengths[i];const heading=tangent(point.n,points[i+1<points.length?i+1:i-1].n),side=unit(cross(point.n,heading)),plus=world(unit(point.n.map((x,k)=>x+side[k]*4/R))).height,minus=world(unit(point.n.map((x,k)=>x-side[k]*4/R))).height,build=construction(point.h-world(point.n).height,(plus-minus)/8,p);if(!build)return null;const width=build.width;point.width=width;point.bridge=build.bridge;
    if(footprint&&(i===0||i===points.length-1))for(let j=0;j<12;j++){const a=j*Math.PI/6,n=unit(point.n.map((v,k)=>v+(heading[k]*Math.cos(a)+side[k]*Math.sin(a))*width/R));if(!world(n).land)return null;}
    const cell=point.n.map(v=>Math.floor(v*R/512));
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const other of occupied.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[]){
      if(station-other.station<Math.max(80,width+other.width+30))continue;
      const radius=width+other.width+15;if(point.n.reduce((sum,v,k)=>sum+(v-other.n[k])**2,0)*R*R<radius*radius)return null;
    }
    const key=cell.join(',');if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push({n:point.n,station,width});
  }
  // Avoid vertical-curve jolts as well as horizontal curvature slowdowns.
  for(let i=2;i<points.length;i++){
    const k=Math.abs(grades[i]-grades[i-1])/Math.max(1,(lengths[i]+lengths[i-1])/2);
    if(k>1e-9)limits[i-1]=Math.min(limits[i-1],Math.sqrt(.25/k));
  }
  const speeds=Float64Array.from(limits);speeds[0]=speeds[speeds.length-1]=0;
  for(let i=1;i<speeds.length;i++)speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i-1]**2+2*.55*lengths[i]));
  for(let i=speeds.length-2;i>=0;i--)speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i+1]**2+2*.7*lengths[i+1]));
  let seconds=0,changes=0;
  for(let i=1;i<speeds.length;i++){seconds+=2*lengths[i]/Math.max(.05,speeds[i]+speeds[i-1]);changes+=Math.abs(limits[i]-limits[i-1]);}
  const score=length+p.timeWeight*(seconds*p.speed/3.6-length)+p.earthworkCost*volume+bridgeCost+changes*8;
  for(let i=0;i<points.length;i++){points[i].limit=limits[i];points[i].speed=speeds[i];}
  return {points,length,seconds,volume,cut,fill,maxGrade,maxWork,minRadius,bridgeLength,maxBridgeHeight,bridgeCost,score};
}
async function search(start,goal,world,p,{spacing,budget,corridor=null,corridorWidth=2500,progress=()=>{},cancelled=()=>false,alternatives=1}){
  const startHeight=world(start).height,goalHeight=world(goal).height,inside=corridorTest(corridor,corridorWidth);
  const heap=new Heap(),best=new Map(),solutions=[],signatures=new Set(),direct=distance(start,goal);
  const lowerBound=Math.max(direct,Math.abs(goalHeight-startHeight)/p.maxGrade),costLimit=lowerBound*6+10000;
  const initial=tangent(start,goal),maxTurn=Math.min(.7,spacing/(p.minRadius*1.01)),sampleSpacing=Math.min(35,spacing/6);
  const add=node=>{if(node.g+Math.max(distance(node.n,goal),Math.abs(goalHeight-node.h)/p.maxGrade)>costLimit)return;const key=stateKey(node.n,node.f,node.h,spacing,p),old=best.get(key);if(old&&old.g<=node.g)return;node.key=key;node.priority=node.g+1.6*Math.max(distance(node.n,goal),Math.abs(goalHeight-node.h)/p.maxGrade);best.set(key,node);heap.push(node);};
  for(let i=0;i<32;i++)add({n:start.slice(),f:rotate(initial,start,i*2*Math.PI/32),h:startHeight,g:0,v:p.speed/3.6,grade:0,parent:null});
  let expanded=0,firstSolution=-1;
  while(heap.size&&expanded<budget){
    const node=heap.pop();if(best.get(node.key)!==node)continue;
    const remaining=distance(node.n,goal);expanded++;
    if(remaining<spacing*2.5){
      const connection=connector(node,goal,goalHeight,world,p);
      if(connection){
        const end={...node,n:goal,h:goalHeight,parent:node,connection},points=reconstruct(end,world),result=evaluate(points,world,p);
        if(result){
          const mid=points[Math.floor(points.length*.5)].n,signature=mid.map(x=>Math.round(x*R/Math.max(400,spacing*2))).join(',');
          if(!signatures.has(signature)){solutions.push(result);signatures.add(signature);if(firstSolution<0)firstSolution=expanded;}
          if(solutions.length>=alternatives)break;
        }
      }
    }
    if(firstSolution>=0&&expanded-firstSolution>2200)break;
    if(node.g>direct*35+20000)continue;
    const desired=tangent(node.n,goal),yaw=Math.atan2(dot(cross(node.f,desired),node.n),dot(node.f,desired));
    // Include local contour-following headings, not just a fixed steering lattice.
    // This matters when a shallow railway must climb a steep mountainside.
    const left=unit(cross(node.n,node.f)),offset=(axis,sign)=>unit(node.n.map((x,k)=>x+axis[k]*50/R*sign));
    const gf=(world(offset(node.f,1)).height-world(offset(node.f,-1)).height)/100,gl=(world(offset(left,1)).height-world(offset(left,-1)).height)/100,gm=Math.hypot(gf,gl);
    const want=clamp((goalHeight-node.h)/Math.max(remaining,spacing*4),-p.maxGrade,p.maxGrade),adaptive=[];
    if(gm>.001){const ga=Math.atan2(gl,gf),d=Math.acos(clamp(want/gm,-1,1));for(const target of[ga-d,ga+d]){const a=Math.atan2(Math.sin(target),Math.cos(target));adaptive.push(clamp(a,-maxTurn,maxTurn));}}
    const turns=[-maxTurn,-maxTurn/2,0,maxTurn/2,maxTurn,clamp(yaw,-maxTurn,maxTurn),...adaptive].filter((x,i,a)=>a.findIndex(y=>Math.abs(x-y)<.01)===i);
    for(const turn of turns){
      const geometry=motion(node.n,node.f,spacing,turn,sampleSpacing),end=geometry[geometry.length-1];
      if(!inside(end.n))continue;
      const crossSlope=gl*Math.cos(turn/2)-gf*Math.sin(turn/2),earthLimit=Math.max(0,p.maxEarthwork-2-4*Math.abs(crossSlope));
      let lo=-p.maxGrade,hi=p.maxGrade,valid=true;
      for(const point of geometry){
        const s=world(point.n);if(!s.land){valid=false;break;}point.ground=s.height;
        lo=Math.max(lo,(s.height-earthLimit-node.h)/point.s);hi=Math.min(hi,(s.height+earthLimit-node.h)/point.s);
        if(lo>hi+1e-10){valid=false;break;}
      }
      if(!valid)continue;
      const groundGrade=(end.ground-node.h)/spacing,goalGrade=(goalHeight-node.h)/Math.max(spacing,remaining);
      const grades=[clamp(node.grade,lo,hi),clamp(groundGrade,lo,hi),clamp(goalGrade,lo,hi),clamp(0,lo,hi),lo,hi,(lo+hi)/2].filter((x,i,a)=>a.findIndex(y=>Math.abs(x-y)<.0015)===i);
      for(const grade of grades){
        let volume=0;for(const point of geometry)volume+=area(node.h+grade*point.s-point.ground,crossSlope)*spacing/geometry.length;
        const v=speedLimit(grade,Math.abs(turn)/spacing,p),timeCost=p.timeWeight*spacing*(p.speed/3.6/v-1),transition=8*Math.abs(v-node.v)+spacing*.12*Math.abs(grade-node.grade)/p.maxGrade;
        const g=node.g+spacing+timeCost+p.earthworkCost*volume+transition;
        add({n:end.n,f:end.f,h:node.h+grade*spacing,g,v,grade,parent:node,length:spacing,turn});
      }
    }
    if(expanded%500===0){
      if(heap.size>40000){const live=heap.a.filter(n=>best.get(n.key)===n).sort((a,b)=>a.priority-b.priority),keep=new Set(live.slice(0,24000));for(const n of live)if(!keep.has(n))best.delete(n.key);heap.a=live.slice(0,24000);}
      progress(expanded,budget);await new Promise(resolve=>setTimeout(resolve,0));if(cancelled())throw Error('cancelled');}
  }
  return {solutions,expanded,exhausted:!heap.size};
}
export async function hybridRoute(start,goal,world,options={},hooks={}){
  const p=parameters(options),progress=hooks.progress||(()=>{}),cancelled=hooks.cancelled||(()=>false);
  if(!world(start).land||!world(goal).land)return {error:'Both endpoints must be on land.'};
  for(const endpoint of[start,goal]){
    const forward=tangent(endpoint,endpoint===start?goal:start),side=cross(endpoint,forward);
    for(let i=0;i<12;i++){const a=i*Math.PI/6,n=unit(endpoint.map((v,k)=>v+(forward[k]*Math.cos(a)+side[k]*Math.sin(a))*6/R));if(!world(n).land)return {error:'Choose endpoints at least 6 m inland so the formation stays out of water.'};}
  }
  const direct=distance(start,goal);if(direct<20)return {error:'Choose points at least 20 m apart.'};
  const spacing=clamp(direct/28,150,650);
  const coarse=await search(start,goal,world,p,{spacing,budget:42000,alternatives:3,cancelled,progress:(n,max)=>progress('Coarse alternatives',n,max)});
  if(!coarse.solutions.length)return {error:'No feasible route found within the search budget. Try closer endpoints, a higher grade limit, or more earthwork.',expanded:coarse.expanded};
  let candidates=coarse.solutions.sort((a,b)=>a.score-b.score),expanded=coarse.expanded;
  for(let i=0;i<Math.min(2,candidates.length);i++){
    const guide=candidates[i];
    const fine=await search(start,goal,world,p,{spacing:Math.max(70,spacing/2.5),budget:16000,corridor:guide.points,corridorWidth:Math.max(800,spacing*3),cancelled,progress:(n,max)=>progress(`Refining corridor ${i+1}`,n,max)});
    expanded+=fine.expanded;candidates.push(...fine.solutions);
  }
  candidates.sort((a,b)=>a.score-b.score);const result=candidates[0];
  return {...result,expanded,alternatives:candidates.length,parameters:p};
}

export async function planRoute(start,goal,world,options={},hooks={}){
  const p=parameters(options);
  if(!world(start).land||!world(goal).land)return {error:'Both endpoints must be on land.'};
  if(distance(start,goal)<20)return {error:'Choose points at least 20 m apart.'};
  const {hierarchicalRoute,improvePasses}=await import('./rail-corridor.js?v=2.2.0');
  const result=await hierarchicalRoute(start,goal,world,p,hooks);
  if(result)return {...result,parameters:p};
  // A continuous-heading fallback is useful for short, unusually tight corridors.
  if(distance(start,goal)<20000){const fallback=await hybridRoute(start,goal,world,p,hooks);if(!fallback.error)return improvePasses(fallback,start,goal,world,p,hooks);}
  return {error:'No route found within these limits. Land may be disconnected, or the grade/cut/bridge limits may need increasing. The bounded search does not prove a route is impossible.'};
}
