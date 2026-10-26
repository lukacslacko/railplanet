import assert from 'node:assert/strict';
import {createNoise,elevationAt,BAND_COUNT,WAVES_PER_BAND,normalizeNoiseSettings,NOISE_DEFAULTS,MAX_LAYERS} from '../dist/noise.js';
const golden=Math.PI*(3-Math.sqrt(5));
const direction=(i,count)=>{const z=1-2*(i+.5)/count,r=Math.sqrt(1-z*z),a=i*golden;return [r*Math.cos(a),z,r*Math.sin(a)];};
let worstSecondMoment=0,worstFourthMoment=0;
let snowySamples=0;
for(const seed of ['225795','911154','665185','42','31415']){
 const model=createNoise(seed),again=createNoise(seed);
 assert.deepEqual(model,again,'world spectra must be repeatable by seed');
 const profiles=[];
 for(let band=0;band<MAX_LAYERS;band++){
  const directions=[];
  for(let j=0;j<WAVES_PER_BAND;j++){
   const i=(band*WAVES_PER_BAND+j)*4,v=[model.terrain[i],model.terrain[i+1],model.terrain[i+2]],length=Math.hypot(...v);
   directions.push(v.map(x=>x/length));
  }
  // Isotropic angular moments: E[(d·u)^2]=1/3 and E[(d·u)^4]=1/5,
  // independently of the probe direction u. These catch directional clustering.
  for(let j=0;j<96;j++){
   const u=direction(j,96);let second=0,fourth=0;
   for(const d of directions){const dot=d.reduce((s,v,i)=>s+v*u[i],0);second+=dot*dot/WAVES_PER_BAND;fourth+=dot**4/WAVES_PER_BAND;}
   worstSecondMoment=Math.max(worstSecondMoment,Math.abs(second-1/3));worstFourthMoment=Math.max(worstFourthMoment,Math.abs(fourth-1/5));
  }
 }
 let land=0,high=0,snow=0,min=1,max=-1,totalSlope=0;
 for(let j=0;j<8192;j++){
  const n=direction(j,8192),h=elevationAt(n,model.terrain);
  assert(Number.isFinite(h));land+=h>0;high+=h>.055;snow+=h>.0775;min=Math.min(min,h);max=Math.max(max,h);
  const tangent=[-n[2],0,n[0]],length=Math.hypot(...tangent);
  const neighbor=n.map((v,i)=>v+tangent[i]/length*.002),radius=Math.hypot(...neighbor);
  totalSlope+=Math.abs(elevationAt(neighbor.map(v=>v/radius),model.terrain)-h)/.002;
 }
 assert(land/8192>.55&&land/8192<.85,'world should have substantially more land than the former water-heavy baseline');
 assert(high/8192>.01&&high/8192<.10,'highlands should be present but sparse');
 assert(snow/8192<.025,'only a few peaks should reach the snowline');
 assert(totalSlope/8192<.18,'typical slopes should remain gentle');
 snowySamples+=snow;
 assert(min>-.24&&max<.24,'terrain must stay inside the packed elevation range');
 profiles.push({seed,land:(land/8192*100).toFixed(1)+'%',high:(high/8192*100).toFixed(1)+'%',snow:(snow/8192*100).toFixed(1)+'%',meanSlope:(totalSlope/8192).toFixed(3)});
 console.log(JSON.stringify(profiles[0]));
}
assert(worstSecondMoment<.015,'wave directions must have balanced second moments');
assert(worstFourthMoment<.02,'wave directions must have balanced fourth moments');
assert(snowySamples>0,'some worlds should have snowy summits');
assert.notDeepEqual(createNoise('911154'),createNoise('911155'),'different seeds must change the world');
assert.deepEqual(normalizeNoiseSettings({frequency:'bad',color:null}),NOISE_DEFAULTS,'invalid or missing URL settings use defaults');
assert.deepEqual(normalizeNoiseSettings({frequency:999,color:-2}),{frequency:10,color:.15,layers:5},'URL settings stay in the supported range');
assert.deepEqual(normalizeNoiseSettings({frequency:'1.234',color:'.527'}),{frequency:1.25,color:.53,layers:5},'URL values match slider precision');
const base=createNoise('225795'),scaled=createNoise('225795',{frequency:2}),smooth=createNoise('225795',{color:.15}),fine=createNoise('225795',{color:.8});
assert.deepEqual(base.amplitudes,scaled.amplitudes,'frequency does not change band amplitudes');
assert.deepEqual(base.moisture,scaled.moisture,'frequency preserves the seeded moisture field');
assert.deepEqual(base.terrain,smooth.terrain,'noise color preserves wave directions, phases, and frequencies');
assert.deepEqual(base.terrain,fine.terrain,'noise color changes weights alone');
for(let i=0;i<base.terrain.length;i++)assert(Math.abs(scaled.terrain[i]-base.terrain[i]*(i%4===3?1:2))<.00002,'spatial frequency scales wave vectors while preserving phases');
const energy=a=>a.reduce((sum,x)=>sum+x*x,0),referenceEnergy=energy(base.amplitudes);
for(const model of [smooth,fine])assert(Math.abs(energy(model.amplitudes)-referenceEnergy)<1e-9,'spectral changes preserve expected elevation variance');
assert(fine.amplitudes[BAND_COUNT-1]>base.amplitudes[BAND_COUNT-1]&&base.amplitudes[BAND_COUNT-1]>smooth.amplitudes[BAND_COUNT-1],'noise color controls fine-band strength');
let maxDerivative=0;
for(const settings of [{frequency:.4,color:.15,layers:1},{frequency:.4,color:.8,layers:10},{frequency:10,color:.15,layers:1},{frequency:10,color:.8,layers:10}]){
 const model=createNoise('225795',settings);assert.deepEqual(model,createNoise('225795',settings));
 for(let i=0;i<2048;i++){
  const n=direction(i,2048),h=elevationAt(n,model.terrain,model.amplitudes),t=[-n[2],0,n[0]],length=Math.hypot(...t);
  const p=n.map((x,k)=>x+t[k]/length*.00001),r=Math.hypot(...p),next=elevationAt(p.map(x=>x/r),model.terrain,model.amplitudes);
  assert(h>-.24&&h<.24,'custom spectra remain in the height texture range');
  maxDerivative=Math.max(maxDerivative,Math.abs(next-h)/.00001);
 }
}
for(let slope=-Math.ceil(maxDerivative);slope<=Math.ceil(maxDerivative);slope+=.013){
 const packed=Math.floor((slope/(1+Math.abs(slope))*.5+.5)*65535),compressed=(packed/65535-.5)*2,decoded=compressed/(1-Math.abs(compressed));
 assert(Math.abs(decoded-slope)/(1+Math.abs(slope))<(1+Math.abs(slope))/32000,'slope encoding preserves fine and steep gradients without clipping');
}
const one=createNoise('225795',{layers:1}),ten=createNoise('225795',{layers:10});
assert.deepEqual(one.terrain,ten.terrain,'adding layers preserves seeded wave directions, phases, and frequencies');
assert.deepEqual(one.moisture,ten.moisture,'layer count preserves moisture');
for(let band=0;band<BAND_COUNT;band++)assert.equal(base.amplitudes[band],ten.amplitudes[band],'adding layers preserves the existing coarse amplitudes');
assert.equal(one.amplitudes.filter(Boolean).length,1,'one layer evaluates one band');
assert(ten.amplitudes[5]>0,'extra layers introduce new fine-scale energy');
assert.notEqual(elevationAt(direction(8,20),one.terrain,one.amplitudes),elevationAt(direction(8,20),ten.terrain,ten.amplitudes),'additional layers change the terrain');
assert.deepEqual(normalizeNoiseSettings({layers:99}),{...NOISE_DEFAULTS,layers:10},'layer count is bounded');
assert.equal(normalizeNoiseSettings({layers:3.7}).layers,4,'layer count uses whole layers');
assert.equal(createNoise('225795',{frequency:10,layers:10}).amplitudes[9],0,'unresolvable layers are filtered at high frequency');
console.log('Noise verified: deterministic seeds, angular direction balance, broad land, gentle slopes, sparse high peaks, and safe elevation range. Angular moment errors:',worstSecondMoment.toFixed(4),worstFourthMoment.toFixed(4));
console.log('Terrain controls verified: frequency scaling, unchanged phases, spectral weighting, variance normalization, deterministic custom worlds, URL bounds, and slope range:',maxDerivative.toFixed(3));
