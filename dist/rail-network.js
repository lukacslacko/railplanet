// Built geometry is immutable. Junctions split graph edges by station, without
// moving the original track or drawing its reused sections a second time.
import {R,unit,dot,tangent,distance,clamp,parameters,planRoute,evaluate} from './rail.js?v=2.5.0';
const clonePoint=p=>({...p,n:p.n.slice()});
export function trackStations(points){let s=0;return points.map((p,i)=>{if(i)s+=distance(points[i-1].n,p.n);return s;});}
export function pointOnTrack(track,station){
 const ss=track.stations||trackStations(track.points),s=clamp(station,0,ss.at(-1));let lo=0,hi=ss.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(ss[mid]<s)lo=mid;else hi=mid;}
 const t=(s-ss[lo])/Math.max(1e-9,ss[hi]-ss[lo]),a=track.points[lo],b=track.points[hi];
 return {...clonePoint(t<.5?a:b),n:unit(a.n.map((v,k)=>v*(1-t)+b.n[k]*t)),h:a.h*(1-t)+b.h*t,station:s,trackId:track.id};
}
export function nearestOnTrack(track,n){
 const ss=track.stations||trackStations(track.points);let best=Infinity,station=0;
 for(let i=1;i<track.points.length;i++){
  const a=track.points[i-1].n,b=track.points[i].n,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],t=clamp(((n[0]-a[0])*dx+(n[1]-a[1])*dy+(n[2]-a[2])*dz)/Math.max(1e-20,dx*dx+dy*dy+dz*dz),0,1);
  const x=a[0]+dx*t,y=a[1]+dy*t,z=a[2]+dz*t,r=Math.hypot(x,y,z),gap=(x/r-n[0])**2+(y/r-n[1])**2+(z/r-n[2])**2;
  if(gap<best){best=gap;station=ss[i-1]+t*(ss[i]-ss[i-1]);}
 }
 const q=pointOnTrack(track,station);return {...q,gap:distance(n,q.n)};
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
function graphFor(network,start,end,p,corridor=[]){
 const tracks=network.tracks,portals=[],byTrack=new Map(tracks.map(t=>[t.id,[]]));
 const add=(point,attachments=[],force=false)=>{
  let q=portals.find(q=>distance(q.n,point.n)<.03&&Math.abs(q.h-point.h)<.03);
  if(!q){if(!force&&portals.length>=Math.max(256,network.nodes.length+128))return null;q={id:portals.length,n:point.n,h:point.h,links:[],attachments:[]};portals.push(q);}
  for(const a of attachments)if(byTrack.has(a.trackId)&&!q.attachments.some(b=>b.trackId===a.trackId&&Math.abs(b.station-a.station)<.03)){q.attachments.push(a);byTrack.get(a.trackId).push({portal:q,station:a.station});}return q;
 };
 for(const n of network.nodes)add(n,n.attachments,true);
 // Reserve joining positions across all tracks in rounds. Filling the global
 // budget from one old line first used to starve later lines in a busy network.
 const rounds=[[],[],[]];
 for(const t of tracks){
  const endpoints=[],uniform=[],corridorJoins=[],total=t.stations.at(-1);
  for(const e of[start,end]){const q=nearestOnTrack(t,e.n);for(const offset of[0,-1,1])endpoints.push(clamp(q.station+offset*Math.max(p.minRadius*5,q.gap*2),0,total));}
  const count=Math.max(1,Math.min(32,Math.ceil(80/tracks.length),Math.ceil(total/10000)));for(let j=0;j<=count;j++)uniform.push(total*j/count);
  const stride=Math.max(1,Math.floor(corridor.length/64)),reach=Math.max(1500,Math.min(18000,distance(start.n,end.n)*.18));
  for(let i=0;i<corridor.length;i+=stride){const q=nearestOnTrack(t,corridor[i].n);if(q.gap>reach)continue;for(const sign of[0,-1,1])corridorJoins.push(clamp(q.station+sign*Math.max(p.minRadius*4,q.gap),0,total));}
  for(const [phase,stations]of[[0,endpoints],[1,uniform],[2,corridorJoins]])rounds[phase].push({track:t,stations});
 }
 for(const phase of rounds)for(let i=0;phase.some(entry=>i<entry.stations.length);i++)for(const {track,stations}of phase){if(i>=stations.length)continue;const station=stations[i];add(pointOnTrack(track,station),[{trackId:track.id,station}]);}
 const exact=e=>{
  const n=network.nodes.find(n=>n.id===e.nodeId);if(n)return add(n,n.attachments,true);
  const t=tracks.find(t=>t.id===e.trackId);if(t)return add(pointOnTrack(t,e.station),[{trackId:t.id,station:e.station}],true);return null;
 };
 const ends=[exact(start),exact(end)];
 for(const track of tracks){
  const entries=byTrack.get(track.id).sort((a,b)=>a.station-b.station);
  for(let i=1;i<entries.length;i++){
   const a=entries[i-1],b=entries[i];if(a.portal===b.portal||b.station-a.station<.01)continue;
   // Existing construction is free; distance and running time still count.
   const points=trackSlice(track,a.station,b.station);let cost=0;
   for(let j=1;j<points.length;j++){const ds=distance(points[j-1].n,points[j].n),v=Math.max(1,Math.min(p.speed/3.6,points[j].limit||p.speed/3.6));cost+=ds*(1+p.timeWeight*(p.speed/3.6/v-1));}
   const part={trackId:track.id,from:a.station,to:b.station},departure=tangent(points[0].n,points[1].n),arrival=tangent(points.at(-1).n,points.at(-2).n).map(v=>-v);a.portal.links.push({to:b.portal.id,cost,part,departure,arrival});b.portal.links.push({to:a.portal.id,cost,part:{...part,from:part.to,to:part.from},departure:arrival.map(v=>-v),arrival:departure.map(v=>-v)});
  }
 }
 return {portals,ends};
}
function shortestTree(graph,start){
 const {portals}=graph,cost=new Float64Array(portals.length).fill(Infinity),parent=new Array(portals.length),first=new Array(portals.length),done=new Uint8Array(portals.length);cost[start.id]=0;
 for(let k=0;k<portals.length;k++){
  let id=-1;for(let i=0;i<cost.length;i++)if(!done[i]&&(id<0||cost[i]<cost[id]))id=i;if(id<0||!Number.isFinite(cost[id]))break;done[id]=1;
  for(const e of portals[id].links)if(cost[id]+e.cost<cost[e.to]){cost[e.to]=cost[id]+e.cost;parent[e.to]={id,edge:e};first[e.to]=id===start.id?e:first[id];}
 }return {cost,parent,first};
}
function pathFrom(tree,start,end){
 if(!Number.isFinite(tree.cost[end.id]))return null;const parts=[];
 for(let id=end.id;id!==start.id;id=tree.parent[id].id){if(!tree.parent[id])return null;parts.push(tree.parent[id].edge.part);}return parts.reverse();
}
function networkCandidates(graph,start,end,p){
 const weight=1+p.reusePreference,choices=(a,b)=>graph.portals.length<=320?graph.portals:graph.portals.map(q=>({q,rank:distance(a.n,q.n)*weight+distance(q.n,b.n)})).sort((a,b)=>a.rank-b.rank).slice(0,64).map(x=>x.q);
 const starts=graph.ends[0]?[graph.ends[0]]:choices(start,end),ends=graph.ends[1]?[graph.ends[1]]:choices(end,start),out=[];
 for(const a of starts){const ga=distance(start.n,a.n),tree=shortestTree(graph,a);
  for(const b of ends){if(a===b||!tree.first[b.id])continue;const gb=distance(end.n,b.n),lower=(ga+gb)*weight+tree.cost[b.id],entry=tree.first[b.id].departure,exit=tree.parent[b.id].edge.arrival;
   // Poorly aligned joins cost more to try, but remain candidates: a curved
   // approach can work even when the straight chord is perpendicular.
   const bend=(ga>20?1-dot(tangent(a.n,start.n).map(v=>-v),entry):0)+(gb>20?1-dot(tangent(b.n,end.n),exit):0);
   out.push({a,b,tree,lower,rank:lower+Math.max(p.minRadius*8,Math.min(ga,gb)*.15)*bend,entry,exit});
  }
 }
 out.sort((a,b)=>a.rank-b.rank);const selected=[],spacing=Math.max(1000,p.minRadius*4);
 for(const c of out){if(selected.some(q=>distance(q.a.n,c.a.n)<spacing&&distance(q.b.n,c.b.n)<spacing))continue;
  if(!graph.ends[0]&&selected.filter(q=>distance(q.a.n,c.a.n)<spacing).length>=3||!graph.ends[1]&&selected.filter(q=>distance(q.b.n,c.b.n)<spacing).length>=3)continue;
  selected.push(c);if(selected.length===12)break;
 }return selected;
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
async function searchNetworkRoute(start,end,world,options={},network={tracks:[],nodes:[]},hooks={}){
 if(hooks.cancelled?.())throw Error('cancelled');
 if(!world(start.n).land||!world(end.n).land)return {error:'Both endpoints must be on land or existing track.'};
 if(distance(start.n,end.n)<20)return {error:'Choose points at least 20 m apart.'};
 const p=parameters(options),heights=[start.h??world(start.n).height,end.h??world(end.n).height],baseHooks={...hooks,endpointHeights:heights,endpointDirections:[connectionDirection(start,end,network),connectionDirection(end,start,network,true)]};
 if(!network.tracks.length){const r=await planRoute(start.n,end.n,world,p,baseHooks);return r.error?r:{...r,parts:[{points:r.points}]};}
 let direct=null,terrain=null;const initial=graphFor(network,start,end,p);
 if(initial.ends.every(Boolean)){
  const parts=pathFrom(shortestTree(initial,initial.ends[0]),...initial.ends);if(parts?.length)direct=assemble(parts,network,world,p);
  if(direct&&p.reusePreference>0&&direct.length<=distance(start.n,end.n)*1.1)return direct;
 }
 terrain=await planRoute(start.n,end.n,world,p,baseHooks);
 if(!terrain.error){const r={...terrain,parts:[{points:terrain.points}],networkScore:terrain.score+p.reusePreference*terrain.length};if(!direct||r.networkScore<direct.networkScore)direct=r;}
 if(hooks.cancelled?.())throw Error('cancelled');
 if(!terrain.error&&p.reusePreference){
  const {shareCorridors}=await import('./rail-share.js?v=2.5.0'),shared=await shareCorridors(terrain,network,world,p,hooks,{nearestOnTrack,pointOnTrack,assemble});
  if(shared&&(!direct||shared.networkScore<direct.networkScore))direct=shared;
 }
 const corridor=terrain.error?[]:terrain.points,graph=corridor.length?graphFor(network,start,end,p,corridor):initial,candidates=networkCandidates(graph,start,end,p),cache=new Map(),failed=[];let trials=0;
 const guideFor=(portal,side)=>{
  if(!corridor.length)return null;let index=0,gap=Infinity;
  for(let i=0;i<corridor.length;i++){const d=corridor[i].n.reduce((sum,v,k)=>sum+(v-portal.n[k])**2,0);if(d<gap){gap=d;index=i;}}
  const ps=side?[portal.n,...corridor.slice(index).map(p=>p.n)]:[...corridor.slice(0,index+1).map(p=>p.n),portal.n],stride=Math.max(1,Math.ceil(ps.length/60)),guide=ps.filter((_,i)=>i%stride===0||i===ps.length-1);
  const clean=[guide[0]];for(let i=1;i<guide.length;i++){if(distance(guide[i],clean.at(-1))>20)clean.push(guide[i]);else if(i===guide.length-1){if(clean.length>1)clean.pop();clean.push(guide[i]);}}return clean;
 };
 const attempt=async(c,quickOnly)=>{
  if(hooks.cancelled?.())throw Error('cancelled');
  if(direct&&c.lower>direct.networkScore*1.05)return true;
  hooks.progress?.(quickOnly?'Testing shared track connections':'Refining shared track connections',++trials,16);
  const reused=pathFrom(c.tree,c.a,c.b),parts=[];
  for(const side of[0,1]){
   const endpoint=side?end:start,portal=side?c.b:c.a,gap=distance(endpoint.n,portal.n);if(gap<.01)continue;if(gap<20)return false;
   const direction=side?c.exit:c.entry,key=side+':'+portal.id+':'+direction.map(v=>v.toFixed(5)).join(','),cached=cache.get(key);
   if(!cached||cached.result.error&&!quickOnly&&!cached.full){
    const a=side?portal:endpoint,b=side?endpoint:portal;
    const result=await planRoute(a.n,b.n,world,p,{...hooks,quickOnly,guide:guideFor(portal,side),endpointHeights:[a.h??world(a.n).height,b.h??world(b.n).height],endpointDirections:side?[direction,baseHooks.endpointDirections[1]]:[baseHooks.endpointDirections[0],direction]});cache.set(key,{result,full:!quickOnly});
   }
   const r=cache.get(key).result;if(r.error)return false;if(side)parts.push(...reused,{points:r.points});else parts.push({points:r.points});
  }
  if(!parts.some(part=>part.trackId))parts.push(...reused);
  const r=assemble(parts,network,world,p);if(r&&(!direct||r.networkScore<direct.networkScore))direct=r;return !!r;
 };
 for(const c of candidates){if(!await attempt(c,true))failed.push(c);await new Promise(resolve=>setTimeout(resolve,0));}
 // Broaden cheaply first, then spend full terrain searches on several distinct
 // promising joins. Failed early pairs no longer consume the whole reuse search.
 for(const c of failed.slice(0,4)){await attempt(c,false);await new Promise(resolve=>setTimeout(resolve,0));}
 if(hooks.cancelled?.())throw Error('cancelled');
 return direct||{error:'No route found within these limits, including connections to existing track. Try different endpoints or routing limits.'};
}

// There are no directional city/track constraints yet. Run the approximate
// construction search in a geographic order so click order cannot change it.
// Reverse only traversal and the acceleration/braking envelope for the caller.
export async function planNetworkRoute(start,end,world,options={},network={tracks:[],nodes:[]},hooks={}){
 const order=start.n[0]-end.n[0]||start.n[1]-end.n[1]||start.n[2]-end.n[2],backwards=order>0;
 const r=await searchNetworkRoute(backwards?end:start,backwards?start:end,world,options,network,hooks);
 if(!backwards||r.error)return r;
 if(hooks.cancelled?.())throw Error('cancelled');
 const p=parameters(options),parts=r.parts.toReversed().map(part=>part.trackId?{...part,from:part.to,to:part.from}:{points:part.points.toReversed().map(clonePoint)}),reverse=assemble(parts,network,world,p);
 if(!reverse)throw Error('Could not validate the reverse traversal of the chosen alignment.');
 // Construction quantities belong to the alignment, not its traversal. Retain
 // the same integration samples rather than changing their endpoint convention.
 const quantities={};for(const key of['length','volume','cut','fill','maxGrade','maxWork','minRadius','bridgeLength','maxBridgeHeight','bridgeCost','reusedLength','newLength'])quantities[key]=r[key];
 const score=reverse.score+p.earthworkCost*(r.volume-reverse.volume)+r.bridgeCost-reverse.bridgeCost+(r.score-(r.engineeringScore??r.score));
 return {...r,...reverse,...quantities,score,networkScore:score+p.reusePreference*r.newLength};
}
