import{$t as e,Ar as t,Qt as n,Xt as r,Zt as i}from"./index-BphduvgN.js";var a=`volumetricLightingRenderVolumeVertexShader`,o=`#include<__decl__sceneVertex>
#include<__decl__meshVertex>
attribute vec3 position;varying vec4 vWorldPos;void main(void) {vec4 worldPos=world*vec4(position,1.0);vWorldPos=worldPos;gl_Position=viewProjection*worldPos;}
`;t.ShadersStore[a]||(t.ShadersStore[a]=o);var s=[e,i,n,r];for(let e of s)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var c={name:a,shader:o};export{c as volumetricLightingRenderVolumeVertexShader};