// StreamedMaterialFactory.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { buildStreamedChunkVertexShader } from './buildStreamedChunkVertexShader.js';
import { buildStreamedChunkFragmentShader } from './buildStreamedChunkFragmentShader.js';

/**
 * Factory for creating materials for streamed features
 */
export class StreamedMaterialFactory {
    /**
     * Creates a new StreamedMaterialFactory
     * @param {Object} uniformManager - The uniform manager for lighting
     */
    constructor(uniformManager) {
        this.uniformManager = uniformManager;
    }
    
    /**
     * Create material with GPU culling shader
     * @param {string} typeName - The feature type name
     * @param {Object} config - The type configuration
     * @param {number} chunkSize - The chunk size
     * @returns {Promise<THREE.ShaderMaterial>} The created material
     */
    async createMaterial(typeName, config, chunkSize) {
        const uniforms = this.createDefaultUniforms(config, chunkSize);
        
        // Let config provide custom material if needed
        if (config.createMaterial) {
            return await config.createMaterial(uniforms, this.uniformManager);
        }
        
        // Default GPU-culled material
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: buildStreamedChunkVertexShader(),
            fragmentShader: buildStreamedChunkFragmentShader(),
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.3
        });
        
        if (this.uniformManager) {
            this.uniformManager.registerMaterial(material);
        }
        
        return material;
    }
    
/**
 * Create default uniforms for streaming shader
 * ✅ MATCHES YOUR VERTEX SHADER EXACTLY
 */
createDefaultUniforms(config, chunkSize) {
    const instancesPerRow = Math.ceil(chunkSize / config.gridSpacing);
    
    // ✅ Calculate distances from config
    const streamRadius = config.streamRadius || 100;
    const maxRenderDistance = config.maxRenderDistance || streamRadius * 0.9;
    const taperStartDistance = config.taperStartDistance || streamRadius * 0.5;
    const taperEndDistance = config.taperEndDistance || streamRadius * 0.85;
    const minCullDistance = config.minCullDistance || 2;

    return {
        // Textures
        u_heightTexture: { value: null },
        u_normalTexture: { value: null },
        u_tileTypeTexture: { value: null },
        
        // Chunk data
        u_chunkOffset: { value: new THREE.Vector2(0, 0) },
        u_chunkSize: { value: chunkSize },
        u_gridSpacing: { value: config.gridSpacing },
        u_instancesPerRow: { value: instancesPerRow },
        
        // ✅ Distance culling (matches vertex shader)
        u_maxDistance: { value: maxRenderDistance },
        u_taperStartDistance: { value: taperStartDistance },
        u_taperEndDistance: { value: taperEndDistance },
        u_minCullDistance: { value: minCullDistance },
        
        // Feature config
        u_density: { value: config.density || 0.8 },
        u_waterLevel: { value: 8.0 },
        u_cameraPosition: { value: new THREE.Vector3() },
        
        // Wind animation
        u_time: { value: 0.0 },
        u_windStrength: { value: config.windStrength || 0.05 },
        
        // LOD
        u_lodLevel: { value: 0 },
        
        // Visual
        plantColor: { value: config.color || new THREE.Color(0.4, 0.7, 0.3) },
        
        // Legacy
        u_numSeasons: { value: 4 },
        u_currentSeason: { value: 0 },
        windDirection: { value: new THREE.Vector2(1.0, 0.5).normalize() },
        u_validTiles: { value: new THREE.Vector4(0, 0, 0, 0) }
    };
}


