// One indexed surface shared by all six cube faces, including their edges.
export function cubeSphereData(n) {
  const positions=new Float32Array(6*(n+1)*(n+1)*3);
  const indices=new Uint32Array(36*n*n),seams=new Map();
  let vertexCount=0,indexCount=0;
  for(let face=0;face<6;face++){
    const grid=new Uint32Array((n+1)*(n+1));
    for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
      const a=2*x-n,b=2*y-n;let v;
      switch(face){case 0:v=[n,b,-a];break;case 1:v=[-n,b,a];break;case 2:v=[a,n,-b];break;case 3:v=[a,-n,b];break;case 4:v=[a,b,n];break;default:v=[-a,b,-n];}
      const boundary=x===0||x===n||y===0||y===n,key=boundary?v.join(','):null;
      let index=boundary?seams.get(key):undefined;
      if(index===undefined){
        index=vertexCount++;const radius=Math.hypot(...v);
        for(let axis=0;axis<3;axis++)positions[index*3+axis]=v[axis]===0?0:v[axis]/radius;
        if(boundary)seams.set(key,index);
      }
      grid[y*(n+1)+x]=index;
    }
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
      indices[indexCount++]=grid[a];indices[indexCount++]=grid[b];indices[indexCount++]=grid[c];
      indices[indexCount++]=grid[b];indices[indexCount++]=grid[d];indices[indexCount++]=grid[c];
    }
  }
  return {positions:positions.subarray(0,vertexCount*3),indices};
}
