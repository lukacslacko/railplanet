import assert from 'node:assert/strict';
import * as Flight from '../dist/flight.js';
import * as Orbit from '../dist/orbit.js';
import {createSurfaceSampler} from '../dist/surface.js';
import {cubeSphereData} from '../dist/mesh.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>v.map(x=>x/Math.hypot(...v));
const near=(a,b,tol=1e-9)=>assert(Math.abs(a-b)<tol,`${a} != ${b}`);
const separation=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const flat=()=>1;
function valid(f){
  const basis=Flight.frame(f);
  for(const axis of [f.up,f.forward,basis.right,basis.up,basis.outward])near(Math.hypot(...axis),1);
  near(dot(f.up,f.forward),0);near(dot(basis.right,basis.up),0);
  near(dot(cross(basis.right,basis.up),basis.outward),1);
  near(Math.hypot(...basis.position),f.radius);
  assert(basis.position.every(Number.isFinite));
}
let f=Flight.create([0,0,1],[0,1,0],flat);
near(f.radius,1+Flight.START_HEIGHT);valid(f);
const start=structuredClone(f);
for(let i=0;i<100;i++)Flight.step(f,{},.1,flat);
assert.deepEqual(f,start,'released controls must hover without drift');
for(let i=0;i<100;i++)Flight.step(f,{move:1},.1,flat);
assert(f.up[1]>0,'W moves along the initial heading');
for(let i=0;i<100;i++)Flight.step(f,{move:-1},.1,flat);
assert(separation(f.up,start.up)<1e-10,'S must reverse a forward flight');
Flight.step(f,{yaw:1},.1,flat);
assert(f.forward[0]<0,'A turns left around the local vertical');
assert(separation(f.up,start.up)<1e-10,'yaw at rest must hover over the same point');
Flight.step(f,{yaw:-1},.1,flat);
assert(separation(f.forward,start.forward)<1e-10,'D reverses the yaw');
Flight.step(f,{lift:1},.1,flat);near(f.radius,start.radius+.0018);
for(let i=0;i<100;i++)Flight.step(f,{lift:-1},.1,flat);
near(f.radius,1+Flight.CLEARANCE);
Flight.constrain(f,()=>1.18);near(f.radius,1.18+Flight.CLEARANCE);
// Pole crossings and arbitrary rolls must preserve an orthonormal local frame.
for(let rotation=0;rotation<6;rotation++){
  const q=Orbit.axisAngle([.3,1,.2],rotation*.8),up=Orbit.rotate(q,[0,0,1]),heading=Orbit.rotate(q,[0,1,0]);
  f=Flight.create(up,heading,flat);
  for(let i=0;i<1900;i++){Flight.step(f,{move:1},.1,flat);if(i%100===0)valid(f);}
  assert(dot(f.up,up)<-.9,'flight must continue beyond the poles onto the far side');
}
const simulate=hz=>{const f=Flight.create([0,0,1],[0,1,0],flat);for(let i=0;i<hz*5;i++)Flight.step(f,{move:1,yaw:1,lift:.2},1/hz,flat);return f;};
const a=simulate(60),b=simulate(144);valid(a);valid(b);
assert(separation(a.up,b.up)<.0001,'simultaneous flight/yaw must be frame-rate independent');
assert(separation(a.forward,b.forward)<.0001);
near(a.radius,b.radius,1e-8);
assert(separation(a.up,start.up)>.001,'combined W/A must move as well as turn');
// Match texture addressing and water/ice levels, including the longitude seam.
const W=64,H=32,terrain=new Uint8Array(W*H*4),lakes=new Uint8Array(terrain.length);
const put=(array,i,h)=>{const e=Math.round((h+.24)/.48*65535);array[i]=e>>8;array[i+1]=e&255;};
for(let i=0;i<W*H;i++){put(terrain,i*4,-.06);put(lakes,i*4,.04);}
let sample=createSurfaceSampler({terrain,width:W,height:H,lakes,relief:2,detail:8});
for(const n of [[1,0,0],[1,0,1e-10],[1,0,-1e-10],[0,1,0],[0,-1,0]])near(sample(n),1.08,.00002);
sample=createSurfaceSampler({terrain,width:W,height:H,sea:.01,relief:2,detail:8});near(sample([1,0,0]),1.02,.000001);
// Independently intersect the complete displaced mesh to catch wrong cube-face
// selection or diagonal choice. High-frequency valleys expose triangle bridges.
for(let y=0;y<H;y++)for(let x=0;x<W;x++)put(terrain,(y*W+x)*4,.04+.035*Math.sin(x*1.43)*Math.cos(y*1.31));
const field=n=>{
  const u=((Math.atan2(n[2],n[0])/(2*Math.PI))%1+1)%1,v=Math.asin(n[1])/Math.PI+.5;
  const x=u*W-.5,y=v*H-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const h=(a,b)=>{const i=(Math.max(0,Math.min(H-1,b))*W+(a%W+W)%W)*4;return (terrain[i]*256+terrain[i+1])/65535*.48-.24;};
  return 1+((h(ix,iy)*(1-fx)+h(ix+1,iy)*fx)*(1-fy)+(h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx)*fy)*1.4;
};
for(const detail of [8,12]){
  const {positions,indices}=cubeSphereData(detail),vertices=[];
  for(let i=0;i<positions.length;i+=3){const n=unit(Array.from(positions.slice(i,i+3))),r=field(n);vertices.push(n.map(v=>v*r));}
  sample=createSurfaceSampler({terrain,width:W,height:H,relief:1.4,detail});
  let bridges=0;
  for(let j=0;j<80;j++){
    const n=unit([Math.sin(j*3.12+.2),Math.cos(j*1.71+.3),Math.sin(j*2.23+.7)]);let mesh=0;
    for(let i=0;i<indices.length;i+=3){
      const p=vertices[indices[i]],q=vertices[indices[i+1]],r=vertices[indices[i+2]],e1=q.map((v,k)=>v-p[k]),e2=r.map((v,k)=>v-p[k]);
      const h=cross(n,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)continue;
      const t=p.map(v=>-v),u=dot(t,h)/det;if(u<-1e-9||u>1+1e-9)continue;
      const v=dot(n,cross(t,e1))/det;if(v<-1e-9||u+v>1+1e-9)continue;
      const radius=dot(e2,cross(t,e1))/det;if(radius>0)mesh=Math.max(mesh,radius);
    }
    const ground=field(n);if(mesh>ground+.001)bridges++;
    near(sample(n),Math.max(ground,mesh),1e-7);
  }
  assert(bridges>5,'fixture must include coarse triangles above valleys');
}
console.log('Flight verified: hover, forward/reverse, simultaneous yaw, ascent/descent, collision clearance, poles, frame-rate independence, and exact mesh/water surface sampling.');
