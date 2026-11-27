import{Jr as e,_n as t,gn as n,hn as r,vn as i}from"./index-DwFSVGW0.js";var a=`volumetricLightingRenderVolumeVertexShader`,o=`#include<__decl__sceneVertex>
#include<__decl__meshVertex>
attribute vec3 position;varying vec4 vWorldPos;void main(void) {vec4 worldPos=world*vec4(position,1.0);vWorldPos=worldPos;gl_Position=viewProjection*worldPos;}
`;e.ShadersStore[a]||(e.ShadersStore[a]=o);var s=[i,n,t,r];for(let t of s)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var c={name:a,shader:o};export{c as volumetricLightingRenderVolumeVertexShader};