createChunkUniforms(config, typeName, chunkSize, windTime) {
    const instancesPerRow = Math.ceil(chunkSize / config.gridSpacing);
    
    // Calculate distances from config
    const streamRadius = config.streamRadius || 100;
    const maxRenderDistance = config.maxRenderDistance || streamRadius * 0.9;
    const taperStartDistance = config.taperStartDistance || streamRadius * 0.5;
    const taperEndDistance = config.taperEndDistance || streamRadius * 0.85;
    const minCullDistance = config.minCullDistance || 2;
    
    const uniforms = {
        // Textures
        u_heightTexture: { value: null },
        u_tileTypeTexture: { value: null },
        
        // Chunk data
        u_chunkOffset: { value: new THREE.Vector2(0, 0) },
        u_chunkSize: { value: chunkSize },
        u_gridSpacing: { value: config.gridSpacing },
        u_instancesPerRow: { value: instancesPerRow },
        
        // Distance culling (matches vertex shader exactly)
        u_maxDistance: { value: maxRenderDistance },
        u_taperStartDistance: { value: taperStartDistance },
        u_taperEndDistance: { value: taperEndDistance },
        u_minCullDistance: { value: minCullDistance },
        
        // Feature config
        u_density: { value: config.density || 0.8 },
        u_waterLevel: { value: 8.0 },
        u_cameraPosition: { value: new THREE.Vector3() },
        
        // Wind animation
        u_time: { value: windTime },
        u_windStrength: { value: config.windStrength || 0.05 },
        
        // LOD
        u_lodLevel: { value: 0 },
        
        // ✅ Visual - ADD BOTH NAMES
        plantColor: { value: config.color || new THREE.Color(0.4, 0.7, 0.3) },
        u_color: { value: config.color || new THREE.Color(0.4, 0.7, 0.3) }
    };
    
    console.log(`🔧 Created uniforms for ${typeName}: ${Object.keys(uniforms).length} total`);
    
    return uniforms;
}
/**
 * Create a material for a chunk
 * @param {Object} config - The type configuration
 * @param {string} typeName - The feature type name
 * @param {THREE.Material} baseMaterial - The base material to copy from
 * @param {number} chunkSize - The chunk size
 * @param {number} windTime - Current wind animation time
 * @returns {THREE.ShaderMaterial} The created material
 */
createChunkMaterial(config, typeName, baseMaterial, chunkSize, windTime) {
    // ✅ Create custom uniforms FIRST
    const customUniforms = this.createChunkUniforms(config, typeName, chunkSize, windTime);
    
    console.log(`🔍 Custom uniforms created: ${Object.keys(customUniforms).length}`);
    console.log(`🔍   Has u_lod0TaperStart in customUniforms: ${!!customUniforms.u_lod0TaperStart}`);
    
    // ✅ Create material with custom uniforms
    const material = new THREE.ShaderMaterial({
        uniforms: customUniforms,
        vertexShader: baseMaterial.vertexShader,
        fragmentShader: baseMaterial.fragmentShader,
        side: baseMaterial.side,
        transparent: baseMaterial.transparent,
        alphaTest: baseMaterial.alphaTest
    });
    
    console.log(`🔍 Material created with: ${Object.keys(material.uniforms).length} uniforms`);
    console.log(`🔍   Has u_lod0TaperStart after material creation: ${!!material.uniforms.u_lod0TaperStart}`);
    
    // ✅ Register AFTER (adds lighting uniforms without overwriting)
    if (this.uniformManager) {
        this.uniformManager.registerMaterial(material);
    }
    
    console.log(`🔍 After registerMaterial: ${Object.keys(material.uniforms).length} uniforms`);
    console.log(`🔍   Has u_lod0TaperStart after register: ${!!material.uniforms.u_lod0TaperStart}`);
    
    // ✅ Final verification
    console.log(`🔍 Chunk material created for ${typeName}:`);
    console.log(`   Total uniforms: ${Object.keys(material.uniforms).length}`);
    console.log(`   Has u_cameraPosition: ${!!material.uniforms.u_cameraPosition}`);
    console.log(`   Has u_lod0TaperStart: ${!!material.uniforms.u_lod0TaperStart}`);
    console.log(`   Has sunLightDirection: ${!!material.uniforms.sunLightDirection}`);
    console.log(`   u_lod0TaperStart value: ${material.uniforms.u_lod0TaperStart?.value}`);
    
    return material;
}
    /**
     * Set uniforms for a chunk material
     * @param {THREE.ShaderMaterial} material - The material to update
     * @param {Object} config - The type configuration
     * @param {Object} textures - The chunk textures
     * @param {Object} chunkData - The chunk data
     */
    setMaterialUniforms(material, config, textures, chunkData) {
        material.uniforms.u_heightTexture.value = textures.heightTexture;
        material.uniforms.u_normalTexture.value = textures.normalTexture;
        material.uniforms.u_tileTypeTexture.value = textures.tileTypeTexture;
        material.uniforms.u_chunkOffset.value.copy(chunkData.chunkOffset);
        material.uniforms.u_chunkSize.value = chunkData.chunkSize;
        material.uniforms.u_lodLevel.value = chunkData.lodLevel;
        material.uniforms.u_gridSpacing.value = config.gridSpacing;
        
        const validTiles = config.validTiles.concat([0, 0, 0, 0]).slice(0, 4);
        material.uniforms.u_validTiles.value.set(...validTiles);
        material.uniforms.u_density.value = config.density;
    }
}
