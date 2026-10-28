import assert from 'node:assert/strict';
import {RailNetwork,planNetworkRoute} from '../dist/rail-network.js';
import {R,unit,distance,planRoute,evaluate,parameters} from '../dist/rail.js?v=2.5.0';
const flat=()=>({height:100,land:true}),p=parameters({passPreference:0}),at=(x,y=0)=>unit([1,y/R,x/R]),point=(x,y=0)=>({n:at(x,y),h:100});
async function line(net,a,b){const r=await planRoute(at(a),at(b),flat,p);assert(!r.error);net.add(r);}
function endpoints(net){return [0,100000].map(x=>{const n=net.nodes.find(n=>distance(n.n,at(x))<.01);assert(n);return {...n,nodeId:n.id};});}
const disconnected=new RailNetwork();await line(disconnected,0,40000);await line(disconnected,60000,100000);
const disconnectedRoute=await planNetworkRoute(...endpoints(disconnected),flat,p,disconnected);
console.log('Disconnected trunks:',JSON.stringify({length:disconnectedRoute.length,new:disconnectedRoute.newLength,reused:disconnectedRoute.reusedLength,error:disconnectedRoute.error}));
assert(!disconnectedRoute.error);assert(disconnectedRoute.reusedLength>78000,'reuse both existing end sections and build the missing link');assert(disconnectedRoute.newLength<21000);
const connected=new RailNetwork();await line(connected,0,30000);await line(connected,70000,100000);
const arch=Array.from({length:2001},(_,i)=>{const t=i/2000;return {n:at(30000+40000*t,80000*Math.sin(Math.PI*t)**2),h:100,ground:100};}),detour=evaluate(arch,flat,p);assert(detour);connected.add({...detour,parameters:p});
const connectedRoute=await planNetworkRoute(...endpoints(connected),flat,p,connected);
console.log('Connected detour:',JSON.stringify({length:connectedRoute.length,new:connectedRoute.newLength,reused:connectedRoute.reusedLength,error:connectedRoute.error}));
assert(!connectedRoute.error);assert(connectedRoute.reusedLength>58000,'leave and rejoin a connected network instead of choosing all or none of it');assert(connectedRoute.newLength<41000);assert(connectedRoute.length<101000);
for(const net of[disconnected,connected]){
 const before=net.length,[a,b]=endpoints(net),forward=await planNetworkRoute(a,b,flat,p,net),back=await planNetworkRoute(b,a,flat,p,net);
 assert(!back.error);assert.equal(forward.points.length,back.points.length);assert(Math.abs(forward.reusedLength-back.reusedLength)<.001);assert.equal(net.length,before);
 net.add(forward);assert(net.length-before<48000);assert(net.nodes.some(n=>n.attachments.length>1));net.undo();assert.equal(net.length,before);
}
console.log('PASS disconnected and connected multi-section reuse, snapped endpoints, reverse travel, exact junctions, and immutable built geometry.');

// Multiple independent components must be joined in one connection, even when
// their construction order alternates travel direction.
const dense=new RailNetwork();
for(let i=0;i<6;i++){const a=i*17000,b=Math.min(100000,a+15000);await line(dense,i%2?b:a,i%2?a:b);}
const denseRoute=await planNetworkRoute(...endpoints(dense),flat,p,dense);
assert(!denseRoute.error,denseRoute.error);assert(denseRoute.reusedLength>88000);assert(denseRoute.newLength<10500);
assert.equal(new Set(denseRoute.parts.filter(p=>p.trackId).map(p=>p.trackId)).size,6,'reuse all six existing components');
const before=JSON.stringify(dense.snapshot());let stop=false;
await assert.rejects(planNetworkRoute(...endpoints(dense),flat,p,dense,{progress:phase=>{if(phase==='Fitting shared corridors')stop=true;},cancelled:()=>stop}),/cancelled/);
assert.equal(JSON.stringify(dense.snapshot()),before);
console.log('PASS six-component sharing in mixed construction directions and cancellation during join fitting.');

// Existing decks can have a different elevation from the independently planned
// terrain corridor. Transitions must retain deck heights and engineering limits.
const elevated=new RailNetwork();
for(const [a,b]of[[0,40000],[60000,100000]]){
 const r=await planRoute(at(a),at(b),flat,p,{endpointHeights:[260,260]});assert(!r.error,r.error);elevated.add(r);
}
const raised=await planNetworkRoute(...endpoints(elevated),flat,p,elevated);
assert(!raised.error,raised.error);assert(raised.reusedLength>50000);assert(raised.maxGrade<=p.maxGrade+1e-6);assert(raised.minRadius>=p.minRadius-.1);
for(const part of raised.parts.filter(part=>part.trackId)){
 const old=elevated.tracks.find(t=>t.id===part.trackId);assert(old);assert.equal(old.points[0].h,260);assert.equal(old.points.at(-1).h,260);
}
assert.equal(raised.points[0].h,260);assert.equal(raised.points.at(-1).h,260);
console.log('PASS transitions onto existing elevated formations retain fixed heights and grade/curvature limits.');
