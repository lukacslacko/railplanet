// Stable terrain features, independent of the selected endpoints. Canonical
// cube-face samples seed saddle detection. The cached catalogue is built in a
// deterministic order, so every route uses the same geographic pass anchors.
import {R,unit,cross,dot,distance,tangent,clamp} from './rail.js?v=2.4.0';
const cache=new WeakMap(),pause=()=>new Promise(r=>setTimeout(r,0));
const facePoint=(face,u,v)=>unit([[1,v,-u],[-1,v,u],[u,1,-v],[u,-1,v],[u,v,1],[-u,v,-1]][face]);
const offset=(n,a,x,b,y)=>unit(n.map((v,i)=>v+(a[i]*x+b[i]*y)/R));
const frame=n=>{const a=unit(cross(Math.abs(n[1])<.95?[0,1,0]:[1,0,0],n));return [a,cross(n,a)];};
function eigen(a,b,c){const d=Math.hypot(a-c,2*b),theta=.5*Math.atan2(2*b,a-c);return {low:(a+c-d)/2,high:(a+c+d)/2,along:[Math.cos(theta),Math.sin(theta)],across:[-Math.sin(theta),Math.cos(theta)]};}
async function seedsFor(world,hooks){
 if(cache.has(world)&&cache.get(world).radius===R)return cache.get(world);
 const N=96,W=N+5,seeds=[];
 for(let face=0;face<6;face++){
  const raw=new Float64Array(W*W),smooth=new Float64Array(W*W),at=(x,y)=>(y+2)*W+x+2;
  for(let y=-2;y<=N+2;y++)for(let x=-2;x<=N+2;x++)raw[at(x,y)]=world(facePoint(face,2*x/N-1,2*y/N-1)).height;
  for(let y=-1;y<=N+1;y++)for(let x=-1;x<=N+1;x++){let h=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)h+=raw[at(x+dx,y+dy)]*(dx?1:2)*(dy?1:2)/16;smooth[at(x,y)]=h;}
  for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
   const h=smooth[at(x,y)],gx=(smooth[at(x+1,y)]-smooth[at(x-1,y)])/2,gy=(smooth[at(x,y+1)]-smooth[at(x,y-1)])/2;
   const a=smooth[at(x+1,y)]+smooth[at(x-1,y)]-2*h,c=smooth[at(x,y+1)]+smooth[at(x,y-1)]-2*h,b=(smooth[at(x+1,y+1)]-smooth[at(x-1,y+1)]-smooth[at(x+1,y-1)]+smooth[at(x-1,y-1)])/4,det=a*c-b*b,e=eigen(a,b,c);
   if(e.low>=-8||e.high<=8)continue;
   const dx=(b*gy-c*gx)/det,dy=(b*gx-a*gy)/det;if(Math.abs(dx)>.8||Math.abs(dy)>.8)continue;
   const u=2*(x+dx)/N-1,v=2*(y+dy)/N-1,n=facePoint(face,u,v),cell=(distance(n,facePoint(face,u+2/N,v))+distance(n,facePoint(face,u,v+2/N)))/2;
   seeds.push({id:face*(N+1)**2+y*(N+1)+x,n,reach:cell*1.8,strength:Math.min(-e.low,e.high)});
  }
  hooks.progress?.('Identifying mountain passes',face+1,6);await pause();if(hooks.cancelled?.())throw Error('cancelled');
 }
 seeds.sort((a,b)=>b.strength-a.strength||a.id-b.id);
 const entry={seeds,radius:R,passes:null};cache.set(world,entry);return entry;
}
function refine(seed,world){
 let n=seed.n;const step=seed.reach*.3,blur=step*.65;
 const smoothed=point=>{
  const [a,b]=frame(point);let value=world(point).height*.25;
  for(const[x,y,w]of[[1,0,.125],[-1,0,.125],[0,1,.125],[0,-1,.125],[.707,.707,.0625],[-.707,.707,.0625],[.707,-.707,.0625],[-.707,-.707,.0625]])value+=world(offset(point,a,x*blur,b,y*blur)).height*w;
  return value;
 };
 const derivatives=point=>{
  const [u,v]=frame(point),h=smoothed(point),xp=smoothed(offset(point,u,step,v,0)),xm=smoothed(offset(point,u,-step,v,0)),yp=smoothed(offset(point,u,0,v,step)),ym=smoothed(offset(point,u,0,v,-step));
  const a=(xp+xm-2*h)/(step*step),c=(yp+ym-2*h)/(step*step),b=(smoothed(offset(point,u,step,v,step))-smoothed(offset(point,u,-step,v,step))-smoothed(offset(point,u,step,v,-step))+smoothed(offset(point,u,-step,v,-step)))/(4*step*step);
  return {u,v,h,a,b,c,gx:(xp-xm)/(2*step),gy:(yp-ym)/(2*step),e:eigen(a,b,c)};
 };
 for(let i=0;i<6;i++){
  const d=derivatives(n),det=d.a*d.c-d.b*d.b;if(d.e.low>=0||d.e.high<=0)return null;
  let dx=(d.b*d.gy-d.c*d.gx)/det,dy=(d.b*d.gx-d.a*d.gy)/det,len=Math.hypot(dx,dy);if(!Number.isFinite(len))return null;
  if(len>step){dx*=step/len;dy*=step/len;}n=offset(n,d.u,dx,d.v,dy);
  if(distance(n,seed.n)>seed.reach)return null;if(len<25)break;
 }
 const d=derivatives(n);if(d.e.low>=0||d.e.high<=0||!world(n).land)return null;
 const along=unit(d.u.map((v,i)=>v*d.e.along[0]+d.v[i]*d.e.along[1])),across=unit(d.u.map((v,i)=>v*d.e.across[0]+d.v[i]*d.e.across[1]));
 const probes=[offset(n,along,seed.reach,across,0),offset(n,along,-seed.reach,across,0),offset(n,along,0,across,seed.reach),offset(n,along,0,across,-seed.reach)];
 if(probes.some(p=>!world(p).land))return null;
 const rise=Math.min(smoothed(probes[0]),smoothed(probes[1]))-d.h,drop=d.h-Math.max(smoothed(probes[2]),smoothed(probes[3])),prominence=Math.min(rise,drop);
 if(prominence<25||Math.hypot(d.gx,d.gy)*seed.reach>prominence*.25)return null;
 return {id:seed.id,n,along,across,reach:seed.reach,height:world(n).height,prominence};
}
export async function nearbyPasses(route,world,hooks={}){
 const entry=await seedsFor(world,hooks);
 if(!entry.passes){
  const passes=[];
  for(let i=0;i<entry.seeds.length;i++){
   const p=refine(entry.seeds[i],world);
   if(p&&!passes.some(q=>distance(p.n,q.n)<Math.min(2000,Math.min(p.reach,q.reach)*.15)))passes.push(p);
   if(i%8===7){hooks.progress?.('Identifying mountain passes',i+1,entry.seeds.length);await pause();if(hooks.cancelled?.())throw Error('cancelled');}
  }
  entry.passes=passes;
 }
 const stride=Math.max(1,Math.floor(route.points.length/160)),guide=route.points.filter((_,i)=>i%stride===0||i===route.points.length-1);
 return entry.passes.filter(pass=>guide.some(p=>(pass.n[0]-p.n[0])**2+(pass.n[1]-p.n[1])**2+(pass.n[2]-p.n[2])**2<((pass.reach*2.4+route.length/160)/R)**2));
}
// A pass applies only to a nearby crossing of its ridge, never to track running
// along one valley. Test a local window on both sides of the actual crossing.
export function crossing(route,pass){
 const ps=route.points;let best=null;
 for(let i=1;i<ps.length;i++){
  const a=ps[i-1],b=ps[i],x0=dot(a.n,pass.across)*R,x1=dot(b.n,pass.across)*R;
  if(x0*x1>0||Math.abs(x1-x0)<1e-6)continue;
  const t=clamp(-x0/(x1-x0),0,1),n=unit(a.n.map((v,k)=>v*(1-t)+b.n[k]*t)),offset=dot(n,pass.along)*R;
  if(Math.abs(offset)>pass.reach*1.7||dot(n,pass.n)<Math.cos(pass.reach*1.8/R))continue;
  const station=a.station+(b.station-a.station)*t,span=pass.reach*1.5;
  let before=i-1,after=i;while(before>0&&station-ps[before].station<span)before--;while(after<ps.length-1&&ps[after].station-station<span)after++;
  const xb=dot(ps[before].n,pass.across)*R,xa=dot(ps[after].n,pass.across)*R;
  if(xb*xa>=0||Math.min(Math.abs(xb),Math.abs(xa))<Math.min(pass.reach*.35,(ps[after].station-ps[before].station)*.2))continue;
  const h=a.h+(b.h-a.h)*t,result={n,station,offset,height:h,index:i,before,after};if(!best||Math.abs(offset)<Math.abs(best.offset))best=result;
 }
 return best;
}
export function bypassPenalty(route,pass){
 const c=crossing(route,pass);if(!c)return 0;
 const excess=c.height-pass.height-Math.max(3,pass.prominence*.04);if(excess<=0)return 0;
 const fade=1-clamp((Math.abs(c.offset)/pass.reach-1)/.7,0,1);
 return fade*Math.min(pass.reach*.9,15000,Math.abs(c.offset)*.7+excess*20);
}
function warped(route,pass,map,fraction,windowScale){
 const c=crossing(route,pass);if(!c)return null;
 const length=route.length,window=Math.min(pass.reach*windowScale,c.station*.85,(length-c.station)*.85);
 if(window<Math.max(500,Math.abs(c.offset)*2))return null;
 const target=map.xy(pass.n),original=map.xy(c.n),delta=target.map((v,k)=>(v-original[k])*fraction),stations=route.points.map(p=>p.station);
 let closest=0;for(let i=1;i<stations.length;i++)if(Math.abs(stations[i]-c.station)<Math.abs(stations[closest]-c.station))closest=i;
 if(Math.abs(stations[closest]-c.station)<.01)stations[closest]=c.station;else stations.push(c.station);
 stations.sort((a,b)=>a-b);let index=1;const geometry=[];
 for(const station of stations){
  while(index<route.points.length-1&&route.points[index].station<station)index++;
  const a=route.points[index-1],b=route.points[index],t=clamp((station-a.station)/(b.station-a.station),0,1),n=unit(a.n.map((v,k)=>v*(1-t)+b.n[k]*t)),xy=map.xy(n),u=(station-c.station)/window,w=Math.abs(u)<1?(1-u*u)**3:0;
  geometry.push({n:w?map.n(...xy.map((v,k)=>v+delta[k]*w)):n});
 }
 // Retain the original dense curve outside the local approach. Resimplifying
 // an entire long line here can destroy distant tight curves or shore clearance.
 const path={geometry};
 return path;
}
export async function guidePasses(candidates,map,world,p,hooks,attempt){
 if(!p.passPreference)return;
 const engineering=r=>r.engineeringScore??r.score,confirmed=[],attempted=new Set();let considered=0;
 const rank=()=>{for(const r of candidates){r.engineeringScore=engineering(r);r.passPenalty=p.passPreference*confirmed.reduce((s,pass)=>s+Math.min(pass.costCap,bypassPenalty(r,pass)*pass.costScale),0);r.score=r.engineeringScore+r.passPenalty;}candidates.sort((a,b)=>a.score-b.score);};
 rank();const passes=await nearbyPasses(candidates[0],world,hooks);
 for(let iteration=0;iteration<3;iteration++){
  rank();const base=candidates[0],options=passes.filter(pass=>!attempted.has(pass.id)).map(pass=>({pass,penalty:bypassPenalty(base,pass)})).filter(o=>o.penalty>100).sort((a,b)=>b.penalty-a.penalty);
  if(!options.length)break;
  const {pass,penalty}=options[0],c=crossing(base,pass),costScale=Math.max(1,engineering(base)/base.length),costCap=engineering(base)*.04,allowance=Math.min(costCap,penalty*costScale)*p.passPreference;attempted.add(pass.id);considered++;
  const span=base.points[c.after].station-base.points[c.before].station,detourBudget=Math.max(750,span*.12),detour=distance(base.points[c.before].n,pass.n)+distance(pass.n,base.points[c.after].n)-span;
  if(detour>detourBudget)continue;
  hooks.progress?.('Refining mountain pass approaches',iteration+1,3);let feasible=false;
  for(const[fraction,window]of[[1,2],[1,3],[.7,3]]){
   const path=warped(base,pass,map,fraction,window);if(!path)continue;const result=await attempt(path,3);
   if(result&&result.length-base.length<=detourBudget&&engineering(result)-engineering(base)<=allowance&&bypassPenalty(result,pass)<penalty*.7){feasible=true;break;}
   await pause();if(hooks.cancelled?.())throw Error('cancelled');
  }
  if(feasible)confirmed.push({...pass,costScale,costCap});
 }
 rank();for(const result of candidates){const used=confirmed.filter(pass=>{const c=crossing(result,pass);return c&&Math.abs(c.offset)<Math.min(1500,pass.reach*.15);});result.passGuidance={considered,used:used.length,penalty:result.passPenalty,passes:used.map(({id,n,height})=>({id,n,height}))};}
}
