// Screen-pixel tolerances are independent of zoom, DPR and planet radius.
import {unit,clamp,distance} from './rail.js?v=2.5.0';
import {HEIGHT_METERS} from './scale.js?v=2.5.0';
export function projectTrackPoint(p,matrix,width,height){
 const r=1+(p.h+.5)/HEIGHT_METERS,v=p.n.map(x=>x*r),clip=[0,0,0,0];
 for(let row=0;row<4;row++)clip[row]=matrix[row]*v[0]+matrix[4+row]*v[1]+matrix[8+row]*v[2]+matrix[12+row];
 if(clip[3]<=0||clip[2]<-clip[3]||clip[2]>clip[3])return null;
 return {x:(clip[0]/clip[3]+1)*width/2,y:(1-clip[1]/clip[3])*height/2,w:clip[3]};
}
export function snapToNetwork(network,x,y,project,visible=()=>true,{endpointPixels=16,trackPixels=11}={}){
 const nearby=[];
 for(const node of network.nodes){const q=project(node);if(q){const d=Math.hypot(q.x-x,q.y-y);if(d<=endpointPixels)nearby.push({d,point:{n:node.n.slice(),h:node.h,nodeId:node.id,kind:'endpoint'},screen:q});}}
 nearby.sort((a,b)=>a.d-b.d);for(const hit of nearby)if(visible(hit.point,hit.screen))return hit.point;
 const hits=[];
 for(const track of network.tracks){let a=project(track.points[0]);
  for(let i=1;i<track.points.length;i++){
   const b=project(track.points[i]);if(a&&b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy),0,1),sx=a.x+dx*t,sy=a.y+dy*t,d=Math.hypot(sx-x,sy-y);
    if(d<=trackPixels){const u=(t/b.w)/((1-t)/a.w+t/b.w),p=track.points[i-1],q=track.points[i],n=unit(p.n.map((v,k)=>v*(1-u)+q.n[k]*u)),station=track.stations[i-1]+(track.stations[i]-track.stations[i-1])*u;hits.push({d,point:{n,h:p.h*(1-u)+q.h*u,trackId:track.id,station,kind:'track'},screen:{x:sx,y:sy}});}
   }a=b;
  }
 }
 hits.sort((a,b)=>a.d-b.d);for(const hit of hits)if(visible(hit.point,hit.screen)){
  // Pixel picking can hit a sub-metre fragment next to an existing node.
  const node=network.nodes.find(n=>distance(n.n,hit.point.n)<2&&Math.abs(n.h-hit.point.h)<1);
  return node?{n:node.n.slice(),h:node.h,nodeId:node.id,kind:'endpoint'}:hit.point;
 }return null;
}
