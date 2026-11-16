import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./clipPlaneFragmentDeclaration-DwyXN3A8.js";import{t as r}from"./logDepthDeclaration-DcRZd9JE.js";import{t as i}from"./logDepthFragment-C5lxT4l1.js";import{t as a}from"./clipPlaneFragment-CiHPIb-X.js";var o=e({linePixelShader:()=>u}),s=`linePixelShader`,c=`#include<clipPlaneFragmentDeclaration>
uniform vec4 color;
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;t.ShadersStore[s]||(t.ShadersStore[s]=c);var l=[n,r,i,a];for(let e of l)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var u={name:s,shader:c};export{o as t};