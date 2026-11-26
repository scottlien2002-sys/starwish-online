import{Er as e,Qt as t,Xt as n,Yt as r,Zt as i}from"./index-D-AyVEhs.js";var a=`volumetricLightingRenderVolumeVertexShader`,o=`#include<__decl__sceneVertex>
#include<__decl__meshVertex>
attribute vec3 position;varying vec4 vWorldPos;void main(void) {vec4 worldPos=world*vec4(position,1.0);vWorldPos=worldPos;gl_Position=viewProjection*worldPos;}
`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[t,n,i,r];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as volumetricLightingRenderVolumeVertexShader};