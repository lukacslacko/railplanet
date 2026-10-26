// CPU sampling of the actual GPU readback: bilinear height, nearest-cell lake
// level, repeated longitude and clamped latitude, matching surfaceCommon GLSL.
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const r=Math.hypot(...v);return v.map(x=>x/r);};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const decode=(p,i)=>(p[i]*256+p[i+1])/65535*.48-.24;
export function createSurfaceSampler({terrain,width,height,lakes=null,lakeWidth=width,lakeHeight=height,sea=0,relief=1.4,detail=192}){
  function fields(direction){
    const n=unit(direction);
    const lon=Math.abs(n[0])<1e-7?(n[2]<0?-Math.PI/2:n[2]>0?Math.PI/2:0):Math.abs(n[2])<1e-7?(n[0]<0?Math.PI:0):Math.atan2(n[2],n[0]);
    const u=((lon/(Math.PI*2))%1+1)%1,v=Math.asin(clamp(n[1],-1,1))/Math.PI+.5;
    const tx=u*width-.5,ty=v*height-.5,x=Math.floor(tx),y=Math.floor(ty),fx=tx-x,fy=ty-y;
    const h=(ix,iy)=>decode(terrain,(clamp(iy,0,height-1)*width+((ix%width+width)%width))*4);
    const land=(h(x,y)*(1-fx)+h(x+1,y)*fx)*(1-fy)+(h(x,y+1)*(1-fx)+h(x+1,y+1)*fx)*fy;
    const lake=lakes?decode(lakes,(clamp(Math.floor(clamp(v,0,.999999)*lakeHeight),0,lakeHeight-1)*lakeWidth+Math.min(lakeWidth-1,Math.floor(u*lakeWidth)))*4):sea;
    return {height:land,water:Math.max(sea,lake),land:land>Math.max(sea,lake)+.000015};
  }
  function radius(n){const f=fields(n);return 1+Math.max(f.height,f.water)*relief;}
  const cache=new Float64Array(6*(detail+1)*(detail+1)*3),known=new Uint8Array(6*(detail+1)*(detail+1));
  // Intersect the radial ray with its exact rendered triangle as well. A coarse
  // triangle can lie above a valley in the field, especially at high frequency.
  function renderedRadius(direction){
    const n=unit(direction),a=n.map(Math.abs),largest=Math.max(...a);let face,u,v;
    if(a[0]===largest){face=n[0]>0?0:1;u=(face===0?-n[2]:n[2])/largest;v=n[1]/largest;}
    else if(a[1]===largest){face=n[1]>0?2:3;u=n[0]/largest;v=(face===2?-n[2]:n[2])/largest;}
    else{face=n[2]>0?4:5;u=(face===4?n[0]:-n[0])/largest;v=n[1]/largest;}
    const gx=clamp((u+1)*detail/2,0,detail),gy=clamp((v+1)*detail/2,0,detail);
    const x=Math.min(detail-1,Math.floor(gx)),y=Math.min(detail-1,Math.floor(gy));
    function vertex(ix,iy){
      const key=(face*(detail+1)+iy)*(detail+1)+ix,offset=key*3;
      if(known[key])return [cache[offset],cache[offset+1],cache[offset+2]];
      const a=2*ix-detail,b=2*iy-detail,n=detail;
      const p=[[n,b,-a],[-n,b,a],[a,n,-b],[a,-n,b],[a,b,n],[-a,b,-n]][face];
      const r=Math.hypot(...p),d=unit(p.map(t=>Math.fround(t===0?0:t/r))),height=radius(d);
      const value=d.map(t=>t*height);cache.set(value,offset);known[key]=1;return value;
    }
    const points=gx-x+gy-y<=1?[vertex(x,y),vertex(x+1,y),vertex(x,y+1)]:[vertex(x+1,y),vertex(x+1,y+1),vertex(x,y+1)];
    const [p,q,r]=points,normal=cross(q.map((t,i)=>t-p[i]),r.map((t,i)=>t-p[i]));
    const meshRadius=dot(normal,p)/dot(normal,n);
    return meshRadius;
  }
  const sample=n=>Math.max(radius(n),renderedRadius(n));
  sample.rendered=renderedRadius;sample.fields=fields;
  return sample;
}
