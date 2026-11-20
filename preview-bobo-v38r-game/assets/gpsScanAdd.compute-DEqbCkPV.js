import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./gaussianPointSplattingScan-COj6jNKT.js";var r=e({gpsScanAddComputeShaderWGSL:()=>s}),i=`gpsScanAddComputeShader`,a=`#include<gaussianPointSplattingScan>
@group(0) @binding(0) var<storage,read_write> cdf : array<u32>;@group(0) @binding(1) var<storage,read> blockSums : array<u32>;@compute @workgroup_size(256,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {let i=gid.y*65535u*256u+gid.x;if (i>=arrayLength(&cdf)) {return;}
cdf[i]=gpsSaturatingAdd(cdf[i],blockSums[i/512u]);}
`;t.ShadersStoreWGSL[i]||(t.ShadersStoreWGSL[i]=a);var o=[n];for(let e of o)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var s={name:i,shader:a};export{r as t};