import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TerrainGeometryBuilder } from './terrainGeometryBuilder.js';
import { TerrainMaterialBuilder } from './terrainMaterialBuilder.js';

export class TerrainMeshManager {
    constructor(backend, textureManager, textureCache, uniformManager, lodManager) {
        this.backend = backend;
        this.textureManager = textureManager;
        this.textureCache = textureCache;
        this.uniformManager = uniformManager;
        this.lodManager = lodManager;
        
        this.chunkMeshes = new Map();
        this.atlasConfig = null;
    }

    /**
     * Set atlas configuration for texture lookup
     */
    setAtlasConfig(config) {
        this.atlasConfig = config;
    }

    async addChunk(chunkData, environmentState) {
        // Unique key logic handling spherical faces
        let chunkKey;
        if (chunkData.face !== undefined && chunkData.face !== null) {
            // Spherical mode: include face
            chunkKey = `${chunkData.face}:${chunkData.chunkX},${chunkData.chunkY}:0`;
        } else {
            // Flat mode
            chunkKey = `${chunkData.chunkX},${chunkData.chunkY}`;
        }
         /*
        const chunkKey = chunkData.isSpherical ? 
            `${chunkData.face}:${chunkData.chunkX},${chunkData.chunkY}:${chunkData.lodLevel||0}` : 
            `${chunkData.chunkX},${chunkData.chunkY}`;
*/
        if (this.chunkMeshes.has(chunkKey)) {
            return this.chunkMeshes.get(chunkKey);
        }

        // 1. Get Textures (Atlas or Legacy)
        const textureInfo = this._getChunkTextures(chunkData.chunkX, chunkData.chunkY, chunkData);
        
        if (!textureInfo.valid) {
            // Warn only once per chunk
            if (!this._warnedChunks) this._warnedChunks = new Set();
            if (!this._warnedChunks.has(chunkKey)) {
                console.warn(` Missing textures for ${chunkKey}`);
                this._warnedChunks.add(chunkKey);
            }
            return null;
        }

        // 2. Calculate LOD
        const cameraPos = this.uniformManager.uniforms.cameraPosition?.value || new THREE.Vector3();
        const lodLevel = this.lodManager.getLODForChunkKey(
            `${chunkData.chunkX},${chunkData.chunkY}`, 
            cameraPos, 
            null
        );

        // 3. Build Geometry
        // Uses your custom TerrainGeometryBuilder for the Backend
        const geometry = TerrainGeometryBuilder.build(
            chunkData,
            chunkData.chunkX * chunkData.size, // offsetX
            chunkData.chunkY * chunkData.size, // offsetZ
            lodLevel,
            true // useHeightTexture
        );

        if (!geometry) {
            console.error(`Failed to build geometry for ${chunkKey}`);
            return null;
        }

        // 4. Create Material
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

        // 5. Compile Shader
        if (material._needsCompile && this.backend.compileShader) {
            try {
                this.backend.compileShader(material);
                material._needsCompile = false;
            } catch (e) {
                console.error(`Shader compile failed for ${chunkKey}`, e);
                return null;
            }
        }

        // 6. Create Entry
        const meshEntry = {
            geometry: geometry,
            material: material,
            visible: true,
            chunkData: chunkData,
            lodLevel: lodLevel,
            useAtlasMode: textureInfo.useAtlasMode,
            atlasKey: textureInfo.atlasKey,
            uvTransform: textureInfo.uvTransform,
            modelMatrix: new THREE.Matrix4(),
        };
        if (material.uniforms && !material.uniforms.modelMatrix) {
            material.uniforms.modelMatrix = { value: meshEntry.modelMatrix };
        }
        this.chunkMeshes.set(chunkKey, meshEntry);
        return meshEntry;
    }

