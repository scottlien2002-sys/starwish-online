import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";var n=e({morphTargetsVertexGlobalWGSL:()=>a}),r=`morphTargetsVertexGlobal`,i=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
var vertexID : f32;
#endif
#endif
`;t.IncludesShadersStoreWGSL[r]||(t.IncludesShadersStoreWGSL[r]=i);var a={name:r,shader:i};export{n,a as t};