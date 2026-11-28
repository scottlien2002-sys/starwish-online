import{t as e}from"./rolldown-runtime-P3Pd_6ND.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./gaussianPointSplattingScan-COj6jNKT.js";var r=e({gpsScanSumsComputeShaderWGSL:()=>s}),i=`gpsScanSumsComputeShader`,a=`#include<gaussianPointSplattingScan>
@group(0) @binding(0) var<storage,read_write> blockSums : array<u32>;@group(0) @binding(1) var<storage,read_write> pointCount : array<u32>;@group(0) @binding(2) var<storage,read_write> indirectArgs : array<u32>;var<workgroup> wgCarry : u32;var<workgroup> wgChunkTotal : u32;@compute @workgroup_size(256,1,1)
fn main(@builtin(local_invocation_id) lid : vec3u) {let t=lid.x;let n=arrayLength(&blockSums);if (t==0u) {wgCarry=0u;}
workgroupBarrier();var chunk=0u;loop {if (chunk>=n) {break;}
let i0=chunk+2u*t;let i1=chunk+2u*t+1u;gpsScanTemp[2u*t]=select(0u,blockSums[i0],i0<n);gpsScanTemp[2u*t+1u]=select(0u,blockSums[i1],i1<n);let total=gpsScanExclusive512(t);if (t==0u) {wgChunkTotal=total;}
workgroupBarrier();if (i0<n) {blockSums[i0]=gpsSaturatingAdd(gpsScanTemp[2u*t],wgCarry);}
if (i1<n) {blockSums[i1]=gpsSaturatingAdd(gpsScanTemp[2u*t+1u],wgCarry);}
workgroupBarrier();if (t==0u) {wgCarry=gpsSaturatingAdd(wgCarry,wgChunkTotal);}
workgroupBarrier();chunk=chunk+512u;}
if (t==0u) {let totalGroups=wgCarry/256u+select(0u,1u,(wgCarry % 256u) != 0u);let gx=min(totalGroups,65535u);let gy=totalGroups/65535u+select(0u,1u,(totalGroups % 65535u) != 0u);pointCount[0]=wgCarry; 
pointCount[1]=totalGroups; 
indirectArgs[0]=gx;indirectArgs[1]=gy;indirectArgs[2]=1u;}}
`;t.ShadersStoreWGSL[i]||(t.ShadersStoreWGSL[i]=a);var o=[n];for(let e of o)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var s={name:i,shader:a};export{r as t};