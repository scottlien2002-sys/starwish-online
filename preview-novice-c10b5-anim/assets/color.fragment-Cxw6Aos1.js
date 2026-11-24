import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./clipPlaneFragmentDeclaration-DwyXN3A8.js";import{t as r}from"./fogFragmentDeclaration-DCUwnHxF.js";import{t as i}from"./clipPlaneFragment-CiHPIb-X.js";import{t as a}from"./fogFragment-CKCGTcJi.js";var o=e({colorPixelShader:()=>u}),s=`colorPixelShader`,c=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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