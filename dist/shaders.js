import {MAX_LAYERS, WAVES_PER_BAND, MOISTURE_WAVES, ELEVATION_GAIN, ELEVATION_OFFSET} from './noise.js?v=1.8.0';
// Original GLSL, independent of terrain3d. Coordinates stay on a sphere, avoiding terrain seams.
export const fullscreenVertex = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
// Random-phase waves use uniformly distributed 3D directions, with a fresh
// uniform rotation per frequency band. There is no lattice or domain warp.
export const generateFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 uv;
layout(location=0) out vec4 color;
layout(location=1) out vec4 slopes;
uniform sampler2D terrainWaves;
uniform vec4 moistureWaves[${MOISTURE_WAVES}];
uniform float bandAmplitudes[${MAX_LAYERS}];
uniform int noiseLayers;
void main(){
  float lon=uv.x*6.28318530718,lat=(uv.y-.5)*3.14159265359;
  vec3 n=vec3(cos(lat)*cos(lon),sin(lat),cos(lat)*sin(lon));
  float c=0.0;
  vec3 gradient=vec3(0);
  for(int band=0;band<${MAX_LAYERS};band++){
    if(band>=noiseLayers)break;
    float amplitude=bandAmplitudes[band];
    if(amplitude==0.0)continue;
    float sum=0.0;
    for(int j=0;j<${WAVES_PER_BAND};j++){
      vec4 wave=texelFetch(terrainWaves,ivec2(j,band),0);
      float phase=dot(n,wave.xyz)+wave.w;
      sum+=cos(phase);
      gradient-=sin(phase)*wave.xyz*amplitude;
    }
    c+=sum*amplitude;
  }
  // Raise the whole field, preserving the same smooth spectrum at all heights.
  float h=${ELEVATION_OFFSET}+c*${ELEVATION_GAIN};
  gradient*=${ELEVATION_GAIN};
  // Store analytic tangent derivatives alongside height, once per world.
  // Signed companding preserves fine precision without clipping steep spectra.
  vec3 east=vec3(-sin(lon),0,cos(lon));
  vec3 north=vec3(-sin(lat)*cos(lon),cos(lat),-sin(lat)*sin(lon));
  vec2 derivative=vec2(dot(gradient,east),dot(gradient,north));
  vec2 packedSlope=floor((derivative/(1.0+abs(derivative))*.5+.5)*65535.0);
  vec2 slopeHigh=floor(packedSlope/256.0);
  slopes=vec4(slopeHigh.x,packedSlope.x-slopeHigh.x*256.0,slopeHigh.y,packedSlope.y-slopeHigh.y*256.0)/255.0;
  float humidity=0.0;
  for(int j=0;j<${MOISTURE_WAVES};j++){
    vec4 wave=moistureWaves[j];
    humidity+=cos(dot(n,wave.xyz)+wave.w);
  }
  float moisture=clamp(.60+humidity*${(.16/Math.sqrt(MOISTURE_WAVES/2)).toFixed(8)},0.0,1.0);
  float encoded=clamp((h+.24)/.48,0.0,1.0)*65535.0;
  float high=floor(encoded/256.0),low=floor(encoded-high*256.0);
  color=vec4(high/255.0,low/255.0,moisture,1.0);
}`;
export const surfaceCommon = `
uniform sampler2D terrain;uniform sampler2D drainage;uniform float sea;uniform float relief;
// Handle axes explicitly: atan(z,x) is not portable for zero x, including -0.
float longitude(vec3 p){
  if(abs(p.x)<.0000001)return p.z<0.0?-1.57079632679:(p.z>0.0?1.57079632679:0.0);
  if(abs(p.z)<.0000001)return p.x<0.0?3.14159265359:0.0;
  return atan(p.z,p.x);
}
vec2 coord(vec3 p){p=normalize(p);return vec2(fract(longitude(p)/6.28318530718+1.0),asin(clamp(p.y,-1.0,1.0))/3.14159265359+.5);}
float decode(vec2 rg){return (rg.x*65280.0+rg.y*255.0)/65535.0*.48-.24;}
vec4 fields(vec3 n){vec2 uv=coord(n);vec4 t=texture(terrain,uv);ivec2 size=textureSize(drainage,0);ivec2 cell=ivec2(fract(uv.x)*float(size.x),clamp(uv.y,0.0,.999999)*float(size.y));cell=clamp(cell,ivec2(0),size-1);vec4 d=texelFetch(drainage,cell,0);float h=decode(t.rg),lake=decode(d.rg);return vec4(h,max(sea,lake),t.b,d.b);}
float surface(vec3 n){vec4 f=fields(n);return 1.0+max(f.x,f.y)*relief;}
`;
export const terrainVertex = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location=0) in vec3 direction;
uniform mat4 viewProjection;
out vec3 world;
out vec3 radial;
${surfaceCommon}
void main(){
  vec3 n=normalize(direction);
  world=n*surface(n);
  radial=n;
  gl_Position=viewProjection*vec4(world,1.0);
}`;

