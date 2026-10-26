import {createSurfaceSampler} from './surface.js?v=2.0.0';
import {planRoute,R} from './rail.js?v=2.0.0';
let version=0,world=null;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    version++;const sampler=createSurfaceSampler({...data.config,terrain:new Uint8Array(data.terrain),lakes:new Uint8Array(data.lakes)});
    world=n=>({height:(sampler.rendered(n)-1)*R,land:sampler.fields(n).land});return;
  }
  if(data.type==='cancel'){version++;return;}
  if(data.type!=='plan'||!world)return;
  const own=++version,sample=world,started=performance.now();
  try{
    const result=await planRoute(data.start,data.end,sample,data.parameters,{cancelled:()=>version!==own,progress:(stage,expanded,budget)=>{if(version===own)postMessage({type:'progress',id:data.id,stage,expanded,budget});}});
    if(version===own)postMessage({type:'result',id:data.id,result:{...result,milliseconds:performance.now()-started}});
  }catch(error){if(version===own)postMessage({type:'result',id:data.id,result:{error:error.message==='cancelled'?'Search cancelled.':'Routing failed: '+error.message}});}
};
