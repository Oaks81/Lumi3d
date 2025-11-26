// js/renderer/shaders/webgpu/atlasUV.wgsl.js
// Atlas UV transform functions for WebGPU terrain shaders
//
// Usage: Import and include in your fragment shader
//
// Required uniforms in FragmentUniforms struct:
//   atlasUVOffset: vec2<f32>,
//   atlasUVScale: f32,
//   useAtlasMode: i32,

/**
 * WGSL code snippet for atlas UV transformation.
 * Include this in your terrain fragment shader.
 * 
 * Assumes FragmentUniforms struct has:
 * - atlasUVOffset: vec2<f32>
 * - atlasUVScale: f32
 * - useAtlasMode: i32
 */
export const ATLAS_UV_WGSL = `
// ============================================================================
// Atlas UV Transform Functions
// ============================================================================

// Transform chunk UV [0,1] to atlas UV
// When useAtlasMode == 0: returns original UV (legacy per-chunk textures)
// When useAtlasMode == 1: transforms to atlas subregion
fn chunkToAtlasUV(chunkUV: vec2<f32>) -> vec2<f32> {
    if (fragUniforms.useAtlasMode == 0) {
        return chunkUV;
    }
    return chunkUV * fragUniforms.atlasUVScale + fragUniforms.atlasUVOffset;
}

// Sample height from atlas texture with bilinear filtering
fn sampleAtlasHeight(uv: vec2<f32>) -> f32 {
    let atlasUV = chunkToAtlasUV(uv);
    return sampleRGBA32FBilinear(heightTexture, atlasUV).r;
}

// Sample normal from atlas texture
fn sampleAtlasNormal(uv: vec2<f32>) -> vec3<f32> {
    let atlasUV = chunkToAtlasUV(uv);
    let normalSample = sampleRGBA32FBilinear(normalTexture, atlasUV).xyz;
    return normalSample * 2.0 - 1.0;
}

// Sample tile ID from atlas texture (nearest neighbor)
fn sampleAtlasTileId(uv: vec2<f32>) -> f32 {
    let atlasUV = chunkToAtlasUV(uv);
    let tileSample = sampleRGBA32FNearest(tileTexture, atlasUV);
    let rawVal = tileSample.r;
    return select(rawVal * 255.0, rawVal, rawVal > 1.0);
}

// Sample macro texture from atlas
fn sampleAtlasMacro(uv: vec2<f32>) -> vec4<f32> {
    let atlasUV = chunkToAtlasUV(uv);
    return sampleRGBA32FBilinear(macroTexture, atlasUV);
}

// Sample splat data from atlas
fn sampleAtlasSplatData(uv: vec2<f32>) -> vec4<f32> {
    let atlasUV = chunkToAtlasUV(uv);
    return sampleRGBA32FBilinear(splatDataTexture, atlasUV);
}
`;

/**
 * WGSL struct additions for FragmentUniforms
 * Add these fields to your existing FragmentUniforms struct
 */
export const ATLAS_UNIFORM_STRUCT_WGSL = `
    // Atlas UV transform
    atlasUVOffset: vec2<f32>,
    atlasUVScale: f32,
    useAtlasMode: i32,
`;

/**
 * Helper to create the atlas uniform portion of a bind group
 */
export function getAtlasUniformBytes() {
    // vec2 (8 bytes) + f32 (4 bytes) + i32 (4 bytes) = 16 bytes
    return 16;
}