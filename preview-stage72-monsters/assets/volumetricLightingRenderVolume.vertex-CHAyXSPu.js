import{cn as e,ln as t,sn as n,un as r,zr as i}from"./index-DTjdb8fG.js";var a=`volumetricLightingRenderVolumeVertexShader`,o=`#include<__decl__sceneVertex>
#include<__decl__meshVertex>
attribute vec3 position;varying vec4 vWorldPos;void main(void) {vec4 worldPos=world*vec4(position,1.0);vWorldPos=worldPos;gl_Position=viewProjection*worldPos;}
`;i.ShadersStore[a]||(i.ShadersStore[a]=o);var s=[r,e,t,n];for(let e of s)i.IncludesShadersStore[e.name]||(i.IncludesShadersStore[e.name]=e.shader);var c={name:a,shader:o};export{c as volumetricLightingRenderVolumeVertexShader};