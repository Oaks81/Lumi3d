// mesh/terrain/TerrainMeshManager.js
// Phase 6: Updated with Atlas Texture Support

import { TerrainGeometryBuilder } from './terrainGeometryBuilder.js';
import { TerrainMaterialBuilder } from './terrainMaterialBuilder.js';

export class TerrainMeshManager {
    constructor(backend, textureManager, textureCache, uniformManager, lodManager, altitudeZoneManager) {
        this.backend = backend;
        this.textureManager = textureManager;
        this.textureCache = textureCache;
        this.uniformManager = uniformManager;
        this.lodManager = lodManager;
        this.altitudeZoneManager = altitudeZoneManager;

        this.chunkMeshes = new Map();
        
        // Atlas configuration (can be set externally)
        this.atlasConfig = null;
    }

    /**
     * Set atlas configuration for texture lookup
     * @param {DataTextureConfig} config - Atlas configuration
     */
    setAtlasConfig(config) {
        this.atlasConfig = config;
        console.log('[TerrainMeshManager] Atlas config set:', 
            config ? `${config.textureSize}x${config.textureSize}, ${config.chunksPerAxis} chunks/axis` : 'disabled');
    }

    async addChunk(chunkData, environmentState) {
        const chunkKey = `${chunkData.chunkX},${chunkData.chunkY}`;

        if (this.chunkMeshes.has(chunkKey)) {
            console.warn(`⚠️ Chunk ${chunkKey} already exists`);
            return this.chunkMeshes.get(chunkKey);
        }

        // ==========================================
        // ATLAS-AWARE TEXTURE VALIDATION (Phase 6)
        // ==========================================
        const textureInfo = this._getChunkTextures(chunkData.chunkX, chunkData.chunkY);
        if (!textureInfo.valid) {
            console.error(`🔴 Missing textures for ${chunkKey}`);
            return null;
        }

        // Get camera position for LOD
        const cameraPosition = this.uniformManager?.uniforms?.cameraPosition?.value ||
                              { x: 0, y: 0, z: 0 };

        // Calculate LOD with altitude awareness
        const lodLevel = this.lodManager.getLODForChunk(
            chunkData.chunkX,
            chunkData.chunkY,
            cameraPosition,
            this.altitudeZoneManager
        );

        console.log(`🔧 Creating chunk ${chunkKey} at LOD ${lodLevel}` + 
            (textureInfo.useAtlasMode ? ` [ATLAS: ${textureInfo.atlasKey}]` : ' [PER-CHUNK]'));

        // Determine geometry strategy
        const useHeightTexture = this._shouldUseTextureHeights(lodLevel);

        // Create geometry via builder
        const offsetX = chunkData.chunkX * chunkData.size;
        const offsetZ = chunkData.chunkY * chunkData.size;

        const geometry = TerrainGeometryBuilder.build(
            chunkData,
            0,
            0,
            lodLevel,
            useHeightTexture
        );

        if (!geometry) {
            console.error(`Failed to create geometry for ${chunkKey}`);
            return null;
        }

        // Log geometry info
        console.log(`  Geometry: ${geometry.userData.vertexCount} verts, ` +
                    `heights from ${geometry.userData.heightSource}, ` +
                    `normals from ${geometry.userData.normalSource}`);

        // Create material with atlas support
        const material = await this._createTerrainMaterial(
            chunkData,
            environmentState,
            lodLevel,
            textureInfo
        );

        if (!material) {
            console.error(`Failed to create material for ${chunkKey}`);
            return null;
        }

        // Compile shader
        if (material._needsCompile) {
            try {
                await this.backend.compileShader(material);
                material._needsCompile = false;
            } catch (error) {
                console.error(`Shader compilation failed for ${chunkKey}:`, error);
                return null;
            }
        }

        const meshEntry = {
            geometry,
            material,
            visible: true,
            chunkX: chunkData.chunkX,
            chunkY: chunkData.chunkY,
            lodLevel: lodLevel,
            // Atlas info for later reference
            useAtlasMode: textureInfo.useAtlasMode,
            atlasKey: textureInfo.atlasKey,
            uvTransform: textureInfo.uvTransform
        };

        this.chunkMeshes.set(chunkKey, meshEntry);

        console.log(`✅ Mesh created for ${chunkKey}`);

        return meshEntry;
    }

