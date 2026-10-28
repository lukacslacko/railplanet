import * as S from './shaders.js?v=2.3.0';
import * as Orbit from './orbit.js?v=2.3.0';
import {RailNetwork} from './rail-network.js?v=2.3.0';
import {snapToNetwork,projectTrackPoint} from './rail-snap.js?v=2.3.0';
import {RailwayRenderer} from './rail-render.js?v=2.3.0';
import {R as PLANET_METERS,HEIGHT_METERS,setPlanetRadius} from './scale.js?v=2.3.0';
import {unit as railUnit} from './rail.js?v=2.3.0';
import * as Flight from './flight.js?v=2.3.0';
import {createSurfaceSampler} from './surface.js?v=2.3.0';
import {cubeSphereData} from './mesh.js?v=2.3.0';
import {createNoise,normalizeNoiseSettings,MAX_LAYERS,WAVES_PER_BAND} from './noise.js?v=2.3.0';
const $=id=>document.getElementById(id);
const canvas=$('planet');
const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance',depth:true,stencil:false});
function showError(message){$('loading').hidden=true;$('error').hidden=false;$('error').textContent=message;}
if(!gl){showError('This planet needs WebGL 2. Please open it in a browser with hardware acceleration enabled.');}else{try{start();}catch(e){console.error(e);showError('The planet could not start: '+e.message);}}
function start(){
const MAP_W=2048,MAP_H=1024;
const homeDistance=()=>innerWidth<760?Math.max(3.95,innerHeight/innerWidth*3.2):3.95;
const state={seed:'42',relief:1.4,sea:0,mode:0,quality:192,noise:normalizeNoiseSettings(),orientation:Orbit.home(),targetOrientation:Orbit.home(),distance:3.95,targetDistance:3.95,dirty:true,busy:false,water:0,max:0,job:0,triangles:0};
let worker=new Worker('./hydrology.js?v=2.3.0'),mapPixels=null,mesh=null,pixelRatio=Math.min(devicePixelRatio,1.5),vp,cam=[0,0,3.95],lastTime=0;
let sun=[0,0,1],flight=null,surfaceAt=null,lakePixels=null,lakeWidth=MAP_W,lakeHeight=MAP_H;
const held=new Set();
const network=new RailNetwork();
const railway={points:[],selecting:false,pending:false,replaceLast:false,hover:null,job:0,worker:null,lastPick:0,lastProgress:0,lastHover:0};
const programs={terrain:program(S.terrainVertex,S.terrainFragment),generator:program(S.fullscreenVertex,S.generateFragment),riverAtlas:program(S.riverAtlasVertex,S.riverAtlasFragment)};
const uniforms=new Map();
const railwayRenderer=new RailwayRenderer(gl);
function program(vs,fs){const p=gl.createProgram();for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function loc(p,name){if(!uniforms.has(p))uniforms.set(p,new Map());const m=uniforms.get(p);if(!m.has(name))m.set(name,gl.getUniformLocation(p,name));return m.get(name);}
function texture(w,h,pixels,filter=gl.LINEAR){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return t;}
// A small floating-point wave atlas avoids fragment-uniform limits as layers grow.
const waveTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,waveTexture);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,WAVES_PER_BAND,MAX_LAYERS,0,gl.RGBA,gl.FLOAT,null);
const terrainTexture=texture(MAP_W,MAP_H,null);
const slopeTexture=texture(MAP_W,MAP_H,null);
let drainageTexture=texture(1,1,new Uint8Array([127,255,0,255]));
const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,terrainTexture,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,slopeTexture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Terrain framebuffer unavailable.');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
const emptyVAO=gl.createVertexArray();
const ATLAS_W=Math.min(8192,gl.getParameter(gl.MAX_TEXTURE_SIZE)),ATLAS_H=ATLAS_W/2;
const riverMaskTexture=gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D,riverMaskTexture);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,ATLAS_W,ATLAS_H,0,gl.RED,gl.UNSIGNED_BYTE,null);
const riverFramebuffer=gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER,riverFramebuffer);
gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,riverMaskTexture,0);
if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('River atlas framebuffer unavailable.');
gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
function bakeRivers(vertices,feather){
  const vao=gl.createVertexArray(),buffer=gl.createBuffer();
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,1,gl.FLOAT,false,16,12);
  gl.bindFramebuffer(gl.FRAMEBUFFER,riverFramebuffer);
  gl.viewport(0,0,ATLAS_W,ATLAS_H);
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
  gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);
  gl.useProgram(programs.riverAtlas);
  gl.uniform1f(loc(programs.riverAtlas,'feather'),feather);
  gl.drawArrays(gl.TRIANGLES,0,vertices.length/4);
  gl.blendEquation(gl.FUNC_ADD);gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
  gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
}

