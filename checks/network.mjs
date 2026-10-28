import assert from 'node:assert/strict';
import {R,unit,distance,planRoute,DEFAULTS} from '../dist/rail.js?v=2.3.1';
import {RailNetwork,planNetworkRoute,nearestOnTrack,pointOnTrack,trackSlice} from '../dist/rail-network.js';
import {snapToNetwork,projectTrackPoint} from '../dist/rail-snap.js';
import {RailwayRenderer} from '../dist/rail-render.js';
const at=(x,y=0)=>unit([1,y/R,x/R]),flat=()=>({land:true,height:100}),options={passPreference:0},end=(x,y=0)=>({n:at(x,y),h:100}),net=new RailNetwork();
const first=await planNetworkRoute(end(0),end(20000),flat,options,net);assert(!first.error,first.error);net.add(first);
const original=JSON.stringify(net.tracks),snapshot=net.snapshot(),track=net.tracks[0];
const next=await planNetworkRoute(end(2000,1000),end(18000,1000),flat,options,net);
assert(!next.error,next.error);assert(next.reusedLength>10000,'nearby parallel connection should reuse the trunk');assert(next.newLength<6000,'build approaches instead of a duplicate parallel line');assert(next.length<distance(at(2000,1000),at(18000,1000))*1.15,'reuse must not cause excessive detours');assert(next.minRadius>=DEFAULTS.minRadius-.1);
net.add(next);assert.equal(net.routes.length,2);assert.equal(net.tracks.length,3,'only new approaches become physical track');assert.equal(JSON.stringify(net.tracks.slice(0,1)),original,'original geometry and elevations stay immutable');assert(net.nodes.some(n=>n.attachments.length===2),'interior entry/exit points create shared graph nodes');
console.log('PASS smooth trunk reuse, fixed original geometry, and new interior junctions.');
const a=net.nodes.find(n=>n.attachments.some(a=>a.trackId===track.id&&a.station===0)),b=net.nodes.find(n=>n.attachments.some(a=>a.trackId===track.id&&Math.abs(a.station-track.stations.at(-1))<.01));
const full=await planNetworkRoute({...a,nodeId:a.id},{...b,nodeId:b.id},flat,options,net);assert(!full.error,full.error);assert(full.reusedLength>19900);assert(full.newLength<.01);assert(full.volume<.01);assert(full.seconds>0);net.add(full);assert.equal(net.tracks.length,3,'a reused line is not rendered/built twice');
const partialStart=pointOnTrack(track,5000),partialEnd=pointOnTrack(track,15000),partial=await planNetworkRoute(partialStart,partialEnd,flat,options,net);assert(!partial.error,partial.error);assert(Math.abs(partial.length-10000)<.01);assert(partial.newLength<.01);assert(distance(partial.points[0].n,partialStart.n)<.001);assert(Math.abs(partial.points.at(-1).h-partialEnd.h)<1e-8);
const bridgeWorld=n=>{const x=Math.atan2(n[2],n[0])*R;return {land:true,height:100-130*Math.exp(-(((x-3000)/170)**2))};},bridgeNet=new RailNetwork();
const elevated=await planNetworkRoute({n:at(0)},{n:at(6000)},bridgeWorld,options,bridgeNet);assert(elevated.bridgeLength>100);bridgeNet.add(elevated);
const elevatedTrack=bridgeNet.tracks[0],onBridge=pointOnTrack(elevatedTrack,3000),onEnd=pointOnTrack(elevatedTrack,4500),bridgeReuse=await planNetworkRoute(onBridge,onEnd,bridgeWorld,options,bridgeNet);
assert(!bridgeReuse.error,bridgeReuse.error);assert(bridgeReuse.reusedLength>1499);assert(bridgeReuse.newLength<.01);assert(Math.abs(bridgeReuse.points[0].h-onBridge.h)<1e-8);assert(onBridge.h-bridgeWorld(onBridge.n).height>100,'snapped bridge endpoint must use the deck, not the valley floor');assert.equal(bridgeReuse.volume,0);
console.log('PASS exact full/partial reuse, fixed elevated bridge heights, running-time cost, and no duplicate construction.');
net.undo();assert.equal(net.routes.length,2);net.undo();assert.equal(net.tracks.length,1);assert.equal(net.nodes.length,2);assert.equal(net.length,snapshot.tracks[0].stations.at(-1));
const replacement=await planNetworkRoute(end(1000,1000),end(17000,1000),flat,options,net.beforeLast());net.add(replacement,true);assert.equal(net.routes.length,1);assert.equal(net.tracks.length,1);net.undo();assert.equal(net.routes.length,0);
console.log('PASS undo restores topology and replan replaces only the latest connection.');
// A far or disconnected existing route must not prevent ordinary terrain routing.
const isolated=new RailNetwork();isolated.add(await planNetworkRoute(end(200000,200000),end(220000,200000),flat,options,isolated));const separate=await planNetworkRoute(end(0),end(10000),flat,options,isolated);assert(!separate.error);assert.equal(separate.reusedLength,0);assert(separate.length<10001);
let cancelled=false;try{await planNetworkRoute(end(0),end(10000),flat,options,isolated,{cancelled:()=>true});}catch(e){cancelled=e.message==='cancelled';}assert(cancelled);assert.equal(isolated.routes.length,1);
console.log('PASS disconnected network fallback and cancellation preserve built track.');
const branches=new RailNetwork();branches.add(first);const trunk=branches.tracks[0],junction=pointOnTrack(trunk,10000),branch=await planNetworkRoute(junction,end(16000,4000),flat,options,branches);assert(!branch.error,branch.error);branches.add(branch);
const origin=branches.nodes[0],destination=branches.nodes.find(n=>distance(n.n,at(16000,4000))<.01),through=await planNetworkRoute({...origin,nodeId:origin.id},{...destination,nodeId:destination.id},flat,options,branches);
assert(!through.error,through.error);assert(through.reusedLength>15000);assert(through.newLength<.01,'the graph should traverse a shared interior junction');assert(through.minRadius>=DEFAULTS.minRadius-.1,'a new branch must join with a feasible tangent');
console.log('PASS through routing over multiple existing tracks via a smooth shared junction.');

