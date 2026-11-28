import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./bonesDeclaration-BdmZbx_Q.js";import{t as r}from"./bakedVertexAnimationDeclaration-C-g0vyVW.js";import{t as i}from"./morphTargetsVertexGlobalDeclaration-8M-VPQXn.js";import{t as a}from"./morphTargetsVertexDeclaration-Cq9uV77z.js";import{t as o}from"./instancesDeclaration-DsiFqYXH.js";import{t as s}from"./morphTargetsVertexGlobal-CuP18y1L.js";import{t as c}from"./morphTargetsVertex-D8goMcQ4.js";import{t as l}from"./instancesVertex-Dty6qjVO.js";import{t as u}from"./bonesVertex-CHtNxAAS.js";import{t as d}from"./bakedVertexAnimation-CP3BNGXM.js";var f=e({volumetricLightScatteringPassVertexShaderWGSL:()=>g}),p=`volumetricLightScatteringPassVertexShader`,m=`attribute position: vec3f;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;uniform depthValues: vec2f;
#if defined(ALPHATEST) || defined(NEED_UV)
varying vUV: vec2f;uniform diffuseMatrix: mat4x4f;
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif
#endif
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input: VertexInputs)->FragmentInputs {var positionUpdated: vec3f=vertexInputs.position;
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV1)
var uvUpdated: vec2f=vertexInputs.uv;
#endif
#if (defined(ALPHATEST) || defined(NEED_UV)) && defined(UV2)
var uv2Updated: vec2f=vertexInputs.uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vertexOutputs.position=uniforms.viewProjection*finalWorld*vec4f(positionUpdated,1.0);
#if defined(ALPHATEST) || defined(NEED_UV)
#ifdef UV1
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uvUpdated,1.0,0.0)).xy;
#endif
#ifdef UV2
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uv2Updated,1.0,0.0)).xy;
#endif
#endif
}
`;t.ShadersStoreWGSL[p]||(t.ShadersStoreWGSL[p]=m);var h=[n,r,i,a,o,s,c,l,u,d];for(let e of h)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var g={name:p,shader:m};export{f as t};