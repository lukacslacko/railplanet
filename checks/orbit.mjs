import assert from 'node:assert/strict';
import * as Orbit from '../dist/orbit.js';
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b,tolerance=1e-10)=>assert(Math.abs(a-b)<tolerance,`${a} should be near ${b}`);
function validFrame(q){
  near(Math.hypot(...q),1);
  const {right,up,outward}=Orbit.frame(q);
  for(const axis of [right,up,outward])near(Math.hypot(...axis),1);
  near(dot(right,up),0);near(dot(up,outward),0);near(dot(right,outward),0);
  near(dot(cross(right,up),outward),1);
}
const home=Orbit.home(),frame=Orbit.frame(home);
near(frame.outward[0],Math.sin(.58)*Math.cos(.24));near(frame.outward[1],Math.sin(.24));near(frame.outward[2],Math.cos(.58)*Math.cos(.24));
// A vertical orbit passes beyond the north pole and can complete a full turn.
const beyond=Orbit.turn([0,0,0,1],0,400);validFrame(beyond);
assert(Orbit.frame(beyond).up[1]<0,'camera must be able to go beyond a pole');
const full=Orbit.turn(home,0,Math.PI*2/.006);near(Orbit.distance(home,full),0,1e-7);
// Input directions are local to the screen at arbitrary camera rolls and poles.
for(let i=0;i<60;i++){
  const q=Orbit.multiply(Orbit.axisAngle([.2,.7,.3],i*.31),Orbit.axisAngle([0,0,1],i*.43));
  const basis=Orbit.frame(q);
  const horizontal=Orbit.frame(Orbit.turn(q,1,0)).outward;
  const vertical=Orbit.frame(Orbit.turn(q,0,1)).outward;
  assert(dot(horizontal,basis.right)<0,'horizontal drag direction must stay screen-relative');
  near(dot(horizontal,basis.up),0);
  assert(dot(vertical,basis.up)>0,'vertical drag direction must stay screen-relative');
  near(dot(vertical,basis.right),0);
  validFrame(q);
}
let repeated=home;
for(let i=0;i<10000;i++)repeated=Orbit.turn(repeated,Math.sin(i*.13)*3,Math.cos(i*.19)*4);
validFrame(repeated);
const negative=home.map(value=>-value);near(Orbit.distance(home,Orbit.interpolate(home,negative,.5)),0,1e-7);
// Picking a location preserves a valid frame even for an antipodal target.
for(const direction of [[0,1,0],[0,-1,0],[1,2,-3],frame.outward.map(v=>-v)]){
  const focused=Orbit.lookAtDirection(home,direction);validFrame(focused);
  near(dot(Orbit.frame(focused).outward,direction)/Math.hypot(...direction),1);
}
console.log('Orbit verified: unrestricted pole crossings, full rotations, screen-relative input at arbitrary rolls, stable interpolation, and location focusing.');
