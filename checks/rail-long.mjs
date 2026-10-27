import assert from 'node:assert/strict';
import {planRoute,DEFAULTS,R,unit,tangent,cross,evaluate,distance} from '../dist/rail.js';
import {HEIGHT_METERS,DEFAULT_RADIUS} from '../dist/scale.js?v=2.2.0';
import {createNoise,elevationAt} from '../dist/noise.js';
assert.equal(R,DEFAULT_RADIUS);assert.equal(R,650000);assert.equal(HEIGHT_METERS,65000);
const model=createNoise('803297',{frequency:1.5,color:.53,layers:10});
// Same ten-band terrain as the production GPU. This tests the terrain spectrum,
// rather than only hand-picked flat or single-ridge routing fixtures.
const start=unit([.3357997887595262,.19621603603560825,.9212696505755145]),f=tangent(start,[.5,.3,.8]),side=cross(start,f);
const exact=n=>{const h=elevationAt(n,model.terrain,model.amplitudes);return {height:Math.max(0,h)*1.4*HEIGHT_METERS,land:h>.000015};};
for(const[length,yaw]of[[30000,0],[80000,.4],[150000,1.2]]){
 const heading=f.map((v,k)=>v*Math.cos(yaw)+side[k]*Math.sin(yaw)),end=unit(start.map((v,k)=>v*Math.cos(length/R)+heading[k]*Math.sin(length/R))),at=performance.now();
 const result=await planRoute(start,end,exact);
 assert(!result.error,`${length/1000} km ten-layer route: ${result.error}`);
 assert(result.length<length*2,'long routes must not depend on world-sized detours');
 assert(distance(result.points[0].n,start)<.001&&distance(result.points.at(-1).n,end)<.001);
 assert(result.maxGrade<=DEFAULTS.maxGrade+1e-6);assert(result.minRadius>=DEFAULTS.minRadius-.05);assert(result.maxWork<=DEFAULTS.maxEarthwork+.1);assert(result.maxBridgeHeight<=DEFAULTS.maxBridge+.1);
 console.log(`PASS ten-layer terrain: ${length/1000} km endpoints, ${(result.length/1000).toFixed(1)} km route, ${(result.maxGrade*100).toFixed(2)}% grade, ${(result.bridgeLength/1000).toFixed(1)} km viaducts, ${((performance.now()-at)/1000).toFixed(1)} s`);
}

const other=createNoise('911154',{frequency:1.5,color:.53,layers:10}),otherWorld=n=>{const h=elevationAt(n,other.terrain,other.amplitudes);return {height:Math.max(0,h)*1.4*HEIGHT_METERS,land:h>.000015};};
const h=f.map((v,k)=>v*Math.cos(.4)+side[k]*Math.sin(.4)),otherEnd=unit(start.map((v,k)=>v*Math.cos(80000/R)+h[k]*Math.sin(80000/R))),otherResult=await planRoute(start,otherEnd,otherWorld);
assert(!otherResult.error,'second seed mountainous 80 km route: '+otherResult.error);assert(otherResult.maxGrade<=DEFAULTS.maxGrade+1e-6);
console.log('PASS second ten-layer seed 911154: '+(otherResult.length/1000).toFixed(1)+' km mountain route.');

const point=x=>[Math.cos(x/R),0,Math.sin(x/R)],valley=n=>{const x=Math.atan2(n[2],n[0])*R;return {land:true,height:1000-130*Math.exp(-(((x-3000)/170)**2)),river:Math.abs(x-3000)<10};};
const global=await planRoute(point(0),point(1200000),()=>({height:0,land:true}));assert(!global.error&&Math.abs(global.length-1200000)<1,'continental-distance route must preserve spherical distance and endpoints');
const bridge=await planRoute(point(0),point(6000),valley);
assert(!bridge.error,bridge.error);assert(bridge.bridgeLength>100,'deep narrow valley should be crossed by a viaduct');assert(bridge.maxWork<=DEFAULTS.maxEarthwork+.1);
assert(!evaluate(bridge.points,n=>({...valley(n),land:Math.abs(Math.atan2(n[2],n[0])*R-3000)>30}),DEFAULTS),'viaducts must not enable ocean/lake crossings');
assert(!evaluate(bridge.points,valley,{...DEFAULTS,maxBridge:0}),'bridge option must be enforced');
console.log('PASS bridges over noisy valleys, free river crossing, blocked lakes/ocean, and independent horizontal/vertical units.');
// Exercise the actual renderer's geometry builder without a browser/GPU. This
// catches degenerate deck faces, incorrect vertical units, and bin truncation.
const {RailwayRenderer}=await import('../dist/rail-render.js');
const surface={rendered:n=>1+valley(n).height/HEIGHT_METERS};let vertexCount=0;
const renderer={gl:{deleteTexture(){}},clear(){this.meshes=[];},integerTexture(w,h,data){return{w,h,data};},floatTexture(w,h,data){assert(data.every(Number.isFinite));return{w,h,data};},mesh(vertices){assert(vertices.every(Number.isFinite),'all bridge/deck/pier vertices and normals must be finite');vertexCount+=vertices.length/8;return{};},buildBins:RailwayRenderer.prototype.buildBins};
RailwayRenderer.prototype.setRoute.call(renderer,bridge,surface);assert(vertexCount>bridge.points.length*6,'elevated deck and pier geometry must be present');
const dense=Array.from({length:900},(_,i)=>({n:unit([1,Math.sin(i*.02)*.0005,Math.cos(i*.02)*.0005])})),bins=renderer.buildBins(dense,dense.map(()=>8),2048);
assert(bins.pixels.some((v,i)=>i%4===1&&v>4),'dense cells must preserve more than four segment ranges');
console.log('PASS finite deck/pier geometry and untruncated spatial bins for long, dense routes.');
