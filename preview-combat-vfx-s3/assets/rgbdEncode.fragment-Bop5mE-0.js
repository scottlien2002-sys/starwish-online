import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./helperFunctions-Bfi4hglZ.js";var r=e({rgbdEncodePixelShader:()=>s}),i=`rgbdEncodePixelShader`,a=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=toRGBD(texture2D(textureSampler,vUV).rgb);}`;t.ShadersStore[i]||(t.ShadersStore[i]=a);var o=[n];for(let e of o)t.IncludesShadersStore[e.name]||(t.IncludesShadersStore[e.name]=e.shader);var s={name:i,shader:a};export{r as t};