    /**
     * Get textures for a chunk - tries atlas first, falls back to per-chunk
     * @returns {Object} { valid, textures, useAtlasMode, atlasKey, uvTransform }
     */
    _getChunkTextures(chunkX, chunkY) {
        const result = {
            valid: false,
            textures: {},
            useAtlasMode: false,
            atlasKey: null,
            uvTransform: null
        };

        // ==========================================
        // TRY ATLAS MODE FIRST
        // ==========================================
        if (this.atlasConfig && this.textureCache.hasAtlasForChunk) {
            // Check if atlas exists for this chunk
            const hasAtlas = this.textureCache.hasAtlasForChunk(chunkX, chunkY, this.atlasConfig);
            
            if (hasAtlas) {
                const atlasTextures = this.textureCache.getAtlasForChunk(chunkX, chunkY, this.atlasConfig);
                
                if (atlasTextures && atlasTextures.height && atlasTextures.normal && atlasTextures.tile) {
                    // Calculate UV transform for this chunk within the atlas
                    const uvTransform = this.atlasConfig.getChunkUVTransform(chunkX, chunkY);
                    const atlasCoords = this.atlasConfig.getAtlasCoords(chunkX, chunkY);
                    const atlasKey = `atlas_${atlasCoords.atlasX},${atlasCoords.atlasY}_${this.atlasConfig.textureSize}`;
                    
                    result.valid = true;
                    result.useAtlasMode = true;
                    result.atlasKey = atlasKey;
                    result.uvTransform = uvTransform;
                    result.textures = {
                        height: atlasTextures.height,
                        normal: atlasTextures.normal,
                        tile: atlasTextures.tile,
                        splatData: atlasTextures.splatData || atlasTextures.splatWeight,
                        macro: atlasTextures.macro
                    };
                    
                    console.log(`  📦 Using atlas textures for chunk (${chunkX},${chunkY}): ${atlasKey}`);
                    console.log(`     UV offset: (${uvTransform.offsetX.toFixed(4)}, ${uvTransform.offsetY.toFixed(4)}), scale: ${uvTransform.scale.toFixed(4)}`);
                    
                    return result;
                }
            }
        }

        // ==========================================
        // FALL BACK TO PER-CHUNK TEXTURES
        // ==========================================
        const required = ['height', 'normal', 'tile'];
        let allPresent = true;

        for (const type of required) {
            const texture = this.textureCache.get(chunkX, chunkY, type);
            if (!texture) {
                console.error(`❌ Missing ${type} texture for chunk ${chunkX},${chunkY}`);
                allPresent = false;
            } else {
                result.textures[type] = texture;
            }
        }

        // Optional textures
        result.textures.splatData = this.textureCache.get(chunkX, chunkY, 'splatData') ||
                                    this.textureCache.get(chunkX, chunkY, 'splatWeight');
        result.textures.macro = this.textureCache.get(chunkX, chunkY, 'macro');

        if (allPresent) {
            result.valid = true;
            result.useAtlasMode = false;
            console.log(`  📄 Using per-chunk textures for chunk (${chunkX},${chunkY})`);
        }

        return result;
    }

    /**
     * Determine if heights should come from texture vs CPU data
     * Based on altitude zone and LOD level
     */
    _shouldUseTextureHeights(lodLevel) {
        // LOD 3+ always uses texture heights (simplified geometry)
        if (lodLevel >= 3) return true;

        // LOD 0-2: Check altitude zone
        if (!this.altitudeZoneManager) return false;

        const zone = this.altitudeZoneManager.currentZone;

        // At surface/low altitude: Use CPU heights for detail
        // At medium/high/orbital: Use texture heights
        const useTexture = (zone === 'medium' || zone === 'high' || zone === 'orbital');

        console.log(`  LOD ${lodLevel}, Zone ${zone}: Heights from ${useTexture ? 'texture' : 'CPU'}`);

        return useTexture;
    }

    async _createTerrainMaterial(chunkData, environmentState, lodLevel, textureInfo) {
        const atlasTextures = {
            micro: this.textureManager.getAtlasTexture('micro'),
            macro1024: this.textureManager.getAtlasTexture('macro_1024')
        };

        const lookupTables = this.textureManager.getLookupTables();

        return await TerrainMaterialBuilder.create({
            backend: this.backend,
            atlasTextures,
            lookupTables,
            cachedTextures: textureInfo.textures,
            chunkOffsetX: chunkData.chunkX * chunkData.size,
            chunkOffsetZ: chunkData.chunkY * chunkData.size,
            chunkSize: chunkData.size,
            environmentState,
            uniformManager: this.uniformManager,
            lodLevel: lodLevel,
            planetConfig: this.planetConfig,
            faceIndex: chunkData.faceIndex,
            faceU: chunkData.faceU,
            faceV: chunkData.faceV,
            faceSize: chunkData.faceSize,
            // ==========================================
            // ATLAS UV TRANSFORM (Phase 6)
            // ==========================================
            useAtlasMode: textureInfo.useAtlasMode,
            uvTransform: textureInfo.uvTransform
        });
    }

