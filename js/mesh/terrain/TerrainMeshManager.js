import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TerrainGeometryBuilder } from './terrainGeometryBuilder.js';
import { TerrainMaterialBuilder } from './terrainMaterialBuilder.js';
import { LODTextureAtlasKey } from '../../world/lodTextureAtlasKey.js';

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
        this.lodUpdateInterval = 200;
        this.lastLodUpdate = 0;
        this.useInstancing = true; // Instancing ON (WebGPU). Toggle off if issues arise.
        this.sharedGeometries = new Map(); // key: lod|size|edgeMask -> shared geometry
        this._pendingLODAtlasRequests = new Map();

        this.debugLODUpdates = {
            updatesThisSecond: 0,
            lastSecond: performance.now()
        };
        
        this._lastCameraPos = new THREE.Vector3();
        this._lastLODRefresh = 0;
        
        // =============================================
        // NEW: Planetary configuration
        // =============================================
        this.planetConfig = null;
        this.sphericalMapper = null;
        this.worldGenerator = null;

        console.log('TerrainMeshManager initialized', backend);
    }

    setWorldGenerator(worldGenerator) {
        this.worldGenerator = worldGenerator;
    }
    setAtmosphereLUT(lut) {
        this._atmosphereLUT = lut;
        console.log('[TerrainMeshManager] Atmosphere LUT set');
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
        // 1. Calculate LOD (so textures/geometry use the same level)
        // =============================================
        const cameraPos = this.uniformManager.uniforms.cameraPosition?.value || new THREE.Vector3();
        let lodLevel = typeof chunkData.forceLOD === 'number'
            ? chunkData.forceLOD
            : (typeof chunkData.lodLevel === 'number' ? chunkData.lodLevel : 0);

        if (isSpherical && planetConfig && sphericalMapper && typeof chunkData.forceLOD !== 'number' && typeof chunkData.lodLevel !== 'number') {
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
        // Clamp to available atlas levels
        const lodCfg = this.lodManager?.atlasConfig || this.textureCache?.lodAtlasConfig;
        if (lodCfg?.maxLODLevels) {
            const clamped = Math.min(lodLevel, lodCfg.maxLODLevels - 1);
            if (clamped !== lodLevel) {
                console.warn(`[TerrainMeshManager] Clamping LOD ${lodLevel} -> ${clamped} (max ${lodCfg.maxLODLevels - 1})`);
                lodLevel = clamped;
            }
        }
        chunkData.lodLevel = lodLevel;

        // =============================================
        // 2. Get Textures (Atlas or Legacy) using the chosen LOD
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
        // 3. Create Geometry
        // =============================================
        const edgeMask = this._computeEdgeMask(chunkData, faceIndex, lodLevel);
        const geometry = this.useInstancing
            ? this._getSharedGeometry(lodLevel, chunkData.size, edgeMask)
            : TerrainGeometryBuilder.build(chunkData, offsetX, offsetZ, lodLevel, { edgeMask, addSkirt: false });
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
                heightScale,
                transmittanceLUT: this._atmosphereLUT?.transmittanceLUT || null,
                aerialPerspectiveEnabled: pConfig?.hasAtmosphere ? 1.0 : 0.0,
                enableInstancing: this.useInstancing && this.backend?.getAPIName?.() === 'webgpu',
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
                edgeMask: edgeMask,
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

        const face = chunkData.face ?? null;
        const lodCfg = this.lodManager?.atlasConfig || this.textureCache?.lodAtlasConfig;
        const lodLevel = typeof chunkData.lodLevel === 'number' ? chunkData.lodLevel : 0;
        const maxLOD = lodCfg?.maxLODLevels ? lodCfg.maxLODLevels - 1 : lodLevel;
        const atlasLOD = Math.min(lodLevel, maxLOD);
        const warnKey = `${chunkX},${chunkY}|${atlasLOD}`;

        // Prefer LOD-aware atlas if available
        if (this.textureCache.getLODAtlasForChunk && lodCfg) {
            const hLod = this.textureCache.getLODAtlasForChunk(chunkX, chunkY, 'height', atlasLOD, face, lodCfg);
            const nLod = this.textureCache.getLODAtlasForChunk(chunkX, chunkY, 'normal', atlasLOD, face, lodCfg);
            const tLod = this.textureCache.getLODAtlasForChunk(chunkX, chunkY, 'tile', atlasLOD, face, lodCfg);
            const sLod = this.textureCache.getLODAtlasForChunk(chunkX, chunkY, 'splatData', atlasLOD, face, lodCfg);
            const mLod = this.textureCache.getLODAtlasForChunk(chunkX, chunkY, 'macro', atlasLOD, face, lodCfg);

            if (hLod && tLod) {
                result.valid = true;
                result.useAtlasMode = true;
                result.atlasKey = hLod.atlasKey.toString();
                result.uvTransform = hLod.uvTransform;
                result.textures = {
                    height: hLod.texture,
                    normal: nLod?.texture || hLod.texture,
                    tile: tLod.texture,
                    splatData: sLod ? sLod.texture : hLod.texture,
                    macro: mLod ? mLod.texture : hLod.texture
                };
                return result;
            }
            // If LOD config is present but atlas missing, request generation once and defer
            this._requestLODAtlasGeneration(chunkX, chunkY, face, atlasLOD, lodCfg, warnKey);
            return result;
        }

        // Fallback to legacy atlas if flagged or present
        if (chunkData.useAtlasMode) {
            const h = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'height', null, face);
            const n = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'normal', null, face);
            const t = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'tile', null, face);
            const s = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'splatData', null, face); 
            const m = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'macro', null, face);

            if (h && t) {
                result.valid = true;
                result.useAtlasMode = true;
                result.atlasKey = h.atlasKey.toString();
                result.uvTransform = h.uvTransform;
                result.textures = {
                    height: h.texture,
                    normal: n?.texture || h.texture,
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

    removeChunk(chunkKeyOrX, chunkY) {
        // Support both string key ("0,0" or "2:7,7:0") and numeric coordinates
        let chunkKey;
        if (typeof chunkKeyOrX === 'string' && chunkY === undefined) {
            chunkKey = chunkKeyOrX;
        } else {
            chunkKey = this.makeChunkKey(chunkKeyOrX, chunkY);
        }

        const meshEntry = this.chunkMeshes.get(chunkKey);
        if (!meshEntry) {
            console.warn(`[TerrainMeshManager] removeChunk: no mesh found for key "${chunkKey}"`);
            return false;
        }

        // Only dispose geometry if NOT using shared instanced geometry
        // Shared geometries are stored in this.sharedGeometries and reused across chunks
        const isSharedGeometry = this.useInstancing && this._isSharedGeometry(meshEntry.geometry);
        if (!isSharedGeometry) {
            meshEntry.geometry.dispose();
        } else {
            console.log(`[TerrainMeshManager] Skipping dispose of shared geometry for chunk ${chunkKey}`);
        }

        this.backend.deleteShader(meshEntry.material);
        meshEntry.material.dispose();

        this.chunkMeshes.delete(chunkKey);
        this.chunkHeightTextures.delete(chunkKey);
        this.chunkNormalTextures.delete(chunkKey);
        this.chunkTileTextures.delete(chunkKey);

        return true;
    }

    _isSharedGeometry(geometry) {
        for (const sharedGeo of this.sharedGeometries.values()) {
            if (sharedGeo === geometry) return true;
        }
        return false;
    }

    cleanup() {
        // Track which geometries we've already disposed to avoid double-dispose
        const disposedGeometries = new Set();

        for (const meshEntry of this.chunkMeshes.values()) {
            // Only dispose geometry if we haven't already (handles shared geometry)
            if (!disposedGeometries.has(meshEntry.geometry)) {
                meshEntry.geometry.dispose();
                disposedGeometries.add(meshEntry.geometry);
            }
            this.backend.deleteShader(meshEntry.material);
            meshEntry.material.dispose();
        }

        // Dispose any shared geometries that might not have been used yet
        for (const sharedGeo of this.sharedGeometries.values()) {
            if (!disposedGeometries.has(sharedGeo)) {
                sharedGeo.dispose();
            }
        }
        this.sharedGeometries.clear();

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

    /**
     * Re-evaluate LODs for loaded chunks and refresh geometry/material/atlas when LOD changes.
     * Call this periodically from the main update loop.
     */
    updateLODs(cameraPosition, planetConfig, sphericalMapper, timeBudgetMs = 4) {
        const now = performance.now();
        if (now - this._lastLODRefresh < this.lodUpdateInterval) return;
        this._lastLODRefresh = now;

        const start = performance.now();
        let changes = 0;
        for (const [chunkKey, meshEntry] of this.chunkMeshes) {
            const chunkData = meshEntry.chunkData;
            const isSpherical = meshEntry.faceIndex >= 0;

            const keyStr = isSpherical
                ? `${meshEntry.faceIndex}:${chunkData.chunkX},${chunkData.chunkY}:0`
                : `${chunkData.chunkX},${chunkData.chunkY}`;

            const newLOD = this.lodManager.getLODForChunkKey(
                keyStr,
                cameraPosition,
                null,
                planetConfig
            );

            // Clamp to available atlas levels
            const lodCfg = this.lodManager?.atlasConfig || this.textureCache?.lodAtlasConfig;
            const clampedLOD = lodCfg?.maxLODLevels ? Math.min(newLOD, lodCfg.maxLODLevels - 1) : newLOD;

            // Simple hysteresis: do not downgrade if within 10% of previous threshold; do not upgrade unless clearly inside
            let proceed = clampedLOD !== chunkData.lodLevel;
            if (proceed && lodCfg?.lodDistances) {
                const dist = this._estimateDistance(chunkData, meshEntry.faceIndex, cameraPosition, planetConfig, sphericalMapper);
                const dists = lodCfg.lodDistances;
                const cur = chunkData.lodLevel;
                if (clampedLOD > cur && cur >= 0 && cur < dists.length) {
                    const threshold = dists[clampedLOD - 1] || 0;
                    if (dist < threshold * 1.1) proceed = false;
                } else if (clampedLOD < cur && clampedLOD >= 0 && clampedLOD < dists.length) {
                    const threshold = dists[clampedLOD] || 0;
                    if (dist > threshold * 0.9) proceed = false;
                }
            }

            // Always recompute edge mask; rebuild if LOD changed or edgeMask changed
            const prevLOD = chunkData.lodLevel;
            const prevEdgeMask = meshEntry.edgeMask || 0;
            const targetLOD = proceed ? clampedLOD : prevLOD;
            const edgeMask = this._computeEdgeMask(chunkData, meshEntry.faceIndex, targetLOD, cameraPosition, planetConfig, sphericalMapper);
            const needsRebuild = proceed || edgeMask !== prevEdgeMask;

            if (needsRebuild) {
                chunkData.lodLevel = targetLOD;
                const textureInfo = this._getChunkTextures(chunkData.chunkX, chunkData.chunkY, chunkData);
                if (!textureInfo.valid) {
                    // Revert if not ready and request generation for next frame
                    chunkData.lodLevel = prevLOD;
                    this._requestLODAtlasGeneration(chunkData.chunkX, chunkData.chunkY, meshEntry.faceIndex, targetLOD, lodCfg);
                    continue;
                }

                const offsetX = chunkData.chunkX * chunkData.size;
                const offsetZ = chunkData.chunkY * chunkData.size;
                const newGeo = this.useInstancing
                    ? this._getSharedGeometry(targetLOD, chunkData.size, edgeMask)
                    : TerrainGeometryBuilder.build(chunkData, offsetX, offsetZ, targetLOD, { edgeMask, addSkirt: false });

                if (newGeo) {
                    const oldIsShared = this.useInstancing && this._isSharedGeometry(meshEntry.geometry);
                    if (!oldIsShared && meshEntry.geometry) {
                        meshEntry.geometry.dispose();
                    }
                    meshEntry.geometry = newGeo;
                    meshEntry.lodLevel = targetLOD;
                    meshEntry.edgeMask = edgeMask;
                    // Update material textures/uniforms
                    const mat = meshEntry.material;
                    mat.uniforms.heightTexture.value = textureInfo.textures.height;
                    mat.uniforms.normalTexture.value = textureInfo.textures.normal;
                    mat.uniforms.tileTexture.value = textureInfo.textures.tile;
                    mat.uniforms.splatDataMap.value = textureInfo.textures.splatData;
                    mat.uniforms.macroMaskTexture.value = textureInfo.textures.macro;
                    if (mat.uniforms.geometryLOD) {
                        mat.uniforms.geometryLOD.value = targetLOD;
                    }
                    meshEntry.useAtlasMode = textureInfo.useAtlasMode;
                    meshEntry.atlasKey = textureInfo.atlasKey;
                    meshEntry.uvTransform = textureInfo.uvTransform;
                    chunkData.useAtlasMode = textureInfo.useAtlasMode;
                    chunkData.atlasKey = textureInfo.atlasKey;
                    chunkData.uvTransform = textureInfo.uvTransform;
                    this.chunkHeightTextures.set(chunkKey, textureInfo.textures.height);
                    this.chunkNormalTextures.set(chunkKey, textureInfo.textures.normal);
                    this.chunkTileTextures.set(chunkKey, textureInfo.textures.tile);
                    if (proceed) {
                        console.log(`[TerrainMeshManager] LOD/edge update for ${chunkKey}: ${prevLOD} -> ${targetLOD}, edgeMask ${prevEdgeMask} -> ${edgeMask}`);
                    }
                    changes++;
                } else {
                    chunkData.lodLevel = prevLOD;
                }
            }

            if (performance.now() - start > timeBudgetMs || changes >= 2) break;
        }
    }

    _estimateDistance(chunkData, faceIndex, cameraPosition, planetConfig, sphericalMapper) {
        if (faceIndex >= 0 && planetConfig && sphericalMapper) {
            const chunksPerFace = sphericalMapper.chunksPerFace;
            const planetRadius = planetConfig.radius;
            const origin = planetConfig.origin;
            const u = (chunkData.chunkX + 0.5) / chunksPerFace;
            const v = (chunkData.chunkY + 0.5) / chunksPerFace;
            const cubePoint = this.getCubePoint(faceIndex, u, v);
            const len = Math.sqrt(cubePoint.x * cubePoint.x + cubePoint.y * cubePoint.y + cubePoint.z * cubePoint.z);
            const sphereDir = { x: cubePoint.x / len, y: cubePoint.y / len, z: cubePoint.z / len };
            const chunkWorldPos = {
                x: origin.x + sphereDir.x * planetRadius,
                y: origin.y + sphereDir.y * planetRadius,
                z: origin.z + sphereDir.z * planetRadius
            };
            const dx = cameraPosition.x - chunkWorldPos.x;
            const dy = cameraPosition.y - chunkWorldPos.y;
            const dz = cameraPosition.z - chunkWorldPos.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        const dx = (chunkData.chunkX + 0.5) * chunkData.size - cameraPosition.x;
        const dz = (chunkData.chunkY + 0.5) * chunkData.size - cameraPosition.z;
        return Math.sqrt(dx * dx + dz * dz + (cameraPosition.y || 0) * (cameraPosition.y || 0));
    }

    _getSharedGeometry(lodLevel, chunkSize, edgeMask = 0) {
        const key = `${lodLevel}|${chunkSize}|${edgeMask}`;
        if (this.sharedGeometries.has(key)) return this.sharedGeometries.get(key);
        const dummyChunk = { size: chunkSize, heights: null };
        const geo = TerrainGeometryBuilder.build(dummyChunk, 0, 0, lodLevel, { edgeMask, addSkirt: false });
        this.sharedGeometries.set(key, geo);
        return geo;
    }

    _requestLODAtlasGeneration(chunkX, chunkY, face, lod, lodCfg, warnKey = null) {
        const cfg = lodCfg || this.lodManager?.atlasConfig || this.textureCache?.lodAtlasConfig;
        const terrainGen = this.worldGenerator?.modules?.tiledTerrain?.instance;
        if (!cfg || !terrainGen?.generateLODAtlasTextures || !LODTextureAtlasKey) {
            return;
        }
        const key = warnKey || `${face ?? 'f'}:${chunkX},${chunkY}|${lod}`;
        if (this._pendingLODAtlasRequests.has(key)) return;

        const atlasKey = LODTextureAtlasKey.fromChunkCoords(chunkX, chunkY, lod, face ?? null, cfg);
        console.warn(`[TerrainMeshManager] Missing LOD atlas for chunk ${chunkX},${chunkY} at lod ${lod} - generating`);
        const promise = terrainGen.generateLODAtlasTextures(atlasKey, cfg)
            .catch(err => console.error('[TerrainMeshManager] Failed to generate LOD atlas', atlasKey.toString(), err))
            .finally(() => this._pendingLODAtlasRequests.delete(key));
        this._pendingLODAtlasRequests.set(key, promise);
    }

    _computeEdgeMask(chunkData, faceIndex, lodLevel, cameraPosition = null, planetConfig = null, sphericalMapper = null) {
        const neighbors = [
            { dx: 0, dy: -1, bit: 1 }, // top
            { dx: 1, dy: 0, bit: 2 },  // right
            { dx: 0, dy: 1, bit: 4 },  // bottom
            { dx: -1, dy: 0, bit: 8 }, // left
        ];
        let mask = 0;
        for (const n of neighbors) {
            const neighborLOD = this._getNeighborLOD(chunkData, faceIndex, n.dx, n.dy, cameraPosition, planetConfig, sphericalMapper);
            if (neighborLOD > lodLevel) {
                mask |= n.bit;
            }
        }
        return mask;
    }

    _getNeighborLOD(chunkData, faceIndex, dx, dy, cameraPosition = null, planetConfig = null, sphericalMapper = null) {
        const nx = chunkData.chunkX + dx;
        const ny = chunkData.chunkY + dy;
        const key = faceIndex >= 0 ? `${faceIndex}:${nx},${ny}:0` : `${nx},${ny}`;
        const neighbor = this.chunkMeshes.get(key);
        if (neighbor && typeof neighbor.lodLevel === 'number') {
            return neighbor.lodLevel;
        }
        // Fallback: estimate using LOD manager if available
        if (this.lodManager) {
            const cam = cameraPosition || this.uniformManager?.uniforms?.cameraPosition?.value || { x: 0, y: 0, z: 0 };
            const keyStr = faceIndex >= 0 ? `${faceIndex}:${nx},${ny}:0` : `${nx},${ny}`;
            try {
                return this.lodManager.getLODForChunkKey(keyStr, cam, null, planetConfig || this.planetConfig);
            } catch (e) {
                // ignore
            }
        }
        return chunkData.lodLevel ?? 0;
    }
}
