import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./clipPlaneFragmentDeclaration-BqmL15wC.js";import{t as r}from"./fogFragmentDeclaration-Ch2spL9C.js";import{t as i}from"./clipPlaneFragment-I2VjlD2M.js";import{t as a}from"./fogFragment-CKCGTcJi.js";var o=e({colorPixelShader:()=>u}),s=`colorPixelShader`,c=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
#define VERTEXCOLOR
varying vec4 vColor;
#else
uniform vec4 color;
#endif
#include<clipPlaneFragmentDeclaration>
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
gl_FragColor=vColor;
#else
gl_FragColor=color;
#endif
#include<fogFragment>(color,gl_FragColor)
#define CUSTOM_FRAGMENT_MAIN_END
}`;t.ShadersStore[s]||(t.ShadersStore[s]=c);var l=[n,r,i,a];for(let e of l)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var u={name:s,shader:c};export{o as t};