import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./clipPlaneFragmentDeclaration-ByWuc2u-.js";import{t as r}from"./logDepthDeclaration-FIwYr9tC.js";import{t as i}from"./logDepthFragment-CxtJswLx.js";import{t as a}from"./clipPlaneFragment-CIXWtyW3.js";var o=e({linePixelShaderWGSL:()=>u}),s=`linePixelShader`,c=`#include<clipPlaneFragmentDeclaration>
uniform color: vec4f;
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;t.ShadersStoreWGSL[s]||(t.ShadersStoreWGSL[s]=c);var l=[n,r,i,a];for(let e of l)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var u={name:s,shader:c};export{o as t};