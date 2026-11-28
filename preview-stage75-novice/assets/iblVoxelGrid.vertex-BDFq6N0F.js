import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./bonesDeclaration-DgqiHYKb.js";import{n as r,t as i}from"./bakedVertexAnimation-7XIMgH6x.js";import{t as a}from"./instancesDeclaration-CJBvtBV5.js";import{t as o}from"./morphTargetsVertexGlobalDeclaration-CeqvJie-.js";import{t as s}from"./morphTargetsVertexDeclaration-suI816Mw.js";import{t as c}from"./morphTargetsVertexGlobal-DEfULAhx.js";import{t as l}from"./morphTargetsVertex-BjPxL5wc.js";import{t as u}from"./instancesVertex-C-FoRQR1.js";import{t as d}from"./bonesVertex-BfTgeOaV.js";var f=e({iblVoxelGridVertexShader:()=>g}),p=`iblVoxelGridVertexShader`,m=`attribute vec3 position;varying vec3 vNormalizedPosition;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
uniform mat4 invWorldScale;uniform mat4 viewMatrix;void main(void) {vec3 positionUpdated=position;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);gl_Position=viewMatrix*invWorldScale*worldPos;vNormalizedPosition.xyz=gl_Position.xyz*0.5+0.5;
#ifdef IS_NDC_HALF_ZRANGE
gl_Position.z=gl_Position.z*0.5+0.5;
#endif
}`;t.ShadersStore[p]||(t.ShadersStore[p]=m);var h=[n,r,a,o,s,c,l,u,d,i];for(let e of h)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var g={name:p,shader:m};export{f as t};