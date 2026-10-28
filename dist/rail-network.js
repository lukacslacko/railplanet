// Built geometry is immutable. Junctions split graph edges by station, without
// moving the original track or drawing its reused sections a second time.
import {R,unit,dot,tangent,distance,clamp,parameters,planRoute,evaluate} from './rail.js?v=2.3.0';
const clonePoint=p=>({...p,n:p.n.slice()});
export function trackStations(points){let s=0;return points.map((p,i)=>{if(i)s+=distance(points[i-1].n,p.n);return s;});}
export function pointOnTrack(track,station){
 const ss=track.stations||trackStations(track.points),s=clamp(station,0,ss.at(-1));let lo=0,hi=ss.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(ss[mid]<s)lo=mid;else hi=mid;}
 const t=(s-ss[lo])/Math.max(1e-9,ss[hi]-ss[lo]),a=track.points[lo],b=track.points[hi];
 return {...clonePoint(t<.5?a:b),n:unit(a.n.map((v,k)=>v*(1-t)+b.n[k]*t)),h:a.h*(1-t)+b.h*t,station:s,trackId:track.id};
}
export function nearestOnTrack(track,n){
 const ss=track.stations||trackStations(track.points);let best=null;
 for(let i=1;i<track.points.length;i++){
  const a=track.points[i-1].n,b=track.points[i].n,d=b.map((v,k)=>v-a[k]),t=clamp(dot(n.map((v,k)=>v-a[k]),d)/Math.max(1e-20,dot(d,d)),0,1),q=unit(a.map((v,k)=>v+d[k]*t)),gap=distance(n,q);
  if(!best||gap<best.gap)best={...pointOnTrack(track,ss[i-1]+t*(ss[i]-ss[i-1])),gap};
 }
 return best;
}
export function trackSlice(track,from,to){
 const ss=track.stations||trackStations(track.points),a=Math.min(from,to),b=Math.max(from,to),out=[pointOnTrack(track,a)];
 for(let i=1;i<ss.length-1;i++)if(ss[i]>a+.001&&ss[i]<b-.001)out.push({...clonePoint(track.points[i]),station:ss[i]});
 if(b-a>.001)out.push(pointOnTrack(track,b));if(from>to)out.reverse();return out;
}
export class RailNetwork{
 constructor(){this.clear();}
 clear(){this.tracks=[];this.nodes=[];this.routes=[];this.history=[];this.serial=0;}
 snapshot(){return {tracks:this.tracks,nodes:this.nodes,routes:this.routes};}
 restore(s){this.tracks=s.tracks;this.nodes=s.nodes;this.routes=s.routes;}
 beforeLast(){return this.history.at(-1)||this.snapshot();}
 undo(){const s=this.history.pop();if(s)this.restore(s);return !!s;}
 add(result,replace=false){
  const base=replace?this.beforeLast():this.snapshot();for(const part of result.parts||[])if(part.trackId&&!base.tracks.some(t=>t.id===part.trackId))throw Error('A reused track is missing.');
  if(replace)this.undo();this.history.push(this.snapshot());this.tracks=this.tracks.slice();this.nodes=this.nodes.map(n=>({...n,attachments:n.attachments.slice()}));this.routes=this.routes.slice();
  const nodeAt=(p,attachment)=>{
   let node=this.nodes.find(n=>distance(n.n,p.n)<.03&&Math.abs(n.h-p.h)<.03);
   if(!node){node={id:'n'+(++this.serial),n:p.n.slice(),h:p.h,attachments:[]};this.nodes.push(node);}
   if(attachment&&!node.attachments.some(a=>a.trackId===attachment.trackId&&Math.abs(a.station-attachment.station)<.03))node.attachments.push(attachment);return node;
  };
  const parts=result.parts||[{points:result.points}],built=[];
  for(const part of parts){
   if(part.trackId){const track=this.tracks.find(t=>t.id===part.trackId);if(!track)throw Error('A reused track is missing.');nodeAt(pointOnTrack(track,part.from),{trackId:track.id,station:part.from});nodeAt(pointOnTrack(track,part.to),{trackId:track.id,station:part.to});built.push({...part});}
   else if(part.points.length>1){
    const points=part.points.map(p=>{const q=clonePoint(p);delete q.reused;delete q.fixed;return q;}),track={id:'t'+(++this.serial),points,stations:trackStations(points),parameters:result.parameters};this.tracks.push(track);
    // A connector endpoint can also lie in the middle of an older track.
    for(const p of[points[0],points.at(-1)])for(const old of this.tracks){if(old===track)continue;const q=nearestOnTrack(old,p.n);if(q.gap<.03&&Math.abs(q.h-p.h)<.03)nodeAt(p,{trackId:old.id,station:q.station});}
    const a=nodeAt(points[0],{trackId:track.id,station:0}),b=nodeAt(points.at(-1),{trackId:track.id,station:track.stations.at(-1)});built.push({trackId:track.id,from:0,to:track.stations.at(-1),startNode:a.id,endNode:b.id});
   }
  }
  this.routes.push({id:'r'+(++this.serial),parts:built,result});return this.routes.at(-1);
 }
 get length(){return this.tracks.reduce((s,t)=>s+t.stations.at(-1),0);}
}
function connectionDirection(endpoint,toward,network,incoming=false){
 const node=network.nodes.find(n=>n.id===endpoint.nodeId),attachments=node?.attachments||(endpoint.trackId?[endpoint]:[]),desired=tangent(endpoint.n,toward.n).map(v=>incoming?-v:v);let best=null,alignment=-Infinity;
 for(const a of attachments){const track=network.tracks.find(t=>t.id===a.trackId);if(!track)continue;const total=track.stations.at(-1),s=a.station;
  // Original terminal endpoints still have unrestricted city approach headings.
  if(!endpoint.trackId&&(s<.03||total-s<.03)&&attachments.length===1)continue;
  const before=pointOnTrack(track,Math.max(0,s-20)),after=pointOnTrack(track,Math.min(total,s+20)),f=tangent(before.n,after.n);
  const projected=unit(f.map((v,k)=>v-endpoint.n[k]*dot(f,endpoint.n)));
  for(const sign of[-1,1]){const d=projected.map(v=>v*sign),score=dot(d,desired);if(score>alignment){best=d;alignment=score;}}
 }return best;
}
function graphFor(network,start,end,p){
 const tracks=network.tracks,portals=[],byTrack=new Map(tracks.map(t=>[t.id,[]]));
 const add=(point,attachments=[])=>{
  let q=portals.find(q=>distance(q.n,point.n)<.03&&Math.abs(q.h-point.h)<.03);
  if(!q){q={id:portals.length,n:point.n,h:point.h,links:[],attachments:[]};portals.push(q);}
  for(const a of attachments)if(byTrack.has(a.trackId)&&!q.attachments.some(b=>b.trackId===a.trackId&&Math.abs(b.station-a.station)<.03)){q.attachments.push(a);byTrack.get(a.trackId).push({portal:q,station:a.station});}return q;
 };
 for(const n of network.nodes)add(n,n.attachments);
 for(const t of tracks){
  for(const e of[start,end]){const q=nearestOnTrack(t,e.n);for(const offset of[0,-1,1]){const station=clamp(q.station+offset*Math.max(p.minRadius*5,q.gap*2),0,t.stations.at(-1));add(pointOnTrack(t,station),[{trackId:t.id,station}]);}}
  const total=t.stations.at(-1),count=Math.max(1,Math.min(32,Math.ceil(80/tracks.length),Math.ceil(total/10000)));
  for(let j=0;j<=count;j++){const station=total*j/count;add(pointOnTrack(t,station),[{trackId:t.id,station}]);}
 }
 const exact=e=>{
  const n=network.nodes.find(n=>n.id===e.nodeId);if(n)return add(n,n.attachments);
  const t=tracks.find(t=>t.id===e.trackId);if(t)return add(pointOnTrack(t,e.station),[{trackId:t.id,station:e.station}]);return null;
 };
 const ends=[exact(start),exact(end)];
 for(const track of tracks){
  const entries=byTrack.get(track.id).sort((a,b)=>a.station-b.station);
  for(let i=1;i<entries.length;i++){
   const a=entries[i-1],b=entries[i];if(a.portal===b.portal||b.station-a.station<.01)continue;
   // Existing construction is free; distance and running time still count.
   const points=trackSlice(track,a.station,b.station);let cost=0;
   for(let j=1;j<points.length;j++){const ds=distance(points[j-1].n,points[j].n),v=Math.max(1,Math.min(p.speed/3.6,points[j].limit||p.speed/3.6));cost+=ds*(1+p.timeWeight*(p.speed/3.6/v-1));}
   const part={trackId:track.id,from:a.station,to:b.station};a.portal.links.push({to:b.portal.id,cost,part});b.portal.links.push({to:a.portal.id,cost,part:{...part,from:part.to,to:part.from}});
  }
 }
 return {portals,ends};
}
function shortest(graph,start,end){
 const {portals}=graph,cost=new Float64Array(portals.length).fill(Infinity),parent=new Array(portals.length),done=new Set();cost[start.id]=0;
 for(let k=0;k<portals.length;k++){
  let id=-1;for(let i=0;i<cost.length;i++)if(!done.has(i)&&(id<0||cost[i]<cost[id]))id=i;if(id<0||!Number.isFinite(cost[id]))return null;if(id===end.id)break;done.add(id);
  for(const e of portals[id].links)if(cost[id]+e.cost<cost[e.to]){cost[e.to]=cost[id]+e.cost;parent[e.to]={id,part:e.part};}
 }
 if(!Number.isFinite(cost[end.id]))return null;const parts=[];for(let id=end.id;id!==start.id;id=parent[id].id){if(!parent[id])return null;parts.push(parent[id].part);}return {parts:parts.reverse(),cost:cost[end.id]};
}
function assemble(parts,network,world,p){
 const compact=[];for(const part of parts){const last=compact.at(-1);if(part.trackId&&part.trackId===last?.trackId&&Math.abs(last.to-part.from)<.03)last.to=part.to;else compact.push({...part});}parts=compact;
 const points=[];let station=0;
 for(const part of parts){const reused=!!part.trackId,ps=reused?trackSlice(network.tracks.find(t=>t.id===part.trackId),part.from,part.to):part.points;
  for(let i=0;i<ps.length;i++){
   const q={...clonePoint(ps[i]),reused,fixed:reused,sourceTrackId:part.trackId};
   if(points.length){const gap=distance(points.at(-1).n,q.n);if(gap<.005){if(Math.abs(points.at(-1).h-q.h)>.02)return null;if(reused){points.at(-1).fixed=true;points.at(-1).width=q.width;points.at(-1).bridge=q.bridge;}continue;}station+=gap;}
   points.push({...q,station});
  }
 }
 const result=evaluate(points,world,p);return result?{...result,parts,parameters:p,networkScore:result.score+p.reusePreference*result.newLength}:null;
}
export async function planNetworkRoute(start,end,world,options={},network={tracks:[],nodes:[]},hooks={}){
 if(hooks.cancelled?.())throw Error('cancelled');
 if(!world(start.n).land||!world(end.n).land)return {error:'Both endpoints must be on land or existing track.'};
 if(distance(start.n,end.n)<20)return {error:'Choose points at least 20 m apart.'};
 const p=parameters(options),heights=[start.h??world(start.n).height,end.h??world(end.n).height],baseHooks={...hooks,endpointHeights:heights,endpointDirections:[connectionDirection(start,end,network),connectionDirection(end,start,network,true)]};
 let direct=null;
 if(!network.tracks.length){const r=await planRoute(start.n,end.n,world,p,baseHooks);return r.error?r:{...r,parts:[{points:r.points}]};}
 const graph=graphFor(network,start,end,p),choices=e=>graph.portals.map(q=>({q,d:distance(q.n,e.n)})).sort((a,b)=>a.d-b.d).filter((v,i,a)=>!a.slice(0,i).some(o=>distance(o.q.n,v.q.n)<Math.max(500,p.minRadius*3))).slice(0,6).map(v=>v.q);
 const starts=graph.ends[0]?[graph.ends[0]]:choices(start),ends=graph.ends[1]?[graph.ends[1]]:choices(end),candidates=[];
 for(const a of starts)for(const b of ends){if(a===b)continue;const path=shortest(graph,a,b);if(!path?.parts.length)continue;const first=path.parts[0],last=path.parts.at(-1),ta=network.tracks.find(t=>t.id===first.trackId),tb=network.tracks.find(t=>t.id===last.trackId),fa=trackSlice(ta,first.from,first.to),fb=trackSlice(tb,last.from,last.to);const ga=distance(start.n,a.n),gb=distance(end.n,b.n);if(ga>20&&dot(tangent(a.n,start.n).map(v=>-v),tangent(fa[0].n,fa[1].n))<.35||gb>20&&dot(tangent(b.n,end.n),tangent(fb.at(-1).n,fb.at(-2).n).map(v=>-v))<.35)continue;const lower=(ga+gb)*(1+p.reusePreference)+path.cost;candidates.push({a,b,path,lower});}
 candidates.sort((a,b)=>a.lower-b.lower);
 // A completely existing path needs no terrain search. Validate it first.
 for(const c of candidates.filter(c=>c.a===graph.ends[0]&&c.b===graph.ends[1])){const r=assemble(c.path.parts,network,world,p);if(r){direct=r;break;}}
 if(!direct||p.reusePreference===0||direct.length>distance(start.n,end.n)*1.1){const r=await planRoute(start.n,end.n,world,p,baseHooks);if(!r.error){const v={...r,parts:[{points:r.points}],networkScore:r.score+p.reusePreference*r.length};if(!direct||v.networkScore<direct.networkScore)direct=v;}else if(!candidates.length)return r;}
 if(hooks.cancelled?.())throw Error('cancelled');const cache=new Map();
 for(const c of candidates.slice(0,3)){
  if(direct&&c.lower>direct.networkScore*1.05)continue;
  hooks.progress?.('Connecting to existing track',0,1);
  const reused=c.path.parts,firstTrack=network.tracks.find(t=>t.id===reused[0].trackId),lastTrack=network.tracks.find(t=>t.id===reused.at(-1).trackId),first=trackSlice(firstTrack,reused[0].from,reused[0].to),last=trackSlice(lastTrack,reused.at(-1).from,reused.at(-1).to),parts=[];let valid=true;
  for(const side of[0,1]){
   const endpoint=side?end:start,portal=side?c.b:c.a,gap=distance(endpoint.n,portal.n);if(gap<.01)continue;
   if(gap<20){valid=false;break;}
   const direction=side?tangent(last.at(-1).n,last.at(-2).n).map(v=>-v):tangent(first[0].n,first[1].n),key=side+':'+portal.id+':'+direction.map(v=>v.toFixed(5)).join(',');
   if(!cache.has(key)){
    const a=side?portal:endpoint,b=side?endpoint:portal;
    const r=await planRoute(a.n,b.n,world,p,{...hooks,endpointHeights:[a.h??world(a.n).height,b.h??world(b.n).height],endpointDirections:side?[direction,baseHooks.endpointDirections[1]]:[baseHooks.endpointDirections[0],direction]});cache.set(key,r);
   }
   const r=cache.get(key);if(r.error){valid=false;break;}if(side)parts.push(...reused,{points:r.points});else parts.push({points:r.points});
  }
  if(!valid)continue;if(!parts.some(part=>part.trackId))parts.push(...reused);
  const r=assemble(parts,network,world,p);if(r&&(!direct||r.networkScore<direct.networkScore))direct=r;
  await new Promise(resolve=>setTimeout(resolve,0));if(hooks.cancelled?.())throw Error('cancelled');
 }
 return direct||{error:'No route found within these limits, including connections to existing track. Try different endpoints or routing limits.'};
}
