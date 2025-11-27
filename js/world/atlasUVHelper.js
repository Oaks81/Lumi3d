// js/world/atlasUVHelper.js

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

/**
 * Write atlas uniforms to a WebGPU buffer (for uniform buffer updates)
 * @param {DataView} dataView - DataView to write to
 * @param {number} offset - Byte offset to start writing
 * @param {Object} uvTransform - UV transform from atlas key (or null for legacy mode)
 * @returns {number} Number of bytes written (16)
 */
export function writeAtlasUniformsToBuffer(dataView, offset, uvTransform) {
    const uniforms = createAtlasUniforms(uvTransform);
    
    // vec2 atlasUVOffset (8 bytes)
    dataView.setFloat32(offset + 0, uniforms.atlasUVOffset[0], true);
    dataView.setFloat32(offset + 4, uniforms.atlasUVOffset[1], true);
    
    // f32 atlasUVScale (4 bytes)
    dataView.setFloat32(offset + 8, uniforms.atlasUVScale, true);
    
    // i32 useAtlasMode (4 bytes)
    dataView.setInt32(offset + 12, uniforms.useAtlasMode, true);
    
    return 16; // Bytes written
}

/**
 * Get size of atlas uniform data in bytes
 * @returns {number} Size in bytes (16)
 */
export function getAtlasUniformsByteSize() {
    // vec2 (8) + f32 (4) + i32 (4) = 16 bytes
    return 16;
}

/**
 * Create a Float32Array for atlas uniforms (for WebGL uniform upload)
 * @param {Object} uvTransform - UV transform from atlas key
 * @returns {Float32Array} Array ready for gl.uniform upload
 */
export function createAtlasUniformArray(uvTransform) {
    const uniforms = createAtlasUniforms(uvTransform);
    return new Float32Array([
        uniforms.atlasUVOffset[0],
        uniforms.atlasUVOffset[1],
        uniforms.atlasUVScale,
        uniforms.useAtlasMode
    ]);
}

/**
 * Check if a chunkData object is using atlas mode
 * @param {Object} chunkData - Chunk data from world generator
 * @returns {boolean}
 */
export function isAtlasMode(chunkData) {
    return chunkData && chunkData.useAtlasMode === true;
}

/**
 * Get UV transform from chunkData (with fallback to legacy)
 * @param {Object} chunkData - Chunk data from world generator
 * @returns {Object|null} UV transform or null for legacy mode
 */
export function getUVTransform(chunkData) {
    if (!chunkData || !chunkData.useAtlasMode) {
        return null;
    }
    return chunkData.uvTransform || null;
}