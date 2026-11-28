import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./bonesDeclaration-DgqiHYKb.js";import{n as r,t as i}from"./bakedVertexAnimation-7XIMgH6x.js";import{t as a}from"./morphTargetsVertexGlobalDeclaration-CeqvJie-.js";import{t as o}from"./morphTargetsVertexDeclaration-suI816Mw.js";import{t as s}from"./clipPlaneVertexDeclaration-D9Qgwi6C.js";import{t as c}from"./instancesDeclaration-CJBvtBV5.js";import{t as l}from"./logDepthDeclaration-B6X-ewZJ.js";import{t as u}from"./morphTargetsVertexGlobal-DEfULAhx.js";import{t as d}from"./morphTargetsVertex-BjPxL5wc.js";import{t as f}from"./instancesVertex-C-FoRQR1.js";import{t as p}from"./bonesVertex-BfTgeOaV.js";import{t as m}from"./clipPlaneVertex-Baq94Hyt.js";import{t as h}from"./logDepthVertex-D5IUM6qd.js";var g=e({outlineVertexShader:()=>b}),_=`outlineVertexShader`,v=`attribute vec3 position;attribute vec3 normal;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
uniform float offset;
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef ALPHATEST
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;vec3 normalUpdated=normal;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
vec3 offsetPosition=positionUpdated+(normalUpdated*offset);
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(offsetPosition,1.0);gl_Position=viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
}
`;t.ShadersStore[_]||(t.ShadersStore[_]=v);var y=[n,r,a,o,s,c,l,u,d,f,p,i,m,h];for(let e of y)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var b={name:_,shader:v};export{g as t};