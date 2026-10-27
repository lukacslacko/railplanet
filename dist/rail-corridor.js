// Terrain corridors first, engineering profile second. A coarse grid does not
// need to commit to an exact track height or a particular 650 m circular arc.
import {R,unit,cross,dot,tangent,distance,angle,clamp,evaluate} from './rail.js?v=2.1.0';
class Heap{
 constructor(){this.a=[];} push(n){let i=this.a.length;this.a.push(n);while(i){const j=(i-1)>>1;if(this.a[j].f<=n.f)break;this.a[i]=this.a[j];i=j;}this.a[i]=n;}
 pop(){const a=this.a,n=a[0],v=a.pop();if(a.length){let i=0;while(2*i+1<a.length){let j=2*i+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=v.f)break;a[i]=a[j];i=j;}a[i]=v;}return n;} get size(){return this.a.length;}
}
const pause=()=>new Promise(r=>setTimeout(r,0));
function chart(start,end){
 const c=unit(start.map((v,i)=>v+end[i])),east=tangent(c,end),north=cross(c,east);
 return {xy:n=>{const a=angle(c,n),s=Math.sin(a);return s>1e-9?[dot(n,east)*a*R/s,dot(n,north)*a*R/s]:[0,0];},
  n:(x,y)=>{const d=Math.hypot(x,y),a=d/R,k=d?Math.sin(a)/d:1/R;return unit(c.map((v,i)=>v*Math.cos(a)+(east[i]*x+north[i]*y)*k));}};
}
function simplify(path,tolerance){
 if(path.length<=2)return path;let max=0,index=0;const a=path[0],b=path.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
 for(let i=1;i<path.length-1;i++){const p=path[i],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/Math.max(1,l),0,1),d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d>max){max=d;index=i;}}
 return max>tolerance?[...simplify(path.slice(0,index+1),tolerance).slice(0,-1),...simplify(path.slice(index),tolerance)]:[a,b];
}
function spline(path,map,spacing=35){
 const points=[];
 for(let i=0;i<path.length-1;i++){
  const a=path[Math.max(0,i-1)],b=path[i],c=path[i+1],d=path[Math.min(path.length-1,i+2)],count=Math.max(2,Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1])/spacing));
  for(let j=0;j<count;j++){const t=j/count,t2=t*t,t3=t2*t,xy=b.map((v,k)=>.5*(2*v+(-a[k]+c[k])*t+(2*a[k]-5*v+4*c[k]-d[k])*t2+(-a[k]+3*v-3*c[k]+d[k])*t3));points.push({n:map.n(...xy),xy});}
 }
 points.push({n:map.n(...path.at(-1)),xy:path.at(-1).slice()});return points;
}
function roundControls(path,amount){return path.map((p,i)=>i===0||i===path.length-1?p.slice():p.map((v,k)=>v*(1-amount)+(path[i-1][k]+path[i+1][k])*amount/2));}
// Propagate the complete reachable height interval, then backtrack. Unlike a
// local height beam this cannot lose a feasible profile by quantizing its height.
export function fitProfile(points,world,p){
 const count=points.length,lo=new Float64Array(count),hi=new Float64Array(count),ground=new Float64Array(count),station=new Float64Array(count),target=new Float64Array(count);
 for(let i=0;i<count;i++){
  const n=points[i].n,s=world(n);if(!s.land)return null;ground[i]=s.height;station[i]=i?station[i-1]+distance(points[i-1].n,n):0;
  const f=tangent(n,points[i+1<count?i+1:i-1].n),side=cross(n,f),plus=world(unit(n.map((v,k)=>v+side[k]*4/R))),minus=world(unit(n.map((v,k)=>v-side[k]*4/R))),edge=Math.abs(plus.height-minus.height)/2;
  lo[i]=s.height-Math.max(0,p.maxEarthwork-edge-.2);hi[i]=s.height+Math.max(p.maxBridge?Math.max(0,p.maxBridge-edge-.2):0,Math.max(0,p.maxEarthwork-edge-.2));
 }
 lo[0]=hi[0]=ground[0];lo[count-1]=hi[count-1]=ground[count-1];
 for(let i=1;i<count;i++){const dh=(station[i]-station[i-1])*p.maxGrade*.999;lo[i]=Math.max(lo[i],lo[i-1]-dh);hi[i]=Math.min(hi[i],hi[i-1]+dh);if(lo[i]>hi[i]+1e-7)return null;}
 for(let i=count-2;i>=0;i--){const dh=(station[i+1]-station[i])*p.maxGrade*.999;lo[i]=Math.max(lo[i],lo[i+1]-dh);hi[i]=Math.min(hi[i],hi[i+1]+dh);if(lo[i]>hi[i]+1e-7)return null;}
 // A 600 m window removes high-frequency vertical jolts before bounded fitting.
 let left=0,right=0,sum=0;
 for(let i=0;i<count;i++){while(right<count&&station[right]<station[i]+300){sum+=ground[right++];}while(station[left]<station[i]-300){sum-=ground[left++];}target[i]=.35*ground[i]+.65*sum/Math.max(1,right-left);}
 const heights=new Float64Array(count);heights[count-1]=ground[count-1];
 for(let i=count-2;i>=0;i--){const dh=(station[i+1]-station[i])*p.maxGrade*.999;heights[i]=clamp(target[i],Math.max(lo[i],heights[i+1]-dh),Math.min(hi[i],heights[i+1]+dh));}
 for(let pass=0;pass<30;pass++)for(let j=1;j<count-1;j++){
  const i=pass%2?count-1-j:j,dl=station[i]-station[i-1],dr=station[i+1]-station[i],slope=(heights[i-1]*dr+heights[i+1]*dl)/(dl+dr);
  heights[i]=clamp(.08*target[i]+.92*slope,Math.max(lo[i],heights[i-1]-dl*p.maxGrade*.999,heights[i+1]-dr*p.maxGrade*.999),Math.min(hi[i],heights[i-1]+dl*p.maxGrade*.999,heights[i+1]+dr*p.maxGrade*.999));
 }
 return points.map((point,i)=>({...point,h:heights[i],ground:ground[i],station:station[i]}));
}
async function gridRoute(start,end,map,world,p,{spacing,margin,gradeWeight,penalty=null,hooks}){
 const a=map.xy(start),b=map.xy(end),xmin=a[0]-margin,ymin=-margin,nx=Math.ceil((b[0]-a[0]+2*margin)/spacing)+1,ny=Math.ceil(2*margin/spacing)+1;
 if(nx*ny>180000)return null;
 const n=nx*ny,known=new Uint8Array(n),samples=new Array(n),cost=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),closed=new Uint8Array(n),queue=new Heap();
 const xy=i=>[xmin+(i%nx)*spacing,ymin+Math.floor(i/nx)*spacing],sample=i=>{if(!known[i]){const q=xy(i),dir=map.n(...q);samples[i]={...(Math.hypot(...q)<Math.PI*R*.98?world(dir):{height:0,land:false}),n:dir,xy:q};known[i]=1;}return samples[i];};
 const id=q=>clamp(Math.round((q[1]-ymin)/spacing),0,ny-1)*nx+clamp(Math.round((q[0]-xmin)/spacing),0,nx-1),si=id(a),ei=id(b);
 samples[si]={...world(start),n:start,xy:a};samples[ei]={...world(end),n:end,xy:b};known[si]=known[ei]=1;
 const edge=(s,t)=>{
  if(!t.land)return Infinity;const length=distance(s.n,t.n),steps=Math.max(2,Math.ceil(length/Math.min(350,spacing/2)));let rough=0;
  for(let j=1;j<steps;j++){const q=j/steps,v=world(unit(s.n.map((x,k)=>x*(1-q)+t.n[k]*q)));if(!v.land)return Infinity;rough+=Math.abs(v.height-(s.height*(1-q)+t.height*q))/steps;}
  const grade=Math.abs(t.height-s.height)/Math.max(1,length),excess=Math.max(0,grade/p.maxGrade-.65);
  return length*(1+gradeWeight*Math.min(200,excess*excess)+.3*rough/Math.max(10,p.maxEarthwork+p.maxBridge*.3));
 };
 const directions=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2],[1,-2],[2,-1]];
 cost[si]=0;queue.push({i:si,g:0,f:distance(start,end)});let expanded=0;
 while(queue.size&&expanded<130000){
  const node=queue.pop(),i=node.i;if(closed[i]||node.g!==cost[i])continue;closed[i]=1;expanded++;
  if(i===ei){const path=[];for(let q=i;q>=0;q=parent[q])path.push(sample(q).xy);return {path:path.reverse(),expanded,spacing};}
  const s=sample(i),x=i%nx,y=Math.floor(i/nx);
  for(const[dx,dy]of directions){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=nx||yy>=ny)continue;const k=yy*nx+xx;if(closed[k])continue;const t=sample(k),c=edge(s,t);if(!Number.isFinite(c))continue;
   let extra=0;if(parent[i]>=0){const prev=sample(parent[i]),u=tangent(s.n,prev.n).map(v=>-v),v=tangent(s.n,t.n),yaw=angle(u,v);extra=distance(s.n,t.n)*yaw*.18;}
   if(penalty){let d=Infinity;for(let j=0;j<penalty.length;j+=3)d=Math.min(d,Math.hypot(t.xy[0]-penalty[j][0],t.xy[1]-penalty[j][1]));extra+=c*.45*Math.exp(-((d/(spacing*3))**2));}
   const g=node.g+c+extra;if(g>=cost[k])continue;cost[k]=g;parent[k]=i;queue.push({i:k,g,f:g+1.1*distance(t.n,end)});
  }
  if(expanded%400===0){hooks.progress?.('Finding land corridors',expanded,130000);await pause();if(hooks.cancelled?.())throw Error('cancelled');}
 }
 return null;
}
export async function hierarchicalRoute(start,end,world,p,hooks={}){
 if(hooks.cancelled?.())throw Error('cancelled');
 const direct=distance(start,end);if(angle(start,end)>Math.PI-.0001)return null;
 const map=chart(start,end),candidates=[];let expanded=0,lastPath=null;
 const attempt=async(path)=>{
  let controls=simplify(path,Math.max(2,Math.min(180,p.minRadius*.3)));
  // Smoothing progressively rounds grid corners; endpoints remain exact.
  for(let smooth=0;smooth<7;smooth++){
   const geometry=spline(controls,map,clamp(direct/5000,20,50));geometry[0].n=start.slice();geometry.at(-1).n=end.slice();
   const profile=fitProfile(geometry,world,p);
   if(profile){const result=evaluate(profile,world,p);if(result){candidates.push(result);return true;}}
   if(controls.length===2)break;
   controls=roundControls(controls,.22);await pause();if(hooks.cancelled?.())throw Error('cancelled');
  }
  return false;
 };
 hooks.progress?.('Fitting direct profile',0,1);await attempt([map.xy(start),map.xy(end)]);
 if(candidates.length&&candidates[0].score<direct*1.08)return {...candidates[0],alternatives:1,expanded};
 const spacing=Math.max(direct/150,clamp(direct/85,Math.max(150,p.minRadius*1.8),3200));
 for(let pass=0;pass<4;pass++){
  const step=spacing*(pass===2?.55:pass===3?1.25:1),margin=Math.max(5000,direct*(pass===3?1:.45));
  const result=await gridRoute(start,end,map,world,p,{spacing:step,margin,gradeWeight:[5,16,8,12][pass],penalty:pass===1?lastPath:null,hooks});
  if(result){expanded+=result.expanded;lastPath=result.path;hooks.progress?.('Fitting grades and bridges',pass+1,4);await attempt(result.path);}
  if(candidates.length>=2||candidates.length&&pass>=1)break;
 }
 // Refine a broad corridor locally by shortening its controls only when the
 // exact profile, footprint, curve and water checks still pass.
 if(!candidates.length)return null;
 candidates.sort((a,b)=>a.score-b.score);let best=candidates[0];
 const stride=Math.max(2,Math.round(best.points.length/80)),guide=best.points.filter((_,i)=>i%stride===0||i===best.points.length-1).map(p=>map.xy(p.n));
 for(let pass=0;pass<2;pass++){const before=candidates.length;await attempt(roundControls(guide,.15+pass*.15));if(candidates.length>before)candidates.sort((a,b)=>a.score-b.score);}
 best=candidates[0];return {...best,alternatives:candidates.length,expanded};
}
