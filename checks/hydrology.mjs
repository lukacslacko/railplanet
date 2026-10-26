import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../dist/hydrology.js',import.meta.url),'utf8');
function simulate(terrain,sea=0){
  const width=256,height=128,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const h=terrain((x+.5)/width,(y+.5)/height),q=Math.round((h+.24)/.48*65535),i=(y*width+x)*4;
    pixels[i]=q>>8;pixels[i+1]=q&255;pixels[i+2]=180;pixels[i+3]=255;
  }
  let result;
  const ctx={self:{postMessage:r=>result=r},Float32Array,Int32Array,Uint8Array,Math};
  vm.runInNewContext(source,ctx);
  ctx.self.onmessage({data:{pixels:pixels.buffer,width,height,sea,id:1,debug:true}});
  return result;
}
function checkGraph(result){
  const parents=new Int32Array(result.graph.parent),filled=new Float32Array(result.graph.filled),done=new Uint8Array(parents.length);
  for(let i=0;i<parents.length;i++){
    if(parents[i]>=0)assert(filled[i]+1e-6>=filled[parents[i]],'drainage must never flow uphill');
    if(done[i])continue;let j=i;const path=[];
    while(j>=0&&!done[j]){done[j]=1;path.push(j);j=parents[j];}
    assert(j<0||done[j]===2,'drainage must not contain cycles');
    for(const k of path)done[k]=2;
  }
}
const ocean=simulate(()=>-.04);assert.equal(ocean.water,1);assert.equal(ocean.segments,0);assert.equal(ocean.lakeCells,0);
const basin=(x,y)=>{const r=Math.hypot((x-.5)*2,y-.5);if(r>.4)return -.025;return .014+.045*Math.exp(-(((r-.19)/.055)**2))+.035*r;};
const a=simulate(basin),b=simulate(basin);
assert(a.lakeCells>10,'enclosed basin should hold a lake');assert(a.pathCount>0,'slopes should collect rivers');assert(a.water>0&&a.water<1);
assert.deepEqual(new Uint8Array(a.lakes),new Uint8Array(b.lakes),'basins must be deterministic');assert.deepEqual(new Float32Array(a.rivers),new Float32Array(b.rivers),'curves must be deterministic');
assert(a.curveSamples>a.segments*4,'river curves need finer samples than the drainage grid');
const vertices=new Float32Array(a.rivers);assert.equal(vertices.length%12,0);
for(let i=0;i<vertices.length;i+=4){assert(Number.isFinite(vertices[i])&&Number.isFinite(vertices[i+1]));assert(vertices[i+3]>0,'river half-width must be positive');}
checkGraph(a);
// The shallow bank of a deep basin must be included. A per-cell depth cutoff
// would leave this gentle shore out and force a rectangular lake boundary.
const lakeBytes=new Uint8Array(a.lakes),heights=new Float32Array(a.graph.heights),filled=new Float32Array(a.graph.filled);
let shallowMargin=0;
for(let i=0;i<heights.length;i++)if(filled[i]-heights[i]>.00002&&filled[i]-heights[i]<.0012&&lakeBytes[i*4+2])shallowMargin++;
assert(shallowMargin>0,'valid lakes must retain shallow margins');
const seam=simulate((x,y)=>basin((x+.5)%1,y));checkGraph(seam);
const v=new Float32Array(seam.rivers);
for(let i=0;i<v.length;i+=12)assert(Math.max(v[i],v[i+4],v[i+8])-Math.min(v[i],v[i+4],v[i+8])<.1,'seam-crossing river triangles must stay local');
const flooded=simulate(basin,.07);assert.equal(flooded.water,1);assert.equal(flooded.segments,0);
const dry=simulate((x,y)=>.03+.01*Math.cos(x*Math.PI*2)*Math.sin(y*Math.PI));assert(Number.isFinite(dry.water));assert.equal(dry.width,256);assert.equal(dry.height,128);checkGraph(dry);
console.log('Hydrology verified: full-resolution drainage, downhill acyclic paths, curved rivers, longitude seams, shallow lake shores, deterministic basins, ocean/flood/dry worlds.');
