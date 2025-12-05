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
        this.chunkHeightTextures = new Map();
        this.chunkTileTextures = new Map();
        this.chunkNormalTextures = new Map();

        this.dirtyLODChunks = new Set();
        this.lodUpdateInterval = 100;
        this.lastLodUpdate = 0;

        this.debugLODUpdates = {
            updatesThisSecond: 0,
            lastSecond: performance.now()
        };
        
        this._lastCameraPos = new THREE.Vector3();
        
        // =============================================
        // NEW: Planetary configuration
        // =============================================
        this.planetConfig = null;
        this.sphericalMapper = null;

        console.log('TerrainMeshManager initialized', backend);
    }

    // =============================================
    // NEW: Set planetary configuration
    // =============================================
    setPlanetaryConfig(planetConfig, sphericalMapper) {
        this.planetConfig = planetConfig;
        this.sphericalMapper = sphericalMapper;
        console.log('[TerrainMeshManager] Planetary config set:', {
            radius: planetConfig?.radius,
            chunksPerFace: sphericalMapper?.chunksPerFace
        });
    }

    makeChunkKey(chunkX, chunkY) {
        return `${chunkX},${chunkY}`;
    }

    getHeightTexture(chunkX, chunkY) {
        const chunkKey = this.makeChunkKey(chunkX, chunkY);
        return this.chunkHeightTextures.get(chunkKey);
    }

    getNormalTexture(chunkX, chunkY) {
        const chunkKey = this.makeChunkKey(chunkX, chunkY);
        return this.chunkNormalTextures.get(chunkKey);
    }

    getTileTypeTexture(chunkX, chunkY) {
        const chunkKey = this.makeChunkKey(chunkX, chunkY);
        return this.chunkTileTextures.get(chunkKey);
    }

    _getBytesPerPixel(format) {
        const bytesMap = {
            'rgba8': 4,
            'rgba16f': 8,
            'rgba32f': 16,
            'r8': 1,
            'r16f': 2,
            'r32f': 4
        };
        return bytesMap[format] || 4;
    }
    
    async addChunk(chunkData, environmentState, chunkKeyStr, planetConfig, sphericalMapper) {
        // =============================================
        // Parse chunk key to detect spherical mode
        // =============================================
        let chunkKey;
        let faceIndex = -1;
        let localChunkX = chunkData.chunkX;
        let localChunkY = chunkData.chunkY;
        
        // Check if this is a spherical chunk (has face property)
        if (chunkData.face !== undefined && chunkData.face !== null) {
            faceIndex = chunkData.face;
            chunkKey = `${faceIndex}:${chunkData.chunkX},${chunkData.chunkY}:0`;
        } else {
            chunkKey = `${chunkData.chunkX},${chunkData.chunkY}`;
        }
        
        // Try to parse from provided key string
        if (faceIndex === -1 && chunkKeyStr && chunkKeyStr.includes(':')) {
            const parts = chunkKeyStr.split(':');
            if (parts.length >= 2) {
                faceIndex = parseInt(parts[0], 10);
                const coords = parts[1].split(',');
                localChunkX = parseInt(coords[0], 10);
                localChunkY = parseInt(coords[1], 10);
                chunkKey = chunkKeyStr;
            }
        }

        if (this.chunkMeshes.has(chunkKey)) {
            return this.chunkMeshes.get(chunkKey);
        }

        const offsetX = chunkData.chunkX * chunkData.size;
        const offsetZ = chunkData.chunkY * chunkData.size;
        
        const isSpherical = faceIndex >= 0 && faceIndex <= 5;
        
        if (isSpherical) {
            console.log(`[TerrainMeshManager] Adding spherical chunk: face=${faceIndex}, local=(${localChunkX},${localChunkY})`);
        }

        // =============================================
        // 1. Get Textures (Atlas or Legacy)
        // =============================================
        const textureInfo = this._getChunkTextures(chunkData.chunkX, chunkData.chunkY, chunkData);
        
        if (!textureInfo.valid) {
            if (!this._warnedChunks) this._warnedChunks = new Set();
            if (!this._warnedChunks.has(chunkKey)) {
                console.warn(` Missing textures for ${chunkKey}`);
                this._warnedChunks.add(chunkKey);
            }
            return null;
        }

        // =============================================
        // 2. Calculate LOD
        // =============================================
        const cameraPos = this.uniformManager.uniforms.cameraPosition?.value || new THREE.Vector3();
        let lodLevel = 0;
        
        if (isSpherical && planetConfig && sphericalMapper) {
            const chunksPerFace = sphericalMapper.chunksPerFace;
            const planetRadius = planetConfig.radius;
            const origin = planetConfig.origin;
            
            const u = (chunkData.chunkX + 0.5) / chunksPerFace;
            const v = (chunkData.chunkY + 0.5) / chunksPerFace;
            
            const cubePoint = this.getCubePoint(faceIndex, u, v);
            const len = Math.sqrt(cubePoint.x*cubePoint.x + cubePoint.y*cubePoint.y + cubePoint.z*cubePoint.z);
            const sphereDir = { x: cubePoint.x/len, y: cubePoint.y/len, z: cubePoint.z/len };
            
            const chunkWorldPos = {
                x: origin.x + sphereDir.x * planetRadius,
                y: origin.y + sphereDir.y * planetRadius,
                z: origin.z + sphereDir.z * planetRadius
            };
            
            const dx = cameraPos.x - chunkWorldPos.x;
            const dy = cameraPos.y - chunkWorldPos.y;
            const dz = cameraPos.z - chunkWorldPos.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            lodLevel = this.lodManager ? this.lodManager.getLODForDistance(distance) : 0;
            
            console.log('[TerrainMeshManager] Spherical LOD:', {
                chunk: `${faceIndex}:${chunkData.chunkX},${chunkData.chunkY}`,
                distance: distance.toFixed(0),
                lodLevel: lodLevel,
                cameraPos: { x: cameraPos.x.toFixed(0), y: cameraPos.y.toFixed(0), z: cameraPos.z.toFixed(0) },
                chunkWorldPos: { x: chunkWorldPos.x.toFixed(0), y: chunkWorldPos.y.toFixed(0), z: chunkWorldPos.z.toFixed(0) }
            });
        }

        // =============================================
        // 3. Create Geometry
        // =============================================
        chunkData.lodLevel = lodLevel;
        const geometry = TerrainGeometryBuilder.build(chunkData, offsetX, offsetZ);
        if (!geometry) {
            console.error('[TerrainMeshManager] Failed to create terrain geometry for', chunkKey);
            return null;
        }

        // =============================================
        // 4. Get Atlas and Lookup Textures
        // =============================================
        const lookupTables = this.textureManager.getLookupTables();
        const atlasTextures = {
            micro: this.textureManager.getAtlasTexture('micro'),
            macro1024: this.textureManager.getAtlasTexture('macro1024')
        };

        if (!atlasTextures.micro || !atlasTextures.macro1024) {
            console.error('[TerrainMeshManager] Atlas textures missing');
            return null;
        }

        try {
            // =============================================
            // 5. Get planetary configuration
            // =============================================
            const pConfig = planetConfig || this.planetConfig || { radius: 50000, origin: { x: 0, y: 0, z: 0 } };
            const sMapper = sphericalMapper || this.sphericalMapper;
            const chunksPerFace = sMapper?.chunksPerFace || 16;
            const renderScale = this.worldGenerator?.renderHeightScale;
            const genScale = this.worldGenerator?.generationHeightScale || renderScale || 1.0;
            const heightScale = chunkData.heightScale ?? (renderScale && genScale ? renderScale / genScale : renderScale ?? 1.0);

            // =============================================
            // 6. Create Material WITH spherical parameters
            // =============================================
            const material = await TerrainMaterialBuilder.create({
                backend: this.backend,
                atlasTextures,
                lookupTables,
                cachedTextures: textureInfo.textures,
                chunkOffsetX: offsetX,
                chunkOffsetZ: offsetZ,
                chunkSize: chunkData.size,
                environmentState,
                uniformManager: this.uniformManager,
                
                // =============================================
                // SPHERICAL PARAMETERS (NEW!)
                // =============================================
                faceIndex: faceIndex,
                faceU: localChunkX,
                faceV: localChunkY,
                faceSize: chunksPerFace,
                planetConfig: pConfig,
                useAtlasMode: textureInfo.useAtlasMode,
                uvTransform: textureInfo.uvTransform,
                heightScale
            });

            if (!material) {
                console.error('[TerrainMeshManager] Failed to create terrain material for', chunkKey);
                return null;
            }

            // Compile Shader
            if (material._needsCompile && this.backend.compileShader) {
                try {
                    this.backend.compileShader(material);
                    material._needsCompile = false;
                } catch (e) {
                    console.error(`Shader compile failed for ${chunkKey}`, e);
                    return null;
                }
            }

            // =============================================
            // 7. Create Entry
            // =============================================
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
                // Store spherical info for debugging
                faceIndex: faceIndex,
                localChunkX: localChunkX,
                localChunkY: localChunkY
            };
            
            if (material.uniforms && !material.uniforms.modelMatrix) {
                material.uniforms.modelMatrix = { value: meshEntry.modelMatrix };
            }
            
            this.chunkMeshes.set(chunkKey, meshEntry);

            // Store texture references
            this.chunkHeightTextures.set(chunkKey, textureInfo.textures.height);
            this.chunkNormalTextures.set(chunkKey, textureInfo.textures.normal);
            this.chunkTileTextures.set(chunkKey, textureInfo.textures.tile);

            console.log(`[TerrainMeshManager] Chunk ${chunkKey} added (spherical=${isSpherical}, LOD=${lodLevel})`);
            return meshEntry;
            
        } catch (error) {
            console.error('[TerrainMeshManager] Error creating terrain mesh for', chunkKey, error);
            return null;
        }
    }

    getCubePoint(face, u, v) {
        const xy = { x: u * 2.0 - 1.0, y: v * 2.0 - 1.0 };
        switch (face) {
            case 0: return { x: 1.0, y: xy.y, z: -xy.x };  // +X
            case 1: return { x: -1.0, y: xy.y, z: xy.x };  // -X
            case 2: return { x: xy.x, y: 1.0, z: -xy.y };  // +Y
            case 3: return { x: xy.x, y: -1.0, z: xy.y };  // -Y
            case 4: return { x: xy.x, y: xy.y, z: 1.0 };   // +Z
            case 5: return { x: -xy.x, y: xy.y, z: -1.0 }; // -Z
            default: return { x: 0, y: 1, z: 0 };
        }
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
            const m = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'macro', null, face);

            if (h && n && t) {
                result.valid = true;
                result.useAtlasMode = true;
                result.atlasKey = h.atlasKey.toString();
                result.uvTransform = h.uvTransform;
                result.textures = {
                    height: h.texture,
                    normal: n.texture,
                    tile: t.texture,
                    splatData: s ? s.texture : h.texture,
                    macro: m ? m.texture : h.texture
                };
                return result;
            }
        }

        // LEGACY PER-CHUNK MODE
        const height = this.textureCache.get(chunkX, chunkY, 'height');
        const normal = this.textureCache.get(chunkX, chunkY, 'normal');
        const tile = this.textureCache.get(chunkX, chunkY, 'tile');
        const splatData = this.textureCache.get(chunkX, chunkY, 'splatData');
        const macro = this.textureCache.get(chunkX, chunkY, 'macro');

        if (height && tile) {
            result.valid = true;
            result.textures = {
                height: height,
                normal: normal || height,
                tile: tile,
                splatData: splatData || height,
                macro: macro || height
            };
        }

        return result;
    }

    removeChunk(chunkX, chunkY) {
        const chunkKey = this.makeChunkKey(chunkX, chunkY);
        const meshEntry = this.chunkMeshes.get(chunkKey);
        if (!meshEntry) return false;

        meshEntry.geometry.dispose();
        this.backend.deleteShader(meshEntry.material);
        meshEntry.material.dispose();

        this.chunkMeshes.delete(chunkKey);
        this.chunkHeightTextures.delete(chunkKey);
        this.chunkNormalTextures.delete(chunkKey);
        this.chunkTileTextures.delete(chunkKey);

        return true;
    }

    cleanup() {
        for (const meshEntry of this.chunkMeshes.values()) {
            meshEntry.geometry.dispose();
            this.backend.deleteShader(meshEntry.material);
            meshEntry.material.dispose();
        }
        this.chunkMeshes.clear();
        this.chunkHeightTextures.clear();
        this.chunkNormalTextures.clear();
        this.chunkTileTextures.clear();
    }

    getChunkData(chunkX, chunkY) {
        const chunkKey = this.makeChunkKey(chunkX, chunkY);
        const meshEntry = this.chunkMeshes.get(chunkKey);
        if (!meshEntry) return null;
        return meshEntry;
    }

    markChunkLODDirty(chunkKey) {
        this.dirtyLODChunks.add(chunkKey);
    }
}
