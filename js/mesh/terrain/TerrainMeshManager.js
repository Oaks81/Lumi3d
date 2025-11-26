// mesh/terrain/TerrainMeshManager.js

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
    }

    async addChunk(chunkData, environmentState) {
        const chunkKey = `${chunkData.chunkX},${chunkData.chunkY}`;

        if (this.chunkMeshes.has(chunkKey)) {
            console.warn(`⚠️ Chunk ${chunkKey} already exists`);
            return this.chunkMeshes.get(chunkKey);
        }

        // Validate textures (ALWAYS required - even for CPU height geometry)
        const hasTextures = this._validateTextures(chunkData.chunkX, chunkData.chunkY);
        if (!hasTextures) {
            console.error(`🔴Missing textures for ${chunkKey}`);
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

        console.log(`🔧 Creating chunk ${chunkKey} at LOD ${lodLevel}`);

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

        // Create material
        const material = await this._createTerrainMaterial(
            chunkData,
            environmentState,
            lodLevel
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
            lodLevel: lodLevel
        };

        this.chunkMeshes.set(chunkKey, meshEntry);

        console.log(`✅ Mesh created for ${chunkKey}`);

        return meshEntry;
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

    _validateTextures(chunkX, chunkY) {
        // CRITICAL: Textures are ALWAYS required
        // Even if using CPU heightmap data, we still need texture versions
        // for shader sampling (normals, tiles, splats, etc.)
        const required = ['height', 'normal', 'tile', 'splatWeight', 'splatType'];

        for (const type of required) {
            const texture = this.textureCache.get(chunkX, chunkY, type);
            if (!texture) {
                console.error(`❌ Missing ${type} texture for chunk ${chunkX},${chunkY}`);
                return false;
            }

            // Verify GPU texture exists
            if (!texture._gpuTexture) {
                console.warn(`⚠️ Texture ${type} not uploaded to GPU for ${chunkX},${chunkY}`);
            }
        }

        return true;
    }

    async _createTerrainMaterial(chunkData, environmentState, lodLevel) {
        const atlasTextures = {
            micro: this.textureManager.getAtlasTexture('micro'),
            macro1024: this.textureManager.getAtlasTexture('macro_1024')
        };

        const lookupTables = this.textureManager.getLookupTables();

        // Get cached textures (from WorldGenerator)
        const cachedTextures = {
            height: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'height'),
            normal: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'normal'),
            tile: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'tile'),
            splatWeight: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'splatWeight'),
            splatType: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'splatType'),
            splatData: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'splatData') ||
                       this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'splatWeight'),
            macro: this.textureCache.get(chunkData.chunkX, chunkData.chunkY, 'macro')
        };

        return await TerrainMaterialBuilder.create({
            backend: this.backend,
            atlasTextures,
            lookupTables,
            cachedTextures,
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
            faceSize: chunkData.faceSize
        });
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