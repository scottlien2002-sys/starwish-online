import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{t}from"./shaderStore-D-XQlhUT.js";import{t as n}from"./gaussianPointSplatting-UwjdZPb8.js";var r=e({gpsPartitionComputeShaderWGSL:()=>s}),i=`gpsPartitionComputeShader`,a=`#include<gaussianPointSplatting>
@group(0) @binding(0) var<storage,read> cdf : array<u32>;@group(0) @binding(1) var<storage,read> pointCount : array<u32>;@group(0) @binding(2) var<storage,read_write> partTable : array<u32>;fn gpsFindGaussian(p : u32,count : u32)->u32 {var lo=0u;var hi=count;loop {if (lo+1u>=hi) {break;}
let mid=(lo+hi)>>1u;if (cdf[mid]<=p) {lo=mid;} else {hi=mid;}}
return lo;}
@compute @workgroup_size(256,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {let k=gid.x;if (k>GPS_PARTITION_BUCKETS) {return;}
let total=pointCount[0];let count=arrayLength(&cdf);if (total==0u || count==0u) {partTable[k]=0u;return;}
var pk=u32(f32(k)/f32(GPS_PARTITION_BUCKETS)*f32(total));if (pk>total-1u) {pk=total-1u;}
partTable[k]=gpsFindGaussian(pk,count);}
`;t.ShadersStoreWGSL[i]||(t.ShadersStoreWGSL[i]=a);var o=[n];for(let e of o)t.IncludesShadersStoreWGSL[e.name]||(t.IncludesShadersStoreWGSL[e.name]=e.shader);var s={name:i,shader:a};export{r as t};