import{n as e}from"./scene.pure-DkB5Fm2r.js";import{o as t,t as n}from"./math.vector.pure-DST8O3ID.js";import{t as r}from"./math.color.pure-DobtDy7H.js";import{r as i}from"./buffer.pure-CGFpq70F.js";import{n as a}from"./texture.pure-C2CI4GQj.js";import{l as o}from"./pbrMaterial.pure-C61IP4Pq.js";import{M as s,N as c,O as l,S as u,a as d,c as f,j as p,k as m,l as h,o as g,s as _,u as v,w as ee,x as te}from"./index-DAiSXRRI.js";function y(e,t){let n=[...e].sort((e,t)=>e-t),r=n.reduce((e,t)=>e+t,0),i=n.length,a=i?n[Math.min(i-1,Math.floor(i*.99))]:0,o=t.length?t.reduce((e,t)=>e+t,0)/t.length:0;return{seconds:Math.round(r*10)/10,frames:i,avgFps:i?i/Math.max(r,1e-6):0,low1Fps:a>0?1/a:0,minFps:i?1/n[i-1]:0,avgDrawCalls:o,maxDrawCalls:t.length?Math.max(...t):0}}var b=class{warmup;target;elapsed=0;dts=[];draws=[];constructor(e,t=.5){this.target=e,this.warmup=t}get progress(){return Math.min(1,this.elapsed/(this.target+this.warmup))}record(e,t){return this.elapsed+=e,this.elapsed>this.warmup&&(this.dts.push(e),this.draws.push(t)),this.elapsed>=this.target+this.warmup}summary(){return y(this.dts,this.draws)}},x=class extends o{rim=new r(.58,.52,1);deep=new r(.2,.2,.78);top=new r(.42,.8,1);nebulaA=new r(.25,.85,1);nebulaB=new r(.55,.45,1);skyLow=new r(.95,.88,.98);skyHigh=new r(.55,.78,1);height=.8;strength=1;invWorld=n.Identity();nebula=1;enabled=!1;constructor(e){super(e,`JellyV3Plugin`,200,{JELLY3:!1}),this._enable(!0),this.enabled=!0}get jellyEnabled(){return this.enabled}set jellyEnabled(e){this.enabled!==e&&(this.enabled=e,this.markAllDefinesAsDirty())}getClassName(){return`JellyV3Plugin`}prepareDefines(e,t,n){e.JELLY3=this.enabled}getUniforms(){return{ubo:[{name:`j3Rim`,size:3,type:`vec3`},{name:`j3Deep`,size:3,type:`vec3`},{name:`j3Top`,size:3,type:`vec3`},{name:`j3NebA`,size:3,type:`vec3`},{name:`j3NebB`,size:3,type:`vec3`},{name:`j3SkyLow`,size:3,type:`vec3`},{name:`j3SkyHigh`,size:3,type:`vec3`},{name:`j3Params`,size:4,type:`vec4`},{name:`j3InvWorld`,size:16,type:`mat4`}],fragment:`#ifdef JELLY3
uniform vec3 j3Rim;
uniform vec3 j3Deep;
uniform vec3 j3Top;
uniform vec3 j3NebA;
uniform vec3 j3NebB;
uniform vec3 j3SkyLow;
uniform vec3 j3SkyHigh;
uniform vec4 j3Params;
uniform mat4 j3InvWorld;
#endif`}}bindForSubMesh(e,t,n,r){this.enabled&&(e.updateColor3(`j3Rim`,this.rim),e.updateColor3(`j3Deep`,this.deep),e.updateColor3(`j3Top`,this.top),e.updateColor3(`j3NebA`,this.nebulaA),e.updateColor3(`j3NebB`,this.nebulaB),e.updateColor3(`j3SkyLow`,this.skyLow),e.updateColor3(`j3SkyHigh`,this.skyHigh),e.updateFloat4(`j3Params`,this.height,this.strength,this.nebula,2.4),e.updateMatrix(`j3InvWorld`,this.invWorld))}getCustomCode(e){return e===`fragment`?{CUSTOM_FRAGMENT_DEFINITIONS:S,CUSTOM_FRAGMENT_BEFORE_FOG:C}:null}},S=`
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
`,C=`
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
  color.rgb = mix(color.rgb, color.rgb * 0.5 + body * 0.6, jS * (0.3 + 0.35 * (1.0 - jNdV)));

  if (j3Params.z > 0.5) {
    // 沿折射後視線往內取兩個深度（視差 → 內部深度）
    vec3 rdW = refract(-jV, jN, 0.75);
    vec3 rd = normalize((j3InvWorld * vec4(rdW, 0.0)).xyz);
    vec3 p1 = lp + rd * 0.12;
    vec3 p2 = lp + rd * 0.34;
    float low1 = 1.0 - smoothstep(0.15, 0.75, p1.y);
    float low2 = 1.0 - smoothstep(0.1, 0.7, p2.y);
    float n1 = smoothstep(0.42, 0.85, j3Fbm(p1 * 3.2 + vec3(0.0, 1.3, 0.0)));
    float n2 = smoothstep(0.38, 0.8, j3Fbm(p2 * 2.3 + vec3(4.1, 0.0, 2.2)));
    vec3 neb = j3NebA * n1 * (0.35 + 0.65 * low1) * 0.65 + j3NebB * n2 * (0.3 + 0.7 * low2) * 0.55;
    float st = j3Stars(p1, 9.0) * 0.9 + j3Stars(p2 + 3.3, 6.0) * 0.6;
    // 底部光池（設定圖：底部中央青色發亮）
    float pool = smoothstep(0.45, 0.0, length(p2.xz)) * (1.0 - smoothstep(0.0, 0.35, p2.y));
    vec3 inner = neb + vec3(0.85, 0.95, 1.0) * st + j3NebA * pool * 0.55;
    // 正面看進去最多、邊緣少（邊緣是表面反光）
    color.rgb += inner * 1.6 * jS * (0.35 + 0.65 * jNdV);
    color.a = clamp(color.a + (st * 0.35 + n1 * 0.12) * jS * jNdV, 0.0, 1.0);
  }

  // 天空反射＋藍紫邊緣光
  vec3 jR = reflect(-jV, jN);
  color.rgb += mix(j3SkyLow, j3SkyHigh, clamp(jR.y * 0.5 + 0.5, 0.0, 1.0)) * jFres * 0.22 * jS;
  color.rgb += j3Rim * jFres * 0.8 * jS;
  color.a = clamp(color.a + jFres * 0.32 * jS, 0.0, 1.0);

  // 日系硬邊高光：正面看左上大、右上小（世界方向）
  vec3 jL1 = normalize(vec3(0.5, 0.85, 0.35));
  vec3 jL2 = normalize(vec3(-0.6, 0.65, 0.45));
  float jHL = smoothstep(0.9915, 0.995, dot(jN, normalize(jL1 + jV))) * 0.85 + smoothstep(0.9975, 0.9988, dot(jN, normalize(jL2 + jV))) * 0.6;
  color.rgb = mix(color.rgb, vec3(1.0), clamp(jHL * jS, 0.0, 1.0));
  color.a = max(color.a, jHL * 0.9 * jS);
}
#endif
`,w=[`normal`,`happy`,`curious`,`angry`,`scared`,`dizzy`,`sleepy`,`hurt`],T={normal:`一般`,happy:`開心`,curious:`好奇`,angry:`生氣`,scared:`害怕`,dizzy:`暈眩`,sleepy:`昏睡`,hurt:`受傷`},E={front:Math.PI/2,side:Math.PI,back:-Math.PI/2},ne={front:`正面`,side:`側面`,back:`背面`};async function D(n,a){let o=h(),y=g(n,o),x=new e(y);f(x),x.skipPointerMovePicking=!0;let S=new l(`sky`,new t(.2,1,.3),x);S.intensity=.85,S.groundColor=new r(.6,.68,.6);let C=new ee(`sun`,new t(-.4,-1,-.5).normalize(),x);C.position=new t(4,10,5),C.intensity=.6;let D=_(C,{...o,shadows:{...o.shadows,mapSize:Math.min(1024,o.shadows.mapSize)}});D.darkness=.4;let k=new m(`PH_labGrass`,x);k.diffuseColor=new r(.55,.82,.45),k.specularColor=new r(.03,.03,.03);let A=s.CreateCylinder(`PH_labGround`,{diameter:9,height:.2,tessellation:48},x);A.position.y=-.1,A.material=k,A.receiveShadows=!0;let j=new p(`labCam`,E.front,1.3,2.6,new t(0,.5,0),x);j.attachControl(n,!0),j.lowerRadiusLimit=1.2,j.upperRadiusLimit=7,j.lowerBetaLimit=.35,j.upperBetaLimit=1.55,j.panningSensibility=0,j.minZ=.05;let M=v(x,j,o),N=`bobo_v3_${o.level}.glb`,P=await u.LoadAssetContainerAsync(`./models/`,N,x),F=O(x,P.materials,o.level!==`low`),I=[],L=(e,t,n)=>{let r=P.instantiateModelsToScene(e=>`${e}_${I.length}`,!1,{doNotInstantiate:!0}),a=new c(`bobo3_${I.length}`,x);for(let e of r.rootNodes)e.parent=a;a.position.set(e,0,t),a.rotation.y=n;let o=a.getChildMeshes(!1),s=e=>{let t=o.find(t=>t.name.startsWith(e));if(!t)throw Error(`V3 模型缺少零件：${e}`);return t},l=s(`Body_`),u=s(`Eyes`),d=s(`Mouth`),f=s(`Blush`),p=s(`Stars`),m=F.body(I.length);l.material=m.material,l.alphaIndex=1,u.material=F.eyes,p.material=F.stars,f.material=F.blush,f.alphaIndex=2,d.material=F.mouth,d.alphaIndex=3;for(let e of[l,u,p])D.addShadowCaster(e,!1);M.glow?.addIncludedOnlyMesh(p);for(let e of o)e.isPickable=!1,e.receiveShadows=e===l;let h=Float32Array.from(u.getVerticesData(i.UVKind)??[]),g=Float32Array.from(d.getVerticesData(i.UVKind)??[]),_={root:a,body:l,eyes:u,mouth:d,blush:f,stars:p,jelly:m.jelly,eyeUV:h,mouthUV:g};return I.push(_),_};L(0,0,0),M.glow&&(M.glow.customEmissiveColorSelector=(e,t,n,r)=>{if(e.name.startsWith(`Stars`))r.set(.9,.62,.14,1);else{let e=n.emissiveColor;e?r.set(e.r,e.g,e.b,1):r.set(0,0,0,1)}});let R=`normal`,z=e=>{R=e;let t=w.indexOf(e),n=t%4,r=Math.floor(t/4);for(let e of I){let t=new Float32Array(e.eyeUV.length);for(let i=0;i<t.length;i+=2)t[i]=e.eyeUV[i]+n*.25,t[i+1]=e.eyeUV[i+1]+r*.5;e.eyes.updateVerticesData(i.UVKind,t);let a=new Float32Array(e.mouthUV.length);for(let t=0;t<a.length;t+=2)a[t]=e.mouthUV[t]+n*.25,a[t+1]=e.mouthUV[t+1]+r*.25;e.mouth.updateVerticesData(i.UVKind,a)}for(let t of H)t.classList.toggle(`active`,t.dataset.expr===e)},B=e=>{for(;I.length<e;){let e=I.length;L(e===1?-1.4:1.4,-.9,e===1?.35:-.35),z(R)}I.forEach((t,n)=>t.root.setEnabled(n<e));for(let t of U)t.classList.toggle(`active`,Number(t.dataset.count)===e)};a.innerHTML=`
    <div class="lab-title" data-layout="lab-title">
      <div class="lab-name">星露啵啵 V3 <small>模型預覽（第一版，程式化建模）</small></div>
      <div class="lab-state">畫質：${o.level}・${N}</div>
    </div>
    <div class="lab-fps" data-layout="lab-fps">-- FPS</div>
    <div class="lab-views">
      ${[`front`,`side`,`back`].map(e=>`<button class="lab-view-btn" data-view="${e}" data-layout="btn-view-${e}">${ne[e]}</button>`).join(``)}
      <button class="lab-view-btn" data-count="1" data-layout="btn-count-1">1 隻</button>
      <button class="lab-view-btn" data-count="3" data-layout="btn-count-3">3 隻</button>
      <button class="lab-view-btn lab-bench" data-layout="btn-bench">效能測試</button>
    </div>
    <div class="lab-bench-result" hidden></div>
    <div class="lab-panel v3-expr">
      ${w.map(e=>`<button class="lab-btn" data-expr="${e}" data-layout="btn-expr-${e}">${T[e]}</button>`).join(``)}
    </div>`;let V=[...a.querySelectorAll(`[data-view]`)],H=[...a.querySelectorAll(`[data-expr]`)],U=[...a.querySelectorAll(`[data-count]`)],W=a.querySelector(`.lab-fps`),G=a.querySelector(`.lab-bench`),K=a.querySelector(`.lab-bench-result`),q=E.front,J=!1,Y=(e,t=!1)=>{q=E[e],J=t;for(let t of V)t.classList.toggle(`active`,t.dataset.view===e)};for(let e of V)e.addEventListener(`click`,()=>Y(e.dataset.view));for(let e of H)e.addEventListener(`click`,()=>z(e.dataset.expr));for(let e of U)e.addEventListener(`click`,()=>B(Number(e.dataset.count)));Y(`front`,!0),z(`normal`),B(1);let X=new d(y,x,o,a),re=new te(x),Z=null,Q=(e=10)=>new Promise(t=>{Z||=(K.hidden=!0,G.classList.add(`on`),{rec:new b(e),resolve:t})});G.addEventListener(`click`,()=>void Q(10));let $=0;y.runRenderLoop(()=>{let e=y.getDeltaTime()/1e3,t=Math.min(e,.1);if(Z)j.alpha+=t*Math.PI*2/10;else if(J)j.alpha=q,J=!1;else{let e=q-j.alpha;e=Math.atan2(Math.sin(e),Math.cos(e)),j.alpha+=e*Math.min(1,t*6)}for(let e of I)e.jelly&&e.body.getWorldMatrix().invertToRef(e.jelly.invWorld);if(x.render(),X.update(t),Z&&Z.rec.record(e,re.drawCallsCounter.current)){let e=Z.rec.summary(),t=Z;Z=null,G.classList.remove(`on`),K.hidden=!1;let n=X.stats();K.innerHTML=`<b>V3 效能測試（本機實測）</b><br>${e.seconds} 秒・${I.filter(e=>e.root.isEnabled()).length} 隻・畫質 ${n.quality}・${n.pixelRatio}x<br>平均 ${e.avgFps.toFixed(1)} FPS・最慢 1% ${e.low1Fps.toFixed(1)}・最低 ${e.minFps.toFixed(1)}<br>Draw Calls 平均 ${e.avgDrawCalls.toFixed(0)}（最高 ${e.maxDrawCalls}）<br><small>點此關閉</small>`,K.onclick=()=>K.hidden=!0,t.resolve(e)}$+=t,$>.25&&($=0,W.textContent=`${Math.round(y.getFps())} FPS`)}),window.addEventListener(`resize`,()=>y.resize()),window.__bobo3={ready:!0,setView:e=>Y(e,!0),setExpression:z,setCount:B,info:()=>{let e=I[0],t=[e.body,e.eyes,e.mouth,e.blush,e.stars].map(e=>({name:e.name,triangles:(e.getTotalIndices()||0)/3,vertices:e.getTotalVertices()}));return{quality:o.level,meshes:t,trianglesTotal:t.reduce((e,t)=>e+t.triangles,0),materials:5}},perf:()=>({...X.stats(),jelly:!!I[0]?.jelly?.jellyEnabled}),benchmark:Q}}function O(e,t,n){let i=e=>t.find(t=>t.name===e)?.albedoTexture??null,o=i(`Bobo_Eyes`),s=i(`Bobo_Face`);o instanceof a&&(o.anisotropicFilteringLevel=4);let c=new m(`BoboV3_Eyes`,e);c.diffuseTexture=o,c.diffuseTexture&&(c.diffuseTexture.hasAlpha=!0),c.useAlphaFromDiffuseTexture=!0,c.transparencyMode=1,c.alphaCutOff=.45,c.emissiveColor=new r(.55,.55,.6),c.specularColor=new r(.9,.9,1),c.specularPower=90;let l=t=>{let n=new m(t,e);return n.diffuseTexture=s,n.diffuseTexture&&(n.diffuseTexture.hasAlpha=!0),n.useAlphaFromDiffuseTexture=!0,n.disableLighting=!0,n.emissiveColor=new r(.95,.95,.95),n.backFaceCulling=!0,n.zOffset=-2,n},u=l(`BoboV3_Mouth`),d=l(`BoboV3_Blush`),f=new m(`BoboV3_Stars`,e);return f.disableLighting=!0,f.emissiveColor=r.White(),{eyes:c,mouth:u,blush:d,stars:f,body:t=>{let i=new m(`BoboV3_Body_${t}`,e);i.diffuseColor=new r(.72,.78,1),i.emissiveColor=new r(.1,.09,.36),i.specularColor=new r(.25,.25,.3),i.specularPower=32,i.alpha=.58,i.useSpecularOverAlpha=!1,i.backFaceCulling=!0;let a=null;if(n){a=new x(i),a.height=1;let e=a;i.onError=()=>{e.jellyEnabled&&=(console.warn(`[bobo3] jelly shader failed, fallback`),!1)}}return{material:i,jelly:a}}}}export{D as startBoboV3Lab};