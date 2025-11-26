// js/renderer/shaders/webgl2/atlasUV.glsl.js
// Atlas UV transform functions for WebGL2 terrain shaders
//
// Usage: Import and include in your fragment shader
//
// Required uniforms:
//   uniform vec2 atlasUVOffset;
//   uniform float atlasUVScale;
//   uniform int useAtlasMode;

/**
 * GLSL code snippet for atlas UV transformation.
 * Include this in your terrain fragment shader.
 */
export const ATLAS_UV_GLSL = `
// ============================================================================
// Atlas UV Transform - Uniforms
// ============================================================================
uniform vec2 atlasUVOffset;    // Offset within atlas [0,1]
uniform float atlasUVScale;    // Scale factor (1.0 / chunksPerAxis)
uniform int useAtlasMode;      // 0 = per-chunk textures, 1 = atlas textures

// ============================================================================
// Atlas UV Transform Functions
// ============================================================================

// Transform chunk UV [0,1] to atlas UV
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
    // Handle both normalized [0,1] and direct [0,255] formats
    return (rawVal > 1.0) ? rawVal : (rawVal * 255.0);
}

// Sample macro texture
vec4 sampleMacro(vec2 uv) {
    vec2 atlasUV = chunkToAtlasUV(uv);
    return texture(macroTexture, atlasUV);
}

// Sample splat data texture
vec4 sampleSplatData(vec2 uv) {
    vec2 atlasUV = chunkToAtlasUV(uv);
    return texture(splatDataTexture, atlasUV);
}
`;

/**
 * Uniform declarations only (if you need to add them separately)
 */
export const ATLAS_UNIFORMS_GLSL = `
uniform vec2 atlasUVOffset;
uniform float atlasUVScale;
uniform int useAtlasMode;
`;