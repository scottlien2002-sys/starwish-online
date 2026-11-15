import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./helperFunctions-CPZVryR8.js";var r=e({lodPixelShaderWGSL:()=>s}),i=`lodPixelShader`,a=`#ifndef USE_EXACT_SRGB_CONVERSIONS
#define USE_EXACT_SRGB_CONVERSIONS
#endif
#include<helperFunctions>
varying vUV: vec2f;var textureSampler: texture_2d<f32>;uniform lod: f32;uniform gamma: i32; 
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {let textureSize=textureDimensions(textureSampler);fragmentOutputs.color=textureLoad(textureSampler,vec2u(fragmentInputs.vUV*vec2f(textureSize)),u32(uniforms.lod));if (uniforms.gamma==0) {fragmentOutputs.color=vec4f(pow(fragmentOutputs.color.rgb,vec3f(GammaEncodePowerApprox)),fragmentOutputs.color.a);} else if (uniforms.gamma==2) {fragmentOutputs.color=vec4f(toGammaSpaceExact(fragmentOutputs.color.rgb),fragmentOutputs.color.a);}}
`;t.ShadersStoreWGSL[i]||(t.ShadersStoreWGSL[i]=a);var o=[n];for(let e of o)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var s={name:i,shader:a};export{r as t};