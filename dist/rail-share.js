// Replace nearby parallel stretches of a feasible terrain corridor with exact
// built track. Several disjoint replacements can serve one new connection.
import {unit,dot,tangent,distance,clamp} from './rail.js?v=2.5.0';
import {fitTransition} from './rail-corridor.js?v=2.5.0';
const pause=()=>new Promise(r=>setTimeout(r,0));
function direction(points,i){
 const p=points[i],next=i+1<points.length?tangent(p.n,points[i+1].n):null,prior=i?tangent(p.n,points[i-1].n).map(v=>-v):null;
 return next&&prior?unit(next.map((v,k)=>v+prior[k])):next||prior;
}
export async function shareCorridors(terrain,network,world,p,hooks,helpers){
 const {nearestOnTrack,pointOnTrack,assemble}=helpers,ps=terrain.points,length=terrain.length;
 if(!network.tracks.length||ps.length<3||!p.reusePreference)return null;
 const stations=ps.map(p=>p.station),indexAt=s=>{let lo=0,hi=ps.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(stations[m]<s)lo=m;else hi=m;}return Math.abs(stations[lo]-s)<Math.abs(stations[hi]-s)?lo:hi;};
 const spacing=clamp(length/110,400,1800),indices=[0];for(let s=spacing;s<length;s+=spacing){const i=indexAt(s);if(i!==indices.at(-1))indices.push(i);}if(indices.at(-1)!==ps.length-1)indices.push(ps.length-1);
 const reach=clamp(length*.06,1500,8000),runs=[];
 for(const track of network.tracks){
  let run=null;
  const finish=()=>{if(run&&run.matches.length>2){run.lo=run.matches[0].i;run.hi=run.matches.at(-1).i;run.span=stations[run.hi]-stations[run.lo];if(run.span>Math.max(2500,p.minRadius*8)){run.rank=run.span/(1+run.gap/run.matches.length/Math.max(500,p.minRadius));runs.push(run);}}run=null;};
  for(const i of indices){
   const point=ps[i],q=nearestOnTrack(track,point.n),total=track.stations.at(-1),a=pointOnTrack(track,Math.max(0,q.station-20)),b=pointOnTrack(track,Math.min(total,q.station+20)),heading=tangent(a.n,b.n),alignment=dot(direction(ps,i),heading),sign=Math.sign(alignment)||1;
   if(q.gap>reach||Math.abs(alignment)<.72){finish();continue;}
   const previous=run?.matches.at(-1),advance=previous?(q.station-previous.q.station)*sign:0,ds=previous?stations[i]-stations[previous.i]:0;
   if(run&&(run.sign!==sign||advance<Math.max(2,ds*.12)||advance>ds*2.2+100)){finish();}
   if(!run)run={track,sign,matches:[],gap:0};run.matches.push({i,q});run.gap+=q.gap;
  }
  finish();await pause();if(hooks.cancelled?.())throw Error('cancelled');
 }
 runs.sort((a,b)=>b.rank-a.rank);const candidates=[];let trial=0;
 const nearFixed=(point,q)=>distance(point.n,q.n)<.05&&Math.abs(point.h-q.h)<.02;
 const trackHeading=(track,s,sign)=>{const a=pointOnTrack(track,Math.max(0,s-20)),b=pointOnTrack(track,Math.min(track.stations.at(-1),s+20)),n=pointOnTrack(track,s).n,f=tangent(a.n,b.n);return unit(f.map((v,k)=>(v-dot(f,n)*n[k])*sign));};
 for(const run of runs.slice(0,10)){
  const {track,sign}=run,lo=run.lo,hi=run.hi,qa=nearestOnTrack(track,ps[lo].n),qb=nearestOnTrack(track,ps[hi].n),fixedA=nearFixed(ps[lo],qa),fixedB=nearFixed(ps[hi],qb);
  const requiredA=Math.max(p.minRadius*6,2000,qa.gap*3,Math.abs(qa.h-ps[lo].h)/p.maxGrade*1.5),requiredB=Math.max(p.minRadius*6,2000,qb.gap*3,Math.abs(qb.h-ps[hi].h)/p.maxGrade*1.5);
  let best=null;
  for(const factor of[0,1,1.7,2.7]){
   if(hooks.cancelled?.())throw Error('cancelled');hooks.progress?.('Fitting shared corridors',++trial,Math.min(runs.length,10)*4);
   const entryIndex=fixedA?lo:indexAt(stations[lo]+requiredA*factor),exitIndex=fixedB?hi:indexAt(stations[hi]-requiredB*factor);
   if(entryIndex>=exitIndex||entryIndex>hi||exitIndex<lo)continue;
   const entry=fixedA?qa:nearestOnTrack(track,ps[entryIndex].n),exit=fixedB?qb:nearestOnTrack(track,ps[exitIndex].n);
   if((exit.station-entry.station)*sign<Math.max(1500,p.minRadius*4))continue;
   const parts=[];
   if(!fixedA){
    const guide=ps.slice(lo,entryIndex+1).filter((_,i)=>i%Math.max(1,Math.floor((entryIndex-lo)/40))===0).map(p=>p.n);guide.push(entry.n);
    const r=await fitTransition(ps[lo].n,entry.n,guide,world,p,{...hooks,endpointHeights:[ps[lo].h,entry.h],endpointDirections:[direction(ps,lo),trackHeading(track,entry.station,sign)]});if(!r)continue;parts.push({points:r.points});
   }
   parts.push({trackId:track.id,from:entry.station,to:exit.station});
   if(!fixedB){
    const guide=[exit.n,...ps.slice(exitIndex,hi+1).filter((_,i)=>i%Math.max(1,Math.floor((hi-exitIndex)/40))===0).map(p=>p.n)];if(distance(guide.at(-1),ps[hi].n)>.01)guide.push(ps[hi].n);
    const r=await fitTransition(exit.n,ps[hi].n,guide,world,p,{...hooks,endpointHeights:[exit.h,ps[hi].h],endpointDirections:[trackHeading(track,exit.station,sign),direction(ps,hi)]});if(!r)continue;parts.push({points:r.points});
   }
   const local=assemble(parts,network,world,p);if(!local)continue;
   if(!best||local.networkScore<best.local.networkScore)best={lo,hi,parts,local};
   if(fixedA&&fixedB)break;
   await pause();
  }
  if(best){const baseline=assemble([{points:ps.slice(lo,hi+1)}],network,world,p);if(baseline){best.gain=baseline.networkScore-best.local.networkScore;if(best.gain>Math.max(100,(stations[hi]-stations[lo])*.01))candidates.push(best);}}
 }
 if(!candidates.length)return null;
 // Weighted interval scheduling combines savings from separate old lines. This
 // also works when their graph components have no existing connection at all.
 candidates.sort((a,b)=>a.hi-b.hi);const dp=[{gain:0,items:[]}];
 for(let i=0;i<candidates.length;i++){let j=i-1;while(j>=0&&candidates[j].hi>candidates[i].lo)j--;const yes={gain:dp[j+1].gain+candidates[i].gain,items:[...dp[j+1].items,candidates[i]]},no=dp[i];dp.push(yes.gain>no.gain?yes:no);}
 const build=items=>{const parts=[];let cursor=0;for(const c of items.toSorted((a,b)=>a.lo-b.lo)){if(c.lo>cursor)parts.push({points:ps.slice(cursor,c.lo+1)});parts.push(...c.parts);cursor=c.hi;}if(cursor<ps.length-1)parts.push({points:ps.slice(cursor)});return assemble(parts,network,world,p);};
 let chosen=dp.at(-1).items,result=build(chosen);
 // Validate the complete route too: independent local changes can interact.
 while(!result&&chosen.length>1){const worst=chosen.reduce((a,b)=>a.gain<b.gain?a:b);chosen=chosen.filter(c=>c!==worst);result=build(chosen);}
 if(hooks.cancelled?.())throw Error('cancelled');return result;
}