    /**
     * Update atlas UV transform for a chunk (e.g., after atlas regeneration)
     */
    updateChunkAtlasUV(chunkX, chunkY) {
        const chunkKey = `${chunkX},${chunkY}`;
        const meshEntry = this.chunkMeshes.get(chunkKey);
        
        if (!meshEntry || !meshEntry.useAtlasMode || !this.atlasConfig) {
            return;
        }
        
        const uvTransform = this.atlasConfig.getChunkUVTransform(chunkX, chunkY);
        meshEntry.uvTransform = uvTransform;
        
        TerrainMaterialBuilder.updateAtlasUVTransform(meshEntry.material, uvTransform);
        
        console.log(`📍 Updated atlas UV for ${chunkKey}: offset=(${uvTransform.offsetX.toFixed(4)}, ${uvTransform.offsetY.toFixed(4)})`);
    }

    removeChunk(chunkX, chunkY) {
        const chunkKey = `${chunkX},${chunkY}`;
        const meshEntry = this.chunkMeshes.get(chunkKey);
        
        if (!meshEntry) {
            console.warn(`⚠️ No mesh to remove for ${chunkKey}`);
            return;
        }
        
        // Dispose geometry
        if (meshEntry.geometry) {
            meshEntry.geometry.dispose();
        }
        
        // Dispose material (shader resources handled by backend)
        if (meshEntry.material) {
            this.backend.deleteShader(meshEntry.material);
            meshEntry.material.dispose();
        }
        
        this.chunkMeshes.delete(chunkKey);
        console.log(`🗑️ Removed mesh for ${chunkKey}`);
    }

    updateEnvUniforms(environmentState, camera, shadowData, clusteredLightData) {
        // Update all chunk materials with current environment state
        for (const [chunkKey, meshEntry] of this.chunkMeshes) {
            if (!meshEntry.material || !meshEntry.material.uniforms) continue;
            
            const uniforms = meshEntry.material.uniforms;
            
            // Update lighting uniforms
            if (environmentState.sunLightDirection && uniforms.sunLightDirection) {
                uniforms.sunLightDirection.value.copy(environmentState.sunLightDirection);
            }
            if (environmentState.sunLightColor && uniforms.sunLightColor) {
                uniforms.sunLightColor.value.copy(environmentState.sunLightColor);
            }
            if (environmentState.sunLightIntensity !== undefined && uniforms.sunLightIntensity) {
                uniforms.sunLightIntensity.value = environmentState.sunLightIntensity;
            }
            
            // Update camera uniforms
            if (camera && uniforms.cameraPosition) {
                uniforms.cameraPosition.value.set(camera.position.x, camera.position.y, camera.position.z);
            }
            
            // Update fog
            if (environmentState.fogColor && uniforms.fogColor) {
                uniforms.fogColor.value.copy(environmentState.fogColor);
            }
            if (environmentState.fogDensity !== undefined && uniforms.fogDensity) {
                uniforms.fogDensity.value = environmentState.fogDensity;
            }
        }
    }

    getHeightTexture(chunkX, chunkY) {
        return this.textureCache.get(chunkX, chunkY, 'height');
    }

    getNormalTexture(chunkX, chunkY) {
        return this.textureCache.get(chunkX, chunkY, 'normal');
    }

    /**
     * Get statistics about mesh management
     */
    getStats() {
        let atlasChunks = 0;
        let perChunkChunks = 0;
        const atlasUsage = new Map();
        
        for (const [key, entry] of this.chunkMeshes) {
            if (entry.useAtlasMode) {
                atlasChunks++;
                const atlasKey = entry.atlasKey || 'unknown';
                atlasUsage.set(atlasKey, (atlasUsage.get(atlasKey) || 0) + 1);
            } else {
                perChunkChunks++;
            }
        }
        
        return {
            totalChunks: this.chunkMeshes.size,
            atlasChunks,
            perChunkChunks,
            atlasUsage: Object.fromEntries(atlasUsage)
        };
    }

    /**
     * Debug print
     */
    debugPrint() {
        const stats = this.getStats();
        console.log('[TerrainMeshManager] === Stats ===');
        console.log(`  Total chunks: ${stats.totalChunks}`);
        console.log(`  Atlas mode: ${stats.atlasChunks}`);
        console.log(`  Per-chunk mode: ${stats.perChunkChunks}`);
        console.log('  Atlas usage:', stats.atlasUsage);
    }

    cleanup() {
        for (const [chunkKey, meshEntry] of this.chunkMeshes) {
            if (meshEntry.geometry) {
                meshEntry.geometry.dispose();
            }
            if (meshEntry.material) {
                this.backend.deleteShader(meshEntry.material);
                meshEntry.material.dispose();
            }
        }
        this.chunkMeshes.clear();
        console.log('🧹 TerrainMeshManager cleaned up');
    }
}