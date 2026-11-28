import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import"./logDepthFragment-CxtJswLx.js";import"./fogFragment-C9E3EVJj.js";var n=e({gaussianSplattingFragmentDeclarationWGSL:()=>a}),r=`gaussianSplattingFragmentDeclaration`,i=`fn gaussianColor(inColor: vec4f,inPosition: vec2f)->vec4f
{var A : f32=-dot(inPosition,inPosition);if (A>-4.0)
{var B: f32=exp(A)*inColor.a;
#include<logDepthFragment>
var color: vec4f=vec4f(inColor.rgb,B);
#ifdef FOG
#include<fogFragment>
#endif
return color;} else {return vec4f(0.0);}}
`;t.IncludesShadersStoreWGSL[r]||(t.IncludesShadersStoreWGSL[r]=i);var a={name:r,shader:i};export{n,a as t};