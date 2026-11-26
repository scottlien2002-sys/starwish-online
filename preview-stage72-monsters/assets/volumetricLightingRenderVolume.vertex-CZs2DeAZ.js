import{Bn as e,zn as t,zr as n}from"./index-DTjdb8fG.js";var r=`volumetricLightingRenderVolumeVertexShader`,i=`#include<sceneUboDeclaration>
#include<meshUboDeclaration>
attribute position : vec3f;varying vWorldPos: vec4f;@vertex
fn main(input : VertexInputs)->FragmentInputs {let worldPos=mesh.world*vec4f(vertexInputs.position,1.0);vertexOutputs.vWorldPos=worldPos;vertexOutputs.position=scene.viewProjection*worldPos;}
`;n.ShadersStoreWGSL[r]||(n.ShadersStoreWGSL[r]=i);var a=[t,e];for(let e of a)n.IncludesShadersStoreWGSL[e.name]||(n.IncludesShadersStoreWGSL[e.name]=e.shader);var o={name:r,shader:i};export{o as volumetricLightingRenderVolumeVertexShaderWGSL};