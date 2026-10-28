import {createSurfaceSampler} from './surface.js?v=2.4.0';
import {setPlanetRadius,HEIGHT_METERS} from './scale.js?v=2.4.0';
import {planNetworkRoute} from './rail-network.js?v=2.4.0';
let version=0,world=null;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    version++;setPlanetRadius(data.config.radius);const sampler=createSurfaceSampler({...data.config,terrain:new Uint8Array(data.terrain),lakes:new Uint8Array(data.lakes)});
    world=n=>({height:(sampler.rendered(n)-1)*HEIGHT_METERS,land:sampler.fields(n).land});return;
  }
  if(data.type==='cancel'){version++;return;}
  if(data.type!=='plan'||!world)return;
  const own=++version,sample=world,started=performance.now();
  try{
    const result=await planNetworkRoute(data.start,data.end,sample,data.parameters,data.network,{cancelled:()=>version!==own,progress:(stage,expanded,budget)=>{if(version===own)postMessage({type:'progress',id:data.id,stage,expanded,budget});}});
    if(version===own)postMessage({type:'result',id:data.id,result:{...result,milliseconds:performance.now()-started}});
  }catch(error){if(version===own)postMessage({type:'result',id:data.id,result:{error:error.message==='cancelled'?'Search cancelled.':'Routing failed: '+error.message}});}
};
