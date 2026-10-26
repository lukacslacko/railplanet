import {rotate} from './orbit.js?v=1.8.0';

export const BAND_COUNT = 5;
export const MAX_LAYERS = 10;
export const WAVES_PER_BAND = 32;
export const MOISTURE_WAVES = 24;
export const FIRST_AMPLITUDE = .24;
export const PERSISTENCE = .49;
export const ELEVATION_GAIN = .104;
export const ELEVATION_OFFSET = .012;
export const NOISE_DEFAULTS = Object.freeze({frequency:1, color:PERSISTENCE, layers:BAND_COUNT});
export const NOISE_LIMITS = Object.freeze({frequency:[.4,10,.05], color:[.15,.8,.01], layers:[1,MAX_LAYERS,1]});

export function normalizeNoiseSettings(settings={}) {
  const result={};
  for(const key of ['frequency','color','layers']) {
    const [min,max,step]=NOISE_LIMITS[key],input=settings[key];
    const number=input===null||input===undefined||input===''?NaN:Number(input);
    const value=Number.isFinite(number)?Math.max(min,Math.min(max,number)):NOISE_DEFAULTS[key];
    result[key]=Number((Math.round(value/step)*step).toFixed(2));
  }
  return result;
}
export function bandAmplitudes(color=PERSISTENCE, layers=BAND_COUNT, frequency=1) {
  const energy=p=>Array.from({length:BAND_COUNT},(_,band)=>p**(2*band)).reduce((sum,x)=>sum+x,0);
  // Hold expected elevation variance steady as the spectral balance changes.
  const scale=Math.sqrt(energy(PERSISTENCE)/energy(color));
  return Float32Array.from({length:MAX_LAYERS},(_,band)=>{
    if(band>=layers)return 0;
    // Fixed 2048×1024 map: taper near the angular Nyquist limit. This keeps
    // unresolved layers from folding into false, larger-scale patterns.
    const k=7*frequency*1.7**band,t=Math.max(0,Math.min(1,(k-512)/(900-512)));
    return FIRST_AMPLITUDE/Math.sqrt(WAVES_PER_BAND/2)*scale*color**band*(1-t*t*(3-2*t));
  });
}

const DEFAULT_AMPLITUDES=bandAmplitudes();

function seededRandom(text) {
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function rotation(random) {
  // A uniform rotation of the whole directional set, independently per band.
  const a = random(), b = random() * Math.PI * 2, c = random() * Math.PI * 2;
  return [Math.sqrt(1-a)*Math.sin(b), Math.sqrt(1-a)*Math.cos(b), Math.sqrt(a)*Math.sin(c), Math.sqrt(a)*Math.cos(c)];
}
function makeBand(count, frequency, random) {
  const result = new Float32Array(count * 4), q = rotation(random);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = 1 - 2 * (i + .5) / count, radius = Math.sqrt(1 - z*z), angle = i * goldenAngle;
    const direction = rotate(q, [radius * Math.cos(angle), radius * Math.sin(angle), z]);
    const k = frequency * (.82 + random() * .36);
    result.set([direction[0]*k, direction[1]*k, direction[2]*k, random()*Math.PI*2], i*4);
  }
  return result;
}
export function createNoise(seed, options={}) {
  const settings=normalizeNoiseSettings(options);
  const random = seededRandom(String(seed));
  const terrain = new Float32Array(MAX_LAYERS * WAVES_PER_BAND * 4);
  let moisture;
  for (let band = 0; band < MAX_LAYERS; band++) {
    terrain.set(makeBand(WAVES_PER_BAND, 7 * settings.frequency * 1.7 ** band, random), band * WAVES_PER_BAND * 4);
    // Keep the original five-layer world's moisture field and coarse phases.
    if(band===BAND_COUNT-1)moisture=makeBand(MOISTURE_WAVES,16,random);
  }
  return {terrain, moisture, amplitudes:bandAmplitudes(settings.color,settings.layers,settings.frequency)};
}
// CPU reference for validation and future simulation queries. The browser's
// generation pass evaluates this same spectrum on the GPU, once per world.
export function elevationAt(point, spectrum, amplitudes=DEFAULT_AMPLITUDES) {
  let value = 0;
  for (let band = 0; band < MAX_LAYERS; band++) {
    if(!amplitudes[band])continue;
    let sum = 0;
    for (let j = 0; j < WAVES_PER_BAND; j++) {
      const i = (band * WAVES_PER_BAND + j) * 4;
      sum += Math.cos(point[0]*spectrum[i] + point[1]*spectrum[i+1] + point[2]*spectrum[i+2] + spectrum[i+3]);
    }
    value += amplitudes[band] * sum;
  }
  return ELEVATION_OFFSET + ELEVATION_GAIN * value;
}
