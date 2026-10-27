import assert from 'node:assert/strict';
import {planRoute,R,distance,DEFAULTS,unit} from '../dist/rail.js';
import {nearbyPasses,crossing} from '../dist/passes.js';
import {rotate,axisAngle} from '../dist/orbit.js';
import {createNoise,elevationAt} from '../dist/noise.js';
const point=(x,y)=>[Math.cos(x/R)*Math.cos(y/R),Math.sin(y/R),Math.sin(x/R)*Math.cos(y/R)];
const xy=n=>[Math.atan2(n[2],n[0])*R,Math.asin(n[1])*R];
const world=n=>{const[x,y]=xy(n);return {land:true,height:500+(120+80*(1-Math.exp(-((y/10000)**2))))*Math.exp(-((x/16000)**2))};};
const a=point(-20000,4000),b=point(20000,4000),old=await planRoute(a,b,world,{passPreference:0}),guided=await planRoute(a,b,world);
assert(!old.error&&!guided.error);
const passes=await nearbyPasses(old,world),pass=passes.find(p=>distance(p.n,point(0,0))<500);
assert(pass,'well-defined terrain saddle must be detected');
const before=crossing(old,pass),after=crossing(guided,pass);
assert(Math.abs(before.offset)>3000,'fixture must exhibit the upslope shortcut');
assert(Math.abs(after.offset)<300,'preferred route should cross through the nearby saddle');
assert(after.height<before.height-8,'pass route should avoid unnecessary extra climbing');
assert(guided.length<old.length*1.05,'preference must remain a modest local detour');
assert(guided.engineeringScore<old.score*1.04,'default preference must bound additional engineering cost');
assert(guided.maxGrade<=DEFAULTS.maxGrade+1e-6&&guided.minRadius>=DEFAULTS.minRadius-.05&&guided.maxWork<=DEFAULTS.maxEarthwork+.1,'pass preference cannot relax engineering constraints');
assert(guided.passGuidance.used===1);
const reverse=await planRoute(b,a,world),other=await planRoute(point(-20000,-4000),point(20000,-4000),world);
assert(!reverse.error&&!other.error);assert(Math.abs(crossing(reverse,pass).offset)<300&&Math.abs(crossing(other,pass).offset)<300);
assert(distance(guided.passGuidance.passes[0].n,other.passGuidance.passes[0].n)<1,'different approaches must recognize the same geographic pass');
assert(guided.passGuidance.passes[0].id===other.passGuidance.passes[0].id,'terrain feature identity must not depend on route direction');
for(const [name,start,end]of[['same valley',point(-20000,-20000),point(-20000,20000)],['distant pass',point(-20000,80000),point(20000,80000)]]){
 const off=await planRoute(start,end,world,{passPreference:0}),on=await planRoute(start,end,world);
 assert(!off.error&&!on.error,name);assert(Math.abs(off.length-on.length)<.01,name+' must not be pulled toward an unrelated saddle');assert(on.passGuidance.used===0);
}
const lake=n=>({...world(n),land:distance(n,point(0,0))>2000}),wet=await planRoute(a,b,lake);
assert(!wet.error,wet.error);assert(wet.points.every(p=>lake(p.n).land));assert(wet.passGuidance.used===0,'a flooded saddle must not attract the route');
// Rotate the same physical terrain onto a cube-face seam and near a pole.
const q=axisAngle(unit([.7,1,.2]),1.7),inverse=[-q[0],-q[1],-q[2],q[3]],rotatedWorld=n=>world(rotate(inverse,n)),polar=await planRoute(rotate(q,a),rotate(q,b),rotatedWorld);
assert(!polar.error,polar.error);assert(polar.passGuidance.used===1);assert(distance(polar.passGuidance.passes[0].n,rotate(q,point(0,0)))<500,'rotated terrain must yield the same saddle');
await assert.rejects(()=>nearbyPasses(old,n=>world(n),{cancelled:()=>true}),/cancelled/,'feature extraction must be cancellable');
console.log(`Pass preference verified: upslope crossing ${before.height.toFixed(1)} m / ${(Math.abs(before.offset)/1000).toFixed(1)} km from saddle → ${after.height.toFixed(1)} m / ${Math.round(Math.abs(after.offset))} m; ${(100*(guided.length/old.length-1)).toFixed(1)}% extra track. Stable opposite approaches, no same-valley/distant/flooded attraction, rotation, engineering constraints, disable control, and cancellation.`);

// Production ten-layer spectrum: a modest sideways adjustment should reach
// the lower pass even when earthwork makes the objective much larger than length.
const spectrum=createNoise('42'),terrain=n=>{const h=elevationAt(n,spectrum.terrain,spectrum.amplitudes);return {land:h>.000015,height:Math.max(0,h)*91000};};
const realStart=[.44619890167908405,.47570892653995617,.7580287312170834],realEnd=[.5061780033407162,.5111790657437798,.6946076530526583],realBefore=await planRoute(realStart,realEnd,terrain,{passPreference:0}),realAfter=await planRoute(realStart,realEnd,terrain);
assert(!realBefore.error&&!realAfter.error);assert(realAfter.passGuidance.used===1,'production seed-42 saddle must influence the line');
assert(realAfter.length<realBefore.length*1.01,'real-terrain pass should need less than 1% extra track');
assert(realAfter.engineeringScore<=realBefore.score*1.04,'construction-heavy routes must retain the same relative-cost bound');
const realPass=(await nearbyPasses(realBefore,terrain)).find(p=>p.id===realAfter.passGuidance.passes[0].id),r0=crossing(realBefore,realPass),r1=crossing(realAfter,realPass);
assert(Math.abs(r0.offset)>1500&&Math.abs(r1.offset)<300);assert(r1.height<r0.height-20,'production terrain crossing must avoid extra climbing');
console.log('PASS generated seed 42: lower saddle crossing with '+Math.round(realAfter.length-realBefore.length)+' m extra track on a '+(realBefore.length/1000).toFixed(1)+' km route.');
