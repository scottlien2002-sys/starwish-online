import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./clipPlaneFragmentDeclaration-ByWuc2u-.js";import{t as r}from"./logDepthDeclaration-FIwYr9tC.js";import{t as i}from"./clipPlaneFragment-CIXWtyW3.js";import{t as a}from"./logDepthFragment-CxtJswLx.js";var o=e({outlinePixelShaderWGSL:()=>u}),s=`outlinePixelShader`,c=`uniform color: vec4f;
#ifdef ALPHATEST
varying vUV: vec2f;var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;
#endif
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#ifdef ALPHATEST
if (textureSample(diffuseSampler,diffuseSamplerSampler,fragmentInputs.vUV).a<0.4) {discard;}
#endif
#include<logDepthFragment>
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;t.ShadersStoreWGSL[s]||(t.ShadersStoreWGSL[s]=c);var l=[n,r,i,a];for(let e of l)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var u={name:s,shader:c};export{o as t};