function cubeSphere(n){const {positions,indices}=cubeSphereData(n);return makeMesh(positions,indices);}
function makeMesh(positions,indices=null){const vao=gl.createVertexArray(),vbo=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);let ibo=null;if(indices){ibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);}gl.bindVertexArray(null);return {vao,vbo,ibo,count:indices?indices.length:positions.length/3};}
function deleteMesh(m){if(!m)return;gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.vbo);if(m.ibo)gl.deleteBuffer(m.ibo);}
function setQuality(n){deleteMesh(mesh);mesh=cubeSphere(n);state.quality=n;state.triangles=mesh.count/3;refreshSurface();state.dirty=true;}
setQuality(state.quality);
function setBusy(b,message=''){state.busy=b;if(b)held.clear();$('generate').disabled=b;$('random-seed').disabled=b;$('rail-toggle').disabled=b||!lakePixels;$('rail-pick').disabled=b||railway.pending;$('rail-replan').disabled=b||railway.points.length<2||railway.pending;$('flight-toggle').disabled=!surfaceAt||(b&&!flight);$('generation-state').textContent=message;$('generation-state').hidden=!message;}
let noiseTimer, generationQueued=false;
function generate(){clearTimeout(noiseTimer);if(state.busy){generationQueued=true;return;}generationQueued=false;resetRailway();state.noise=normalizeNoiseSettings({frequency:$('frequency').value,color:$('noise-color').value,layers:$('layers').value});state.seed=$('seed').value.trim()||'42';$('seed').value=state.seed;const url=new URL(location.href);url.searchParams.set('seed',state.seed);url.searchParams.set('frequency',state.noise.frequency);url.searchParams.set('color',state.noise.color);url.searchParams.set('layers',state.noise.layers);history.replaceState(null,'',url);setBusy(true,'Generating terrain…');$('loading').hidden=false;$('loading').style.opacity='1';$('loading-message').textContent='Generating terrain…';
// Yield a paint before the single GPU generation pass and its one-time readback.
requestAnimationFrame(()=>requestAnimationFrame(()=>{try{gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,MAP_W,MAP_H);gl.disable(gl.DEPTH_TEST);gl.useProgram(programs.generator);const spectrum=createNoise(state.seed,state.noise);gl.uniform1fv(loc(programs.generator,'bandAmplitudes[0]'),spectrum.amplitudes);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,waveTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,WAVES_PER_BAND,MAX_LAYERS,gl.RGBA,gl.FLOAT,spectrum.terrain);gl.uniform1i(loc(programs.generator,'terrainWaves'),4);gl.uniform1i(loc(programs.generator,'noiseLayers'),state.noise.layers);gl.uniform4fv(loc(programs.generator,'moistureWaves[0]'),spectrum.moisture);gl.bindVertexArray(emptyVAO);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(MAP_W*MAP_H*4);gl.readPixels(0,0,MAP_W,MAP_H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);mapPixels=pixels;refreshSurface();gl.bindFramebuffer(gl.FRAMEBUFFER,null);drain();state.dirty=true;}catch(e){setBusy(false,'Generation failed. Try another world.');showError(e.message);}}));}
function drain(){if(!mapPixels)return;resetRailway();setBusy(true,'Calculating rivers and lakes…');$('loading-message').textContent='Calculating rivers and lakes…';const copy=mapPixels.slice();const id=++state.job;worker.postMessage({pixels:copy.buffer,width:MAP_W,height:MAP_H,sea:state.sea,id},[copy.buffer]);}
worker.onmessage=({data})=>{if(data.id!==state.job)return;gl.deleteTexture(drainageTexture);lakePixels=new Uint8Array(data.lakes);lakeWidth=data.width;lakeHeight=data.height;drainageTexture=texture(data.width,data.height,lakePixels);bakeRivers(new Float32Array(data.rivers),data.feather);state.water=data.water;state.max=data.max;refreshSurface();setBusy(false);$('loading').style.opacity='0';setTimeout(()=>{if(!state.busy)$('loading').hidden=true;},450);state.dirty=true;console.info('World ready '+JSON.stringify({seed:state.seed,frequency:state.noise.frequency,noiseColor:state.noise.color,layers:state.noise.layers,heightSamples:MAP_W*MAP_H,triangles:state.triangles,riverSegments:data.segments,curvedPaths:data.pathCount,curveSamples:data.curveSamples,drainageSamples:data.width*data.height,riverAtlas:ATLAS_W,lakeCells:data.lakeCells}));if(generationQueued)generate();};
worker.onerror=e=>{console.error(e);setBusy(false,'Drainage could not finish. Generate to retry.');$('loading').hidden=true;};
function refreshSurface(){
  if(!mapPixels)return;
  surfaceAt=createSurfaceSampler({terrain:mapPixels,width:MAP_W,height:MAP_H,lakes:lakePixels,lakeWidth,lakeHeight,sea:state.sea,relief:state.relief,detail:state.quality});
  if(flight)Flight.constrain(flight,surfaceAt);
}
function toggleFlight(){
  if(!surfaceAt||state.busy&&!flight)return;
  held.clear();
  if(flight){
    state.orientation=Orbit.lookAtDirection(state.orientation,flight.up);
    state.targetOrientation=state.orientation.slice();flight=null;
  }else{
    const {outward,up}=Orbit.frame(state.orientation);
    flight=Flight.create(outward,up,surfaceAt);
  }
  $('flight-toggle').setAttribute('aria-pressed',!!flight);
  $('flight-toggle').title=flight?'Return to globe view · Esc':'Fly above the center of the current view';
  $('flight-info').hidden=!flight;
  $('zoom-in').setAttribute('aria-label',flight?'Fly higher':'Zoom in');
  $('zoom-out').setAttribute('aria-label',flight?'Fly lower':'Zoom out');
  canvas.setAttribute('aria-label',flight?'Airplane camera. W/S forward and backward, A/D yaw, Q/E down and up. Drag to look. Escape returns to globe view.':'Interactive 3D planet. Drag to rotate, scroll to zoom. Arrow keys rotate.');
  $('flight-toggle').disabled=state.busy&&!flight;
  state.dirty=true;canvas.focus({preventScroll:true});
}
// Column-major matrices; both camera modes share the same renderer.
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function cameraMatrix(){
  let axes;
  if(flight){Flight.constrain(flight,surfaceAt);axes=Flight.frame(flight);cam=axes.position;}
  else{axes=Orbit.frame(state.orientation);cam=axes.outward.map(v=>v*state.distance);}
  const {right:x,up:y,outward:z}=axes,dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,cam),-dot(y,cam),-dot(z,cam),1]);
  const aspect=canvas.width/canvas.height,f=1/Math.tan((flight?60:43)*Math.PI/360),near=flight?.00015:.025,far=30;
  const shift=!flight&&innerWidth>760?.18:0,yshift=flight?0:innerWidth>760?-.015:.15;
  const projection=new Float32Array([f/aspect,0,0,0,0,f,0,0,-shift,-yshift,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  // The light stays behind the viewer in both camera modes.
  sun=z;
  if(flight){
    const meters=Math.round((flight.radius-surfaceAt(flight.up))*Flight.METERS_PER_UNIT);
    $('flight-height').textContent='Height '+meters.toLocaleString()+' m';
  }
  return multiply(projection,view);
}
function bindSurface(p){gl.useProgram(p);gl.uniformMatrix4fv(loc(p,'viewProjection'),false,vp);gl.uniform3fv(loc(p,'camera'),cam);gl.uniform3fv(loc(p,'sun'),sun);gl.uniform1f(loc(p,'sea'),state.sea);gl.uniform1f(loc(p,'relief'),state.relief);gl.uniform1i(loc(p,'mode'),state.mode);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,terrainTexture);gl.uniform1i(loc(p,'terrain'),0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,drainageTexture);gl.uniform1i(loc(p,'drainage'),1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,riverMaskTexture);gl.uniform1i(loc(p,'riverMask'),2);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,slopeTexture);gl.uniform1i(loc(p,'slopeMap'),3);railwayRenderer.bindTerrain(p,loc);}
function resize(){const w=Math.round(innerWidth*pixelRatio),h=Math.round(innerHeight*pixelRatio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;state.dirty=true;}}
function draw(){resize();vp=cameraMatrix();gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(17/255,25/255,27/255,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.disable(gl.BLEND);bindSurface(programs.terrain);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);railwayRenderer.draw(vp,cam,sun,canvas);gl.bindVertexArray(null);refreshMeasures();}
function tick(now){
  requestAnimationFrame(tick);if(document.hidden){lastTime=now;return;}
  const dt=Math.min(Math.max(0,(now-lastTime)/1000),.05),amount=Math.min(1,dt*12);
  let moving=false;
  if(flight){
    const controls={move:Number(held.has('KeyW'))-Number(held.has('KeyS')),yaw:Number(held.has('KeyA'))-Number(held.has('KeyD')),lift:Number(held.has('KeyE'))-Number(held.has('KeyQ'))};
    if(!state.busy&&(controls.move||controls.yaw||controls.lift)){Flight.step(flight,controls,dt,surfaceAt);moving=true;}
  }else{
    moving=Orbit.distance(state.orientation,state.targetOrientation)>.00003;
    state.orientation=moving?Orbit.interpolate(state.orientation,state.targetOrientation,amount):state.targetOrientation.slice();
    const delta=state.targetDistance-state.distance;
    if(Math.abs(delta)>.00003){state.distance+=delta*amount;moving=true;}else state.distance=state.targetDistance;
  }
  if(state.dirty||moving){draw();state.dirty=false;}lastTime=now;
}
const pointers=new Map();let pinchDistance=0,pickGesture=null;
canvas.addEventListener('pointerdown',e=>{canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);pickGesture={x:e.clientX,y:e.clientY,dragged:pointers.size>1};if(pointers.size===2){const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);}});
canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  if(pickGesture&&Math.hypot(e.clientX-pickGesture.x,e.clientY-pickGesture.y)>6)pickGesture.dragged=true;
  const previous=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
  if(railway.selecting&&pickGesture&&!pickGesture.dragged)return;
  if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinchDistance>0&&d>0)zoom(pinchDistance/d);pinchDistance=d;}
  else if(flight){Flight.look(flight,-(e.clientX-previous[0])*.0045,-(e.clientY-previous[1])*.0045);state.dirty=true;}
  else{state.targetOrientation=Orbit.turn(state.targetOrientation,e.clientX-previous[0],e.clientY-previous[1]);state.dirty=true;}
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(type==='pointerup'&&pickGesture&&!pickGesture.dragged&&pointers.size===1&&e.button===0)pickRailwayPoint(e);pointers.delete(e.pointerId);pinchDistance=0;pickGesture=null;});
function changeHeight(delta){flight.radius+=delta;Flight.constrain(flight,surfaceAt);state.dirty=true;}
function zoom(factor){
  if(flight){changeHeight(Math.log(factor)*.12);return;}
  state.targetDistance=Math.max(1.25+Math.max(0,state.max)*state.relief,Math.min(Math.max(7,homeDistance()*1.8),state.targetDistance*factor));state.dirty=true;
}
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(Math.max(-120,Math.min(120,e.deltaY))*.0016));},{passive:false});
// Center a picked location without discarding the camera's current roll.
canvas.addEventListener('dblclick',e=>{
  if(flight||railway.selecting||performance.now()-railway.lastPick<500)return;
  const aspect=canvas.width/canvas.height,f=1/Math.tan(43*Math.PI/360),shift=innerWidth>760?.18:0,yshift=innerWidth>760?-.015:.15;
  const px=((e.clientX/innerWidth*2-1)-shift)*aspect/f,py=((1-e.clientY/innerHeight*2)-yshift)/f;
  const {right,up,outward}=Orbit.frame(state.orientation);
  let d=outward.map((v,i)=>-v+right[i]*px+up[i]*py),length=Math.hypot(...d);d=d.map(v=>v/length);
  const b=cam.reduce((sum,v,i)=>sum+v*d[i],0),disc=b*b-(state.distance*state.distance-1.04*1.04);
  if(disc<0)return;
  const t=-b-Math.sqrt(disc),point=cam.map((v,i)=>v+d[i]*t);
  state.targetOrientation=Orbit.lookAtDirection(state.orientation,point);state.dirty=true;
});
$('zoom-in').onclick=()=>{if(flight)changeHeight(.006);else zoom(.86);};
$('zoom-out').onclick=()=>{if(flight)changeHeight(-.006);else zoom(1.16);};
$('flight-toggle').onclick=toggleFlight;
const flightKeys=new Set(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE']);
window.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.isContentEditable||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.key==='Escape'){if(railway.pending){cancelRailway();e.preventDefault();return;}if(railway.selecting){railway.selecting=false;railway.hover=null;refreshRailwayMarkers();document.body.classList.remove('picking');$('rail-status').textContent='Point selection stopped.';e.preventDefault();return;}$('help').hidden=true;if(flight)toggleFlight();e.preventDefault();return;}
  if(flight&&flightKeys.has(e.code)){e.preventDefault();if(!state.busy)held.add(e.code);return;}
  const actions={'+':$('zoom-in').onclick,'=':$('zoom-in').onclick,'-':$('zoom-out').onclick};
  if(!flight)Object.assign(actions,{ArrowLeft:()=>state.targetOrientation=Orbit.turn(state.targetOrientation,-20,0),ArrowRight:()=>state.targetOrientation=Orbit.turn(state.targetOrientation,20,0),ArrowUp:()=>state.targetOrientation=Orbit.turn(state.targetOrientation,0,-20),ArrowDown:()=>state.targetOrientation=Orbit.turn(state.targetOrientation,0,20)});
  if(actions[e.key]){e.preventDefault();actions[e.key]();state.dirty=true;}
});
window.addEventListener('keyup',e=>held.delete(e.code));
function releaseControls(){held.clear();pointers.clear();pinchDistance=0;}
window.addEventListener('blur',releaseControls);
document.addEventListener('visibilitychange',releaseControls);
document.addEventListener('focusin',e=>{if(e.target!==canvas)held.clear();});
function railParameters(){return {speed:+$('rail-speed').value,maxGrade:+$('rail-grade').value/100,minRadius:+$('rail-radius').value,maxEarthwork:+$('rail-earthwork').value,earthworkCost:+$('rail-cost').value*.005,timeWeight:+$('rail-time').value,maxBridge:+$('rail-bridge').value,passPreference:+$('rail-pass').value,reusePreference:+$('rail-reuse').value};}
function resetRailway(message='Choose endpoints to start a new route.'){
  railway.job++;railway.worker?.terminate();railway.worker=null;railway.points=[];railway.selecting=false;railway.pending=false;railway.replaceLast=false;railway.hover=null;network.clear();updateNetworkSummary();
  railwayRenderer.clear();railwayRenderer.setMarkers([],surfaceAt);$('rail-snap').hidden=true;document.body.classList.remove('picking');
  $('rail-status').textContent=message;$('rail-endpoints').hidden=true;$('rail-stats').hidden=true;$('rail-profile').setAttribute('hidden','');$('rail-replan').disabled=true;$('rail-cancel').hidden=true;$('rail-pick').disabled=false;state.dirty=true;
}
function cancelRailway(){railway.job++;railway.worker?.postMessage({type:'cancel'});railway.pending=false;updateNetworkSummary();$('rail-cancel').hidden=true;$('rail-pick').disabled=false;$('rail-replan').disabled=railway.points.length<2;$('rail-status').textContent='Search cancelled.';}
function chooseRailwayPoints(){
  if(state.busy||!lakePixels)return;
  cancelRailway();railway.points=[];railway.replaceLast=false;railway.hover=null;railway.selecting=true;refreshRailwayMarkers();
  document.body.classList.add('picking');$('rail-stats').hidden=true;$('rail-profile').setAttribute('hidden','');$('rail-endpoints').hidden=true;$('rail-replan').disabled=true;$('rail-status').textContent='Click the starting point on land.';state.dirty=true;
}
function ensureRailwayWorker(){
  if(railway.worker)return railway.worker;
  const w=new Worker('./rail-worker.js?v=2.3.0',{type:'module'}),terrain=mapPixels.slice(),lakes=lakePixels.slice();railway.worker=w;
  w.postMessage({type:'init',terrain:terrain.buffer,lakes:lakes.buffer,config:{width:MAP_W,height:MAP_H,lakeWidth,lakeHeight,sea:state.sea,relief:state.relief,detail:state.quality,radius:PLANET_METERS}},[terrain.buffer,lakes.buffer]);
  w.onmessage=({data})=>{
    if(data.id!==railway.job)return;
    if(data.type==='progress'){if(performance.now()-railway.lastProgress>200){$('rail-status').textContent=data.stage+(data.stage==='Finding land corridors'||data.stage==='Coarse alternatives'||data.stage.startsWith('Refining corridor')?': '+data.expanded.toLocaleString()+' states.':'…');railway.lastProgress=performance.now();}return;}
    railway.pending=false;updateNetworkSummary();$('rail-cancel').hidden=true;$('rail-pick').disabled=false;$('rail-replan').disabled=false;
    const r=data.result;
    if(r.error){$('rail-status').textContent=r.error;return;}
    try{network.add(r,railway.replaceLast);railway.replaceLast=true;railway.hover=null;renderNetwork();}catch(error){$('rail-status').textContent=error.message;state.dirty=true;return;}
    const minRadius=Number.isFinite(r.minRadius)&&r.minRadius<1e8?Math.round(r.minRadius).toLocaleString()+' m':'Straight';
    const values=[['Distance',(r.length/1000).toFixed(2)+' km'],['Journey time',(r.seconds/60).toFixed(1)+' min'],['Maximum grade',(r.maxGrade*100).toFixed(2)+'%'],['Minimum radius',minRadius],['Earthwork',Math.round(r.volume).toLocaleString()+' m³'],['Largest cut/fill',r.maxWork.toFixed(1)+' m'],['Bridges',(r.bridgeLength/1000).toFixed(2)+' km'],['Highest bridge',r.maxBridgeHeight.toFixed(1)+' m']];
    if(r.passGuidance?.used)values.push(['Preferred passes',String(r.passGuidance.used)]);
    values.unshift(['New track',((r.newLength??r.length)/1000).toFixed(2)+' km'],['Reused track',((r.reusedLength??0)/1000).toFixed(2)+' km']);
    $('rail-stats').replaceChildren();for(const[name,value]of values){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;$('rail-stats').append(dt,dd);}$('rail-stats').hidden=false;drawProfile(r);
    $('rail-status').textContent='Connection added · '+(r.milliseconds/1000).toFixed(1)+' s search.';state.dirty=true;
    console.info('Railway ready '+JSON.stringify({length:r.length,seconds:r.seconds,maxGrade:r.maxGrade,minRadius:r.minRadius,maxWork:r.maxWork,volume:r.volume,alternatives:r.alternatives,expanded:r.expanded,passGuidance:r.passGuidance,newLength:r.newLength,reusedLength:r.reusedLength,connections:network.routes.length}));
  };
  w.onerror=()=>{railway.pending=false;updateNetworkSummary();$('rail-cancel').hidden=true;$('rail-pick').disabled=false;$('rail-replan').disabled=false;$('rail-status').textContent='Routing failed. Replan to retry.';w.terminate();railway.worker=null;};
  return w;
}
function updateRailEndpointSummary(){
  if(!railway.points.length){$('rail-endpoints').hidden=true;return;}
  const heights=railway.points.map(p=>p.h);let text='Elevation: '+heights.map(h=>(Math.round(h)||0).toLocaleString()+' m').join(' → ');
  if(heights.length===2){const minimum=Math.abs(heights[1]-heights[0])/railParameters().maxGrade/1000;const a=railway.points[0].n,b=railway.points[1].n,angle=Math.acos(Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)));text+=' · '+(angle*PLANET_METERS/1000).toFixed(1)+' km apart';if(minimum>angle*PLANET_METERS/1000*1.5)text+=' · at least '+minimum.toFixed(1)+' km needed for this elevation change.';}
  $('rail-endpoints').textContent=text;$('rail-endpoints').hidden=false;
}
function planRailway(){
  if(railway.points.length!==2||state.busy)return;
  railway.selecting=false;railway.hover=null;refreshRailwayMarkers();document.body.classList.remove('picking');$('rail-stats').hidden=true;$('rail-profile').setAttribute('hidden','');railway.pending=true;updateNetworkSummary();
  $('rail-replan').disabled=true;$('rail-pick').disabled=true;$('rail-cancel').hidden=false;$('rail-status').textContent='Searching land routes…';
  console.info('Railway endpoints '+JSON.stringify({start:railway.points[0],end:railway.points[1],startHeight:railway.points[0].h,endHeight:railway.points[1].h}));
  const base=railway.replaceLast?network.beforeLast():network.snapshot();
  ensureRailwayWorker().postMessage({type:'plan',id:++railway.job,start:railway.points[0],end:railway.points[1],parameters:railParameters(),network:{tracks:base.tracks,nodes:base.nodes}});state.dirty=true;
}
function pickSurface(clientX,clientY){
  const axes=flight?Flight.frame(flight):Orbit.frame(state.orientation),origin=flight?axes.position:axes.outward.map(x=>x*state.distance),f=1/Math.tan((flight?60:43)*Math.PI/360);
  const shift=!flight&&innerWidth>760?.18:0,yshift=flight?0:innerWidth>760?-.015:.15;
  const px=((clientX/innerWidth*2-1)-shift)*(canvas.width/canvas.height)/f,py=((1-clientY/innerHeight*2)-yshift)/f;
  const dir=railUnit(axes.outward.map((x,i)=>-x+axes.right[i]*px+axes.up[i]*py)),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),bound=1+Math.max(state.max,state.sea)*state.relief+.005;
  const b=dot(origin,dir),disc=b*b-dot(origin,origin)+bound*bound;if(disc<0)return null;
  let t=Math.max(0,-b-Math.sqrt(disc)),previous=t;const end=-b+Math.sqrt(disc);
  for(let i=0;i<6000&&t<end;i++){
    const point=origin.map((x,k)=>x+dir[k]*t),r=Math.hypot(...point),n=point.map(x=>x/r),gap=r-surfaceAt.rendered(n);
    if(gap<=0){let lo=previous,hi=t;for(let j=0;j<24;j++){const mid=(lo+hi)/2,p=origin.map((x,k)=>x+dir[k]*mid),radius=Math.hypot(...p),n=p.map(x=>x/radius);if(radius>surfaceAt.rendered(n))lo=mid;else hi=mid;}return railUnit(origin.map((x,k)=>x+dir[k]*(lo+hi)/2));}
    previous=t;t+=Math.max(.00005,Math.min(.004,gap*.05));
  }
  return null;
}
function updateNetworkSummary(){
  $('rail-network').textContent=network.routes.length+' connection'+(network.routes.length===1?'':'s')+' · '+(network.length/1000).toFixed(2)+' km of track';
  $('rail-undo').disabled=!network.routes.length||railway.pending;$('rail-clear').disabled=!network.routes.length||railway.pending;
}
function refreshRailwayMarkers(){
  const markers=network.nodes.map(n=>({...n,tint:[.95,.04,.6]}));
  railway.points.forEach((p,i)=>markers.push({...p,tint:i?[1,.65,.08]:[.05,.95,1]}));
  if(railway.selecting&&railway.hover)markers.push({...railway.hover,tint:[1,1,.15]});
  railwayRenderer.setMarkers(markers,surfaceAt);$('rail-snap').hidden=!railway.selecting;
  $('rail-snap').textContent=railway.hover?'Snap: existing '+(railway.hover.kind==='endpoint'?'endpoint':'track')+'.':'Clicks snap to endpoints, then track.';state.dirty=true;
}
function renderNetwork(){railwayRenderer.setRoutes(network.tracks,surfaceAt);updateNetworkSummary();refreshRailwayMarkers();}
function railwaySnap(x,y){
  if(!network.tracks.length)return null;
  return snapToNetwork(network,x,y,p=>projectTrackPoint(p,vp,innerWidth,innerHeight),(p,q)=>{
    const hit=pickSurface(q.x,q.y);if(!hit)return false;
    const position=p.n.map(v=>v*(1+p.h/HEIGHT_METERS)),hitPosition=hit.map(v=>v*surfaceAt.rendered(hit));
    return Math.hypot(...position.map((v,k)=>v-cam[k]))<=Math.hypot(...hitPosition.map((v,k)=>v-cam[k]))+.0025;
  });
}
canvas.addEventListener('pointermove',e=>{
  if(!railway.selecting||pointers.size||performance.now()-railway.lastHover<90)return;
  railway.lastHover=performance.now();railway.hover=railwaySnap(e.clientX,e.clientY);refreshRailwayMarkers();
});
canvas.addEventListener('pointerleave',()=>{if(railway.hover){railway.hover=null;refreshRailwayMarkers();}});
function pickRailwayPoint(event){
  if(!railway.selecting||state.busy)return;
  const snapped=railwaySnap(event.clientX,event.clientY),n=snapped?.n||pickSurface(event.clientX,event.clientY);railway.lastPick=performance.now();
  if(!n){$('rail-status').textContent='Click the planet to choose a point.';return;}
  if(!snapped&&!surfaceAt.fields(n).land){$('rail-status').textContent='Choose a land point. Oceans and lakes are blocked.';return;}
  const point=snapped||{n,h:(surfaceAt.rendered(n)-1)*HEIGHT_METERS};
  if(railway.points.length&&Math.acos(Math.min(1,railway.points[0].n.reduce((v,x,i)=>v+x*n[i],0)))*PLANET_METERS<20){$('rail-status').textContent='Choose a different endpoint, at least 20 m away.';return;}
  railway.points.push(point);railway.hover=null;updateRailEndpointSummary();refreshRailwayMarkers();
  if(railway.points.length===1)$('rail-status').textContent='Click the destination on land or existing track.';else planRailway();
}
$('rail-toggle').onclick=()=>{const open=$('rail-toggle').getAttribute('aria-expanded')==='true';$('rail-toggle').setAttribute('aria-expanded',!open);$('rail-body').hidden=open;if(open){railway.selecting=false;railway.hover=null;refreshRailwayMarkers();document.body.classList.remove('picking');}else if(!railway.points.length)chooseRailwayPoints();else if(railway.points.length===1){railway.selecting=true;document.body.classList.add('picking');$('rail-status').textContent='Click the destination on land.';}};
$('rail-pick').onclick=chooseRailwayPoints;$('rail-replan').onclick=planRailway;$('rail-clear').onclick=()=>{resetRailway();chooseRailwayPoints();};$('rail-cancel').onclick=cancelRailway;
$('rail-undo').onclick=()=>{if(railway.pending)return;network.undo();railway.points=[];railway.replaceLast=false;railway.hover=null;railway.selecting=false;document.body.classList.remove('picking');renderNetwork();$('rail-stats').hidden=true;$('rail-profile').setAttribute('hidden','');$('rail-endpoints').hidden=true;$('rail-replan').disabled=true;$('rail-status').textContent='Last connection removed.';};
for(const[id,format]of[['rail-speed',v=>v+' km/h'],['rail-grade',v=>(+v).toFixed(1)+'%'],['rail-radius',v=>v+' m'],['rail-earthwork',v=>v+' m'],['rail-cost',v=>v],['rail-time',v=>(+v).toFixed(1)],['rail-bridge',v=>v+' m'],['rail-pass',v=>(+v).toFixed(2)],['rail-reuse',v=>(+v).toFixed(2)]]){
  $(id).oninput=()=>{$(id+'-value').value=format($(id).value);rangeFill($(id));updateRailEndpointSummary();$('rail-radius-hint').textContent='At '+$('rail-radius').value+' m radius, curve speed is about '+Math.round(Math.sqrt(.65*+$('rail-radius').value)*3.6)+' km/h in this model.';};
  $(id).onchange=()=>{if(railway.pending)cancelRailway();if(railway.points.length===2)$('rail-status').textContent='Parameters changed. Replan to apply.';};rangeFill($(id));
}

