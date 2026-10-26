import assert from 'node:assert/strict';
import {cubeSphereData} from '../dist/mesh.js';
for(const n of [1,8,48,128,192,288]){
 const {positions,indices}=cubeSphereData(n),vertices=positions.length/3;
 assert.equal(vertices,6*n*n+2,'cube faces must share all boundary vertices');
 assert.equal(indices.length,36*n*n);
 for(let i=0;i<positions.length;i++)assert(!Object.is(positions[i],-0),'coordinate axes use canonical positive zero');
 for(let i=0;i<positions.length;i+=3)assert(Math.abs(Math.hypot(positions[i],positions[i+1],positions[i+2])-1)<.0000001,'mesh directions must lie on the unit sphere');
 const edges=n<=48?new Map():null;
 for(let i=0;i<indices.length;i+=3){
  const [a,b,c]=indices.slice(i,i+3);assert(a<vertices&&b<vertices&&c<vertices);
  const ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2];
  const bx=positions[b*3],by=positions[b*3+1],bz=positions[b*3+2];
  const cx=positions[c*3],cy=positions[c*3+1],cz=positions[c*3+2];
  const determinant=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);
  assert(determinant>0,'every triangle must face outward and have nonzero area');
  if(edges)for(const [u,v] of [[a,b],[b,c],[c,a]]){
   const key=u<v?u+':'+v:v+':'+u,edge=edges.get(key)||{count:0,balance:0};
   edge.count++;edge.balance+=u<v?1:-1;edges.set(key,edge);
  }
 }
 if(edges){
  for(const edge of edges.values()){assert.equal(edge.count,2,'closed sphere edges belong to exactly two triangles');assert.equal(edge.balance,0,'neighboring triangles traverse their shared edge in opposite directions');}
  assert.equal(vertices-edges.size+indices.length/3,2,'sphere must have Euler characteristic 2');
 }
}
console.log('Mesh verified: one closed indexed surface, shared tile edges, outward winding, positive-zero axes, and all supported detail levels.');