    _getChunkTextures(chunkX, chunkY, chunkData) {
        const result = {
            valid: false,
            textures: {},
            useAtlasMode: false,
            atlasKey: null,
            uvTransform: null
        };

        // ATLAS MODE
        if (chunkData.useAtlasMode) {
            const face = chunkData.face ?? null;
            const h = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'height', null, face);
            const n = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'normal', null, face);
            const t = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'tile', null, face);
            const s = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'splatData', null, face); 

            if (h && n && t) {
                result.valid = true;
                result.useAtlasMode = true;
                result.atlasKey = h.atlasKey.toString();
                result.uvTransform = h.uvTransform;
                result.textures = {
                    height: h.texture,
                    normal: n.texture,
                    tile: t.texture,
                    splatData: s ? s.texture : null,
                };
                return result;
            }
        } 
        // LEGACY MODE
        else {
            const h = this.textureCache.get(chunkX, chunkY, 'height');
            const n = this.textureCache.get(chunkX, chunkY, 'normal');
            const t = this.textureCache.get(chunkX, chunkY, 'tile');
            const s = this.textureCache.get(chunkX, chunkY, 'splatData');

            if (h && n && t) {
                result.valid = true;
                result.useAtlasMode = false;
                result.textures = {
                    height: h,
                    normal: n,
                    tile: t,
                    splatData: s
                };
                return result;
            }
        }

        return result;
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
        planetConfig: { radius: 50000.0, origin: new THREE.Vector3(0,0,0) },
        
      // === FIX START ===
      faceIndex: chunkData.face ?? -1,
            
      // Map the CHUNK coordinates to the FACE coordinates
      faceU: chunkData.chunkX % 16,
      faceV: chunkData.chunkY % 16,
      
      // Ensure this matches your grid size (default 16 chunks across a face)
      faceSize: 16, 
      // === FIX END ===
        
        // Ensure this matches your chunks per face config (usually 16)
        faceSize: 16, 
        
        useAtlasMode: textureInfo.useAtlasMode,
        uvTransform: textureInfo.uvTransform
    });
}
    updateEnvUniforms(environmentState, camera, shadowData, clusteredLightData) {
        for (const [key, meshEntry] of this.chunkMeshes) {
            if (!meshEntry.material || !meshEntry.material.uniforms) continue;
            
            const u = meshEntry.material.uniforms;

            // Camera
            if (camera && u.cameraPosition) {
                u.cameraPosition.value.set(camera.position.x, camera.position.y, camera.position.z);
            }

            // Lighting (Sun)
            if (environmentState.sunLightDirection && u.sunLightDirection) {
                u.sunLightDirection.value.copy(environmentState.sunLightDirection);
            }
            if (environmentState.sunLightColor && u.sunLightColor) {
                u.sunLightColor.value.copy(environmentState.sunLightColor);
            }
            
            // Fog
            if (environmentState.fogColor && u.fogColor) {
                u.fogColor.value.copy(environmentState.fogColor);
            }
            if (environmentState.fogDensity !== undefined && u.fogDensity) {
                u.fogDensity.value = environmentState.fogDensity;
            }

            // Time / Seasons (if supported)
            if (environmentState.time !== undefined && u.time) {
                u.time.value = environmentState.time;
            }
        }
    }

    removeChunk(chunkKeyStr) {
        // Support both spherical ("face:x,y:lod") and flat ("x,y") keys
        const candidateKeys = [chunkKeyStr];
        if (chunkKeyStr && chunkKeyStr.includes(':')) {
            const parts = chunkKeyStr.split(':');
            const face = parts[0];
            const coords = (parts[1] || '').split(',');
            if (coords.length === 2) {
                const flat = `${coords[0]},${coords[1]}`;
                const faceKey = `${face}:${coords[0]},${coords[1]}:0`;
                candidateKeys.push(flat, faceKey);
            }
        }

        for (const key of candidateKeys) {
            if (!this.chunkMeshes.has(key)) continue;
            const entry = this.chunkMeshes.get(key);
            if (entry?.material && this.backend.deleteShader) {
                this.backend.deleteShader(entry.material);
                if (entry.material.dispose) entry.material.dispose();
            }
            this.chunkMeshes.delete(key);
            return;
        }
    }

    cleanup() {
        for (const [key, entry] of this.chunkMeshes) {
            if (entry.material) this.backend.deleteShader(entry.material);
        }
        this.chunkMeshes.clear();
    }
}
