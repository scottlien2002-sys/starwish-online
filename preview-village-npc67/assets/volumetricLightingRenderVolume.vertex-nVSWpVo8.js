import{Dn as e,Dr as t,On as n}from"./index-7oFmyTDv.js";var r=`volumetricLightingRenderVolumeVertexShader`,i=`#include<sceneUboDeclaration>
#include<meshUboDeclaration>
attribute position : vec3f;varying vWorldPos: vec4f;@vertex
fn main(input : VertexInputs)->FragmentInputs {let worldPos=mesh.world*vec4f(vertexInputs.position,1.0);vertexOutputs.vWorldPos=worldPos;vertexOutputs.position=scene.viewProjection*worldPos;}
`;t.ShadersStoreWGSL[r]||(t.ShadersStoreWGSL[r]=i);var a=[e,n];for(let e of a)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var o={name:r,shader:i};export{o as volumetricLightingRenderVolumeVertexShaderWGSL};