export const terrainFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 world;
in vec3 radial;
out vec4 color;
uniform vec3 camera;
uniform vec3 sun;
uniform int mode;
uniform sampler2D riverMask;
uniform sampler2D slopeMap;
${surfaceCommon}

// Interpolated analytic derivatives give smooth normals at every mesh detail.
// No triangle normals or finite differences of quantized heights are used.
vec3 terrainNormal(vec3 n,float h){
  vec4 packed=texture(slopeMap,coord(n));
  vec2 compressed=(vec2(packed.x*65280.0+packed.y*255.0,packed.z*65280.0+packed.w*255.0)/65535.0-.5)*2.0;
  vec2 derivative=compressed/max(vec2(.00001),1.0-abs(compressed));
  float lon=longitude(n);
  vec3 east=vec3(-sin(lon),0,cos(lon));
  vec3 north=cross(east,n);
  vec3 gradient=east*derivative.x+north*derivative.y;
  return normalize(n-gradient*relief/(1.0+h*relief));
}
// A smooth dielectric coating: GGX distribution, Schlick Fresnel, and Smith
// visibility. The small roughness floor keeps point-light reflections crisp.
// Pixel normal variance gently widens only subpixel glints to prevent sparkle.
vec3 coatedLight(vec3 base,vec3 normal,vec3 view,float roughness){
  vec3 halfVector=normalize(sun+view);
  float nl=max(dot(normal,sun),0.0),nv=max(dot(normal,view),.001);
  float nh=max(dot(normal,halfVector),0.0),vh=max(dot(view,halfVector),0.0);
  vec3 dx=dFdx(normal),dy=dFdy(normal);
  float variance=max(dot(dx,dx),dot(dy,dy));
  float a2=max(pow(roughness,4.0)+variance*.04,.00004);
  float denominator=nh*nh*(a2-1.0)+1.0;
  float distribution=a2/(3.14159265*denominator*denominator);
  float visibility=.5/max(nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2),.0001);
  float fresnel=.04+.96*pow(1.0-vh,5.0);
  float specular=distribution*visibility*fresnel*nl;
  return base*(.10+1.45*nl)+vec3(specular*1.45);
}
vec3 waterLight(vec3 normal,vec3 view){
  // One linear base color for oceans, lakes, and rivers, at every depth.
  return coatedLight(vec3(.006,.033,2.2),normal,view,.089);
}
vec3 glacierLight(vec3 normal,vec3 view){
  return coatedLight(vec3(1.5,1.8,2.0),normal,view,.19);
}
vec3 displayColor(vec3 linear){
  // Compress the HDR reflection, then encode linear light for the display.
  vec3 mapped=linear/(1.0+linear);
  return mix(mapped*12.92,1.055*pow(mapped,vec3(1.0/2.4))-.055,step(vec3(.0031308),mapped));
}
float snowCover(float altitude){return smoothstep(.0745,.0775,altitude);}
void main(){
  vec3 n=normalize(radial);
  vec4 f=fields(n);
  float h=f.x;
  float altitude=max(0.0,h-sea);
  vec3 normal=terrainNormal(n,h);
  // Reference palette expressed as independent linear-light color stops:
  // vivid green lowlands, olive foothills, and warm rose-brown summits.
  float heightTint=clamp(altitude/.085,0.0,1.0);
  vec3 albedo=mix(vec3(.006,.50,.002),vec3(.40,.167,.20),heightTint);
  float snow=snowCover(altitude);
  albedo=mix(albedo,vec3(2.3),snow);
  if(mode==1){
    albedo=mix(mix(vec3(.35,.65,.20),vec3(.75,.53,.32),smoothstep(0.0,.075,altitude)),vec3(.94,.95,.90),smoothstep(.07,.12,altitude));
  }
  vec3 surfacePoint=n*(1.0+max(h,f.y)*relief);
  vec3 view=normalize(camera-surfacePoint);
  vec3 land=coatedLight(albedo,normal,view,.089);
  // A distance field gives subpixel edges without staircase corners. Since the
  // river material is evaluated on the planet itself, it cannot intersect or
  // disappear beneath a coarser mesh or a change in vertical exaggeration.
  float field=texture(riverMask,coord(n)).r;
  float edge=max(fwidth(field)*.65,.006);
  float river=smoothstep(.5-edge,.5+edge,field);
  // Adjacent basins can have different spill levels. Differentiate terrain
  // height only; differentiating the basin-level jump would draw cell outlines.
  float shore=max(fwidth(h)*.55,.000008);
  float body=1.0-smoothstep(-shore,shore,h-f.y);
  // River ice follows exactly the same snow coverage as the surrounding land.
  vec3 riverMaterial=mix(waterLight(normal,view),glacierLight(normal,view),snow);
  vec3 lit=mix(land,riverMaterial,river);
  // Level lakes retain their physical glacier line and freeze as one surface.
  const float glacierLineMeters=3500.0;
  float lakeAltitudeMeters=(f.y-sea)*relief*65000.0;
  bool glacier=f.y>sea+.00001 && lakeAltitudeMeters>=glacierLineMeters;
  vec3 lakeMaterial=glacier?glacierLight(n,view):waterLight(n,view);
  lit=mix(lit,lakeMaterial,body);
  color=vec4(displayColor(max(lit,vec3(0))),1.0);
}`;

// Smooth drainage paths are rasterized once into an 8K R8 distance atlas.
// The globe samples the atlas as a material; there is no river overlay mesh.
export const riverAtlasVertex = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location=0) in vec3 position;
layout(location=1) in float halfWidth;
out float across;
out float width;
void main(){
  gl_Position=vec4(position.xy*2.0-1.0,0.0,1.0);
  across=position.z;
  width=halfWidth;
}`;
export const riverAtlasFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in float across;
in float width;
uniform float feather;
out vec4 color;
void main(){
  float coverage=clamp(.5+(width-abs(across))/(2.0*feather),0.0,1.0);
  color=vec4(coverage,0,0,1);
}`;
export const atmosphereVertex = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;layout(location=0) in vec3 direction;uniform mat4 viewProjection;out vec3 world;void main(){world=normalize(direction)*1.15;gl_Position=viewProjection*vec4(world,1.0);}`;
export const atmosphereFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;in vec3 world;uniform vec3 camera;uniform vec3 sun;out vec4 color;void main(){vec3 n=normalize(world),v=normalize(camera-world);float rim=pow(1.0-abs(dot(n,v)),5.0);float lit=smoothstep(-.4,.7,dot(n,sun));color=vec4(.30,.48,.49,rim*.10*lit);}`;