// Endpoint priority is pixel based; hidden far-side endpoints must not steal it.
const t={id:'snap',points:[{n:at(0),h:100},{n:at(1000),h:200}],stations:[0,1000]},node={id:'endpoint',n:at(0),h:100,attachments:[]},sn={tracks:[t],nodes:[node]},project=p=>({x:Math.atan2(p.n[2],p.n[0])*R/10,y:0,w:1});
let hit=snapToNetwork(sn,14,0,project);assert.equal(hit.nodeId,'endpoint');
hit=snapToNetwork(sn,50,5,project);assert.equal(hit.trackId,'snap');assert(Math.abs(hit.h-150)<.01);assert(Math.abs(hit.station-500)<.01);
assert.equal(snapToNetwork(sn,50,20,project),null);assert.equal(snapToNetwork(sn,14,0,project,p=>!p.nodeId).kind,'track');assert.equal(snapToNetwork(sn,50,0,project,()=>false),null);
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];assert(projectTrackPoint({n:[0,1,0],h:100},identity,1000,500));
console.log('PASS endpoint-first snapping, interior interpolation, pixel tolerance, and occlusion filtering.');
// Separate track polylines must never carve a phantom connector in the globe.
const points=[{n:at(0)},{n:at(100)},{n:at(10000),breakBefore:true},{n:at(10100)}],bins=RailwayRenderer.prototype.buildBins(points,[6,6,6,6],2048),ids=[];
for(let i=0;i<bins.pixels.length;i+=4){let k=bins.pixels[i],count=bins.pixels[i+1];for(let j=0;j<count;j++){const packed=bins.ranges[k+j];for(let a=0;a<(packed&255);a++)ids.push((packed>>>8)+a);}}
assert(ids.includes(0)&&ids.includes(2));assert(!ids.includes(1),'no segment between separate railways');
console.log('PASS separate railway footprint bins without phantom connecting segments.');
