import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./bonesDeclaration-BdmZbx_Q.js";import{t as r}from"./bakedVertexAnimationDeclaration-C-g0vyVW.js";import{t as i}from"./clipPlaneVertexDeclaration-CELFDRsk.js";import{t as a}from"./fogVertexDeclaration-CiHbVcSR.js";import{t as o}from"./instancesDeclaration-DsiFqYXH.js";import{t as s}from"./instancesVertex-Dty6qjVO.js";import{t as c}from"./bonesVertex-CHtNxAAS.js";import{t as l}from"./bakedVertexAnimation-CP3BNGXM.js";import{t as u}from"./clipPlaneVertex-BKW5dA2c.js";import{t as d}from"./fogVertex-D0bmc4KF.js";import{t as f}from"./vertexColorMixing-UCrnwszu.js";var p=e({colorVertexShaderWGSL:()=>_}),m=`colorVertexShader`,h=`attribute position: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform view: mat4x4f;
#endif
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vColor: vec4f;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
var colorUpdated: vec4f=vertexInputs.color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;t.ShadersStoreWGSL[m]||(t.ShadersStoreWGSL[m]=h);var g=[n,r,i,a,o,s,c,l,u,d,f];for(let e of g)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var _={name:m,shader:h};export{p as t};