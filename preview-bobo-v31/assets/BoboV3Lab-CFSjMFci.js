import{n as e}from"./scene.pure-DkB5Fm2r.js";import{o as t,t as n}from"./math.vector.pure-DST8O3ID.js";import{t as r}from"./math.color.pure-DobtDy7H.js";import{r as i}from"./buffer.pure-CGFpq70F.js";import{n as a}from"./texture.pure-C2CI4GQj.js";import{l as o}from"./pbrMaterial.pure-C61IP4Pq.js";import{t as s}from"./constants-DlOANaVb.js";import{M as c,N as l,O as u,P as d,S as f,a as p,c as m,j as h,k as g,l as _,o as v,s as ee,u as te,w as ne,x as re}from"./index-CFYtCbRz.js";function y(e,t){let n=[...e].sort((e,t)=>e-t),r=n.reduce((e,t)=>e+t,0),i=n.length,a=i?n[Math.min(i-1,Math.floor(i*.99))]:0,o=t.length?t.reduce((e,t)=>e+t,0)/t.length:0;return{seconds:Math.round(r*10)/10,frames:i,avgFps:i?i/Math.max(r,1e-6):0,low1Fps:a>0?1/a:0,minFps:i?1/n[i-1]:0,avgDrawCalls:o,maxDrawCalls:t.length?Math.max(...t):0}}var ie=class{warmup;target;elapsed=0;dts=[];draws=[];constructor(e,t=.5){this.target=e,this.warmup=t}get progress(){return Math.min(1,this.elapsed/(this.target+this.warmup))}record(e,t){return this.elapsed+=e,this.elapsed>this.warmup&&(this.dts.push(e),this.draws.push(t)),this.elapsed>=this.target+this.warmup}summary(){return y(this.dts,this.draws)}},b=class extends o{rim=new r(.55,.8,1);deep=new r(.2,.14,.78);top=new r(.3,.55,1);nebulaA=new r(.2,.85,1);nebulaB=new r(.6,.38,1);skyLow=new r(.95,.88,.98);skyHigh=new r(.55,.78,1);height=.8;strength=1;invWorld=n.Identity();nebula=1;enabled=!1;constructor(e){super(e,`JellyV3Plugin`,200,{JELLY3:!1}),this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV3Plugin`}prepareDefines(e,t,n){e.JELLY3=this.enabled}getUniforms(){return{ubo:[{name:`j3Rim`,size:3,type:`vec3`},{name:`j3Deep`,size:3,type:`vec3`},{name:`j3Top`,size:3,type:`vec3`},{name:`j3NebA`,size:3,type:`vec3`},{name:`j3NebB`,size:3,type:`vec3`},{name:`j3SkyLow`,size:3,type:`vec3`},{name:`j3SkyHigh`,size:3,type:`vec3`},{name:`j3Params`,size:4,type:`vec4`},{name:`j3InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY3
uniform vec3 j3Rim;
uniform vec3 j3Deep;
uniform vec3 j3Top;
uniform vec3 j3NebA;
uniform vec3 j3NebB;
uniform vec3 j3SkyLow;
uniform vec3 j3SkyHigh;
uniform vec4 j3Params;
uniform mat4 j3InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j3Rim`,this.rim),e.updateColor3(`j3Deep`,this.deep),e.updateColor3(`j3Top`,this.top),e.updateColor3(`j3NebA`,this.nebulaA),e.updateColor3(`j3NebB`,this.nebulaB),e.updateColor3(`j3SkyLow`,this.skyLow),e.updateColor3(`j3SkyHigh`,this.skyHigh),e.updateFloat4(`j3Params`,this.height,this.strength,this.nebula,2.4),e.updateMatrix(`j3InvWorld`,this.invWorld))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:x,CUSTOM_FRAGMENT_BEFORE_FOG:S}:null}},x=`
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
`,S=`
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
`,C=class extends o{rim=new r(.62,.85,1);core=new r(.16,.12,.62);shell=new r(.36,.5,1);top=new r(.5,.66,1);nebulaA=new r(.25,.75,1);nebulaB=new r(.62,.36,1);wing=new r(.56,.66,1);skyLow=new r(.95,.88,.98);skyHigh=new r(.55,.78,1);starCenter=new t(0,.27,.53);starNormal=new t(0,-.48,.8773).normalize();starOuter=.11;starInner=.056;height=1;strength=1;nebula=1;invWorld=n.Identity();enabled=!1;noise;constructor(e,t){super(e,`JellyV31Plugin`,200,{JELLY31:!1}),this.noise=t,this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV31Plugin`}prepareDefines(e,t,n){e.JELLY31=this.enabled}isReadyForSubMesh(e,t,n,r){return!this.enabled||this.noise.isReady()}getSamplers(e){e.push(`j31Noise`)}getActiveTextures(e){e.push(this.noise)}hasTexture(e){return e===this.noise}getUniforms(){return{ubo:[{name:`j31Rim`,size:3,type:`vec3`},{name:`j31Core`,size:3,type:`vec3`},{name:`j31Shell`,size:3,type:`vec3`},{name:`j31Top`,size:3,type:`vec3`},{name:`j31NebA`,size:3,type:`vec3`},{name:`j31NebB`,size:3,type:`vec3`},{name:`j31Wing`,size:3,type:`vec3`},{name:`j31SkyLow`,size:3,type:`vec3`},{name:`j31SkyHigh`,size:3,type:`vec3`},{name:`j31StarC`,size:3,type:`vec3`},{name:`j31StarN`,size:3,type:`vec3`},{name:`j31Params`,size:4,type:`vec4`},{name:`j31Star`,size:4,type:`vec4`},{name:`j31InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY31
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
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j31Rim`,this.rim),e.updateColor3(`j31Core`,this.core),e.updateColor3(`j31Shell`,this.shell),e.updateColor3(`j31Top`,this.top),e.updateColor3(`j31NebA`,this.nebulaA),e.updateColor3(`j31NebB`,this.nebulaB),e.updateColor3(`j31Wing`,this.wing),e.updateColor3(`j31SkyLow`,this.skyLow),e.updateColor3(`j31SkyHigh`,this.skyHigh),e.updateVector3(`j31StarC`,this.starCenter),e.updateVector3(`j31StarN`,this.starNormal),e.updateFloat4(`j31Params`,this.height,this.strength,this.nebula,2.2),e.updateFloat4(`j31Star`,this.starOuter,this.starInner,1.25,0),e.updateMatrix(`j31InvWorld`,this.invWorld),e.setTexture(`j31Noise`,this.noise))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:T,CUSTOM_FRAGMENT_BEFORE_FOG:E}:null}};function w(e,t=256){let n=new Uint8Array(t*t*4),r=(e,t,n)=>{let r=e*374761393+t*668265263+n*2147483647|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967295},i=(e,t,n,i)=>{let a=Math.floor(e),o=Math.floor(t),s=e-a,c=t-o,l=s*s*(3-2*s),u=c*c*(3-2*c),d=(e,t)=>r((e%n+n)%n,(t%n+n)%n,i),f=d(a,o)+(d(a+1,o)-d(a,o))*l;return f+(d(a,o+1)+(d(a+1,o+1)-d(a,o+1))*l-f)*u},o=(e,t,n,r,a)=>{let o=0,s=.55,c=0,l=n;for(let n=0;n<a;n++)o+=s*i(e*l,t*l,l,r+n*17),c+=s,s*=.5,l*=2;return o/c},c=new Float32Array(t*t);for(let e=0;e<22;e++)for(let n=0;n<22;n++){if(r(n,e,91)>.55)continue;let i=(n+.15+.7*r(n,e,92))/22*t,a=(e+.15+.7*r(n,e,93))/22*t,o=.45+.55*r(n,e,94),s=1.1+1.6*r(n,e,95);for(let e=-4;e<=4;e++)for(let n=-4;n<=4;n++){let r=(Math.round(i)+n+t)%t,l=(Math.round(a)+e+t)%t,u=Math.hypot(Math.round(i)+n-i,Math.round(a)+e-a),d=o*Math.exp(-(u*u)/(s*s));d>c[l*t+r]&&(c[l*t+r]=d)}}for(let e=0;e<t;e++)for(let r=0;r<t;r++){let i=r/t,a=e/t,s=(e*t+r)*4;n[s]=Math.round(o(i,a,4,1,4)*255),n[s+1]=Math.round(o(i,a,8,7,3)*255),n[s+2]=Math.round(Math.min(1,c[e*t+r])*255),n[s+3]=Math.round(o(i,a,32,3,2)*255)}let u=new l(n,t,t,s.TEXTUREFORMAT_RGBA,e,!0,!1,a.TRILINEAR_SAMPLINGMODE);return u.wrapU=a.WRAP_ADDRESSMODE,u.wrapV=a.WRAP_ADDRESSMODE,u.name=`BoboV31_Noise`,u}var T=`
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
`,E=`
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
  color.a = mix(color.a, color.a * 0.5, jWing);

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
`,D=[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],O={normal:`一般`,happy:`開心`,curious:`好奇`,angry:`生氣`,scared:`害怕`,dizzy:`暈眩`,sleepy:`昏睡`,hurt:`受傷`},k={front:Math.PI/2,side:Math.PI,back:-Math.PI/2},A={front:`正面`,side:`側面`,back:`背面`};async function j(n,a,o=`v3`){let s=o===`v31`,l=s?`V3.1`:`V3`,y=_(),b=v(n,y),x=new e(b);m(x),x.skipPointerMovePicking=!0;let S=new u(`sky`,new t(.2,1,.3),x);S.intensity=.85,S.groundColor=new r(.6,.68,.6);let C=new ne(`sun`,new t(-.4,-1,-.5).normalize(),x);C.position=new t(4,10,5),C.intensity=.6;let w=ee(C,{...y,shadows:{...y.shadows,mapSize:Math.min(1024,y.shadows.mapSize)}});w.darkness=.4;let T=new g(`PH_labGrass`,x);T.diffuseColor=new r(.55,.82,.45),T.specularColor=new r(.03,.03,.03);let E=c.CreateCylinder(`PH_labGround`,{diameter:9,height:.2,tessellation:48},x);E.position.y=-.1,E.material=T,E.receiveShadows=!0;let j=new h(`labCam`,k.front,1.3,2.6,new t(0,.5,0),x);j.attachControl(n,!0),j.lowerRadiusLimit=1.2,j.upperRadiusLimit=7,j.lowerBetaLimit=.35,j.upperBetaLimit=1.55,j.panningSensibility=0,j.minZ=.05;let M=te(x,j,y),N=s?`bobo_v31_${y.level}.glb`:`bobo_v3_${y.level}.glb`,P=await f.LoadAssetContainerAsync(`./models/`,N,x),F=s?oe(x,P.materials,y.level!==`low`):ae(x,P.materials,y.level!==`low`),I=[],L=(e,t,n)=>{let r=P.instantiateModelsToScene(e=>`${e}_${I.length}`,!1,{doNotInstantiate:!0}),a=new d(`bobo3_${I.length}`,x);for(let e of r.rootNodes)e.parent=a;a.position.set(e,0,t),a.rotation.y=n;let o=a.getChildMeshes(!1),c=e=>{let t=o.find(t=>t.name.startsWith(e));if(!t)throw Error(`V3 模型缺少零件：${e}`);return t},l=c(`Body_`),u=c(`Eyes`),f=c(`Mouth`),p=c(`Blush`),m=c(`Stars`),h=F.body(I.length);l.material=h.material,l.alphaIndex=1,u.material=F.eyes,m.material=F.stars,h.material.needDepthPrePass=!0,p.material=F.blush,p.alphaIndex=2,f.material=F.mouth,f.alphaIndex=3,s&&(u.alphaIndex=2);for(let e of[l,u,m])w.addShadowCaster(e,!1);M.glow?.addIncludedOnlyMesh(m);for(let e of o)e.isPickable=!1,e.receiveShadows=e===l;u.makeGeometryUnique(),f.makeGeometryUnique();let g=Float32Array.from(u.getVerticesData(i.UVKind)??[]),_=Float32Array.from(f.getVerticesData(i.UVKind)??[]);u.setVerticesData(i.UVKind,Float32Array.from(g),!0),f.setVerticesData(i.UVKind,Float32Array.from(_),!0);let v={root:a,body:l,eyes:u,mouth:f,blush:p,stars:m,jelly:h.jelly,eyeUV:g,mouthUV:_};return I.push(v),v};L(0,0,0),M.glow&&(M.glow.customEmissiveColorSelector=(e,t,n,r)=>{if(e.name.startsWith(`Stars`))s?r.set(.42,.32,.06,1):r.set(.75,.45,.05,1);else{let e=n.emissiveColor;e?r.set(e.r,e.g,e.b,1):r.set(0,0,0,1)}});let R=`normal`,z=e=>{R=e;let t=D.indexOf(e),n=t%4,r=Math.floor(t/4);for(let e of I){let t=new Float32Array(e.eyeUV.length);for(let i=0;i<t.length;i+=2)t[i]=e.eyeUV[i]+n*.25,t[i+1]=e.eyeUV[i+1]+r*.5;e.eyes.updateVerticesData(i.UVKind,t);let a=new Float32Array(e.mouthUV.length);for(let t=0;t<a.length;t+=2)a[t]=e.mouthUV[t]+n*.25,a[t+1]=e.mouthUV[t+1]+r*.25;e.mouth.updateVerticesData(i.UVKind,a)}for(let t of H)t.classList.toggle(`active`,t.dataset.expr===e)},B=e=>{for(;I.length<e;){let e=I.length;L(e===1?-1.4:1.4,-.9,e===1?.35:-.35),z(R)}I.forEach((t,n)=>t.root.setEnabled(n<e));for(let t of U)t.classList.toggle(`active`,Number(t.dataset.count)===e)};a.innerHTML=`
    <div class="v3-top">
    <div class="lab-title v3-title" data-layout="lab-title">
      <div class="lab-name">星露啵啵 ${l} <small>模型預覽</small></div>
      <div class="lab-state">畫質：${y.level}・${N}</div>
    </div>
    <div class="lab-views v3-views">
      ${[`front`,`side`,`back`].map(e=>`<button class="lab-view-btn" data-view="${e}" data-layout="btn-view-${e}">${A[e]}</button>`).join(``)}
      <button class="lab-view-btn" data-count="1" data-layout="btn-count-1">1 隻</button>
      <button class="lab-view-btn" data-count="3" data-layout="btn-count-3">3 隻</button>
      <button class="lab-view-btn v3-switch" data-layout="btn-switch">${s?`看 V3`:`看 V3.1`}</button>
    </div>
    <button class="v3-bench lab-bench" data-layout="btn-bench">⏱ 效能測試（10 秒）</button>
    <div class="lab-bench-result v3-bench-result" hidden></div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-panel v3-expr">
      ${D.map(e=>`<button class="lab-btn" data-expr="${e}" data-layout="btn-expr-${e}">${O[e]}</button>`).join(``)}
    </div>`;let V=[...a.querySelectorAll(`[data-view]`)],H=[...a.querySelectorAll(`[data-expr]`)],U=[...a.querySelectorAll(`[data-count]`)],se=a.querySelector(`.lab-fps`),W=a.querySelector(`.lab-bench`),G=a.querySelector(`.lab-bench-result`);a.querySelector(`.v3-switch`).addEventListener(`click`,()=>{let e=new URL(location.href);e.searchParams.set(`lab`,s?`bobo3`:`bobo31`),e.searchParams.delete(`bench`),location.href=e.toString()});let K=k.front,q=!1,J=(e,t=!1)=>{K=k[e],q=t;for(let t of V)t.classList.toggle(`active`,t.dataset.view===e)};for(let e of V)e.addEventListener(`click`,()=>J(e.dataset.view));for(let e of H)e.addEventListener(`click`,()=>z(e.dataset.expr));for(let e of U)e.addEventListener(`click`,()=>B(Number(e.dataset.count)));J(`front`,!0),z(`normal`),B(1);let Y=new p(b,x,y,a),ce=new re(x),X=null,Z=(e=10)=>new Promise(t=>{X||(G.hidden=!0,W.classList.add(`on`),X={rec:new ie(e),resolve:t},W.textContent=`⏱ 測試中…請勿操作`)});W.addEventListener(`click`,()=>void Z(10));let Q=new URLSearchParams(location.search);Q.get(`count`)===`3`&&B(3),Q.get(`bench`)===`1`&&window.setTimeout(()=>void Z(10),3e3);let $=0;b.runRenderLoop(()=>{let e=b.getDeltaTime()/1e3,t=Math.min(e,.1);if(X)j.alpha+=t*Math.PI*2/10;else if(q)j.alpha=K,q=!1;else{let e=K-j.alpha;e=Math.atan2(Math.sin(e),Math.cos(e)),j.alpha+=e*Math.min(1,t*6)}for(let e of I)e.jelly&&e.body.getWorldMatrix().invertToRef(e.jelly.invWorld);if(x.render(),Y.update(t),X&&X.rec.record(e,ce.drawCallsCounter.current)){let e=X.rec.summary(),t=X;X=null,W.classList.remove(`on`),W.textContent=`⏱ 效能測試（10 秒）`,G.hidden=!1;let n=Y.stats(),r=I.filter(e=>e.root.isEnabled()).length;G.innerHTML=`<b>${l} 效能測試（本機 WebGL 實測）</b><br>${N}・${r} 隻・畫質 ${n.quality}・${n.pixelRatio}x・${e.seconds} 秒<br>平均 ${e.avgFps.toFixed(1)} FPS・最慢 1% ${e.low1Fps.toFixed(1)} FPS・最低 ${e.minFps.toFixed(1)} FPS<br>Draw Calls 平均 ${e.avgDrawCalls.toFixed(0)}（最高 ${e.maxDrawCalls}）・畫面物件 ${n.activeMeshes}<br><small>點此關閉</small>`,G.onclick=()=>G.hidden=!0,t.resolve(e)}$+=t,$>.25&&($=0,se.textContent=`${Math.round(b.getFps())} FPS`)}),window.addEventListener(`resize`,()=>b.resize()),window.__bobo3={ready:!0,setView:e=>J(e,!0),setExpression:z,setCount:B,info:()=>{let e=I[0],t=[e.body,e.eyes,e.mouth,e.blush,e.stars].map(e=>({name:e.name,triangles:(e.getTotalIndices()||0)/3,vertices:e.getTotalVertices()}));return{quality:y.level,meshes:t,trianglesTotal:t.reduce((e,t)=>e+t.triangles,0),materials:5}},perf:()=>({...Y.stats(),jelly:!!I[0]?.jelly?.jellyEnabled,variant:o}),benchmark:Z,eyeUV0:()=>{let e=I[0].eyes.getVerticesData(i.UVKind);return[e[0],e[1]]}}}function ae(e,t,n){let i=e=>t.find(t=>t.name===e)?.albedoTexture??null,o=i(`Bobo_Eyes`),s=i(`Bobo_Face`);o instanceof a&&(o.anisotropicFilteringLevel=4);let c=new g(`BoboV3_Eyes`,e);c.diffuseTexture=o,c.diffuseTexture&&(c.diffuseTexture.hasAlpha=!0),c.useAlphaFromDiffuseTexture=!0,c.transparencyMode=1,c.alphaCutOff=.45,c.emissiveColor=new r(.78,.78,.82),c.diffuseColor=new r(.35,.35,.38),c.specularColor=new r(1,1,1),c.specularPower=140;let l=t=>{let n=new g(t,e);return n.diffuseTexture=s,n.diffuseTexture&&(n.diffuseTexture.hasAlpha=!0),n.useAlphaFromDiffuseTexture=!0,n.disableLighting=!0,n.emissiveColor=new r(.95,.95,.95),n.backFaceCulling=!0,n.zOffset=-2,n},u=l(`BoboV3_Mouth`),d=l(`BoboV3_Blush`),f=new g(`BoboV3_Stars`,e);return f.disableLighting=!0,f.emissiveColor=new r(.9,.62,.1),f.backFaceCulling=!1,{eyes:c,mouth:u,blush:d,stars:f,body:t=>{let i=new g(`BoboV3_Body_${t}`,e);i.diffuseColor=new r(.45,.5,.95),i.emissiveColor=new r(.12,.08,.42),i.specularColor=new r(.06,.06,.08),i.specularPower=64,i.alpha=.66,i.useSpecularOverAlpha=!1,i.backFaceCulling=!0;let a=null;if(n){a=new b(i),a.height=1;let e=a;i.onError=()=>{e.jellyEnabled&&=(console.warn(`[bobo3] jelly shader failed, fallback`),!1)}}return{material:i,jelly:a}}}}function oe(e,t,n){let i=e=>t.find(t=>t.name===e)?.albedoTexture??null,o=i(`Bobo_Eyes`),s=i(`Bobo_Face`);o instanceof a&&(o.anisotropicFilteringLevel=4);let c=new g(`BoboV31_Eyes`,e);c.diffuseTexture=o,c.diffuseTexture&&(c.diffuseTexture.hasAlpha=!0),c.useAlphaFromDiffuseTexture=!0,c.transparencyMode=2,c.emissiveColor=new r(.8,.8,.84),c.diffuseColor=new r(.3,.3,.33),c.specularColor=new r(1,1,1),c.specularPower=160,c.zOffset=-1;let l=t=>{let n=new g(t,e);return n.diffuseTexture=s,n.diffuseTexture&&(n.diffuseTexture.hasAlpha=!0),n.useAlphaFromDiffuseTexture=!0,n.disableLighting=!0,n.emissiveColor=new r(.95,.95,.95),n.backFaceCulling=!0,n.zOffset=-2,n},u=l(`BoboV31_Mouth`),d=l(`BoboV31_Blush`),f=new g(`BoboV31_Stars`,e);f.disableLighting=!0,f.emissiveColor=new r(1,.96,.62),f.backFaceCulling=!1;let p=w(e);return{eyes:c,mouth:u,blush:d,stars:f,body:t=>{let i=new g(`BoboV31_Body_${t}`,e);i.diffuseColor=new r(.42,.48,.95),i.emissiveColor=new r(.1,.07,.4),i.specularColor=new r(.04,.04,.05),i.specularPower=64,i.alpha=.64,i.useSpecularOverAlpha=!1,i.backFaceCulling=!0;let a=new C(i,p);return a.height=1,a.nebula=+!!n,i.onError=()=>{a.jellyEnabled&&=(console.warn(`[bobo3] jelly V3.1 shader failed, fallback`),!1)},{material:i,jelly:a}}}}export{j as startBoboV3Lab};