/* Drainage is calculated once per world, off the UI thread. Priority flooding
   finds each basin's spill elevation; the reverse flood order accumulates runoff.
   Longitude wraps, and polar neighbours reflect over the pole. No reference code. */
self.onmessage = ({data}) => {
  const {pixels,width,height,sea,id,debug=false}=data;
  const W=width,H=height,N=W*H;
  const heights=new Float32Array(N),filled=new Float32Array(N),parent=new Int32Array(N).fill(-1),seen=new Uint8Array(N),order=new Int32Array(N),flow=new Float32Array(N);
  const raw=new Uint8Array(pixels);
  const heapIndex=new Int32Array(N),heapHeight=new Float32Array(N);let heapSize=0;
  function push(i,h){let k=heapSize++;while(k>0){let p=(k-1)>>1;if(heapHeight[p]<=h)break;heapHeight[k]=heapHeight[p];heapIndex[k]=heapIndex[p];k=p;}heapHeight[k]=h;heapIndex[k]=i;}
  function pop(){const i=heapIndex[0];const h=heapHeight[--heapSize],idx=heapIndex[heapSize];let k=0;while(k*2+1<heapSize){let c=k*2+1;if(c+1<heapSize&&heapHeight[c+1]<heapHeight[c])c++;if(heapHeight[c]>=h)break;heapIndex[k]=heapIndex[c];heapHeight[k]=heapHeight[c];k=c;}heapHeight[k]=h;heapIndex[k]=idx;return i;}
  const neighbour=(x,y)=>{if(y<0){y=0;x+=W/2;}if(y>=H){y=H-1;x+=W/2;}return y*W+((x+W)%W);};
  let min=1,minI=0,max=-1,water=0,totalWeight=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,p=(y*width+x)*4;const h=(raw[p]*256+raw[p+1])/65535*.48-.24;heights[i]=h;filled[i]=h;
    const area=Math.cos(((y+.5)/H-.5)*Math.PI);flow[i]=area*(.65+raw[p+2]/255*.6);totalWeight+=area;if(h<min){min=h;minI=i;}max=Math.max(max,h);
    if(h<=sea){seen[i]=1;filled[i]=sea;push(i,sea);water+=area;}
  }
  // A dry planet still gets a well-defined outlet at its lowest cell.
  if(!heapSize){seen[minI]=1;push(minI,min);}
  let count=0;
  while(heapSize){const i=pop();order[count++]=i;let x=i%W,y=(i/W)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const j=neighbour(x+dx,y+dy);if(seen[j])continue;seen[j]=1;parent[j]=i;const f=Math.max(heights[j],filled[i]);filled[j]=f;push(j,f);}
  }
  // Refine drainage on non-flooded slopes to the steepest lower neighbour.
  // Filled depressions keep their flood-tree outlet, so flats cannot form cycles.
  for(let i=0;i<N;i++){if(heights[i]<=sea||filled[i]>heights[i]+1e-7)continue;const x=i%W,y=(i/W)|0;let best=parent[i],bestDrop=0;const cos=Math.max(.06,Math.cos(((y+.5)/H-.5)*Math.PI));
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const j=neighbour(x+dx,y+dy);const dist=Math.sqrt(dx*dx*cos*cos+dy*dy);const drop=(filled[i]-filled[j])/dist;if(drop>bestDrop&&filled[j]<filled[i]-1e-7){bestDrop=drop;best=j;}}
    parent[i]=best;
  }
  // Flood heights are nondecreasing, but equal-height cells must preserve tree order.
  for(let k=count-1;k>=0;k--){const i=order[k],p=parent[i];if(p>=0)flow[p]+=flow[i];}
  // Keep a basin by its maximum depth, then include ALL of its shallow margins.
  // Thresholding every cell by depth would cut gentle shores into square tiles.
  const lakeState=new Uint8Array(N);
  for(let i=0;i<N;i++)if(heights[i]>sea&&filled[i]-heights[i]>.00001)lakeState[i]=1;
  for(let root=0;root<N;root++){
    if(lakeState[root]!==1)continue;
    let head=0,tail=1,maxDepth=0;
    order[0]=root;lakeState[root]=2;
    const level=filled[root];
    while(head<tail){
      const i=order[head++],x=i%W,y=i/W|0;
      maxDepth=Math.max(maxDepth,filled[i]-heights[i]);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const j=neighbour(x+dx,y+dy);
        if(lakeState[j]===1&&Math.abs(filled[j]-level)<.00001){lakeState[j]=2;order[tail++]=j;}
      }
    }
    if(maxDepth>.0012&&tail>=3)for(let k=0;k<tail;k++)lakeState[order[k]]=3;
  }
  const lakeData=new Uint8Array(N*4);let lakeWeight=0,lakeCells=0;
  for(let i=0;i<N;i++){
    const lake=lakeState[i]===3,level=lake?filled[i]:sea;
    const q=Math.max(0,Math.min(65535,Math.round((level+.24)/.48*65535)));
    lakeData[i*4]=q>>8;lakeData[i*4+1]=q&255;lakeData[i*4+2]=lake?255:0;lakeData[i*4+3]=255;
    if(lake){lakeWeight+=Math.cos((((i/W|0)+.5)/H-.5)*Math.PI);lakeCells++;}
  }
  // Extend lake spill levels by two cells; the full-resolution elevation field
  // defines the shoreline continuously instead of clipping it to square cells.
  // Terrain still determines the exact wet boundary in the shader.
  const expanded=new Uint8Array(lakeData);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(lakeData[i*4+2])continue;let level=sea;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const j=neighbour(x+dx,y+dy);if(lakeData[j*4+2])level=Math.max(level,filled[j]);}
    if(level>sea){const q=Math.round((level+.24)/.48*65535);expanded[i*4]=q>>8;expanded[i*4+1]=q&255;}
  }
  // Split the drainage graph into chains at headwaters and confluences, then
  // interpolate each chain with cubic Hermite curves. The original drainage
  // graph remains monotonic; smoothing affects only the visual centerline.
  const threshold=36*(W/1024)*(H/512);
  const active=new Uint8Array(N),upstream=new Uint8Array(N);
  for(let i=0;i<N;i++)if(parent[i]>=0&&heights[i]>sea&&flow[i]>=threshold)active[i]=1;
  for(let i=0;i<N;i++)if(active[i]&&active[parent[i]])upstream[parent[i]]++;
  const verts=[];
  const feather=.00125;
  let segments=0,pathCount=0,curveSamples=0;
  const point=i=>[(i%W+.5)/W,((i/W|0)+.5)/H,Math.min(.0015,.00024+Math.sqrt(flow[i]/((W/1024)*(H/512)))*.000026)];
  const emit=(p,side,w,shift=0)=>verts.push(p[0]+shift,p[1],side,w);
  function triangle(a,b,c){
    emit(a,a[2],a[3]);emit(b,b[2],b[3]);emit(c,c[2],c[3]);
    if(Math.min(a[0],b[0],c[0])<0){emit(a,a[2],a[3],1);emit(b,b[2],b[3],1);emit(c,c[2],c[3],1);}
    if(Math.max(a[0],b[0],c[0])>1){emit(a,a[2],a[3],-1);emit(b,b[2],b[3],-1);emit(c,c[2],c[3],-1);}
  }
  function cap(p){
    const cos=Math.max(.012,Math.cos((p[1]-.5)*Math.PI)),e=p[2]+feather;
    for(let k=0;k<12;k++){
      const a=k/12*Math.PI*2,b=(k+1)/12*Math.PI*2;
      triangle([p[0],p[1],0,p[2]],[p[0]+Math.cos(a)*e/(Math.PI*2*cos),p[1]+Math.sin(a)*e/Math.PI,e,p[2]],[p[0]+Math.cos(b)*e/(Math.PI*2*cos),p[1]+Math.sin(b)*e/Math.PI,e,p[2]]);
    }
  }
  function bake(points){
    const strip=[];
    for(let k=0;k<points.length;k++){
      const p=points[k],a=points[Math.max(0,k-1)],b=points[Math.min(points.length-1,k+1)];
      const cos=Math.max(.012,Math.cos((p[1]-.5)*Math.PI));
      const dx=(b[0]-a[0])*Math.PI*2*cos,dy=(b[1]-a[1])*Math.PI,len=Math.hypot(dx,dy)||1;
      const e=p[2]+feather,ox=-dy/len*e/(Math.PI*2*cos),oy=dx/len*e/Math.PI;
      strip.push([[p[0]+ox,p[1]+oy,e,p[2]],[p[0]-ox,p[1]-oy,-e,p[2]]]);
    }
    for(let k=1;k<strip.length;k++){
      const [al,ar]=strip[k-1],[bl,br]=strip[k];
      triangle(al,ar,bl);triangle(ar,br,bl);
    }
    cap(points[0]);cap(points[points.length-1]);
  }
  for(let start=0;start<N;start++){
    if(!active[start]||upstream[start]===1)continue;
    const chain=[point(start)];let i=start;
    for(let guard=0;guard<N;guard++){
      const j=parent[i];if(j<0)break;
      const p=point(j),previous=chain[chain.length-1];
      p[0]-=Math.round(p[0]-previous[0]);chain.push(p);segments++;
      if(!active[j]||upstream[j]!==1)break;i=j;
    }
    if(chain.length<2)continue;
    // Remove the alternating axial/diagonal steps of the D8 grid before
    // interpolation. Confluences and endpoints stay fixed so branches meet.
    for(let pass=0;pass<2;pass++){
      const next=chain.map(p=>p.slice());
      for(let k=1;k<chain.length-1;k++)for(let axis=0;axis<2;axis++)next[k][axis]=(chain[k-1][axis]+2*chain[k][axis]+chain[k+1][axis])*.25;
      for(let k=1;k<chain.length-1;k++)chain[k]=next[k];
    }
    const smooth=[];
    for(let k=0;k<chain.length-1;k++){
      const p0=chain[Math.max(0,k-1)],p1=chain[k],p2=chain[k+1],p3=chain[Math.min(chain.length-1,k+2)];
      for(let j=0;j<6;j++){
        const t=j/6,t2=t*t,t3=t2*t,a=2*t3-3*t2+1,b=t3-2*t2+t,c=-2*t3+3*t2,d=t3-t2;
        smooth.push([a*p1[0]+b*(p2[0]-p0[0])*.35+c*p2[0]+d*(p3[0]-p1[0])*.35,a*p1[1]+b*(p2[1]-p0[1])*.35+c*p2[1]+d*(p3[1]-p1[1])*.35,p1[2]+(p2[2]-p1[2])*t]);
      }
    }
    smooth.push(chain[chain.length-1]);curveSamples+=smooth.length;pathCount++;
    // Shift the unwrapped chain into the atlas's central longitude range.
    const shift=Math.floor(smooth[0][0]);for(const p of smooth)p[0]-=shift;
    bake(smooth);
  }
  const vertices=new Float32Array(verts);
  const result={id,width:W,height:H,lakes:expanded.buffer,rivers:vertices.buffer,water:(water+lakeWeight)/totalWeight,max,lakeCells,segments,pathCount,curveSamples,feather};
  const transfers=[expanded.buffer,vertices.buffer];
  if(debug){result.graph={parent:parent.buffer,filled:filled.buffer,heights:heights.buffer};transfers.push(parent.buffer,filled.buffer,heights.buffer);}
  self.postMessage(result,transfers);
};
