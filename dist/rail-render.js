import {HEIGHT_METERS} from './scale.js?v=2.3.0';
import {R,unit,tangent,cross,distance} from './rail.js?v=2.3.0';
const vertex=`#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec3 normal;layout(location=2)in vec2 coordinate;uniform mat4 viewProjection;out vec3 n;out vec2 uv;void main(){n=normal;uv=coordinate;gl_Position=viewProjection*vec4(position,1);}`;
const fragment=`#version 300 es
precision highp float;in vec3 n;in vec2 uv;uniform vec3 sun;out vec4 color;
void main(){float across=abs(uv.x);vec3 base=across>4.0?vec3(.32,.24,.14):vec3(.27,.29,.27);
float aa=max(fwidth(uv.x),.025);float rail=1.0-smoothstep(.065,.065+aa,abs(across-.7175));
float sleeper=(1.0-smoothstep(.13,.13+max(fwidth(uv.y),.02),abs(mod(uv.y+1.1,2.2)-1.1)))*(1.0-smoothstep(1.2,1.3,across));
base=mix(base,vec3(.16,.105,.065),sleeper);base=mix(base,vec3(.66,.70,.69),rail);float light=.22+1.15*max(dot(normalize(n),sun),0.0);color=vec4(pow(base*light,vec3(.4545)),1);}`;
const lineVertex=`#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec3 along;layout(location=2)in vec2 data;uniform mat4 viewProjection;uniform vec2 viewport;uniform vec3 camera;out float speed;out float fade;out float edge;void main(){vec4 a=viewProjection*vec4(position,1),b=viewProjection*vec4(position+along*.001,1);vec2 d=normalize((b.xy/b.w-a.xy/a.w)*viewport);vec2 side=vec2(-d.y,d.x);a.xy+=side*data.x*6.0/viewport*a.w;a.z-=.000001*a.w;gl_Position=a;speed=data.y;edge=data.x;fade=mix(.38,1.0,smoothstep(.001,.012,distance(position,camera)));}`;
const lineFragment=`#version 300 es
precision highp float;in float speed;in float fade;in float edge;out vec4 color;void main(){if(fade<.01)discard;vec3 tint=mix(vec3(1.0,.06,.65),vec3(1.0,.92,1.0),smoothstep(.25,.5,abs(edge)));tint=mix(tint,vec3(.075,.015,.075),smoothstep(.65,.95,abs(edge)));color=vec4(tint,fade);}`;
const markerVertex=`#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec3 shade;uniform mat4 viewProjection;out vec3 tint;void main(){gl_Position=viewProjection*vec4(position,1);gl_Position.z-=.000003*gl_Position.w;gl_PointSize=13.0;tint=shade;}`;
const markerFragment=`#version 300 es
precision highp float;in vec3 tint;out vec4 color;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;color=vec4(r>.34?vec3(.95):tint,1);}`;
function compile(gl,vs,fs){const p=gl.createProgram();for(const [kind,source]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
export class RailwayRenderer{
  constructor(gl){this.gl=gl;this.bedProgram=compile(gl,vertex,fragment);this.lineProgram=compile(gl,lineVertex,lineFragment);this.markerProgram=compile(gl,markerVertex,markerFragment);this.meshes=[];this.markers=null;this.hasRoute=false;this.bins=this.integerTexture(1,1,new Uint32Array(4));this.data=this.floatTexture(1,1,new Float32Array(4));this.ranges=this.integerTexture(1,1,new Uint32Array(4));}
  integerTexture(w,h,pixels){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);for(const v of[g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,v,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.REPEAT);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA32UI,w,h,0,g.RGBA_INTEGER,g.UNSIGNED_INT,pixels);return t;}
  floatTexture(w,h,pixels){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);for(const v of[g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,v,g.NEAREST);g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,w,h,0,g.RGBA,g.FLOAT,pixels);return t;}
  mesh(vertices,stride,attributes){const g=this.gl,vao=g.createVertexArray(),buffer=g.createBuffer();g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(vertices),g.STATIC_DRAW);let offset=0;attributes.forEach((size,i)=>{g.enableVertexAttribArray(i);g.vertexAttribPointer(i,size,g.FLOAT,false,stride*4,offset*4);offset+=size;});g.bindVertexArray(null);return{vao,buffer,count:vertices.length/stride};}
  destroy(mesh){if(mesh){this.gl.deleteVertexArray(mesh.vao);this.gl.deleteBuffer(mesh.buffer);}}
  clear(){this.meshes.forEach(m=>this.destroy(m));this.meshes=[];this.hasRoute=false;}
  setMarkers(points,surface){this.destroy(this.markers);const values=[];for(let i=0;i<points.length;i++){const p=points[i],n=p.n||p,radius=Number.isFinite(p.h)?1+(p.h+5)/HEIGHT_METERS:surface.rendered(n)+5/HEIGHT_METERS;values.push(...n.map(x=>x*radius),...(p.tint||(i===0?[.1,.9,.6]:[1,.6,.1])));}this.markers=values.length?this.mesh(values,6,[3,3]):null;}
  setRoute(route,surface){return RailwayRenderer.prototype.setRoutes.call(this,[route],surface);}
  setRoutes(routes,surface){
    this.clear();if(!routes.length)return;const g=this.gl,bed=[],line=[],points=[],widths=[];
    for(const route of routes){
      const part=RailwayRenderer.prototype.geometry.call(this,route,surface);
      for(const v of part.bed)bed.push(v);for(const v of part.line)line.push(v);
      part.points.forEach((p,i)=>{points.push({...p,breakBefore:i===0});widths.push(part.widths[i]);});
    }
    const bins=this.buildBins(points,widths,2048);g.deleteTexture(this.bins);g.deleteTexture(this.data);g.deleteTexture(this.ranges);this.bins=this.integerTexture(bins.width,bins.height,bins.pixels);this.ranges=this.integerTexture(bins.rangeWidth,bins.rangeHeight,bins.ranges);
    const width=2048,height=Math.max(1,Math.ceil(points.length/width)),data=new Float32Array(width*height*4);
    points.forEach((p,i)=>data.set([...p.n,widths[i]/R],i*4));this.data=this.floatTexture(width,height,data);
    this.meshes=[this.mesh(bed,8,[3,3,2]),this.mesh(line,8,[3,3,2])];this.hasRoute=true;
  }
  geometry(route,surface){
    const points=route.points,bed=[],stroke=[],widths=[],rows=[],stations=[];let station=0;
    for(let i=0;i<points.length;i++){
      const p=points[i];if(i)station+=distance(points[i-1].n,p.n);stations.push(station);
      const next=i+1<points.length?tangent(p.n,points[i+1].n):null,previous=i?tangent(p.n,points[i-1].n).map(x=>-x):null,f=next&&previous?unit(next.map((v,k)=>v+previous[k])):(next||previous),side=unit(cross(p.n,f));
      const depth=p.h-(surface.rendered(p.n)-1)*HEIGHT_METERS,width=p.bridge?4:(p.width??(6+1.5*Math.abs(depth)));widths.push(p.bridge?0:width);
      const row=[];
      for(const across of[-width,-4,4,width]){
        const n=unit(p.n.map((x,k)=>x+side[k]*across/R)),r=Math.abs(across)>4?(surface.rendered(n)+.15/HEIGHT_METERS):(1+(p.h+.2)/HEIGHT_METERS);
        row.push({position:n.map(x=>x*r),n,across,s:station});
      }
      rows.push(row);
      const position=p.n.map(x=>x*(1+(p.h+.5)/HEIGHT_METERS)),ratio=p.limit/(route.parameters.speed/3.6);
      for(const sign of[-1,1])stroke.push(...position,...f,sign,ratio);
    }
    const emit=(a,b,c)=>{const raw=cross(b.position.map((x,i)=>x-a.position[i]),c.position.map((x,i)=>x-a.position[i]));if(Math.hypot(...raw)<1e-16)return;let normal=unit(raw);if(normal.reduce((s,v,i)=>s+v*a.n[i],0)<0)normal=normal.map(v=>-v);for(const v of[a,b,c])bed.push(...v.position,...normal,v.across,v.s);};
    // Close the rounded construction footprints at both endpoints.
    for(const index of[0,points.length-1]){
      const p=points[index];if(p.bridge)continue;const f=tangent(p.n,points[index===0?1:index-1].n).map(x=>-x),side=unit(cross(p.n,f)),width=widths[index];
      const center={position:p.n.map(x=>x*(1+(p.h+.2)/HEIGHT_METERS)),n:p.n,across:0,s:stations[index]};let lastInner=null,lastOuter=null;
      for(let j=0;j<=20;j++){
        const a=j*Math.PI/20,d=side.map((x,k)=>x*Math.cos(a)+f[k]*Math.sin(a));
        const innerN=unit(p.n.map((x,k)=>x+d[k]*4/R)),outerN=unit(p.n.map((x,k)=>x+d[k]*width/R));
        const inner={position:innerN.map(x=>x*(1+(p.h+.2)/HEIGHT_METERS)),n:innerN,across:4,s:stations[index]},outer={position:outerN.map(x=>x*(surface.rendered(outerN)+.15/HEIGHT_METERS)),n:outerN,across:width,s:stations[index]};
        if(lastInner){emit(center,lastInner,inner);emit(lastInner,lastOuter,inner);emit(inner,lastOuter,outer);}lastInner=inner;lastOuter=outer;
      }
    }
    const line=[];
    for(let i=1;i<points.length;i++){
      for(let j=0;j<3;j++){emit(rows[i-1][j],rows[i][j],rows[i-1][j+1]);emit(rows[i][j],rows[i][j+1],rows[i-1][j+1]);}
      if(points[i].bridge||points[i-1].bridge){
        for(const j of[1,2]){
          const a=rows[i-1][j],b=rows[i][j],lower=v=>({...v,position:v.position.map((x,k)=>x-v.n[k]*1.2/HEIGHT_METERS),across:3}),c=lower(a),d=lower(b);
          emit(a,c,b);emit(b,c,d);
        }
      }
      for(const index of[(i-1)*2,(i-1)*2+1,i*2,(i-1)*2+1,i*2+1,i*2])line.push(...stroke.slice(index*8,index*8+8));
    }

    for(let i=1;i<points.length-1;i++){
      const p=points[i];if(!p.bridge||Math.floor(stations[i]/80)===Math.floor(stations[i-1]/80))continue;
      const f=tangent(p.n,points[i+1].n),side=unit(cross(p.n,f)),top=[],bottom=[];
      for(const[a,b]of[[-1,-1],[1,-1],[1,1],[-1,1]]){
        const n=unit(p.n.map((v,k)=>v+(f[k]*a+side[k]*b)*.85/R));
        top.push({n,position:n.map(v=>v*(1+(p.h-1)/HEIGHT_METERS)),across:3,s:0});
        bottom.push({n,position:n.map(v=>v*(surface.rendered(n)-.3/HEIGHT_METERS)),across:3,s:0});
      }
      for(let j=0;j<4;j++){const k=(j+1)%4;emit(top[j],bottom[j],top[k]);emit(top[k],bottom[j],bottom[k]);}
    }
    return {points,widths,bed,line};
  }
  buildBins(points,widths,width){
    const height=width/2,lists=new Map();
    for(let i=0;i<points.length-1;i++){
      if(points[i+1].breakBefore||!widths[i]&&!widths[i+1])continue;const a=points[i].n,b=points[i+1].n,latA=Math.asin(a[1]),latB=Math.asin(b[1]),v0=latA/Math.PI+.5,v1=latB/Math.PI+.5;
      let u0=(Math.atan2(a[2],a[0])/(2*Math.PI)+1)%1,u1=(Math.atan2(b[2],b[0])/(2*Math.PI)+1)%1;if(u1-u0>.5)u1--;if(u0-u1>.5)u1++;
      const margin=Math.max(widths[i],widths[i+1])/R,du=margin/(2*Math.PI*Math.max(.005,Math.cos(Math.max(Math.abs(latA),Math.abs(latB))))),dv=margin/Math.PI;
      const minX=Math.floor((Math.min(u0,u1)-du)*width)-1,maxX=Math.ceil((Math.max(u0,u1)+du)*width)+1,minY=Math.max(0,Math.floor((Math.min(v0,v1)-dv)*height)-1),maxY=Math.min(height-1,Math.ceil((Math.max(v0,v1)+dv)*height)+1);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const key=y*width+(x%width+width)%width;if(!lists.has(key))lists.set(key,[]);const a=lists.get(key);if(a[a.length-1]!==i)a.push(i);}
    }
    const pixels=new Uint32Array(width*height*4),packed=[];
    for(const[key,ids]of lists){const offset=packed.length;let start=ids[0],last=start;for(let k=1;k<=ids.length;k++){if(k<ids.length&&ids[k]===last+1&&last-start<62){last=ids[k];continue;}packed.push((start<<8)|(last-start+1));start=last=ids[k];}pixels[key*4]=offset;pixels[key*4+1]=packed.length-offset;}
    const rangeWidth=2048,rangeHeight=Math.max(1,Math.ceil(packed.length/(rangeWidth*4))),ranges=new Uint32Array(rangeWidth*rangeHeight*4);ranges.set(packed);
    return {width,height,pixels,ranges,rangeWidth,rangeHeight};
  }
  bindTerrain(program,loc){const g=this.gl;g.useProgram(program);g.uniform1i(loc(program,'hasRail'),this.hasRoute?1:0);g.activeTexture(g.TEXTURE5);g.bindTexture(g.TEXTURE_2D,this.bins);g.uniform1i(loc(program,'railBins'),5);g.activeTexture(g.TEXTURE6);g.bindTexture(g.TEXTURE_2D,this.data);g.uniform1i(loc(program,'railData'),6);g.activeTexture(g.TEXTURE7);g.bindTexture(g.TEXTURE_2D,this.ranges);g.uniform1i(loc(program,'railRanges'),7);}
  draw(matrix,camera,sun,canvas){const g=this.gl;g.disable(g.CULL_FACE);
    for(let i=0;i<this.meshes.length;i++){const p=i===0?this.bedProgram:this.lineProgram,m=this.meshes[i];g.useProgram(p);g.uniformMatrix4fv(g.getUniformLocation(p,'viewProjection'),false,matrix);g.uniform3fv(g.getUniformLocation(p,'sun'),sun);g.uniform3fv(g.getUniformLocation(p,'camera'),camera);g.uniform2f(g.getUniformLocation(p,'viewport'),canvas.width,canvas.height);g.bindVertexArray(m.vao);if(i){g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);}g.drawArrays(g.TRIANGLES,0,m.count);g.disable(g.BLEND);}
    if(this.markers){const p=this.markerProgram;g.useProgram(p);g.uniformMatrix4fv(g.getUniformLocation(p,'viewProjection'),false,matrix);g.bindVertexArray(this.markers.vao);g.drawArrays(g.POINTS,0,this.markers.count);}g.bindVertexArray(null);
  }
}
