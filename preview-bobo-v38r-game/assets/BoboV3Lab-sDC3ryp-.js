import{n as e}from"./scene.pure-BGKq890p.js";import{n as t,o as n,t as r}from"./math.vector.pure-DST8O3ID.js";import{n as i,t as a}from"./math.color.pure-D3LZPd96.js";import{r as o}from"./buffer.pure-BQQy_Hxi.js";import{n as s}from"./texture.pure-DMXFILnG.js";import{l as c}from"./pbrMaterial.pure-CwSCcVZ3.js";import{t as l}from"./constants-DlOANaVb.js";import{A as u,B as d,H as f,I as p,L as m,M as h,R as g,T as _,U as ee,V as v,a as te,d as ne,f as re,g as ie,h as ae,i as y,k as oe,m as se,n as ce,o as le,p as ue,r as de,s as fe,w as pe}from"./index-CZToEe3U.js";function b(e,t){let n=[...e].sort((e,t)=>e-t),r=n.reduce((e,t)=>e+t,0),i=n.length,a=i?n[Math.min(i-1,Math.floor(i*.99))]:0,o=t.length?t.reduce((e,t)=>e+t,0)/t.length:0;return{seconds:Math.round(r*10)/10,frames:i,avgFps:i?i/Math.max(r,1e-6):0,low1Fps:a>0?1/a:0,minFps:i?1/n[i-1]:0,avgDrawCalls:o,maxDrawCalls:t.length?Math.max(...t):0}}var me=class{warmup;target;elapsed=0;dts=[];draws=[];constructor(e,t=.5){this.target=e,this.warmup=t}get progress(){return Math.min(1,this.elapsed/(this.target+this.warmup))}record(e,t){return this.elapsed+=e,this.elapsed>this.warmup&&(this.dts.push(e),this.draws.push(t)),this.elapsed>=this.target+this.warmup}summary(){return b(this.dts,this.draws)}},x=class extends c{rim=new a(.55,.8,1);deep=new a(.2,.14,.78);top=new a(.3,.55,1);nebulaA=new a(.2,.85,1);nebulaB=new a(.6,.38,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);height=.8;strength=1;invWorld=r.Identity();nebula=1;enabled=!1;constructor(e){super(e,`JellyV3Plugin`,200,{JELLY3:!1}),this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV3Plugin`}prepareDefines(e,t,n){e.JELLY3=this.enabled}getUniforms(){return{ubo:[{name:`j3Rim`,size:3,type:`vec3`},{name:`j3Deep`,size:3,type:`vec3`},{name:`j3Top`,size:3,type:`vec3`},{name:`j3NebA`,size:3,type:`vec3`},{name:`j3NebB`,size:3,type:`vec3`},{name:`j3SkyLow`,size:3,type:`vec3`},{name:`j3SkyHigh`,size:3,type:`vec3`},{name:`j3Params`,size:4,type:`vec4`},{name:`j3InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY3
uniform vec3 j3Rim;
uniform vec3 j3Deep;
uniform vec3 j3Top;
uniform vec3 j3NebA;
uniform vec3 j3NebB;
uniform vec3 j3SkyLow;
uniform vec3 j3SkyHigh;
uniform vec4 j3Params;
uniform mat4 j3InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j3Rim`,this.rim),e.updateColor3(`j3Deep`,this.deep),e.updateColor3(`j3Top`,this.top),e.updateColor3(`j3NebA`,this.nebulaA),e.updateColor3(`j3NebB`,this.nebulaB),e.updateColor3(`j3SkyLow`,this.skyLow),e.updateColor3(`j3SkyHigh`,this.skyHigh),e.updateFloat4(`j3Params`,this.height,this.strength,this.nebula,2.4),e.updateMatrix(`j3InvWorld`,this.invWorld))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:S,CUSTOM_FRAGMENT_BEFORE_FOG:he}:null}},S=`
#ifdef JELLY3
float j3Hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float j3Noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(j3Hash(i + vec3(0, 0, 0)), j3Hash(i + vec3(1, 0, 0)), f.x),
                 mix(j3Hash(i + vec3(0, 1, 0)), j3Hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(j3Hash(i + vec3(0, 0, 1)), j3Hash(i + vec3(1, 0, 1)), f.x),
                 mix(j3Hash(i + vec3(0, 1, 1)), j3Hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float j3Fbm(vec3 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * j3Noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}
/* 星點：每個格子一顆，亮度隨距離快速衰減 */
float j3Stars(vec3 p, float density) {
  vec3 c = floor(p * density);
  vec3 f = fract(p * density) - 0.5;
  vec3 o = vec3(j3Hash(c), j3Hash(c + 7.1), j3Hash(c + 3.7)) - 0.5;
  float keep = step(0.62, j3Hash(c + 1.9));
  float d = length(f - o * 0.7);
  return keep * smoothstep(0.16, 0.0, d);
}
#endif
`,he=`
#ifdef JELLY3
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j3Params.w);
  float jS = j3Params.y;

  // 物件座標（以身高為 1）：星雲跟著模型走
  vec3 lp = (j3InvWorld * vec4(vPositionW, 1.0)).xyz / j3Params.x;
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 body = mix(j3Deep, j3Top, smoothstep(0.05, 0.95, h));
  // V3.1：以藍紫本色為主（壓低受光造成的發白），邊緣更深、更透
  color.rgb = mix(color.rgb, color.rgb * 0.35 + body * 0.7, jS * (0.55 + 0.3 * (1.0 - jNdV)));

  if (j3Params.z > 0.5) {
    // 沿折射後視線往內取兩個深度（視差 → 內部深度）
    vec3 rdW = refract(-jV, jN, 0.75);
    vec3 rd = normalize((j3InvWorld * vec4(rdW, 0.0)).xyz);
    vec3 p1 = lp + rd * 0.12;
    vec3 p2 = lp + rd * 0.34;
    float low1 = 1.0 - smoothstep(0.15, 0.75, p1.y);
    float low2 = 1.0 - smoothstep(0.1, 0.7, p2.y);
    float n1 = smoothstep(0.4, 0.82, j3Fbm(p1 * 3.2 + vec3(0.0, 1.3, 0.0)));
    float n2 = smoothstep(0.36, 0.78, j3Fbm(p2 * 2.3 + vec3(4.1, 0.0, 2.2)));
    vec3 neb = j3NebA * n1 * (0.35 + 0.65 * low1) * 0.7 + j3NebB * n2 * (0.3 + 0.7 * low2) * 0.6;
    // 細碎星光：近層細密、遠層較大（三種密度）
    float st = j3Stars(p1, 16.0) * 0.8 + j3Stars(p1 + 1.7, 9.0) * 0.9 + j3Stars(p2 + 3.3, 6.0) * 0.6;
    // 底部光池（設定圖：底部中央青色發亮）
    // 只在身體中後段底部，避免正面把腹部星星洗白
    float pool = smoothstep(0.45, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.3, p2.y)) * (1.0 - smoothstep(0.15, 0.45, p2.z));
    vec3 inner = neb + vec3(0.85, 0.95, 1.0) * st + j3NebA * pool * 0.85;
    // 正面看進去最多、邊緣少（邊緣是表面反光）
    color.rgb += inner * 1.6 * jS * (0.35 + 0.65 * jNdV);
    color.a = clamp(color.a + (st * 0.35 + n1 * 0.12) * jS * jNdV, 0.0, 1.0);
  }

  // 腹部星星的暖光從果凍內部透出（物件座標：高 0.2、往前 0.5）
  {
    vec3 jSd = lp - vec3(0.0, 0.23, 0.55);
    jSd.z *= 1.6;
    float jStarGlow = exp(-dot(jSd, jSd) / 0.012);
    // 星星前方的果凍變薄：看得到裡面的金色星星，帶一點藍紫色調，而不是貼在表面
    color.rgb = mix(color.rgb, j3Deep * 0.6, jStarGlow * jS * 0.5);
    color.a *= 1.0 - 0.85 * jStarGlow * jS;
  }

  // 天空反射＋藍紫邊緣光
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j3SkyLow, j3SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.12 * jS;
  color.rgb += j3Rim * jFres * 0.95 * jS;
  color.a = clamp(color.a + jFres * 0.32 * jS, 0.0, 1.0);

  // 日系硬邊高光：正面看左上大、右上小（世界方向）
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,ge=class extends c{rim=new a(.62,.85,1);core=new a(.16,.12,.62);shell=new a(.36,.5,1);top=new a(.5,.66,1);nebulaA=new a(.25,.75,1);nebulaB=new a(.62,.36,1);wing=new a(.56,.66,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.25,.54);starNormal=new n(0,-.48,.8773).normalize();starOuter=.112;starInner=.056;height=1;strength=1;nebula=1;invWorld=r.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV31Plugin`,200,{JELLY31:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV31Plugin`}prepareDefines(e,t,n){e.JELLY31=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j31Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j31Rim`,size:3,type:`vec3`},{name:`j31Core`,size:3,type:`vec3`},{name:`j31Shell`,size:3,type:`vec3`},{name:`j31Top`,size:3,type:`vec3`},{name:`j31NebA`,size:3,type:`vec3`},{name:`j31NebB`,size:3,type:`vec3`},{name:`j31Wing`,size:3,type:`vec3`},{name:`j31SkyLow`,size:3,type:`vec3`},{name:`j31SkyHigh`,size:3,type:`vec3`},{name:`j31StarC`,size:3,type:`vec3`},{name:`j31StarN`,size:3,type:`vec3`},{name:`j31Params`,size:4,type:`vec4`},{name:`j31Star`,size:4,type:`vec4`},{name:`j31InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY31
uniform vec3 j31Rim;
uniform vec3 j31Core;
uniform vec3 j31Shell;
uniform vec3 j31Top;
uniform vec3 j31NebA;
uniform vec3 j31NebB;
uniform vec3 j31Wing;
uniform vec3 j31SkyLow;
uniform vec3 j31SkyHigh;
uniform vec3 j31StarC;
uniform vec3 j31StarN;
uniform vec4 j31Params;
uniform vec4 j31Star;
uniform mat4 j31InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j31Rim`,this.rim),e.updateColor3(`j31Core`,this.core),e.updateColor3(`j31Shell`,this.shell),e.updateColor3(`j31Top`,this.top),e.updateColor3(`j31NebA`,this.nebulaA),e.updateColor3(`j31NebB`,this.nebulaB),e.updateColor3(`j31Wing`,this.wing),e.updateColor3(`j31SkyLow`,this.skyLow),e.updateColor3(`j31SkyHigh`,this.skyHigh),e.updateVector3(`j31StarC`,this.starCenter),e.updateVector3(`j31StarN`,this.starNormal),e.updateFloat4(`j31Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j31Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j31InvWorld`,this.invWorld),e.setTexture(`j31Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:w,CUSTOM_FRAGMENT_BEFORE_FOG:T}:null}};function C(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV31_Noise`,c}var w=`
#ifdef JELLY31
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j31Noise;
/* 雙平面投影取樣（物件座標的 xy 與 zy 平面混合）：便宜的 3D 星雲 */
vec4 j31Tex(vec3 p, vec3 n) {
  vec4 a = texture2D(j31Noise, p.xy);
  vec4 b = texture2D(j31Noise, p.zy + vec2(0.37, 0.61));
  float w = clamp(abs(n.x) * 1.4 - 0.2, 0.0, 1.0);
  return mix(a, b, w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j31StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,T=`
#ifdef JELLY31
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j31Params.w);
  float jS = j31Params.y;
  vec3 lp = (j31InvWorld * vec4(vPositionW, 1.0)).xyz / j31Params.x;
  vec3 lnrm = normalize((j31InvWorld * vec4(jN, 0.0)).xyz);
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j31InvWorld * vec4(rdW, 0.0)).xyz);

  // 翅膀區域（身體半寬約 0.62，翅膀在外側）
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.22, 0.0, 1.0);

  // 本色：中央（正對鏡頭、最厚）較深的藍紫 → 外層亮藍 → 上方偏淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j31Shell, j31Top, smoothstep(0.35, 1.0, h));
  vec3 base = mix(shell, j31Core, smoothstep(0.25, 0.95, jNdV) * 0.55);
  base = mix(base, j31Wing * (0.85 + 0.25 * jWingT), jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.25 + base * 0.8, jS * 0.85);
  // 翅膀更透
  color.a = mix(color.a, color.a * 0.82, jWing);

  if (j31Params.z > 0.5) {
    // 兩層深度（視差）：近層 0.1、遠層 0.3
    vec3 p1 = lp + rd * 0.1;
    vec3 p2 = lp + rd * 0.3;
    vec4 t1 = j31Tex(p1 * 0.9, lnrm);
    vec4 t2 = j31Tex(p2 * 0.55 + 0.21, lnrm);
    float n1 = smoothstep(0.42, 0.78, t1.r);
    float n2 = smoothstep(0.38, 0.72, t2.g);
    float low = 1.0 - smoothstep(0.1, 0.8, p2.y);
    vec3 neb = j31NebA * n1 * 0.55 + j31NebB * n2 * (0.35 + 0.45 * low);
    // 星光：近層細小、遠層較大較暗；星塵讓星雲有顆粒感
    float st = pow(t1.b, 1.5) * 1.3 + pow(t2.b, 2.0) * 0.6;
    float dust = smoothstep(0.62, 0.9, t1.a) * 0.25;
    // 柔和內部發光（中下方）
    float glow = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.5, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j31NebA * glow * 0.45;
    // 翅膀與細觸角上的星雲淡一點（太細的地方星點會變成雜訊）
    float into = (0.3 + 0.7 * jNdV) * (1.0 - 0.7 * jWing) * (1.0 - 0.75 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.25 * jS * into;
    color.a = clamp(color.a + (st * 0.4 + n2 * 0.1) * jS * jNdV, 0.0, 1.0);
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j31StarC;
    vec3 n = j31StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j31StarDist(uv, j31Star.x, j31Star.y, j31Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j31Star.x * 0.9, length(uv));
      vec3 gold = mix(vec3(1.0, 0.72, 0.12), vec3(1.0, 0.95, 0.62), core);
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j31Star.x + 0.5, 0.0, 1.0);
      float halo = exp(-max(d, 0.0) / 0.035) * (1.0 - fill) * face;
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.75, 0.25) * halo * 0.42;
      color.a = max(color.a, fill * 0.96);
      color.a = clamp(color.a + halo * 0.12, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j31SkyLow, j31SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j31Rim * jFres * (0.85 + 0.4 * jWing) * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,_e=class extends c{rim=new a(.62,.85,1);core=new a(.16,.12,.62);shell=new a(.36,.5,1);top=new a(.5,.66,1);nebulaA=new a(.25,.75,1);nebulaB=new a(.62,.36,1);wing=new a(.56,.66,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;invWorld=r.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV32Plugin`,200,{JELLY32:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV32Plugin`}prepareDefines(e,t,n){e.JELLY32=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j32Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j32Rim`,size:3,type:`vec3`},{name:`j32Core`,size:3,type:`vec3`},{name:`j32Shell`,size:3,type:`vec3`},{name:`j32Top`,size:3,type:`vec3`},{name:`j32NebA`,size:3,type:`vec3`},{name:`j32NebB`,size:3,type:`vec3`},{name:`j32Wing`,size:3,type:`vec3`},{name:`j32SkyLow`,size:3,type:`vec3`},{name:`j32SkyHigh`,size:3,type:`vec3`},{name:`j32StarC`,size:3,type:`vec3`},{name:`j32StarN`,size:3,type:`vec3`},{name:`j32Params`,size:4,type:`vec4`},{name:`j32Star`,size:4,type:`vec4`},{name:`j32InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY32
uniform vec3 j32Rim;
uniform vec3 j32Core;
uniform vec3 j32Shell;
uniform vec3 j32Top;
uniform vec3 j32NebA;
uniform vec3 j32NebB;
uniform vec3 j32Wing;
uniform vec3 j32SkyLow;
uniform vec3 j32SkyHigh;
uniform vec3 j32StarC;
uniform vec3 j32StarN;
uniform vec4 j32Params;
uniform vec4 j32Star;
uniform mat4 j32InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j32Rim`,this.rim),e.updateColor3(`j32Core`,this.core),e.updateColor3(`j32Shell`,this.shell),e.updateColor3(`j32Top`,this.top),e.updateColor3(`j32NebA`,this.nebulaA),e.updateColor3(`j32NebB`,this.nebulaB),e.updateColor3(`j32Wing`,this.wing),e.updateColor3(`j32SkyLow`,this.skyLow),e.updateColor3(`j32SkyHigh`,this.skyHigh),e.updateVector3(`j32StarC`,this.starCenter),e.updateVector3(`j32StarN`,this.starNormal),e.updateFloat4(`j32Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j32Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j32InvWorld`,this.invWorld),e.setTexture(`j32Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:ye,CUSTOM_FRAGMENT_BEFORE_FOG:E}:null}};function ve(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV32_Noise`,c}var ye=`
#ifdef JELLY32
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j32Noise;
/* 雙平面投影取樣（物件座標的 xy 與 zy 平面混合）：便宜的 3D 星雲 */
vec4 j32Tex(vec3 p, vec3 n) {
  vec4 a = texture2D(j32Noise, p.xy);
  vec4 b = texture2D(j32Noise, p.zy + vec2(0.37, 0.61));
  float w = clamp(abs(n.x) * 1.4 - 0.2, 0.0, 1.0);
  return mix(a, b, w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j32StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,E=`
#ifdef JELLY32
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j32Params.w);
  float jS = j32Params.y;
  vec3 lp = (j32InvWorld * vec4(vPositionW, 1.0)).xyz / j32Params.x;
  vec3 lnrm = normalize((j32InvWorld * vec4(jN, 0.0)).xyz);
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j32InvWorld * vec4(rdW, 0.0)).xyz);

  // 翅膀區域（身體半寬約 0.62，翅膀在外側）
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.22, 0.0, 1.0);

  // 本色：中央（正對鏡頭、最厚）較深的藍紫 → 外層亮藍 → 上方偏淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j32Shell, j32Top, smoothstep(0.35, 1.0, h));
  vec3 base = mix(shell, j32Core, smoothstep(0.25, 0.95, jNdV) * 0.55);
  base = mix(base, j32Wing * (0.85 + 0.25 * jWingT), jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.25 + base * 0.8, jS * 0.85);
  // 翅膀更透
  color.a = mix(color.a, color.a * 0.82, jWing);

  if (j32Params.z > 0.5) {
    // 兩層深度（視差）：近層 0.1、遠層 0.3
    vec3 p1 = lp + rd * 0.1;
    vec3 p2 = lp + rd * 0.3;
    vec4 t1 = j32Tex(p1 * 0.9, lnrm);
    vec4 t2 = j32Tex(p2 * 0.55 + 0.21, lnrm);
    float n1 = smoothstep(0.42, 0.78, t1.r);
    float n2 = smoothstep(0.38, 0.72, t2.g);
    float low = 1.0 - smoothstep(0.1, 0.8, p2.y);
    vec3 neb = j32NebA * n1 * 0.55 + j32NebB * n2 * (0.35 + 0.45 * low);
    // 星光：近層細小、遠層較大較暗；星塵讓星雲有顆粒感
    float st = pow(t1.b, 1.5) * 1.3 + pow(t2.b, 2.0) * 0.6;
    float dust = smoothstep(0.62, 0.9, t1.a) * 0.25;
    // 柔和內部發光（中下方）
    float glow = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.5, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j32NebA * glow * 0.45;
    // 翅膀與細觸角上的星雲淡一點（太細的地方星點會變成雜訊）
    float into = (0.3 + 0.7 * jNdV) * (1.0 - 0.7 * jWing) * (1.0 - 0.75 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.25 * jS * into;
    color.a = clamp(color.a + (st * 0.4 + n2 * 0.1) * jS * jNdV, 0.0, 1.0);
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j32StarC;
    vec3 n = j32StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j32StarDist(uv, j32Star.x, j32Star.y, j32Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j32Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j32Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j32SkyLow, j32SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j32Rim * jFres * (0.85 + 0.4 * jWing) * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,D=class extends c{rim=new a(.66,.88,1);core=new a(.16,.12,.62);shell=new a(.36,.5,1);top=new a(.5,.66,1);nebulaA=new a(.25,.75,1);nebulaB=new a(.62,.36,1);wing=new a(.5,.62,1);wingTip=new a(.68,.9,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;invWorld=r.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV34Plugin`,200,{JELLY34:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV34Plugin`}prepareDefines(e,t,n){e.JELLY34=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j34Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j34Rim`,size:3,type:`vec3`},{name:`j34Core`,size:3,type:`vec3`},{name:`j34Shell`,size:3,type:`vec3`},{name:`j34Top`,size:3,type:`vec3`},{name:`j34NebA`,size:3,type:`vec3`},{name:`j34NebB`,size:3,type:`vec3`},{name:`j34Wing`,size:3,type:`vec3`},{name:`j34WingTip`,size:3,type:`vec3`},{name:`j34SkyLow`,size:3,type:`vec3`},{name:`j34SkyHigh`,size:3,type:`vec3`},{name:`j34StarC`,size:3,type:`vec3`},{name:`j34StarN`,size:3,type:`vec3`},{name:`j34Params`,size:4,type:`vec4`},{name:`j34Star`,size:4,type:`vec4`},{name:`j34InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY34
uniform vec3 j34Rim;
uniform vec3 j34Core;
uniform vec3 j34Shell;
uniform vec3 j34Top;
uniform vec3 j34NebA;
uniform vec3 j34NebB;
uniform vec3 j34Wing;
uniform vec3 j34WingTip;
uniform vec3 j34SkyLow;
uniform vec3 j34SkyHigh;
uniform vec3 j34StarC;
uniform vec3 j34StarN;
uniform vec4 j34Params;
uniform vec4 j34Star;
uniform mat4 j34InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j34Rim`,this.rim),e.updateColor3(`j34Core`,this.core),e.updateColor3(`j34Shell`,this.shell),e.updateColor3(`j34Top`,this.top),e.updateColor3(`j34NebA`,this.nebulaA),e.updateColor3(`j34NebB`,this.nebulaB),e.updateColor3(`j34Wing`,this.wing),e.updateColor3(`j34WingTip`,this.wingTip),e.updateColor3(`j34SkyLow`,this.skyLow),e.updateColor3(`j34SkyHigh`,this.skyHigh),e.updateVector3(`j34StarC`,this.starCenter),e.updateVector3(`j34StarN`,this.starNormal),e.updateFloat4(`j34Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j34Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j34InvWorld`,this.invWorld),e.setTexture(`j34Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:O,CUSTOM_FRAGMENT_BEFORE_FOG:k}:null}};function be(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV34_Noise`,c}var O=`
#ifdef JELLY34
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j34Noise;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j34Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j34Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j34Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j34Noise, p.xy, bias), texture2D(j34Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j34StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,k=`
#ifdef JELLY34
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j34Params.w);
  float jS = j34Params.y;
  vec3 lp = (j34InvWorld * vec4(vPositionW, 1.0)).xyz / j34Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j34InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：中央（最厚）較深的藍紫 → 外層亮藍 → 上方偏淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j34Shell, j34Top, smoothstep(0.35, 1.0, h));
  vec3 base = mix(shell, j34Core, smoothstep(0.2, 0.95, jNdV) * 0.62);
  vec3 wingCol = mix(j34Wing, j34WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.22 + base * 0.82, jS * 0.88);
  // 身體中央較不透明（看不到背後的地平線）；邊緣透光；羽翼較透明，越往尖端越透
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, max(color.a, 0.86), jThick * jS);
  color.a = mix(color.a, color.a * mix(0.85, 0.62, jWingT), jWing);

  if (j34Params.z > 0.5) {
    // 三層深度（視差）：近層細小星光、中層青藍星雲、遠層紫色大星雲（越深越暗、越模糊）
    vec3 p1 = lp + rd * 0.07;
    vec3 p2 = lp + rd * 0.2;
    vec3 p3 = lp + rd * 0.38;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j34Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j34Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j34Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    float n2 = smoothstep(0.4, 0.78, t2.r);
    float n3 = smoothstep(0.36, 0.74, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j34NebA * n2 * 0.5 + j34NebB * n3 * (0.32 + 0.4 * low) * 0.9;
    // 星光：近層只留最亮的細點（不刺眼），中層較柔，遠層暗而大
    float st = pow(t1.b, 3.0) * 0.95 + pow(t2.b, 2.0) * 0.55 + pow(t3.b, 1.6) * 0.28;
    float dust = smoothstep(0.66, 0.92, t2.a) * 0.18;
    // 底部青色內部光（設定圖下方的亮青光）＋中央柔和發光
    float pool = smoothstep(0.5, 0.0, length(p3.xz - vec2(0.0, 0.05))) * (1.0 - smoothstep(-0.02, 0.32, p3.y));
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.86, 0.95, 1.0) * (st + dust) + j34NebA * (pool * 0.7 + core * 0.25);
    // 羽翼與細觸角不畫星雲
    float into = (0.3 + 0.7 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.2 * jS * into;
    color.a = clamp(color.a + (st * 0.3 + n3 * 0.08) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j34StarC;
    vec3 n = j34StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j34StarDist(uv, j34Star.x, j34Star.y, j34Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j34Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j34Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j34SkyLow, j34SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j34Rim * jFres * (0.85 + 0.35 * jWing) * jS;
  // 羽翼柔和邊緣高光（亮白、沿輪廓與羽瓣邊緣）
  color.rgb += vec3(0.85, 0.95, 1.0) * pow(1.0 - jNdV, 1.5) * jWing * 0.45 * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,A=class extends c{rim=new a(.72,.94,1);core=new a(.08,.1,.52);shell=new a(.18,.34,.95);top=new a(.34,.56,1);nebulaA=new a(.22,.92,1);nebulaB=new a(.66,.32,1);wing=new a(.5,.62,1);wingTip=new a(.68,.9,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;invWorld=r.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV35Plugin`,200,{JELLY35:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV35Plugin`}prepareDefines(e,t,n){e.JELLY35=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j35Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j35Rim`,size:3,type:`vec3`},{name:`j35Core`,size:3,type:`vec3`},{name:`j35Shell`,size:3,type:`vec3`},{name:`j35Top`,size:3,type:`vec3`},{name:`j35NebA`,size:3,type:`vec3`},{name:`j35NebB`,size:3,type:`vec3`},{name:`j35Wing`,size:3,type:`vec3`},{name:`j35WingTip`,size:3,type:`vec3`},{name:`j35SkyLow`,size:3,type:`vec3`},{name:`j35SkyHigh`,size:3,type:`vec3`},{name:`j35StarC`,size:3,type:`vec3`},{name:`j35StarN`,size:3,type:`vec3`},{name:`j35Params`,size:4,type:`vec4`},{name:`j35Star`,size:4,type:`vec4`},{name:`j35InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY35
uniform vec3 j35Rim;
uniform vec3 j35Core;
uniform vec3 j35Shell;
uniform vec3 j35Top;
uniform vec3 j35NebA;
uniform vec3 j35NebB;
uniform vec3 j35Wing;
uniform vec3 j35WingTip;
uniform vec3 j35SkyLow;
uniform vec3 j35SkyHigh;
uniform vec3 j35StarC;
uniform vec3 j35StarN;
uniform vec4 j35Params;
uniform vec4 j35Star;
uniform mat4 j35InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j35Rim`,this.rim),e.updateColor3(`j35Core`,this.core),e.updateColor3(`j35Shell`,this.shell),e.updateColor3(`j35Top`,this.top),e.updateColor3(`j35NebA`,this.nebulaA),e.updateColor3(`j35NebB`,this.nebulaB),e.updateColor3(`j35Wing`,this.wing),e.updateColor3(`j35WingTip`,this.wingTip),e.updateColor3(`j35SkyLow`,this.skyLow),e.updateColor3(`j35SkyHigh`,this.skyHigh),e.updateVector3(`j35StarC`,this.starCenter),e.updateVector3(`j35StarN`,this.starNormal),e.updateFloat4(`j35Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j35Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j35InvWorld`,this.invWorld),e.setTexture(`j35Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:xe,CUSTOM_FRAGMENT_BEFORE_FOG:Se}:null}};function j(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV35_Noise`,c}var xe=`
#ifdef JELLY35
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j35Noise;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j35Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j35Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j35Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j35Noise, p.xy, bias), texture2D(j35Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j35StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,Se=`
#ifdef JELLY35
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j35Params.w);
  float jS = j35Params.y;
  vec3 lp = (j35InvWorld * vec4(vPositionW, 1.0)).xyz / j35Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j35InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：中央（最厚）較深的藍紫 → 外層亮藍 → 上方偏淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j35Shell, j35Top, smoothstep(0.35, 1.0, h));
  vec3 base = mix(shell, j35Core, smoothstep(0.2, 0.95, jNdV) * 0.7);
  vec3 wingCol = mix(j35Wing, j35WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.16 + base * 0.86, jS * 0.92);
  // 身體中央較不透明（看不到背後的地平線）；邊緣透光；羽翼較透明，越往尖端越透
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, max(color.a, 0.86), jThick * jS);
  color.a = mix(color.a, color.a * mix(0.85, 0.62, jWingT), jWing);

  if (j35Params.z > 0.5) {
    // 三層深度（視差）：近層細小星光、中層青藍星雲、遠層紫色大星雲（越深越暗、越模糊）
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j35Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j35Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j35Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    float n2 = smoothstep(0.4, 0.78, t2.r);
    float n3 = smoothstep(0.36, 0.74, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j35NebA * n2 * 0.55 + j35NebB * n3 * (0.4 + 0.45 * low) * 1.05;
    // 星光：近層只留最亮的細點（不刺眼），中層較柔，遠層暗而大
    float st = pow(t1.b, 3.0) * 0.95 + pow(t2.b, 2.0) * 0.55 + pow(t3.b, 1.6) * 0.28;
    float dust = smoothstep(0.66, 0.92, t2.a) * 0.18;
    // 底部青色內部光（設定圖下方的亮青光）＋中央柔和發光
    float pool = smoothstep(0.5, 0.0, length(p3.xz - vec2(0.0, 0.05))) * (1.0 - smoothstep(-0.02, 0.32, p3.y));
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.86, 0.95, 1.0) * (st + dust) + j35NebA * (pool * 1.0 + core * 0.38);
    // 羽翼與細觸角不畫星雲
    float into = (0.3 + 0.7 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.2 * jS * into;
    color.a = clamp(color.a + (st * 0.3 + n3 * 0.08) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 內部亮青（設定圖：身體下半部從裡面透出的青色光）：不隨視角減弱，邊緣也看得到；低畫質也保留
  {
    float cyan = (1.0 - smoothstep(0.02, 0.42, lp.y)) * (1.0 - jWing) * smoothstep(0.75, 0.2, length(lp.xz));
    color.rgb += j35NebA * cyan * (0.22 + 0.18 * jNdV) * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j35StarC;
    vec3 n = j35StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j35StarDist(uv, j35Star.x, j35Star.y, j35Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j35Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j35Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j35SkyLow, j35SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j35Rim * jFres * (0.85 + 0.35 * jWing) * jS;
  // 羽翼柔和邊緣高光（亮白、沿輪廓與羽瓣邊緣）
  color.rgb += vec3(0.85, 0.95, 1.0) * pow(1.0 - jNdV, 1.5) * jWing * 0.45 * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,M=class extends c{rim=new a(.78,.95,1);core=new a(.3,.6,1);shell=new a(.05,.14,.7);top=new a(.2,.42,.98);nebulaA=new a(.3,.9,1);nebulaB=new a(.42,.3,.95);wing=new a(.5,.72,1);wingTip=new a(.74,.96,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;invWorld=r.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV36Plugin`,200,{JELLY36:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV36Plugin`}prepareDefines(e,t,n){e.JELLY36=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j36Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j36Rim`,size:3,type:`vec3`},{name:`j36Core`,size:3,type:`vec3`},{name:`j36Shell`,size:3,type:`vec3`},{name:`j36Top`,size:3,type:`vec3`},{name:`j36NebA`,size:3,type:`vec3`},{name:`j36NebB`,size:3,type:`vec3`},{name:`j36Wing`,size:3,type:`vec3`},{name:`j36WingTip`,size:3,type:`vec3`},{name:`j36SkyLow`,size:3,type:`vec3`},{name:`j36SkyHigh`,size:3,type:`vec3`},{name:`j36StarC`,size:3,type:`vec3`},{name:`j36StarN`,size:3,type:`vec3`},{name:`j36Params`,size:4,type:`vec4`},{name:`j36Star`,size:4,type:`vec4`},{name:`j36InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY36
uniform vec3 j36Rim;
uniform vec3 j36Core;
uniform vec3 j36Shell;
uniform vec3 j36Top;
uniform vec3 j36NebA;
uniform vec3 j36NebB;
uniform vec3 j36Wing;
uniform vec3 j36WingTip;
uniform vec3 j36SkyLow;
uniform vec3 j36SkyHigh;
uniform vec3 j36StarC;
uniform vec3 j36StarN;
uniform vec4 j36Params;
uniform vec4 j36Star;
uniform mat4 j36InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j36Rim`,this.rim),e.updateColor3(`j36Core`,this.core),e.updateColor3(`j36Shell`,this.shell),e.updateColor3(`j36Top`,this.top),e.updateColor3(`j36NebA`,this.nebulaA),e.updateColor3(`j36NebB`,this.nebulaB),e.updateColor3(`j36Wing`,this.wing),e.updateColor3(`j36WingTip`,this.wingTip),e.updateColor3(`j36SkyLow`,this.skyLow),e.updateColor3(`j36SkyHigh`,this.skyHigh),e.updateVector3(`j36StarC`,this.starCenter),e.updateVector3(`j36StarN`,this.starNormal),e.updateFloat4(`j36Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j36Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j36InvWorld`,this.invWorld),e.setTexture(`j36Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:P,CUSTOM_FRAGMENT_BEFORE_FOG:F}:null}};function N(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV36_Noise`,c}var P=`
#ifdef JELLY36
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j36Noise;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j36Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j36Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j36Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j36Noise, p.xy, bias), texture2D(j36Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j36StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,F=`
#ifdef JELLY36
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j36Params.w);
  float jS = j36Params.y;
  vec3 lp = (j36InvWorld * vec4(vPositionW, 1.0)).xyz / j36Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j36InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：邊緣深藍 → 中央柔和青藍（設定圖中間亮、邊緣深）；頂部略淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j36Shell, j36Top, smoothstep(0.45, 1.0, h) * 0.6);
  vec3 base = mix(shell, j36Core, smoothstep(0.3, 0.95, jNdV) * 0.8);
  vec3 wingCol = mix(j36Wing, j36WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.1 + base * 0.88, jS * 0.94);
  // 透明度：中央 0.8（看不到背後地平線，但仍有透明感）；邊緣更透；羽翼根部 0.75 → 尖端 0.5
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, max(color.a, 0.8), jThick * jS);
  color.a = mix(color.a, color.a * 0.8, (1.0 - jNdV) * (1.0 - jWing) * jS);
  color.a = mix(color.a, mix(0.75, 0.5, jWingT), jWing * jS);

  if (j36Params.z > 0.5) {
    // 三層深度（視差）：近層細小清楚的星光、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j36Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j36Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j36Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    // 星雲邊界清楚一點（不是糊成一片的雜訊）
    float n2 = smoothstep(0.46, 0.76, t2.r);
    float n3 = smoothstep(0.42, 0.72, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j36NebA * n2 * 0.5 + j36NebB * n3 * (0.36 + 0.3 * low);
    // 星光：近層較稀疏但清楚、中層細光點、遠層暗
    float st = pow(t1.b, 3.5) * 1.45 + pow(t2.b, 2.4) * 0.6 + pow(t3.b, 2.0) * 0.24;
    float dust = smoothstep(0.7, 0.94, t2.a) * 0.12;
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j36NebA * core * 0.3;
    // 羽翼與細觸角不畫星雲
    float into = (0.35 + 0.65 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.15 * jS * into;
    color.a = clamp(color.a + (st * 0.25 + n3 * 0.06) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 下半部亮青色內部光（明顯但不刺眼）＋底部內側折射亮帶；低畫質也保留
  {
    float body = 1.0 - jWing;
    float cyan = (1.0 - smoothstep(0.0, 0.42, lp.y)) * smoothstep(0.8, 0.15, length(lp.xz)) * body;
    color.rgb += j36NebA * cyan * (0.5 + 0.22 * jNdV) * jS;
    float band = smoothstep(0.015, 0.06, lp.y) * (1.0 - smoothstep(0.07, 0.17, lp.y)) * (1.0 - jNdV) * body;
    color.rgb += vec3(0.6, 0.98, 1.0) * band * 0.5 * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j36StarC;
    vec3 n = j36StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j36StarDist(uv, j36Star.x, j36Star.y, j36Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j36Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j36Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：天空反射、水晶邊緣透光（邊緣亮而透）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j36SkyLow, j36SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.18 * jS;
  color.rgb += j36Rim * jFres * (0.8 + 0.3 * jWing) * jS;
  // 羽翼：外緣柔和白色高光＋細的水晶光澤（沿羽瓣邊緣）
  color.rgb += vec3(0.9, 0.97, 1.0) * pow(1.0 - jNdV, 1.6) * jWing * 0.6 * jS;
  color.rgb += vec3(1.0) * pow(1.0 - jNdV, 4.0) * jWing * 0.25 * jS;
  color.a = clamp(color.a + jFres * 0.28 * jS, 0.0, 1.0);

  // 高光：一片柔和大光澤＋兩個日系硬邊高光
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float soft = pow(clamp(dot(jN, normalize(jL1 + jV)), 0.0, 1.0), 40.0) * 0.22;
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb += vec3(0.9, 0.95, 1.0) * soft * jS;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,Ce={monsterId:`star_dew_bobo`,assetId:`bobo`,pascalName:`StarDewBobo`,version:`v36`,family:`jelly`,tier:`normal`,heightM:.8,footprintRadiusM:.5,requiredParts:[`Body_`,`Eyes`,`Mouth`,`Blush`,`Stars`],expressions:{names:[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],parts:[{mesh:`Eyes`,cols:4,rows:2,cellU:.25,cellV:.5},{mesh:`Mouth`,cols:4,rows:2,cellU:.25,cellV:.25}]},features:{jelly:!0,nebula:!0,wings:!0,bellyStarInShader:!0,headStar:!0}},we=class extends c{rim=new a(.86,.96,1);core=new a(.44,.62,1);shell=new a(.12,.26,.86);top=new a(.4,.56,1);nebulaA=new a(.34,.92,1);nebulaB=new a(.5,.4,.98);wing=new a(.5,.72,1);wingTip=new a(.74,.96,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;reflect=1;rimStrength=1;iridescence=1;baseGlow=1;invWorld=r.Identity();view=r.Identity();enabled=!1;noise;matcap;constructor(e,t,n){super(e,`JellyV37Plugin`,200,{JELLY37:!1}),this.noise=t,this.matcap=n,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV37Plugin`}prepareDefines(e,t,n){e.JELLY37=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()&&this.matcap.isReady()}getSamplers(e){e.push(`j37Noise`,`j37Matcap`)}getActiveTextures(e){e.push(this.noise,this.matcap)}hasTexture(e){return e===this.noise||e===this.matcap}getUniforms(){return{ubo:[{name:`j37Rim`,size:3,type:`vec3`},{name:`j37Core`,size:3,type:`vec3`},{name:`j37Shell`,size:3,type:`vec3`},{name:`j37Top`,size:3,type:`vec3`},{name:`j37NebA`,size:3,type:`vec3`},{name:`j37NebB`,size:3,type:`vec3`},{name:`j37Wing`,size:3,type:`vec3`},{name:`j37WingTip`,size:3,type:`vec3`},{name:`j37SkyLow`,size:3,type:`vec3`},{name:`j37SkyHigh`,size:3,type:`vec3`},{name:`j37StarC`,size:3,type:`vec3`},{name:`j37StarN`,size:3,type:`vec3`},{name:`j37Params`,size:4,type:`vec4`},{name:`j37Star`,size:4,type:`vec4`},{name:`j37InvWorld`,size:16,type:`mat4`},{name:`j37View`,size:16,type:`mat4`},{name:`j37Glass`,size:4,type:`vec4`}],fragment:`#ifdef JELLY37
uniform vec3 j37Rim;
uniform vec3 j37Core;
uniform vec3 j37Shell;
uniform vec3 j37Top;
uniform vec3 j37NebA;
uniform vec3 j37NebB;
uniform vec3 j37Wing;
uniform vec3 j37WingTip;
uniform vec3 j37SkyLow;
uniform vec3 j37SkyHigh;
uniform vec3 j37StarC;
uniform vec3 j37StarN;
uniform vec4 j37Params;
uniform vec4 j37Star;
uniform mat4 j37InvWorld;
uniform mat4 j37View;
uniform vec4 j37Glass;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j37Rim`,this.rim),e.updateColor3(`j37Core`,this.core),e.updateColor3(`j37Shell`,this.shell),e.updateColor3(`j37Top`,this.top),e.updateColor3(`j37NebA`,this.nebulaA),e.updateColor3(`j37NebB`,this.nebulaB),e.updateColor3(`j37Wing`,this.wing),e.updateColor3(`j37WingTip`,this.wingTip),e.updateColor3(`j37SkyLow`,this.skyLow),e.updateColor3(`j37SkyHigh`,this.skyHigh),e.updateVector3(`j37StarC`,this.starCenter),e.updateVector3(`j37StarN`,this.starNormal),e.updateFloat4(`j37Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j37Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j37InvWorld`,this.invWorld),e.updateMatrix(`j37View`,this.view),e.updateFloat4(`j37Glass`,this.reflect,this.rimStrength,this.iridescence,this.baseGlow),e.setTexture(`j37Noise`,this.noise),e.setTexture(`j37Matcap`,this.matcap))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:Ee,CUSTOM_FRAGMENT_BEFORE_FOG:De}:null}};function Te(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);if(s>.82)for(let e=-7;e<=7;e++){let n=s*.85*Math.exp(-(e*e)/10);for(let[r,s]of[[e,0],[0,e]]){let e=(Math.round(i)+r+t)%t,c=(Math.round(a)+s+t)%t;n>o[c*t+e]&&(o[c*t+e]=n)}}for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV37_Noise`,c}function I(e,t=256){let n=new m(`BoboV37_Matcap`,{width:t,height:t},e,!0),r=n.getContext(),i=t;r.fillStyle=`#000`,r.fillRect(0,0,i,i),r.globalCompositeOperation=`lighter`;let a=(e,t)=>{r.shadowColor=t,r.shadowBlur=e},o=(e,t,n,a)=>{r.shadowBlur=0;let o=r.createRadialGradient(e*i,t*i,0,e*i,t*i,n*i);for(let[e,t]of a)o.addColorStop(e,t);r.fillStyle=o,r.fillRect(0,0,i,i)};r.save(),r.beginPath(),r.arc(.5*i,.5*i,.475*i,Math.PI*1.05,Math.PI*1.6),r.arc(.515*i,.515*i,.43*i,Math.PI*1.58,Math.PI*1.07,!0),r.closePath();let c=r.createLinearGradient(.1*i,.15*i,.45*i,.45*i);c.addColorStop(0,`rgba(255,255,255,0.9)`),c.addColorStop(1,`rgba(220,235,255,0.25)`),r.fillStyle=c,a(i*.012,`rgba(255,255,255,0.8)`),r.fill(),r.restore(),r.save(),a(i*.012,`rgba(255,255,255,0.7)`),r.fillStyle=`rgba(255,255,255,0.62)`;let l=(e,t,n,a)=>{r.beginPath(),typeof r.roundRect==`function`?r.roundRect(e*i,t*i,n*i,a*i,.02*i):r.rect(e*i,t*i,n*i,a*i),r.fill()};return l(.29,.25,.045,.06),l(.345,.25,.045,.06),r.restore(),o(.72,.3,.1,[[0,`rgba(255,255,255,0.6)`],[1,`rgba(255,255,255,0)`]]),o(.5,.12,.22,[[0,`rgba(200,225,255,0.25)`],[1,`rgba(200,225,255,0)`]]),r.save(),r.beginPath(),r.arc(.5*i,.5*i,.49*i,Math.PI*.2,Math.PI*.8),r.arc(.5*i,.44*i,.43*i,Math.PI*.78,Math.PI*.22,!0),r.closePath(),a(i*.02,`rgba(70,230,255,0.8)`),r.fillStyle=`rgba(70,230,255,0.8)`,r.fill(),r.restore(),o(.08,.55,.22,[[0,`rgba(200,150,255,0.35)`],[1,`rgba(200,150,255,0)`]]),o(.92,.55,.22,[[0,`rgba(255,170,230,0.3)`],[1,`rgba(255,170,230,0)`]]),r.globalCompositeOperation=`source-over`,n.update(!1),n.wrapU=s.CLAMP_ADDRESSMODE,n.wrapV=s.CLAMP_ADDRESSMODE,n}var Ee=`
#ifdef JELLY37
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j37Noise;
uniform sampler2D j37Matcap;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j37Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j37Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j37Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j37Noise, p.xy, bias), texture2D(j37Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j37StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,De=`
#ifdef JELLY37
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j37Params.w);
  float jS = j37Params.y;
  vec3 lp = (j37InvWorld * vec4(vPositionW, 1.0)).xyz / j37Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j37InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：邊緣中深藍（三視圖）→ 中央較亮的長春花藍（主視覺）；頂部略淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j37Shell, j37Top, smoothstep(0.45, 1.0, h) * 0.5);
  vec3 base = mix(shell, j37Core, smoothstep(0.25, 0.92, jNdV) * 0.85);
  vec3 wingCol = mix(j37Wing, j37WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.08 + base * 0.86, jS * 0.95);
  // 透明度：中央 0.74（晶瑩，但不會看穿成一條條背景線）；邊緣由邊緣光補上不透明度
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, 0.74, jThick * jS);
  color.a = mix(color.a, color.a * 0.82, (1.0 - jNdV) * (1.0 - jWing) * jS);
  color.a = mix(color.a, mix(0.75, 0.5, jWingT), jWing * jS);

  if (j37Params.z > 0.5) {
    // 三層深度（視差）：近層細小清楚的星光、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j37Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j37Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j37Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    // 星雲邊界清楚一點（不是糊成一片的雜訊）
    float n2 = smoothstep(0.46, 0.76, t2.r);
    float n3 = smoothstep(0.42, 0.72, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j37NebA * n2 * 0.45 + j37NebB * n3 * (0.26 + 0.24 * low);
    // 星光：近層較稀疏但清楚、中層細光點、遠層暗
    // 星光：越往下越多（設定圖星塵集中在下半部）；十字閃光已畫在貼圖裡
    float stW = 0.55 + 0.75 * (1.0 - smoothstep(0.1, 0.7, lp.y));
    float st = (pow(t1.b, 3.0) * 1.5 + pow(t2.b, 2.4) * 0.6 + pow(t3.b, 2.0) * 0.24) * stW;
    float dust = smoothstep(0.7, 0.94, t2.a) * 0.12;
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j37NebA * core * 0.3;
    // 羽翼與細觸角不畫星雲
    float into = (0.35 + 0.65 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.15 * jS * into;
    color.a = clamp(color.a + (st * 0.25 + n3 * 0.06) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 底部內部光源（主視覺：底部中央很亮的青白光往上擴散）＋底部內側折射亮帶；低畫質也保留
  {
    float body = 1.0 - jWing;
    vec3 src = vec3(0.0, 0.08, 0.05);
    vec3 q = lp + rd * 0.25;
    float d2 = dot((q - src) * vec3(1.0, 1.6, 1.0), (q - src) * vec3(1.0, 1.6, 1.0));
    float srcGlow = exp(-d2 / 0.09) * body;
    float lower = (1.0 - smoothstep(0.0, 0.45, lp.y)) * smoothstep(0.8, 0.15, length(lp.xz)) * body;
    vec3 glowCol = mix(j37NebA, vec3(0.85, 1.0, 1.0), srcGlow * 0.6);
    color.rgb += glowCol * (srcGlow * 1.15 + lower * 0.4) * j37Glass.w * jS;
    color.a = max(color.a, srcGlow * 0.85 * j37Glass.w * jS);
    float band = smoothstep(0.015, 0.06, lp.y) * (1.0 - smoothstep(0.07, 0.17, lp.y)) * (1.0 - jNdV) * body;
    color.rgb += vec3(0.6, 0.98, 1.0) * band * 0.5 * j37Glass.w * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j37StarC;
    vec3 n = j37StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j37StarDist(uv, j37Star.x, j37Star.y, j37Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j37Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j37Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：烘焙反射（matcap）＋整圈邊緣光＋虹彩
  vec3 nV = normalize((j37View * vec4(jN, 0.0)).xyz);
  vec2 mcUV = vec2(nV.x * 0.48 + 0.5, 0.5 - nV.y * 0.48);
  vec3 mc = texture2D(j37Matcap, mcUV).rgb;
  float mcL = max(mc.r, max(mc.g, mc.b));
  color.rgb += mc * 1.05 * j37Glass.x * jS;
  color.a = clamp(color.a + mcL * 0.55 * j37Glass.x * jS, 0.0, 1.0);
  // 整圈明亮的邊緣光（主視覺的白色輪廓）
  float rimW = smoothstep(0.42, 0.0, jNdV);
  // 上半部白色邊緣光、下半部偏青（設定圖底部是亮青光，不是奶白）
  float rimLow = 1.0 - smoothstep(-0.55, 0.1, nV.y);
  vec3 rimCol = mix(j37Rim, vec3(0.35, 0.9, 1.0), rimLow * 0.8);
  color.rgb += rimCol * (rimW * mix(0.62, 0.42, rimLow) + jFres * 0.22) * j37Glass.y * jS;
  color.a = clamp(color.a + rimW * 0.3 * j37Glass.y * jS, 0.0, 1.0);
  // 虹彩：邊緣附近粉紫 → 青色的薄膜色帶（隨角度變化）
  float irB = smoothstep(0.65, 0.2, jNdV) * smoothstep(0.0, 0.12, jNdV);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + jNdV * 1.6 + nV.y * 0.25 + 0.55));
  irid = mix(irid, vec3(0.85, 0.7, 1.0), 0.35);
  color.rgb += irid * irB * 0.22 * j37Glass.z * jS;
  // 羽翼：外緣柔和白色高光＋細的水晶光澤
  color.rgb += vec3(0.9, 0.97, 1.0) * pow(1.0 - jNdV, 1.6) * jWing * 0.5 * jS;
  // 天空反射（很淡，讓上半部有一點環境色）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j37SkyLow, j37SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.1 * jS;
}
#endif
`,Oe={monsterId:`star_dew_bobo`,assetId:`bobo`,pascalName:`StarDewBobo`,version:`v37`,family:`jelly`,tier:`normal`,heightM:.8,footprintRadiusM:.5,requiredParts:[`Body_`,`Eyes`,`Mouth`,`Blush`,`Stars`],expressions:{names:[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],parts:[{mesh:`Eyes`,cols:4,rows:2,cellU:.25,cellV:.5},{mesh:`Mouth`,cols:4,rows:2,cellU:.25,cellV:.25}]},features:{jelly:!0,nebula:!0,wings:!0,bellyStarInShader:!0,headStar:!0}},ke=class extends c{rim=new a(.86,.96,1);core=new a(.44,.62,1);shell=new a(.12,.26,.86);top=new a(.4,.56,1);nebulaA=new a(.34,.92,1);nebulaB=new a(.5,.4,.98);wing=new a(.5,.72,1);wingTip=new a(.74,.96,1);skyLow=new a(.95,.88,.98);skyHigh=new a(.55,.78,1);starCenter=new n(0,.248,.545);starNormal=new n(0,-.22,.975).normalize();starOuter=.084;starInner=.042;height=1;strength=1;nebula=1;reflect=1;rimStrength=1;iridescence=1;baseGlow=1;invWorld=r.Identity();view=r.Identity();enabled=!1;noise;matcap;constructor(e,t,n){super(e,`JellyV38Plugin`,200,{JELLY38:!1}),this.noise=t,this.matcap=n,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV38Plugin`}prepareDefines(e,t,n){e.JELLY38=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()&&this.matcap.isReady()}getSamplers(e){e.push(`j38Noise`,`j38Matcap`)}getActiveTextures(e){e.push(this.noise,this.matcap)}hasTexture(e){return e===this.noise||e===this.matcap}getUniforms(){return{ubo:[{name:`j38Rim`,size:3,type:`vec3`},{name:`j38Core`,size:3,type:`vec3`},{name:`j38Shell`,size:3,type:`vec3`},{name:`j38Top`,size:3,type:`vec3`},{name:`j38NebA`,size:3,type:`vec3`},{name:`j38NebB`,size:3,type:`vec3`},{name:`j38Wing`,size:3,type:`vec3`},{name:`j38WingTip`,size:3,type:`vec3`},{name:`j38SkyLow`,size:3,type:`vec3`},{name:`j38SkyHigh`,size:3,type:`vec3`},{name:`j38StarC`,size:3,type:`vec3`},{name:`j38StarN`,size:3,type:`vec3`},{name:`j38Params`,size:4,type:`vec4`},{name:`j38Star`,size:4,type:`vec4`},{name:`j38InvWorld`,size:16,type:`mat4`},{name:`j38View`,size:16,type:`mat4`},{name:`j38Glass`,size:4,type:`vec4`}],fragment:`#ifdef JELLY38
uniform vec3 j38Rim;
uniform vec3 j38Core;
uniform vec3 j38Shell;
uniform vec3 j38Top;
uniform vec3 j38NebA;
uniform vec3 j38NebB;
uniform vec3 j38Wing;
uniform vec3 j38WingTip;
uniform vec3 j38SkyLow;
uniform vec3 j38SkyHigh;
uniform vec3 j38StarC;
uniform vec3 j38StarN;
uniform vec4 j38Params;
uniform vec4 j38Star;
uniform mat4 j38InvWorld;
uniform mat4 j38View;
uniform vec4 j38Glass;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j38Rim`,this.rim),e.updateColor3(`j38Core`,this.core),e.updateColor3(`j38Shell`,this.shell),e.updateColor3(`j38Top`,this.top),e.updateColor3(`j38NebA`,this.nebulaA),e.updateColor3(`j38NebB`,this.nebulaB),e.updateColor3(`j38Wing`,this.wing),e.updateColor3(`j38WingTip`,this.wingTip),e.updateColor3(`j38SkyLow`,this.skyLow),e.updateColor3(`j38SkyHigh`,this.skyHigh),e.updateVector3(`j38StarC`,this.starCenter),e.updateVector3(`j38StarN`,this.starNormal),e.updateFloat4(`j38Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j38Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j38InvWorld`,this.invWorld),e.updateMatrix(`j38View`,this.view),e.updateFloat4(`j38Glass`,this.reflect,this.rimStrength,this.iridescence,this.baseGlow),e.setTexture(`j38Noise`,this.noise),e.setTexture(`j38Matcap`,this.matcap))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:R,CUSTOM_FRAGMENT_BEFORE_FOG:je}:null}};function Ae(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},a=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},o=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,s=.45+.55*r(n,e,94),c=1.1+1.6*r(n,e,95);if(s>.82)for(let e=-7;e<=7;e++){let n=s*.85*Math.exp(-(e*e)/10);for(let[r,s]of[[e,0],[0,e]]){let e=(Math.round(i)+r+t)%t,c=(Math.round(a)+s+t)%t;n>o[c*t+e]&&(o[c*t+e]=n)}}for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=s*Math.exp(-(u*u)/(c*c));d>o[l*t+r]&&(o[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,s=e/t,c=(e*t+r)*4;n[c]=Math.round(a(i,s,4,1,4)*255),n[c+1]=Math.round(a(i,s,8,7,3)*255),n[c+2]=Math.round(Math.min(1,o[e*t+r])*255),n[c+3]=Math.round(a(i,s,32,3,2)*255)}let c=new f(n,t,t,l.TEXTUREFORMAT_RGBA,e,!0,!1,s.TRILINEAR_SAMPLINGMODE);return c.wrapU=s.WRAP_ADDRESSMODE,c.wrapV=s.WRAP_ADDRESSMODE,c.name=`BoboV38_Noise`,c}function L(e,t=256){let n=new m(`BoboV38_Matcap`,{width:t,height:t},e,!0),r=n.getContext(),i=t;r.fillStyle=`#000`,r.fillRect(0,0,i,i),r.globalCompositeOperation=`lighter`;let a=(e,t)=>{r.shadowColor=t,r.shadowBlur=e},o=(e,t,n,a)=>{r.shadowBlur=0;let o=r.createRadialGradient(e*i,t*i,0,e*i,t*i,n*i);for(let[e,t]of a)o.addColorStop(e,t);r.fillStyle=o,r.fillRect(0,0,i,i)};r.save(),r.beginPath(),r.arc(.5*i,.5*i,.475*i,Math.PI*1.05,Math.PI*1.6),r.arc(.515*i,.515*i,.43*i,Math.PI*1.58,Math.PI*1.07,!0),r.closePath();let c=r.createLinearGradient(.1*i,.15*i,.45*i,.45*i);return c.addColorStop(0,`rgba(255,255,255,0.9)`),c.addColorStop(1,`rgba(220,235,255,0.25)`),r.fillStyle=c,a(i*.012,`rgba(255,255,255,0.8)`),r.fill(),r.restore(),o(.72,.3,.1,[[0,`rgba(255,255,255,0.6)`],[1,`rgba(255,255,255,0)`]]),o(.5,.12,.22,[[0,`rgba(200,225,255,0.25)`],[1,`rgba(200,225,255,0)`]]),r.save(),r.beginPath(),r.arc(.5*i,.5*i,.49*i,Math.PI*.2,Math.PI*.8),r.arc(.5*i,.44*i,.43*i,Math.PI*.78,Math.PI*.22,!0),r.closePath(),a(i*.02,`rgba(70,230,255,0.8)`),r.fillStyle=`rgba(70,230,255,0.8)`,r.fill(),r.restore(),o(.08,.55,.22,[[0,`rgba(200,150,255,0.35)`],[1,`rgba(200,150,255,0)`]]),o(.92,.55,.22,[[0,`rgba(255,170,230,0.3)`],[1,`rgba(255,170,230,0)`]]),r.globalCompositeOperation=`source-over`,n.update(!1),n.wrapU=s.CLAMP_ADDRESSMODE,n.wrapV=s.CLAMP_ADDRESSMODE,n}var R=`
#ifdef JELLY38
// 取樣器不能放在 UBO 宣告裡（WebGL2 會被略過），在這裡宣告
uniform sampler2D j38Noise;
uniform sampler2D j38Matcap;
/*
 * 雙平面取樣（物件座標的 xy 面與 zy 面），依「視線在物件內的方向」混合：
 * 正面看用 xy、側面看用 zy，圖樣不會被拉長成條紋。只有在兩面交界的視角才需要取 2 次，
 * 其他時候只取 1 次（同一區域的像素走同一條分支，手機 GPU 上很便宜）。
 */
vec4 j38Tex(vec3 p, float w, float bias) {
  if (w < 0.01) return texture2D(j38Noise, p.xy, bias);
  if (w > 0.99) return texture2D(j38Noise, p.zy + vec2(0.37, 0.61), bias);
  return mix(texture2D(j38Noise, p.xy, bias), texture2D(j38Noise, p.zy + vec2(0.37, 0.61), bias), w);
}
/* 圓角五角星的距離（正值 = 星星外） */
float j38StarDist(vec2 uv, float outer, float inner, float sharp) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = 0.5 + 0.5 * cos(5.0 * (a - 1.5707963));
  float R = inner + (outer - inner) * pow(t, sharp);
  return (r - R) * 0.85;
}
#endif
`,je=`
#ifdef JELLY38
{
  vec3 jV = normalize(vEyePosition.xyz - vPositionW);
  vec3 jN = normalize(normalW);
  float jNdV = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdV, j38Params.w);
  float jS = j38Params.y;
  vec3 lp = (j38InvWorld * vec4(vPositionW, 1.0)).xyz / j38Params.x;
  vec3 rdW = refract(-jV, jN, 0.75);
  vec3 rd = normalize((j38InvWorld * vec4(rdW, 0.0)).xyz);

  // 羽翼區域（身體半寬約 0.62，羽翼在外側）；jWingT：根部 0 → 尖端 1
  float jWing = smoothstep(0.6, 0.7, abs(lp.x));
  float jWingT = clamp((abs(lp.x) - 0.6) / 0.3, 0.0, 1.0);

  // 本色：邊緣中深藍（三視圖）→ 中央較亮的長春花藍（主視覺）；頂部略淡
  float h = clamp(lp.y, 0.0, 1.0);
  vec3 shell = mix(j38Shell, j38Top, smoothstep(0.45, 1.0, h) * 0.5);
  vec3 base = mix(shell, j38Core, smoothstep(0.25, 0.92, jNdV) * 0.85);
  vec3 wingCol = mix(j38Wing, j38WingTip, smoothstep(0.0, 1.0, jWingT));
  base = mix(base, wingCol, jWing);
  color.rgb = mix(color.rgb, color.rgb * 0.08 + base * 0.86, jS * 0.95);
  // 透明度：中央 0.74（晶瑩，但不會看穿成一條條背景線）；邊緣由邊緣光補上不透明度
  float jThick = smoothstep(0.35, 0.95, jNdV) * (1.0 - jWing);
  color.a = mix(color.a, 0.74, jThick * jS);
  color.a = mix(color.a, color.a * 0.82, (1.0 - jNdV) * (1.0 - jWing) * jS);
  color.a = mix(color.a, mix(0.75, 0.5, jWingT), jWing * jS);
  // 觸角（身體頂端以上）：透明玻璃管，淡藍、較透明
  float jAnt = smoothstep(0.97, 1.03, lp.y) * (1.0 - jWing);
  color.rgb = mix(color.rgb, vec3(0.55, 0.74, 1.0) * 0.9, jAnt * 0.7 * jS);
  color.a = mix(color.a, 0.42, jAnt * jS);

  if (j38Params.z > 0.5) {
    // 三層深度（視差）：近層細小清楚的星光、中層青藍星雲＋細光點、遠層較暗的紫藍星雲
    vec3 p1 = lp + rd * 0.05;
    vec3 p2 = lp + rd * 0.22;
    vec3 p3 = lp + rd * 0.44;
    float bw = smoothstep(0.45, 0.75, abs(rd.x));
    vec4 t1 = j38Tex(p1 * 1.15 + vec3(0.13, 0.0, 0.29), bw, 0.0);
    vec4 t2 = j38Tex(p2 * 0.7 + vec3(0.31, 0.17, 0.05), bw, 0.5);
    vec4 t3 = j38Tex(p3 * 0.42 + vec3(0.07, 0.53, 0.41), bw, 1.5);
    // 星雲邊界清楚一點（不是糊成一片的雜訊）
    float n2 = smoothstep(0.46, 0.76, t2.r);
    float n3 = smoothstep(0.42, 0.72, t3.g);
    float low = 1.0 - smoothstep(0.05, 0.75, p3.y);
    vec3 neb = j38NebA * n2 * 0.45 + j38NebB * n3 * (0.26 + 0.24 * low);
    // 星光：近層較稀疏但清楚、中層細光點、遠層暗
    // 星光：越往下越多（設定圖星塵集中在下半部）；十字閃光已畫在貼圖裡
    float stW = 0.55 + 0.75 * (1.0 - smoothstep(0.1, 0.7, lp.y));
    float st = (pow(t1.b, 3.0) * 1.5 + pow(t2.b, 2.4) * 0.6 + pow(t3.b, 2.0) * 0.24) * stW;
    float dust = smoothstep(0.7, 0.94, t2.a) * 0.12;
    float core = smoothstep(0.55, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.1, 0.6, p2.y));
    vec3 inner = neb + vec3(0.88, 0.96, 1.0) * (st + dust) + j38NebA * core * 0.3;
    // 羽翼與細觸角不畫星雲
    float into = (0.35 + 0.65 * jNdV) * (1.0 - jWing) * (1.0 - 0.8 * smoothstep(0.92, 1.05, lp.y));
    color.rgb += inner * 1.15 * jS * into;
    color.a = clamp(color.a + (st * 0.25 + n3 * 0.06) * jS * jNdV * (1.0 - jWing), 0.0, 1.0);
  }

  // 底部內部光源（主視覺：底部中央很亮的青白光往上擴散）＋底部內側折射亮帶；低畫質也保留
  {
    float body = 1.0 - jWing;
    vec3 src = vec3(0.0, 0.08, 0.05);
    vec3 q = lp + rd * 0.25;
    float d2 = dot((q - src) * vec3(1.0, 1.6, 1.0), (q - src) * vec3(1.0, 1.6, 1.0));
    float srcGlow = exp(-d2 / 0.09) * body;
    float lower = (1.0 - smoothstep(0.0, 0.45, lp.y)) * smoothstep(0.8, 0.15, length(lp.xz)) * body;
    vec3 glowCol = mix(j38NebA, vec3(0.85, 1.0, 1.0), srcGlow * 0.6);
    color.rgb += glowCol * (srcGlow * 1.15 + lower * 0.4) * j38Glass.w * jS;
    color.a = max(color.a, srcGlow * 0.85 * j38Glass.w * jS);
    float band = smoothstep(0.015, 0.06, lp.y) * (1.0 - smoothstep(0.07, 0.17, lp.y)) * (1.0 - jNdV) * body;
    color.rgb += vec3(0.6, 0.98, 1.0) * band * 0.5 * j38Glass.w * jS;
  }

  // 腹部星星：沿折射視線找到身體內的星星平面，在那裡畫一顆圓角金星＋光暈
  {
    vec3 c = j38StarC;
    vec3 n = j38StarN;
    float dn = dot(rd, n);
    if (dn < -0.01 && length(lp - c) < 0.45) {
      float t = dot(c - lp, n) / dn;
      vec3 q = lp + rd * max(t, 0.0);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 ay = cross(n, ax);
      vec2 uv = vec2(dot(q - c, ax), dot(q - c, ay));
      float d = j38StarDist(uv, j38Star.x, j38Star.y, j38Star.z);
      float face = smoothstep(0.0, 0.3, -dn);
      float fill = smoothstep(0.004, -0.004, d) * face;
      float core = 1.0 - smoothstep(0.0, j38Star.x * 0.9, length(uv));
      // V3.2：柔和金黃（邊緣暖金 → 中央奶油金），不偏橘
      vec3 gold = mix(vec3(1.0, 0.76, 0.2), vec3(1.0, 0.9, 0.5), core);
      // 輪廓內側一圈略深的暖金：五角星邊界清楚
      gold *= mix(0.84, 1.0, smoothstep(0.0, -0.012, d));
      // 星星邊緣微微的立體（上亮下暗）
      gold *= 0.9 + 0.18 * clamp(uv.y / j38Star.x + 0.5, 0.0, 1.0);
      // 光暈兩層：貼著輪廓的細緻亮邊＋往外暈開的柔光（在果凍內部擴散的感覺）
      float dd = max(d, 0.0);
      float halo = (exp(-dd / 0.01) * 0.5 + exp(-dd / 0.045) * 0.26) * (1.0 - fill) * face;
      // 星星隔著一層果凍：保留一點果凍本色，內部星光仍疊在上面
      color.rgb = mix(color.rgb, gold * vec3(0.96, 0.96, 1.0), fill * 0.92);
      color.rgb += vec3(1.0, 0.78, 0.3) * halo * 0.55;
      color.a = max(color.a, fill * 0.94);
      color.a = clamp(color.a + halo * 0.14, 0.0, 1.0);
    }
  }

  // 表面：烘焙反射（matcap）＋整圈邊緣光＋虹彩
  vec3 nV = normalize((j38View * vec4(jN, 0.0)).xyz);
  vec2 mcUV = vec2(nV.x * 0.48 + 0.5, 0.5 - nV.y * 0.48);
  vec3 mc = texture2D(j38Matcap, mcUV).rgb;
  float mcL = max(mc.r, max(mc.g, mc.b));
  color.rgb += mc * 1.05 * j38Glass.x * jS;
  color.a = clamp(color.a + mcL * 0.55 * j38Glass.x * jS, 0.0, 1.0);
  // 整圈明亮的邊緣光（主視覺的白色輪廓）
  float rimW = smoothstep(0.42, 0.0, jNdV);
  // 上半部白色邊緣光、下半部偏青（設定圖底部是亮青光，不是奶白）
  float rimLow = 1.0 - smoothstep(-0.55, 0.1, nV.y);
  vec3 rimCol = mix(j38Rim, vec3(0.35, 0.9, 1.0), rimLow * 0.8);
  color.rgb += rimCol * (rimW * mix(0.62, 0.42, rimLow) + jFres * 0.22) * j38Glass.y * jS;
  color.a = clamp(color.a + rimW * 0.3 * j38Glass.y * jS, 0.0, 1.0);
  // 觸角玻璃管的亮邊（細管的邊緣光更明顯）
  color.rgb += vec3(0.9, 0.97, 1.0) * rimW * jAnt * 0.45 * jS;
  color.a = clamp(color.a + rimW * jAnt * 0.25 * jS, 0.0, 1.0);
  // 虹彩：邊緣附近粉紫 → 青色的薄膜色帶（隨角度變化）
  float irB = smoothstep(0.65, 0.2, jNdV) * smoothstep(0.0, 0.12, jNdV);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + jNdV * 1.6 + nV.y * 0.25 + 0.55));
  irid = mix(irid, vec3(0.85, 0.7, 1.0), 0.35);
  color.rgb += irid * irB * 0.22 * j38Glass.z * jS;
  // 羽翼：外緣柔和白色高光＋細的水晶光澤
  color.rgb += vec3(0.9, 0.97, 1.0) * pow(1.0 - jNdV, 1.6) * jWing * 0.5 * jS;
  // 天空反射（很淡，讓上半部有一點環境色）
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j38SkyLow, j38SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.1 * jS;
}
#endif
`,Me={monsterId:`star_dew_bobo`,assetId:`bobo`,pascalName:`StarDewBobo`,version:`v38`,family:`jelly`,tier:`normal`,heightM:.8,footprintRadiusM:.5,requiredParts:[`Body_`,`Eyes`,`Mouth`,`Blush`,`Stars`],expressions:{names:[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],parts:[{mesh:`Eyes`,cols:4,rows:2,cellU:.25,cellV:.5},{mesh:`Mouth`,cols:4,rows:2,cellU:.25,cellV:.25}]},features:{jelly:!0,nebula:!0,wings:!0,bellyStarInShader:!0,headStar:!0}},Ne=[`none`,`idle`,`move`,`attack`],Pe=[`none`,`idle`,`move`,`attack`,`hurt`,`death`],Fe={sy:1,sxz:1,roll:0,pitch:0,swayX:0,swayZ:0,flap:0,lift:0,sfwd:1,fwd:0};function Ie(e){let t=1/Math.sqrt(e.sy*e.sfwd);return[t,e.sy,t*e.sfwd]}var z=2.6,B=Math.PI*2;function Le(e,t=0){let n=B/z,r=t*B,i=n*e+r,a=1+.03*Math.sin(i)+.008*Math.sin(2*i+.6),o=1/Math.sqrt(a),s=.021*Math.sin(i*.5+.3),c=.01*Math.sin(i*.5+1.9);return{sy:a,sxz:o,roll:s,pitch:c,swayX:.035*Math.sin(i-1.1)+.01*Math.sin(i*1.5+.4)-s*.6,swayZ:.022*Math.sin(i*.5-.4)-c*.6,flap:.12*Math.sin(2*i+.9),lift:0,sfwd:1,fwd:0}}function V(e,t,n){if(t<=e[0][0])return e[0][n];if(t>=e[e.length-1][0])return e[e.length-1][n];let r=0;for(;r<e.length-2&&t>e[r+1][0];)r++;let i=e[r][0],a=e[r+1][0],o=e[r][n],s=e[r+1][n],c=t=>t<=0||t>=e.length-1?0:(e[t+1][n]-e[t-1][n])/(e[t+1][0]-e[t-1][0]),l=a-i,u=(t-i)/l,d=u*u,f=d*u;return(2*f-3*d+1)*o+(f-2*d+u)*c(r)*l+(-2*f+3*d)*s+(f-d)*c(r+1)*l}var H=.62,U=.3,Re=[[0,1,0,0,0],[.12,.88,0,-.04,.02],[.2,1.13,.03,.07,-.05],[.42,1.04,.16,.03,-.02],[.62,1.07,.05,-.02,.03],[.7,.84,0,.06,.06],[.84,1.05,0,-.02,-.02],[1,1,0,0,0]];function W(e,t){let n=Re,r=0;for(;r<n.length-2&&e>n[r+1][0];)r++;let[i,a]=[n[r][0],n[r+1][0]],o=n[r][t],s=n[r+1][t],c=e=>e<=0||e>=n.length-1?0:(n[e+1][t]-n[e-1][t])/(n[e+1][0]-n[e-1][0]),l=a-i,u=(e-i)/l,d=c(r)*l,f=c(r+1)*l,p=u*u,m=p*u;return(2*m-3*p+1)*o+(m-2*p+u)*d+(-2*m+3*p)*s+(m-p)*f}function ze(e){let t=Math.min(1,Math.max(0,(e-.16)/.08)),n=Math.min(1,Math.max(0,(.72-e)/.08)),r=Math.min(t,n);return r*r*(3-2*r)}function G(e){let t=Math.min(1,Math.max(0,(e-.18)/.5));return t*t*(3-2*t)}function Be(e){e=(e%1+1)%1;let t=W(e,1),n=Math.max(0,W(e,2)),r=W(e,3),i=ze(e),a=W(e,4)-r*.3,o=i*.3*Math.sin(B*3*e)+(1-i)*.04*Math.sin(B*e);return{sy:t,sxz:1/Math.sqrt(t),roll:0,pitch:r,swayX:0,swayZ:a,flap:o,lift:n,sfwd:1,fwd:0}}var Ve=.95,K=[[0,1,1,0,0,0,0,0],[.14,.9,.96,-.03,0,-.06,.03,.16],[.34,.8,.93,-.07,0,-.13,.065,.3],[.4,.9,1.12,.03,.02,.06,-.02,.15],[.48,.95,1.22,.21,.05,.17,-.09,-.16],[.56,.9,.88,.24,.015,.1,-.03,-.1],[.68,1.06,1.02,.15,0,-.04,.07,.1],[.82,.97,1,.04,0,.02,-.02,0],[.95,1,1,0,0,0,0,0]];function q(e){let t=K,n=V(t,e,1),r=V(t,e,2);return{sy:n,sfwd:r,sxz:1/Math.sqrt(n*r),fwd:V(t,e,3),lift:Math.max(0,V(t,e,4)),pitch:V(t,e,5),roll:0,swayX:0,swayZ:V(t,e,6),flap:V(t,e,7)}}var He=.75,Ue=[[0,1,1,0,0,0,0,0,0],[.06,.92,.9,-.015,0,-.11,.05,.3,0],[.15,.88,.9,-.035,0,-.175,.075,.38,0],[.24,.92,1.03,-.065,0,-.12,.01,.05,0],[.32,.95,1.04,-.08,0,-.07,-.03,-.1,0],[.42,1.04,.98,-.075,0,.03,.03,.06,.03],[.5,.99,1,-.06,0,0,-.015,-.03,-.02],[.55,1,1,-.05,0,.01,.005,0,.008],[.66,1,1,-.015,0,0,0,0,0],[.75,1,1,0,0,0,0,0,0]];function We(e){let t=Ue,n=V(t,e,1),r=V(t,e,2);return{sy:n,sfwd:r,sxz:1/Math.sqrt(n*r),fwd:V(t,e,3),lift:Math.max(0,V(t,e,4)),pitch:V(t,e,5),swayZ:V(t,e,6),flap:V(t,e,7),roll:V(t,e,8),swayX:0}}var J=1.8,Ge=.8,Y=[[0,1,1,0,0,0,0,0],[.12,.9,.93,-.02,-.15,.06,.3,0],[.25,.85,.94,-.04,-.21,.08,.2,0],[.42,.88,.98,-.04,-.06,.03,.05,.045],[.55,.85,1,-.035,.04,.05,-.12,-.03],[.65,.81,1,-.03,.09,.07,-.22,.015],[.85,.79,1,-.03,.11,.085,-.28,0],[1.05,.78,1,-.03,.12,.09,-.3,0],[1.8,.78,1,-.03,.12,.09,-.3,0]];function Ke(e){let t=Y,n=V(t,e,1),r=V(t,e,2);return{sy:n,sfwd:r,sxz:1/Math.sqrt(n*r),fwd:V(t,e,3),pitch:V(t,e,4),swayZ:V(t,e,5),flap:V(t,e,6),roll:V(t,e,7),swayX:0,lift:0}}var X=e=>{let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)};function qe(e){return{visibility:1-X((e-1.05)/.5),starBright:1-X((e-.65)/.4),eyesClosed:e>=Ge,dust:e>=1.05&&e<1.8}}function Je(e){return e===`high`?10:e===`medium`?8:6}var Ye=[[.62,.86,1],[1,1,1],[1,.88,.5]];function Xe(e,t,n){let r=t=>{let n=Math.sin((e+1)*12.9898+t*78.233)*43758.5453;return n-Math.floor(n)},i=Math.min(1,Math.max(0,(n-1.05)/.75)),a=r(1)*.25,o=Math.min(1,Math.max(0,(i-a)/(1-a))),s=(e+r(2)*.6)/t*Math.PI*2,c=.12+r(3)*.18+o*(.06+r(4)*.08),l=.25+r(5)*.4+o*(.35+r(6)*.2)*(1-.35*o),u=o<=0?0:Math.sin(Math.PI*Math.min(1,o))**.8;return{x:Math.cos(s)*c,y:l,z:Math.sin(s)*c,alpha:u*.9,size:.06+r(7)*.04}}function Ze(e,t,n=0){return e===`idle`?Le(t,n):e===`move`?Be(t/H+n):e===`attack`?q(Math.min(t,Ve)):e===`hurt`?We(Math.min(t,He)):e===`death`||e===`dead`?Ke(e===`dead`?J:Math.min(t,J)):Fe}function Qe(e,t,n){let r=(e,t)=>e+(t-e)*n,i=r(e.sy,t.sy),a=r(e.sfwd,t.sfwd);return{sy:i,sfwd:a,sxz:1/Math.sqrt(i*a),roll:r(e.roll,t.roll),pitch:r(e.pitch,t.pitch),swayX:r(e.swayX,t.swayX),swayZ:r(e.swayZ,t.swayZ),flap:r(e.flap,t.flap),lift:r(e.lift,t.lift),fwd:r(e.fwd,t.fwd)}}var $e=class e{current;requested;t=0;from=null;fade=1;lastPose=Fe;phase;static FADE=.3;constructor(e,t=0){this.current=e,this.requested=e,this.phase=t}get pending(){return this.requested}get time(){return this.t}request(e){(this.current!==`attack`||e!==`attack`)&&this.current!==`death`&&this.current!==`dead`&&(this.requested=e,this.current!==`move`&&this.current!==`attack`&&this.current!==`hurt`&&this.switchNow())}get isDead(){return this.current===`death`||this.current===`dead`}death(){this.isDead||(this.requested=`death`,this.from=this.lastPose,this.fade=0,this.fadeTime=.05,this.current=`death`,this.t=0)}hurt(e=!1){this.isDead||(e?this.death():this.current===`hurt`&&this.t<.15||(this.requested=`hurt`,this.from=this.lastPose,this.fade=0,this.fadeTime=.05,this.current=`hurt`,this.t=0))}fadeTime=e.FADE;switchNow(){this.requested!==this.current&&(this.from=this.lastPose,this.fade=0,this.fadeTime=this.requested===`attack`?.12:e.FADE,this.requested===`hurt`&&(this.fadeTime=.05),this.current=this.requested,this.t=0)}update(e){let t=0;if(this.current===`move`){let n=this.t/H,r=(this.t+e)/H,i=n-Math.floor(n),a=Math.floor(r)>Math.floor(n);t=(G(a?1:r-Math.floor(r))-G(i))*U,this.t+=e,a&&this.requested!==`move`?(this.lastPose=Fe,this.switchNow()):a&&(t+=G(r-Math.floor(r))*U)}else this.current===`hurt`?(this.t+=e,this.t>=.75&&(this.requested=`idle`,this.lastPose=We(He),this.switchNow())):this.current===`death`?(this.t+=e,this.t>=1.8&&(this.current=`dead`,this.requested=`dead`,this.t=0,this.fade=1)):this.current===`attack`?(this.t+=e,this.t>=.95&&(this.requested===`attack`&&(this.requested=`idle`),this.lastPose=q(Ve),this.switchNow())):this.t+=e;let n=this.current===`move`?Be(this.t/H):Ze(this.current,this.t,this.phase);if(this.fade<1){this.fade=Math.min(1,this.fade+e/this.fadeTime);let t=this.fade*this.fade*(3-2*this.fade);n=Qe(this.from??Fe,n,t)}return this.lastPose=n,{pose:n,travel:t}}};function et(e){let t=Math.min(1,Math.max(0,(e-1.02)/(1.37-1.02))),n=t*t*(3-2*t);return n*n}var tt=class{next;closedUntil=-1;time=0;seed;constructor(e=1){this.seed=e,this.next=1.2+this.rand()*2}rand(){return this.seed=(this.seed*1664525+1013904223)%4294967296,this.seed/4294967296}update(e){return this.time+=e,this.time>=this.next&&(this.closedUntil=this.time+.13,this.next=this.time+2.6+this.rand()*2),this.time<this.closedUntil}};async function nt(e,t,n,r=()=>Promise.resolve()){let i=[];for(let a=0;a<e.length;a++){let o=e[a];n?.(o.name,a),o.apply();try{await r();let e=await t();i.push({name:o.name,avg:e.avgFps,low1:e.low1Fps,draws:e.avgDrawCalls,gain:0})}finally{o.restore()}}let a=i[0]?.avg??0;for(let e of i)e.gain=e.avg-a;return i}function rt(e){return e.map((e,t)=>t===0?`${e.name}：平均 ${e.avg.toFixed(1)}・1% ${e.low1.toFixed(1)}・Draw ${e.draws.toFixed(0)}`:`${e.name}：平均 ${e.avg.toFixed(1)}（${e.gain>=0?`+`:``}${e.gain.toFixed(1)}）・1% ${e.low1.toFixed(1)}・Draw ${e.draws.toFixed(0)}`)}var it=e=>e instanceof _e||e instanceof D||e instanceof A||e instanceof M||e instanceof we||e instanceof ke||e instanceof de,at={v3:`bobo3`,v31:`bobo31`,v32:`bobo32`,v33:`bobo33`,v34:`bobo34`,v35:`bobo35`,v36:`bobo36`,v37:`bobo37`,v38:`bobo38`,v38r:`bobo38r`},ot={v3:`V3`,v31:`V3.1`,v32:`V3.2`,v33:`V3.3`,v34:`V3.4`,v35:`V3.5`,v36:`V3.6`,v37:`V3.7`,v38:`V3.8`,v38r:`V3.8R`},st={v3:`v31`,v31:`v32`,v32:`v33`,v33:`v34`,v34:`v35`,v35:`v36`,v36:`v37`,v37:`v38`,v38:`v38r`,v38r:`v38`};function ct(e){for(let t of[...e.transformNodes,...e.meshes]){let e=t.metadata?.gltf?.extras?.bellyStar;if(e)return e}return null}var lt=[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],ut={normal:`一般`,happy:`開心`,curious:`好奇`,angry:`生氣`,scared:`害怕`,dizzy:`暈眩`,sleepy:`昏睡`,hurt:`受傷`},dt={front:Math.PI/2,side:Math.PI,back:-Math.PI/2,q45:Math.PI*3/4,top:Math.PI/2},ft={q45:1.2,top:.04},pt={front:`正面`,side:`側面`,back:`背面`,q45:`45°`,top:`俯視`};async function mt(s,c,f=`v3`){let te=f!==`v3`,y=f===`v35`||f===`v36`||f===`v37`||f===`v38`||f===`v38r`,b=f===`v38r`,x=b&&new URLSearchParams(location.search).get(`grey`)===`1`,S=f===`v38r`?ce:f===`v38`?Me:f===`v37`?Oe:f===`v36`?Ce:null,he=!!S,ge=ot[f],C=ae(),w=re(s,C),T=new e(w),_e=se(T);T.skipPointerMovePicking=!0;let ve=new p(`sky`,new n(.2,1,.3),T);ve.intensity=.85,ve.groundColor=new a(.6,.68,.6);let ye=new h(`sun`,new n(-.4,-1,-.5).normalize(),T);ye.position=new n(4,10,5),ye.intensity=.6;let E=y?null:ue(ye,{...C,shadows:{...C.shadows,mapSize:Math.min(1024,C.shadows.mapSize)}});E&&(E.darkness=.4);let D=new g(`PH_labGrass`,T);D.diffuseColor=new a(.55,.82,.45),D.specularColor=new a(.03,.03,.03);let be=v.CreateCylinder(`PH_labGround`,{diameter:9,height:.2,tessellation:48},T);be.position.y=-.1,be.material=D,be.receiveShadows=!y;let O=new d(`labCam`,dt.front,1.3,2.6,new n(0,.5,0),T);O.attachControl(s,!0),O.lowerRadiusLimit=1.2,O.upperRadiusLimit=7,O.lowerBetaLimit=f===`v38r`?.02:.35,O.upperBetaLimit=1.55,O.panningSensibility=0,O.minZ=.05;let k=ie(T,O,y?{...C,bloom:{...C.bloom,enabled:!1}}:C),A=null;S&&(A=await fe(T,`./models/`,S,C.level));let j=A?A.file:f===`v35`?`bobo_v35_${C.level}.glb`:f===`v34`?`bobo_v34_${C.level}.glb`:f===`v33`?`bobo_v33_${C.level}.glb`:te?`bobo_v31_${C.level}.glb`:`bobo_v3_${C.level}.glb`,xe=A?A.container:await u.LoadAssetContainerAsync(`./models/`,j,T),Se=f===`v33`||f===`v34`||f===`v35`||he,M=A?A.extras.bellyStar??null:Se?ct(xe):null;if(Se&&!M)throw Error(`${j} 缺少腹部星星資料（extras.bellyStar）`);let N=te?gt(T,xe.materials,C.level!==`low`,f===`v38r`?`v38r`:f===`v38`?`v38`:f===`v37`?`v37`:f===`v36`?`v36`:f===`v35`?`v35`:f===`v34`?`v34`:f===`v32`||f===`v33`?`v32`:`v31`):ht(T,xe.materials,C.level!==`low`),P=[],F=null;b&&(F=new g(`BoboV38R_Grey`,T),F.diffuseColor=new a(.74,.74,.76),F.specularColor=new a(.12,.12,.12),F.specularPower=40,F.ambientColor=new a(.2,.2,.22));let Te=(e,t)=>{if(F){e.body.material=t?F:e.bodyMat,e.body.alphaIndex=+!t,e.stars.material=t?F:N.stars,e.body.useVertexColors=!t,e.stars.useVertexColors=!t;for(let n of[e.eyes,e.mouth,e.blush])n.setEnabled(!t)}},I=`none`;if(b){let e=new URLSearchParams(location.search).get(`anim`);I=e&&Pe.includes(e)?e:`idle`}let Ee=(e,t,n)=>{let r=A?A.instantiate(`bobo3_${P.length}`):null,i;if(r)i=r.root;else{let e=xe.instantiateModelsToScene(e=>`${e}_${P.length}`,!1,{doNotInstantiate:!0});i=new ee(`bobo3_${P.length}`,T);for(let t of e.rootNodes)t.parent=i}i.position.set(e,0,t),i.rotation.y=n;let a=i.getChildMeshes(!1),s=e=>{let t=a.find(t=>t.name.startsWith(e));if(!t)throw Error(`V3 模型缺少零件：${e}`);return t},c=s(`Body_`),l=s(`Eyes`),u=s(`Mouth`),d=s(`Blush`),f=s(`Stars`),p=N.body(P.length);if(M&&it(p.jelly)&&(p.jelly.starOuter=M.outer,p.jelly.starInner=M.inner,p.jelly.starCenter.set(...M.center),p.jelly.starNormal.set(...M.normal).normalize()),c.material=p.material,c.alphaIndex=1,l.material=N.eyes,f.material=N.stars,p.material.needDepthPrePass=!0,d.material=N.blush,d.alphaIndex=2,u.material=N.mouth,u.alphaIndex=3,te&&(l.alphaIndex=2),E)for(let e of[c,l,f])E.addShadowCaster(e,!1);k.glow?.addIncludedOnlyMesh(f);for(let e of a)e.isPickable=!1,e.receiveShadows=!y&&e===c;let m=r&&S?.expressions?new le(S.expressions,r):null,h=new Float32Array,g=new Float32Array;m||(l.makeGeometryUnique(),u.makeGeometryUnique(),h=Float32Array.from(l.getVerticesData(o.UVKind)??[]),g=Float32Array.from(u.getVerticesData(o.UVKind)??[]),l.setVerticesData(o.UVKind,Float32Array.from(h),!0),u.setVerticesData(o.UVKind,Float32Array.from(g),!0));let _=P.length,v={root:i,body:c,eyes:l,mouth:u,blush:d,stars:f,jelly:p.jelly,eyeUV:h,mouthUV:g,expr:m,bodyMat:p.material,animPhase:[0,.37,.71][_%3],blink:new tt(17+_*101),blinkClosed:!1,player:new $e(`none`,[0,.37,.71][_%3]),home:{x:e,z:t,yaw:n},yaw:n,moveSign:_===1?-1:1,pose:Fe,base:{x:e,z:t},faceOverride:null,vis:1,starBright:1,starMat:null,dust:[]};return b&&(I===`hurt`?v.player.hurt():I===`death`?v.player.death():v.player.request(I)),Te(v,x),P.push(v),v};Ee(0,0,0);let De=e=>{if(b){x=e;for(let t of P)Te(t,e);L()}},Ae=null,L=()=>{};if(y){let e=new m(`BoboV35_BlobTex`,{width:128,height:128},T,!0);{let t=e.getContext(),n=t.createRadialGradient(64,64,0,64,64,64);n.addColorStop(0,`rgba(255,255,255,1)`),n.addColorStop(.45,`rgba(255,255,255,0.75)`),n.addColorStop(1,`rgba(255,255,255,0)`),t.fillStyle=n,t.fillRect(0,0,128,128),e.update()}e.hasAlpha=!0;let i=new g(`BoboV35_BlobMat`,T);i.disableLighting=!0,i.emissiveColor=new a(.14,.24,.2),i.opacityTexture=e,i.alpha=.42,i.disableDepthWrite=!0,i.zOffset=-2;let o=v.CreateGround(`BoboV35_BlobShadow`,{width:1.05,height:.82},T);o.material=i,o.isPickable=!1,o.alphaIndex=0;let s=document.createElement(`canvas`);s.width=s.height=128;{let e=s.getContext(`2d`),t=e.createRadialGradient(64,64,0,64,64,64);t.addColorStop(0,`rgba(255,244,170,0.85)`),t.addColorStop(.3,`rgba(255,232,130,0.42)`),t.addColorStop(.65,`rgba(255,222,110,0.12)`),t.addColorStop(1,`rgba(255,215,100,0)`),e.fillStyle=t,e.fillRect(0,0,128,128)}let c=new pe(`BoboV35_StarHalo`,s.toDataURL(`image/png`),3,{width:128,height:128},T);c.blendMode=l.ALPHA_ADD,c.disableDepthWrite=!0,c.isPickable=!1;let u=[];if(L=()=>{let e=P.filter(e=>e.root.isEnabled()),t=new Float32Array(16*Math.max(1,e.length));for(e.forEach((e,n)=>{e.root.computeWorldMatrix(!0);let i=e.root.getAbsolutePosition();r.Translation(i.x,.004,i.z).copyToArray(t,n*16)}),o.thinInstanceSetBuffer(`matrix`,t,16,!1),o.thinInstanceCount=e.length;u.length<P.length;){let e=new _(`BoboV35_Halo_${u.length}`,c);e.width=e.height=.42,u.push(e)}P.forEach((e,t)=>{e.stars.computeWorldMatrix(!0),e.stars.refreshBoundingInfo(),u[t].position.copyFrom(e.stars.getBoundingInfo().boundingSphere.centerWorld),u[t].isVisible=e.root.isEnabled()&&!x})},L(),b){let e=new Float32Array(48),i=new r,a=new n;Ae=()=>{let s=P.filter(e=>e.root.isEnabled());s.forEach((a,o)=>{let s=a.root.position,c=(1-Math.min(.45,s.y*2.6))*a.vis;r.ComposeToRef(new n(c,1,c),t.Identity(),new n(s.x,.004,s.z),i),i.copyToArray(e,o*16)}),o.thinInstanceSetBuffer(`matrix`,e.subarray(0,16*Math.max(1,s.length)),16,!1),o.thinInstanceCount=s.length,P.forEach((e,t)=>{let r=u[t];r&&(e.stars.computeWorldMatrix(!0),n.TransformCoordinatesToRef(e.stars.getBoundingInfo().boundingSphere.center,e.stars.getWorldMatrix(),a),r.position.copyFrom(a),r.color.a=e.starBright*e.vis)})}}}k.glow&&(k.glow.customEmissiveColorSelector=(e,t,n,r)=>{if(e.name.startsWith(`Stars`))te?r.set(.42,.32,.06,1):r.set(.75,.45,.05,1);else{let e=n.emissiveColor;e?r.set(e.r,e.g,e.b,1):r.set(0,0,0,1)}});let R=`normal`,je=e=>{R=e;let t=lt.indexOf(e),n=t%4,r=Math.floor(t/4);for(let e of P){if(e.expr){e.expr.set(t);continue}let i=new Float32Array(e.eyeUV.length);for(let t=0;t<i.length;t+=2)i[t]=e.eyeUV[t]+n*.25,i[t+1]=e.eyeUV[t+1]+r*.5;e.eyes.updateVerticesData(o.UVKind,i);let a=new Float32Array(e.mouthUV.length);for(let t=0;t<a.length;t+=2)a[t]=e.mouthUV[t]+n*.25,a[t+1]=e.mouthUV[t+1]+r*.25;e.mouth.updateVerticesData(o.UVKind,a)}for(let t of W)t.classList.toggle(`active`,t.dataset.expr===e)},z=!1,B=`front`,Le=T.clearColor.clone(),V=T.fogMode,H=e=>{z=e,_e.setEnabled(!e),be.setEnabled(!e),T.clearColor=e?new i(.075,.085,.16,1):Le,T.fogMode=e?0:V,O.beta=ft[B]??(e?1.5:1.3),O.target.y=e?.42:.5,O.radius=e?2.7:P.filter(e=>e.root.isEnabled()).length===3?4.6:2.6;for(let t of c.querySelectorAll(`.v3-ref`))t.classList.toggle(`active`,e)},U=e=>{for(;P.length<e;){let e=P.length;Ee(e===1?-1.4:1.4,-.9,e===1?.35:-.35),je(R)}P.forEach((t,n)=>t.root.setEnabled(n<e)),L(),O.radius=e===3?4.6:2.6,O.target.y=e===3?.45:.5;for(let t of ze)t.classList.toggle(`active`,Number(t.dataset.count)===e)};c.innerHTML=`
    <div class="v3-top">
    <div class="lab-title v3-title" data-layout="lab-title">
      <div class="lab-name">星露啵啵 ${ge} <small>模型預覽</small></div>
      <div class="lab-state">畫質：${C.level}・${j}${M?`・腹部星星 ${M.outer}（模型 V${M.version}）`:``}</div>
    </div>
    <div class="lab-views v3-views">
      ${(b?[`front`,`side`,`back`,`q45`,`top`]:[`front`,`side`,`back`]).map(e=>`<button class="lab-view-btn" data-view="${e}" data-layout="btn-view-${e}">${pt[e]}</button>`).join(``)}
      <button class="lab-view-btn" data-count="1" data-layout="btn-count-1">1 隻</button>
      <button class="lab-view-btn" data-count="3" data-layout="btn-count-3">3 隻</button>
      <button class="lab-view-btn v3-switch" data-layout="btn-switch">看 ${ot[st[f]]}</button>
      <button class="lab-view-btn v3-ref" data-layout="btn-ref">設定圖對照</button>
    </div>
    <button class="v3-bench lab-bench" data-layout="btn-bench">⏱ 效能測試（10 秒）</button>
    ${b?`<div class="v3-row"><button class="lab-view-btn v3-cost" data-layout="btn-cost">🔍 成本分析（約 35 秒）</button><button class="lab-view-btn v3-anim" data-layout="btn-anim">🫧 待機</button><button class="lab-view-btn v3-hurt" data-layout="btn-hurt">💢 受傷</button><button class="lab-view-btn v3-death" data-layout="btn-death">💫 死亡</button></div>`:`<button class="lab-view-btn v3-cost" data-layout="btn-cost">🔍 成本分析（約 35 秒）</button>`}
    <div class="lab-bench-result v3-bench-result" hidden></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel v3-expr">
      ${lt.map(e=>`<button class="lab-btn" data-expr="${e}" data-layout="btn-expr-${e}">${ut[e]}</button>`).join(``)}
    </div>`;let Re=[...c.querySelectorAll(`[data-view]`)],W=[...c.querySelectorAll(`[data-expr]`)],ze=[...c.querySelectorAll(`[data-count]`)],G=c.querySelector(`.v3-anim`),Be={none:`⏸ 靜止`,idle:`🫧 待機`,move:`🦘 移動`,attack:`💥 攻擊`,hurt:`💢 受傷中`,death:`💫 死亡中`,dead:`💫 已死亡`};c.querySelector(`.v3-death`)?.addEventListener(`click`,()=>{let e=P.filter(e=>e.root.isEnabled()),t=e.find(e=>!e.player.isDead);if(t)t.player.death();else for(let t of e)$(t)}),c.querySelector(`.v3-hurt`)?.addEventListener(`click`,()=>{for(let e of P)e.root.isEnabled()&&e.player.hurt()});let Ve=c.querySelector(`.lab-fps`),K=c.querySelector(`.lab-bench`),q=c.querySelector(`.lab-bench-result`);c.querySelector(`.v3-ref`).addEventListener(`click`,()=>H(!z)),c.querySelector(`.v3-switch`).addEventListener(`click`,()=>{let e=new URL(location.href);e.searchParams.set(`lab`,at[st[f]]),e.searchParams.delete(`bench`),location.href=e.toString()});let He=dt.front,Ue=!1,We=(e,t=!1)=>{B=e,He=dt[e];let n=ft[e];O.beta=n??(z?1.5:1.3),Ue=t;for(let t of Re)t.classList.toggle(`active`,t.dataset.view===e)};for(let e of Re)e.addEventListener(`click`,()=>We(e.dataset.view));for(let e of W)e.addEventListener(`click`,()=>je(e.dataset.expr));for(let e of ze)e.addEventListener(`click`,()=>U(Number(e.dataset.count)));We(`front`,!0),je(`normal`),U(1);let J=new ne(w,T,C,c),Ge=new oe(T),Y=null,Ke=(e=10)=>new Promise(t=>{Y||(z&&H(!1),q.hidden=!0,K.classList.add(`on`),Y={rec:new me(e),resolve:t},K.textContent=`⏱ 測試中…請勿操作`)});K.addEventListener(`click`,()=>void Ke(10));let X=c.querySelector(`.v3-cost`),Qe=async(e=5)=>{if(Y)return[];let t=w.getHardwareScalingLevel(),n=k.pipeline?.samples??1,r=P.map(e=>e.jelly).filter(e=>!!e),i=r.map(e=>`nebula`in e?e.nebula:0),a=P.filter(e=>e.root.isEnabled()).length===3?3:1,o=(e,t,n)=>({name:e,apply:()=>{t(),L()},restore:()=>{n(),U(a)}}),s=[o(`目前設定`,()=>{},()=>{}),o(`關閉果凍內部星雲`,()=>r.forEach(e=>`nebula`in e&&(e.nebula=0)),()=>r.forEach((e,t)=>`nebula`in e&&(e.nebula=i[t]))),o(`關閉果凍材質（純透明）`,()=>r.forEach(e=>e.jellyEnabled=!1),()=>r.forEach(e=>e.jellyEnabled=!0)),o(`關閉 MSAA 抗鋸齒`,()=>k.pipeline&&(k.pipeline.samples=1),()=>k.pipeline&&(k.pipeline.samples=n)),o(`解析度 1.5x`,()=>w.setHardwareScalingLevel(1/1.5),()=>w.setHardwareScalingLevel(t)),o(`隱藏啵啵（只剩場景）`,()=>P.forEach(e=>e.root.setEnabled(!1)),()=>{})];X.disabled=!0;let c=await nt(s,()=>Ke(e),e=>X.textContent=`🔍 測試中：${e}`,()=>new Promise(e=>window.setTimeout(e,600)));X.disabled=!1,X.textContent=`🔍 成本分析（約 35 秒）`;let l=J.stats();return q.hidden=!1,q.innerHTML=`<b>${ge} 成本分析（本機 WebGL 實測，每項 ${e} 秒）</b><br>${j}・${a} 隻・畫質 ${l.quality}・${Math.round(10/t)/10}x<br>`+rt(c).join(`<br>`)+`<br><small>括號內為與「目前設定」相比的 FPS 變化；越多 → 那一項越吃效能。點此關閉</small>`,q.onclick=()=>q.hidden=!0,c};X.addEventListener(`click`,()=>void Qe(5));let mt=new URLSearchParams(location.search);mt.get(`count`)===`3`&&U(3),mt.get(`ref`)===`1`&&H(!0),mt.get(`bench`)===`1`&&window.setTimeout(()=>void Ke(10),3e3);let Z=null,_t=et(1.19),vt=.45,yt=b&&new URLSearchParams(location.search).get(`repeat`)===`1`,Q=null,bt=Je(C.level),xt=()=>{if(Q)return Q;let e=document.createElement(`canvas`);e.width=e.height=64;let t=e.getContext(`2d`),n=t.createRadialGradient(32,32,0,32,32,32);return n.addColorStop(0,`rgba(255,255,255,1)`),n.addColorStop(.18,`rgba(255,255,255,0.75)`),n.addColorStop(.5,`rgba(255,255,255,0.12)`),n.addColorStop(1,`rgba(255,255,255,0)`),t.fillStyle=n,t.fillRect(0,0,64,64),t.globalCompositeOperation=`lighter`,t.fillStyle=`rgba(255,255,255,0.8)`,t.beginPath(),t.moveTo(32,2),t.quadraticCurveTo(35,29,62,32),t.quadraticCurveTo(35,35,32,62),t.quadraticCurveTo(29,35,2,32),t.quadraticCurveTo(29,29,32,2),t.fill(),Q=new pe(`BoboV38R_StarDust`,e.toDataURL(`image/png`),30,{width:64,height:64},T),Q.blendMode=l.ALPHA_ADD,Q.disableDepthWrite=!0,Q.isPickable=!1,Q};b&&xt();let St=(e,t)=>{if(e.vis!==t){e.vis=t;for(let n of[e.body,e.eyes,e.mouth,e.blush,e.stars])n.visibility=t}},Ct=e=>{for(let t of e.dust)t.dispose();e.dust.length=0},wt=(e,t)=>{if(e.starBright===t)return;if(e.starBright=t,t>=1){e.starMat&&=(x||(e.stars.material=N.stars),e.starMat.dispose(),null);return}if(x)return;e.starMat||(e.starMat=N.stars.clone(`BoboV38R_StarDim_${P.indexOf(e)}`),e.stars.material=e.starMat);let n=N.stars,r=1-t;e.starMat.emissiveColor.set(n.emissiveColor.r*t+.3*r,n.emissiveColor.g*t+.34*r,n.emissiveColor.b*t+.42*r),e.starMat.diffuseColor.set(n.diffuseColor.r*t+.4*r,n.diffuseColor.g*t+.45*r,n.diffuseColor.b*t+.55*r),e.starMat.specularColor.copyFrom(n.specularColor).scaleInPlace(.5+.5*t)},Tt=(e,t)=>{if(St(e,t?t.visibility:1),wt(e,t?t.starBright:1),!t||!t.dust||x){e.dust.length&&Ct(e);return}let n=Z??e.player.time,r=xt();for(;e.dust.length<bt;){let t=e.dust.length,n=new _(`BoboV38R_Dust_${P.indexOf(e)}_${t}`,r),a=Ye[t%Ye.length];n.color=new i(a[0],a[1],a[2],0),e.dust.push(n)}let a=e.root.position;e.dust.forEach((e,t)=>{let r=Xe(t,bt,n);e.position.set(a.x+r.x,r.y,a.z+r.z),e.width=e.height=r.size,e.color.a=r.alpha})},$=e=>{e.player=new $e(`none`,e.animPhase),e.player.request(I===`none`||I===`death`||I===`hurt`?I===`none`?`none`:`idle`:I),e.base.x=e.home.x,e.base.z=e.home.z,e.yaw=e.home.yaw,e.root.position.set(e.home.x,0,e.home.z),Ct(e),St(e,1),wt(e,1),e.faceOverride=null,e.blinkClosed=!1,e.expr?.set(lt.indexOf(R))},Et=e=>{if(!b)return;for(let t of P){yt&&Z===null&&I===`death`&&(t.player.current===`dead`&&t.player.time>.6?$(t):t.player.current===`idle`&&t.player.time>.6&&t.player.death()),yt&&Z===null&&(I===`attack`||I===`hurt`)&&t.player.current===`idle`&&t.player.time>.3&&(I===`hurt`?t.player.hurt():t.player.request(`attack`));let n,r=0;if(Z!==null)n=Ze(I,Z,t.animPhase),t.base.x=t.home.x,t.base.z=t.home.z,t.yaw=t.home.yaw;else{let i=t.player.update(e);n=i.pose,r=i.travel;let a=t.player.current===`move`&&t.player.pending===`move`,o=(t.player.current===`attack`||t.player.current===`hurt`||t.player.isDead?t.yaw:a||t.player.current===`move`?t.moveSign>0?Math.PI/2:-Math.PI/2:t.home.yaw)-t.yaw;o=Math.atan2(Math.sin(o),Math.cos(o)),t.yaw+=o*Math.min(1,e*7),Math.abs(o)>.35&&(r=0);let s=t.base;s.x+=Math.sin(t.yaw)*r,s.z+=Math.cos(t.yaw)*r,t.moveSign>0&&s.x>t.home.x+vt?t.moveSign=-1:t.moveSign<0&&s.x<t.home.x-vt&&(t.moveSign=1)}t.pose=n,t.root.position.set(t.base.x+Math.sin(t.yaw)*n.fwd,n.lift,t.base.z+Math.cos(t.yaw)*n.fwd),t.root.rotation.y=t.yaw;let[i,a,o]=Ie(n);t.root.scaling.set(i,a,o),t.root.rotation.z=n.roll,t.root.rotation.x=n.pitch,t.jelly instanceof de&&t.jelly.anim.set(n.swayX,n.swayZ,n.flap,0),t.stars.position.set(n.swayX*_t,0,n.swayZ*_t);let s=Z===null?t.player.current:I,c=Z??t.player.time,l=s===`death`||s===`dead`,u=x?null:s===`attack`?`angry`:s===`hurt`&&c<.6?`hurt`:l?s===`dead`||c>=.8?`sleepy`:`hurt`:null;Tt(t,l?qe(s===`dead`?99:c):null),u!==t.faceOverride&&t.expr&&(t.faceOverride=u,t.blinkClosed=!1,t.expr.set(lt.indexOf(u??R)));let d=t.player.current===`idle`&&Z===null&&!x&&(R===`normal`||R===`curious`)&&t.blink.update(e);d!==t.blinkClosed&&t.expr&&(t.blinkClosed=d,t.expr.setPart(`Eyes`,d?lt.indexOf(`sleepy`):void 0))}Ae?.();let t=P[0]&&Z===null?P[0].player.current:I;G&&G.dataset.anim!==t&&(G.dataset.anim=t,G.textContent=Be[t])},Dt=e=>{I=e,Z=null;for(let t of P)e===`death`?t.player.death():(t.player.isDead&&$(t),e===`hurt`?t.player.hurt():(t.player.request(e),e===`none`&&($(t),t.player=new $e(`none`,t.animPhase),t.root.position.set(t.home.x,0,t.home.z),t.base.x=t.home.x,t.base.z=t.home.z,t.yaw=t.home.yaw)));G&&(G.textContent=Be[e]),e===`none`&&Et(0)};G?.addEventListener(`click`,()=>{let e=P[0]?.player.current??I,t=Ne.indexOf(e);Dt(Ne[(t<0?0:t+1)%Ne.length])}),G&&(G.textContent=Be[I]);let Ot=0;w.runRenderLoop(()=>{let e=w.getDeltaTime()/1e3,t=Math.min(e,.1);if(Y)O.alpha+=t*Math.PI*2/10;else if(Ue)O.alpha=He,Ue=!1;else{let e=He-O.alpha;e=Math.atan2(Math.sin(e),Math.cos(e)),O.alpha+=e*Math.min(1,t*6)}Et(t);for(let e of P)b&&e.body.computeWorldMatrix(!0),e.jelly&&e.body.getWorldMatrix().invertToRef(e.jelly.invWorld),(e.jelly instanceof we||e.jelly instanceof ke||e.jelly instanceof de)&&e.jelly.view.copyFrom(O.getViewMatrix());if(T.render(),J.update(t),Y&&Y.rec.record(e,Ge.drawCallsCounter.current)){let e=Y.rec.summary(),t=Y;Y=null,K.classList.remove(`on`),K.textContent=`⏱ 效能測試（10 秒）`,q.hidden=!1;let n=J.stats(),r=P.filter(e=>e.root.isEnabled()).length;q.innerHTML=`<b>${ge} 效能測試（本機 WebGL 實測）</b><br>${j}・${r} 隻・畫質 ${n.quality}・${n.pixelRatio}x・${e.seconds} 秒<br>平均 ${e.avgFps.toFixed(1)} FPS・最慢 1% ${e.low1Fps.toFixed(1)} FPS・最低 ${e.minFps.toFixed(1)} FPS<br>Draw Calls 平均 ${e.avgDrawCalls.toFixed(0)}（最高 ${e.maxDrawCalls}）・畫面物件 ${n.activeMeshes}<br><small>點此關閉</small>`,q.onclick=()=>q.hidden=!0,t.resolve(e)}Ot+=t,Ot>.25&&(Ot=0,Ve.textContent=`${Math.round(w.getFps())} FPS`)}),window.addEventListener(`resize`,()=>w.resize()),window.__bobo3=window.__monsterLab={ready:!0,setView:e=>We(e,!0),setExpression:je,setCount:U,setRefMode:H,setGrey:De,setAnim:e=>Dt(Pe.includes(e)?e:`idle`),death:e=>{if(e===void 0)for(let e of P)e.root.isEnabled()&&e.player.death();else P[e]?.player.death()},respawn:e=>{for(let[t,n]of P.entries())(e===void 0||e===t)&&$(n)},command:(e,t=0)=>P[t]?.player.request(e),animStateOf:e=>{let t=P[e];return{anim:t.player.current,visibility:t.body.visibility,x:t.root.position.x,z:t.root.position.z}},resourceCounts:()=>({materials:T.materials.length,textures:T.textures.length,meshes:T.meshes.length,sprites:T.spriteManagers?.reduce((e,t)=>e+t.sprites.length,0)??0,dust:P.reduce((e,t)=>e+t.dust.length,0),starMatClones:P.filter(e=>e.starMat).length}),freezeRest:()=>{for(let e of P)e.player=new $e(`none`,e.animPhase),Tt(e,null);I=`none`,Z=null},hurt:e=>{for(let t of P)t.root.isEnabled()&&t.player.hurt(!!e)},holdAnimAt:e=>{Z=e},animPose:()=>{let e=P[0],t=e.pose;return{sy:t.sy,sxz:t.sxz,roll:t.roll,swayX:t.swayX,flap:t.flap,starX:e.stars.position.x,scaleY:e.root.scaling.y}},animState:()=>{let e=P[0],t=e.root.position;return{anim:e.player.current,pending:e.player.pending,x:t.x,y:t.y,z:t.z,yaw:e.yaw,lift:e.pose.lift,sy:e.pose.sy,sfwd:e.pose.sfwd,fwd:e.pose.fwd,bx:e.base.x,bz:e.base.z,angry:e.faceOverride===`angry`,face:e.faceOverride??R,rx:e.root.rotation.x,rz:e.root.rotation.z,scale:e.root.scaling.asArray()}},bodyExtent:()=>{let e=P[0].body;e.computeWorldMatrix(!0),e.refreshBoundingInfo();let t=e.getBoundingInfo().boundingBox;return[...t.minimumWorld.asArray(),...t.maximumWorld.asArray()].map(e=>Math.round(e*1e4)/1e4)},setClose:e=>{O.radius=e?1.45:2.6,O.target.y=e?.36:.5},info:()=>{let e=P[0],t=[e.body,e.eyes,e.mouth,e.blush,e.stars].map(e=>({name:e.name,triangles:(e.getTotalIndices()||0)/3,vertices:e.getTotalVertices()}));return{quality:C.level,meshes:t,trianglesTotal:t.reduce((e,t)=>e+t.triangles,0),materials:5}},perf:()=>{let e=P[0]?.jelly,t=it(e)?{outer:e.starOuter,inner:e.starInner,centerY:e.starCenter.y}:null;return{...J.stats(),jelly:!!e?.jellyEnabled,variant:f,file:j,bellyStar:t,bellyStarVersion:M?.version??null,shadowMap:!!E,refMode:z,glowLayer:!!k.glow,grey:x,anim:b&&P[0]?P[0].player.current:I,faceVisible:!!P[0]?.eyes.isEnabled(),views5:b}},benchmark:Ke,costAnalysis:Qe,releaseModels:()=>{if(!A)return null;let e=A.spec.requiredParts,t=T.meshes.filter(t=>e.some(e=>t.name.startsWith(e))).length;return A.dispose(),P.length=0,{before:t,after:T.meshes.filter(t=>e.some(e=>t.name.startsWith(e))).length}},eyeUV0:()=>{let e=P[0].eyes.getVerticesData(o.UVKind);return[e[0],e[1]]}}}function ht(e,t,n){let r=e=>t.find(t=>t.name===e)?.albedoTexture??null,i=r(`Bobo_Eyes`),o=r(`Bobo_Face`);i instanceof s&&(i.anisotropicFilteringLevel=4);let c=new g(`BoboV3_Eyes`,e);c.diffuseTexture=i,c.diffuseTexture&&(c.diffuseTexture.hasAlpha=!0),c.useAlphaFromDiffuseTexture=!0,c.transparencyMode=1,c.alphaCutOff=.45,c.emissiveColor=new a(.78,.78,.82),c.diffuseColor=new a(.35,.35,.38),c.specularColor=new a(1,1,1),c.specularPower=140;let l=t=>{let n=new g(t,e);return n.diffuseTexture=o,n.diffuseTexture&&(n.diffuseTexture.hasAlpha=!0),n.useAlphaFromDiffuseTexture=!0,n.disableLighting=!0,n.emissiveColor=new a(.95,.95,.95),n.backFaceCulling=!0,n.zOffset=-2,n},u=l(`BoboV3_Mouth`),d=l(`BoboV3_Blush`),f=new g(`BoboV3_Stars`,e);return f.disableLighting=!0,f.emissiveColor=new a(.9,.62,.1),f.backFaceCulling=!1,{eyes:c,mouth:u,blush:d,stars:f,body:t=>{let r=new g(`BoboV3_Body_${t}`,e);r.diffuseColor=new a(.45,.5,.95),r.emissiveColor=new a(.12,.08,.42),r.specularColor=new a(.06,.06,.08),r.specularPower=64,r.alpha=.66,r.useSpecularOverAlpha=!1,r.backFaceCulling=!0;let i=null;if(n){i=new x(r),i.height=1;let e=i;r.onError=()=>{e.jellyEnabled&&=(console.warn(`[bobo3] jelly shader failed, fallback`),!1)}}return{material:r,jelly:i}}}}function gt(e,t,n,r=`v31`){let i=e=>t.find(t=>t.name===e)?.albedoTexture??null,o=i(`Bobo_Eyes`),c=i(`Bobo_Face`);o instanceof s&&(o.anisotropicFilteringLevel=4);let l=new g(`BoboV31_Eyes`,e);l.diffuseTexture=o,l.diffuseTexture&&(l.diffuseTexture.hasAlpha=!0),l.useAlphaFromDiffuseTexture=!0,l.transparencyMode=2,l.emissiveColor=new a(.8,.8,.84),l.diffuseColor=new a(.3,.3,.33),l.specularColor=new a(1,1,1),l.specularPower=160,l.zOffset=-1;let u=t=>{let n=new g(t,e);return n.diffuseTexture=c,n.diffuseTexture&&(n.diffuseTexture.hasAlpha=!0),n.useAlphaFromDiffuseTexture=!0,n.disableLighting=!0,n.emissiveColor=new a(.95,.95,.95),n.backFaceCulling=!0,n.zOffset=-2,n},d=u(`BoboV31_Mouth`),f=u(`BoboV31_Blush`),p=new g(`BoboV31_Stars`,e);p.disableLighting=!0,p.emissiveColor=new a(1,.96,.62),r===`v35`&&(p.emissiveColor=new a(1,1.1,.8)),r===`v38`||r===`v38r`?(p.disableLighting=!1,p.emissiveColor=new a(.9,.9,.84),p.diffuseColor=new a(.14,.14,.12),p.specularColor=new a(.75,.75,.68),p.specularPower=28,r===`v38r`&&(p.emissiveColor=new a(.98,1.02,.82))):(r===`v36`||r===`v37`)&&(p.disableLighting=!1,p.emissiveColor=new a(.92,.92,.86),p.diffuseColor=new a(.12,.12,.1),p.specularColor=new a(.55,.55,.5),p.specularPower=36),p.backFaceCulling=!1;let m=r===`v38r`?y(e):r===`v38`?L(e):r===`v37`?I(e):null,h=r===`v38r`?te(e):r===`v38`?Ae(e):r===`v37`?Te(e):r===`v36`?N(e):r===`v35`?j(e):r===`v34`?be(e):r===`v32`?ve(e):C(e);return{eyes:l,mouth:d,blush:f,stars:p,body:t=>{let i=new g(`BoboV31_Body_${t}`,e);i.diffuseColor=new a(.42,.48,.95),i.emissiveColor=new a(.1,.07,.4),i.specularColor=new a(.04,.04,.05),i.specularPower=64,i.alpha=.64,i.useSpecularOverAlpha=!1,i.backFaceCulling=!0,r===`v38r`&&(i.diffuseColor=new a(.45,.64,1),i.emissiveColor=new a(.08,.16,.42));let o=r===`v38r`?new de(i,h,m):r===`v38`?new ke(i,h,m):r===`v37`?new we(i,h,m):r===`v36`?new M(i,h):r===`v35`?new A(i,h):r===`v34`?new D(i,h):r===`v32`?new _e(i,h):new ge(i,h);return o.height=1,o.nebula=+!!n,i.onError=()=>{o.jellyEnabled&&=(console.warn(`[bobo3] jelly V3.1 shader failed, fallback`),!1)},{material:i,jelly:o}}}}export{mt as startBoboV3Lab};