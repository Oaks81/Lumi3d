// js/world/atlasUVHelper.js
// Phase 4: Helper functions for atlas UV transforms in shaders
//
// This module provides shader code snippets and uniform setup for atlas-based terrain rendering.
// The key change: instead of sampling textures with vUv [0,1], we transform to atlas space:
//   atlasUV = vUv * atlasUVScale + atlasUVOffset
//
// Where:
//   atlasUVScale = 1.0 / chunksPerAxis (e.g., 0.0625 for 16 chunks per axis)
//   atlasUVOffset = localChunkPosition * atlasUVScale (e.g., 0.0625 for chunk at local pos 1)

/**
 * GLSL code for atlas UV transformation (WebGL2)
 */
export const ATLAS_UV_GLSL = `
// Atlas UV transform uniforms
uniform vec2 atlasUVOffset;    // Offset within atlas [0,1]
uniform float atlasUVScale;    // Scale factor (1.0 / chunksPerAxis)
uniform int useAtlasMode;      // 0 = per-chunk textures, 1 = atlas textures

// Transform chunk UV to atlas UV
vec2 chunkToAtlasUV(vec2 chunkUV) {
    if (useAtlasMode == 0) {
        return chunkUV;  // Legacy per-chunk mode
    }
    return chunkUV * atlasUVScale + atlasUVOffset;
}

// Sample height from atlas or per-chunk texture
float sampleHeight(vec2 uv) {
    vec2 atlasUV = chunkToAtlasUV(uv);
    return texture(heightTexture, atlasUV).r;
}

// Sample normal from atlas or per-chunk texture  
vec3 sampleNormal(vec2 uv) {
    vec2 atlasUV = chunkToAtlasUV(uv);
    return texture(normalTexture, atlasUV).rgb * 2.0 - 1.0;
}

// Sample tile ID from atlas or per-chunk texture
float sampleTileId(vec2 uv) {
    vec2 atlasUV = chunkToAtlasUV(uv);
    vec4 tileSample = texture(tileTexture, atlasUV);
    float rawVal = tileSample.r;
    return (rawVal > 1.0) ? rawVal : (rawVal * 255.0);
}
`;

/**
 * WGSL code for atlas UV transformation (WebGPU)
 */
export const ATLAS_UV_WGSL = `
// Atlas UV transform - added to FragmentUniforms struct
// atlasUVOffset: vec2<f32>,
// atlasUVScale: f32,
// useAtlasMode: i32,

// Transform chunk UV to atlas UV
fn chunkToAtlasUV(chunkUV: vec2<f32>) -> vec2<f32> {
    if (fragUniforms.useAtlasMode == 0) {
        return chunkUV;  // Legacy per-chunk mode
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

// Sample tile ID from atlas texture
fn sampleAtlasTileId(uv: vec2<f32>) -> f32 {
    let atlasUV = chunkToAtlasUV(uv);
    let tileSample = sampleRGBA32FNearest(tileTexture, atlasUV);
    let rawVal = tileSample.r;
    return select(rawVal * 255.0, rawVal, rawVal > 1.0);
}
`;

/**
 * Create uniform values for atlas UV transform
 * @param {Object} uvTransform - Result from config.getChunkUVTransform() or atlasKey.getChunkUVTransform()
 * @returns {Object} Uniform values for shader
 */
export function createAtlasUniforms(uvTransform) {
    if (!uvTransform) {
        // Legacy mode - no atlas
        return {
            atlasUVOffset: [0.0, 0.0],
            atlasUVScale: 1.0,
            useAtlasMode: 0
        };
    }
    
    return {
        atlasUVOffset: [uvTransform.offsetX, uvTransform.offsetY],
        atlasUVScale: uvTransform.scale,
        useAtlasMode: 1
    };
}

/**
 * Apply atlas uniforms to a material
 * @param {Material} material - The terrain material
 * @param {Object} uvTransform - UV transform from atlas key
 */
export function applyAtlasUniformsToMaterial(material, uvTransform) {
    const uniforms = createAtlasUniforms(uvTransform);
    
    if (material.uniforms) {
        // Three.js style uniforms
        if (!material.uniforms.atlasUVOffset) {
            material.uniforms.atlasUVOffset = { value: uniforms.atlasUVOffset };
        } else {
            material.uniforms.atlasUVOffset.value = uniforms.atlasUVOffset;
        }
        
        if (!material.uniforms.atlasUVScale) {
            material.uniforms.atlasUVScale = { value: uniforms.atlasUVScale };
        } else {
            material.uniforms.atlasUVScale.value = uniforms.atlasUVScale;
        }
        
        if (!material.uniforms.useAtlasMode) {
            material.uniforms.useAtlasMode = { value: uniforms.useAtlasMode };
        } else {
            material.uniforms.useAtlasMode.value = uniforms.useAtlasMode;
        }
    } else if (material.setUniform) {
        // Custom material API
        material.setUniform('atlasUVOffset', uniforms.atlasUVOffset);
        material.setUniform('atlasUVScale', uniforms.atlasUVScale);
        material.setUniform('useAtlasMode', uniforms.useAtlasMode);
    }
    
    return material;
}

/**
 * Debug: print atlas UV info
 */
export function debugAtlasUV(chunkX, chunkY, uvTransform) {
    console.log('[AtlasUV] Chunk (' + chunkX + ',' + chunkY + '):');
    console.log('  Offset: (' + uvTransform.offsetX.toFixed(4) + ', ' + uvTransform.offsetY.toFixed(4) + ')');
    console.log('  Scale: ' + uvTransform.scale.toFixed(4));
    console.log('  UV range: [' + uvTransform.offsetX.toFixed(4) + '-' + 
        (uvTransform.offsetX + uvTransform.scale).toFixed(4) + ', ' +
        uvTransform.offsetY.toFixed(4) + '-' + 
        (uvTransform.offsetY + uvTransform.scale).toFixed(4) + ']');
}