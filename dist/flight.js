// A tangent heading is parallel transported along great circles. There is no
// geographic up axis, so crossing a pole never flips or reverses the controls.
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function rotate(v,axis,angle){const c=Math.cos(angle),s=Math.sin(angle),k=dot(axis,v),t=cross(axis,v);return v.map((x,i)=>x*c+t[i]*s+axis[i]*k*(1-c));}
export const CLEARANCE=.0003;
export const START_HEIGHT=.022;
export const METERS_PER_UNIT=65000;
export function create(up,heading,surface){
  up=unit(up);const k=dot(up,heading);
  let forward=heading.map((v,i)=>v-up[i]*k);
  if(Math.hypot(...forward)<1e-8)forward=cross(up,Math.abs(up[1])<.9?[0,1,0]:[1,0,0]);
  return {up,forward:unit(forward),radius:surface(up)+START_HEIGHT,pitch:-Math.PI/7};
}
export function constrain(flight,surface){
  flight.radius=Math.max(surface(flight.up)+CLEARANCE,Math.min(2.5,flight.radius));
  return flight;
}
export function look(flight,yaw,pitch){
  flight.forward=unit(rotate(flight.forward,flight.up,yaw));
  flight.pitch=clamp(flight.pitch+pitch,-Math.PI/2+.04,.35);
}
export function step(flight,controls,seconds,surface){
  // Bound each integration step independently of refresh rate or tab suspension.
  let remaining=clamp(seconds,0,.1);
  while(remaining>0){
    const dt=Math.min(remaining,1/120);remaining-=dt;
    look(flight,(controls.yaw||0)*1.05*dt,0);
    const height=Math.max(CLEARANCE,flight.radius-surface(flight.up));
    const speed=clamp(height*.8,.009,.085);
    const angle=(controls.move||0)*speed*dt/flight.radius;
    if(angle){
      const axis=unit(cross(flight.up,flight.forward));
      flight.up=unit(rotate(flight.up,axis,angle));
      const forward=rotate(flight.forward,axis,angle),k=dot(forward,flight.up);
      flight.forward=unit(forward.map((v,i)=>v-k*flight.up[i]));
    }
    flight.radius+=(controls.lift||0)*.018*dt;
    constrain(flight,surface);
  }
  return flight;
}
export function frame(flight){
  const forward=flight.forward.map((v,i)=>v*Math.cos(flight.pitch)+flight.up[i]*Math.sin(flight.pitch));
  const right=unit(cross(forward,flight.up)),up=unit(cross(right,forward));
  return {right,up,outward:forward.map(v=>-v),position:flight.up.map(v=>v*flight.radius)};
}