function drawProfile(route){
  const svg=$('rail-profile'),ns='http://www.w3.org/2000/svg',ps=route.points.filter((_,i)=>i%Math.max(1,Math.floor(route.points.length/220))===0||i===route.points.length-1);
  const low=Math.min(...ps.map(p=>Math.min(p.h,p.ground))),high=Math.max(...ps.map(p=>Math.max(p.h,p.ground))),range=Math.max(20,high-low),y=h=>65-(h-low)/range*47;
  svg.replaceChildren();
  const add=(name,attrs,text)=>{const el=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);};
  for(const[key,color]of[['ground','#8caa73'],['h','#f0d498']])add('polyline',{points:ps.map(p=>(8+p.station/route.length*204).toFixed(1)+','+y(p[key]).toFixed(1)).join(' '),fill:'none',stroke:color,'stroke-width':key==='h'?1.6:1});
  add('text',{x:8,y:10},Math.round(high).toLocaleString()+' m');add('text',{x:8,y:71},Math.round(low).toLocaleString()+' m');add('text',{x:144,y:10,'text-anchor':'end',style:'fill:#8caa73'},'Ground');add('text',{x:212,y:10,'text-anchor':'end',style:'fill:#f0d498'},'Track');add('text',{x:8,y:80},'0');add('text',{x:212,y:80,'text-anchor':'end'},(route.length/1000).toFixed(1)+' km');
  svg.removeAttribute('hidden');
}
let hoverPoint=null,lastMeasure=0,lastScaleMeasure=0;
function describeGround(n){
 const h=(surfaceAt.rendered(n)-1)*HEIGHT_METERS,east=railUnit([n[2],0,-n[0]].some(v=>Math.abs(v)>.001)?[n[2],0,-n[0]]:[1,0,0]),north=[n[1]*east[2]-n[2]*east[1],n[2]*east[0]-n[0]*east[2],n[0]*east[1]-n[1]*east[0]],span=100;
 const slope=axis=>{const a=railUnit(n.map((v,k)=>v+axis[k]*span/PLANET_METERS)),b=railUnit(n.map((v,k)=>v-axis[k]*span/PLANET_METERS));return (surfaceAt.rendered(a)-surfaceAt.rendered(b))*HEIGHT_METERS/(2*span);};
 const grade=Math.hypot(slope(east),slope(north));return (Math.round(h)||0).toLocaleString()+' m · ground slope '+(grade*100).toFixed(1)+'% ('+(Math.atan(grade)*180/Math.PI).toFixed(1)+'°)';
}
function refreshMeasures(){
 if(!surfaceAt||state.busy||performance.now()-lastScaleMeasure<120)return;lastScaleMeasure=performance.now();
 const x=innerWidth*(flight?.5:innerWidth>760?.59:.5),y=innerHeight*(flight?.65:innerWidth>760?.5075:.425),a=pickSurface(x-45,y),b=pickSurface(x+45,y);
 if(a&&b){const angle=Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0))),perPixel=angle*PLANET_METERS/90,power=10**Math.floor(Math.log10(perPixel*130)),value=[1,2,5,10].map(n=>n*power).filter(n=>n/perPixel<=180).at(-1)||power;
 $('map-scale-line').style.width=Math.max(1,value/perPixel)+'px';$('map-scale-distance').textContent=value>=1000?(value/1000).toFixed(value%1000?1:0)+' km':Math.round(value)+' m';$('map-scale').hidden=false;
 }else $('map-scale').hidden=true;
 const n=hoverPoint||pickSurface(x,y);if(n)$('ground-info').textContent=describeGround(n);
}
canvas.addEventListener('pointermove',e=>{if(pointers.size||state.busy||performance.now()-lastMeasure<120)return;lastMeasure=performance.now();hoverPoint=pickSurface(e.clientX,e.clientY);if(hoverPoint)$('ground-info').textContent=describeGround(hoverPoint);});
canvas.addEventListener('pointerleave',()=>{hoverPoint=null;});
function updatePlanetScale(){
 lastScaleMeasure=0;setPlanetRadius(+$('planet-radius').value*1000);$('planet-radius-value').value=(PLANET_METERS/1000).toLocaleString()+' km';rangeFill($('planet-radius'));
 $('planet-scale-info').textContent='Radius '+(PLANET_METERS/1000).toLocaleString()+' km · equator '+Math.round(2*Math.PI*PLANET_METERS/1000).toLocaleString()+' km';
 $('exaggeration-info').textContent='Height shown '+(PLANET_METERS/HEIGHT_METERS).toFixed(1)+'× taller relative to distance';
 state.dirty=true;
}
$('planet-radius').oninput=()=>{resetRailway('Scale changed. Choose endpoints again.');updatePlanetScale();const url=new URL(location.href);url.searchParams.set('radius',PLANET_METERS/1000);history.replaceState(null,'',url);};
$('generate').onclick=generate;$('seed').addEventListener('keydown',e=>{if(e.key==='Enter')generate();});
$('random-seed').onclick=()=>{if(state.busy)return;const a=new Uint32Array(1);crypto.getRandomValues(a);$('seed').value=String(a[0]%1000000);generate();};
$('relief').oninput=e=>{resetRailway('Terrain changed. Choose endpoints again.');state.relief=+e.target.value;$('relief-value').value=state.relief.toFixed(1)+'×';rangeFill(e.target);refreshSurface();state.dirty=true;};
let seaTimer;$('sea').oninput=e=>{resetRailway('Terrain changed. Choose endpoints again.');state.sea=+e.target.value;$('sea-value').value=(state.sea>0?'+':'')+Math.round(state.sea*65000)+' m';rangeFill(e.target);refreshSurface();state.dirty=true;clearTimeout(seaTimer);seaTimer=setTimeout(()=>{drain();},230);};
function rangeFill(e){e.style.background=`linear-gradient(to right,#a7c299 ${(e.value-e.min)/(e.max-e.min)*100}%,#3b4840 0)`;}
for(const id of ['relief','sea','frequency','noise-color','layers'])rangeFill($(id));
for(const id of ['frequency','noise-color','layers']){
  $(id).oninput=()=>{$(id+'-value').value=Number($(id).value).toFixed(id==='layers'?0:2)+(id==='frequency'?'×':'');rangeFill($(id));};
  $(id).onchange=()=>{clearTimeout(noiseTimer);noiseTimer=setTimeout(generate,240);};
}
$('quality').onchange=e=>{resetRailway('Mesh changed. Choose endpoints again.');setQuality(+e.target.value);};
$('settings-toggle').onclick=()=>{const open=$('settings-toggle').getAttribute('aria-expanded')==='true';$('settings-toggle').setAttribute('aria-expanded',!open);$('settings-body').hidden=open;};
$('help-toggle').onclick=()=>{$('help').hidden=!$('help').hidden;};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setBusy(state.busy,'Fullscreen is not available in this browser view.');}};
window.addEventListener('resize',()=>{state.dirty=true;});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();showError('The graphics context was interrupted. Reload this page to resume exploring.');});
// Let the browser suspend the worker when this page enters its back/forward cache.
if(innerWidth<760)state.distance=state.targetDistance=homeDistance();
const params=new URLSearchParams(location.search),seedParam=params.get('seed');if(seedParam)$('seed').value=seedParam.slice(0,20);
if(params.has('radius'))$('planet-radius').value=+params.get('radius');updatePlanetScale();
const initialNoise=normalizeNoiseSettings({frequency:params.get('frequency'),color:params.get('color'),layers:params.get('layers')});
$('frequency').value=initialNoise.frequency;$('noise-color').value=initialNoise.color;$('layers').value=initialNoise.layers;
for(const id of ['frequency','noise-color','layers'])$(id).oninput();
requestAnimationFrame(tick);generate();
}
