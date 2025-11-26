
import { TerrainMeshManager } from "./terrain/TerrainMeshManager.js";

import { FeatureChunkBatch } from "./props/FeatureChunkBatch.js";
import { WaterMeshManager } from './water/WaterMeshManager.js';
import { ChunkLoadQueue } from './chunkLoadQueue.js';

export class MasterChunkLoader {

    constructor(backend, textureManager, textureCache, uniformManager, lodManager, altitudeZoneManager, chunkSize, cacheSize = 100) {
        this._backend = backend;
        this.textureManager = textureManager;
        this.textureCache = textureCache;
        this.uniformManager = uniformManager;
        this.lodManager = lodManager;
        this.altitudeZoneManager = altitudeZoneManager; // NEW: Injected via constructor
        this.chunkSize = chunkSize;
    

        // Initialize terrainMeshManager if we have a backend
        if (backend) {
            this.terrainMeshManager = new TerrainMeshManager(
                backend,
                textureManager,
                textureCache,
                uniformManager,
                lodManager
            );
        } else {
            this.terrainMeshManager = null;
        }

        // Water mesh manager - note: terrainMeshManager might be null
        this.waterMeshManager = new WaterMeshManager(
            this.terrainMeshManager,
            textureManager,
            uniformManager,
            chunkSize
        );

        this.chunkLifecycle = new Map();

        // Streamed features disabled for now
        this.streamedFeatureManager = null;

        this.lastCacheCleanup = 0;
        this.cacheCleanupInterval = 5000;
        this.loadedChunks = new Map();
        
        this.debugStats = {
            loadsThisSecond: 0,
            unloadsThisSecond: 0,
            lastSecond: performance.now()
        };

        this.loadQueue = new ChunkLoadQueue(2);
        this.chunkDataCache = new Map();
    }

    set backend(value) {
        this._backend = value;
        if (value && !this.terrainMeshManager) {
            this.terrainMeshManager = new TerrainMeshManager(
                value,
                this.textureManager,
                this.textureCache,
                this.uniformManager,
                this.lodManager
            );
            // Update water mesh manager reference
            if (this.waterMeshManager) {
                this.waterMeshManager.terrainMeshManager = this.terrainMeshManager;
            }
        }
    }

    get backend() {
        return this._backend;
    }

    async initialize() {
        console.log('MasterChunkLoader initialized');
    }
    async update(cameraPosition, terrain, deltaTime) {
        this.queueChunkOperations(cameraPosition, terrain);
        await this.processQueues(terrain);
        
        const now = performance.now();
        if (now - this.lastCacheCleanup > this.cacheCleanupInterval) {
            this.cleanupCache();
            this.lastCacheCleanup = now;
        }
    }

    
    cleanupCache() {
        // Remove stale entries from chunkDataCache
        const maxCacheAge = 30000; // 30 seconds
        const now = performance.now();
        
        for (const [key, data] of this.chunkDataCache.entries()) {
            if (!data.timestamp) data.timestamp = now;
            if (now - data.timestamp > maxCacheAge && !this.loadQueue.pendingLoads.has(key)) {
                this.chunkDataCache.delete(key);
            }
        }
        
        // Log cache sizes for debugging
        if (this.chunkDataCache.size > 50) {
            console.warn(`Large chunkDataCache size: ${this.chunkDataCache.size}`);
        }
    }
    queueChunkOperations(cameraPosition, terrain) {
        const viewDistance = 160;
    
        const minChunkX = Math.floor((cameraPosition.x - viewDistance) / this.chunkSize);
        const maxChunkX = Math.ceil((cameraPosition.x + viewDistance) / this.chunkSize);
        const minChunkZ = Math.floor((cameraPosition.z - viewDistance) / this.chunkSize);
        const maxChunkZ = Math.ceil((cameraPosition.z + viewDistance) / this.chunkSize);
    
        const visibleChunks = new Set();
    
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                const chunkKey = `${cx},${cz}`;
                visibleChunks.add(chunkKey);
    
                if (!this.loadedChunks.has(chunkKey) && terrain.has(chunkKey)) {
                    const chunkCenterX = cx * this.chunkSize + this.chunkSize / 2;
                    const chunkCenterZ = cz * this.chunkSize + this.chunkSize / 2;
                    const dx = chunkCenterX - cameraPosition.x;
                    const dz = chunkCenterZ - cameraPosition.z;
                    const distSq = dx * dx + dz * dz;
                    const priority = 1000000 / (distSq + 1);
    
                    this.loadQueue.queueLoad(chunkKey, priority);
    
                    if (!this.chunkDataCache.has(chunkKey)) {
                        this.chunkDataCache.set(chunkKey, {
                            chunkData: terrain.get(chunkKey),
                            cameraPosition: cameraPosition.clone ? cameraPosition.clone() : { ...cameraPosition },
                            timestamp: performance.now()
                        });
                    }
                }
            }
        }
    
        for (const loadedKey of this.loadedChunks.keys()) {
            if (!visibleChunks.has(loadedKey)) {
                this.loadQueue.queueUnload(loadedKey);
            }
        }
    
        this.loadQueue.sortByPriority();
    }
    
    async processQueues(terrain) {
        const startTime = performance.now();
        const maxTime = 8;
    
        const unloads = this.loadQueue.getNextUnloads(3);
        for (const chunkKey of unloads) {
            this.unloadChunk(chunkKey);
            this.debugStats.unloadsThisSecond++;
            if (performance.now() - startTime > maxTime) break;
        }
    
        if (performance.now() - startTime < maxTime) {
            const loads = this.loadQueue.getNextLoads(3);
            for (const chunkKey of loads) {
                const cached = this.chunkDataCache.get(chunkKey);
                if (cached) {
                    // No altitudeZoneManager parameter needed
                    await this.loadChunkSync(
                        chunkKey,
                        cached.chunkData,
                        cached.cameraPosition
                    );
                    this.chunkDataCache.delete(chunkKey);
                    this.debugStats.loadsThisSecond++;
                }
                if (performance.now() - startTime > maxTime) break;
            }
        }
    
        const now = performance.now();
        if (now - this.debugStats.lastSecond > 1000) {
            if (this.debugStats.loadsThisSecond > 0 || this.debugStats.unloadsThisSecond > 0) {
                console.log(`⚡ Chunk ops/sec: ${this.debugStats.loadsThisSecond} loads, ${this.debugStats.unloadsThisSecond} unloads`);
            }
            this.debugStats.loadsThisSecond = 0;
            this.debugStats.unloadsThisSecond = 0;
            this.debugStats.lastSecond = now;
        }
    }
  

    
    loadWaterFeaturesSync(chunkKey, waterFeatures, chunkData, environmentState) {
        return;
        if (!waterFeatures || waterFeatures.length === 0) return [];
        if (chunkData.isFullyAboveWater) return [];
        
        const waterMeshes = [];
        const globalSeaLevel = 8.0;
        
        for (const feature of waterFeatures) {
            const mesh = this.waterMeshManager.createWaterMeshSync(
                feature, chunkKey, chunkData, globalSeaLevel, environmentState
            );
            if (mesh) {
                this.scene.add(mesh);
                waterMeshes.push(mesh);
            }
        }
        
        return waterMeshes;
    }

    async loadWaterFeatures(chunkKey, waterFeatures, chunkData, environmentState) {
        return await this.waterMeshManager.loadWaterFeatures(
            chunkKey, waterFeatures, chunkData, environmentState
        );
    }

    async loadTerrainGrid(chunkKey, chunkData, environmentState) {
        this.terrainMeshManager.addChunk(chunkData, environmentState);
        const terrainMesh = this.terrainMeshManager.chunkMeshes.get(chunkKey);
        if (!terrainMesh) throw new Error("Failed to load terrain mesh");
        return terrainMesh;
    }

    updateEnvUniforms(environmentState) {
        this.terrainMeshManager.updateEnvUniforms(environmentState);
    }

    async loadChunk(chunkKey, chunkData, environmentState, cameraPosition = null) {
        // Original implementation unchanged
        const terrainMesh = await this.loadTerrainGrid(chunkKey, chunkData, environmentState);


/*
        for (let feature of features) {
            if (feature.requiresTerrainRimNormals) {
                feature.attachTerrainAccessor(accessor);
            }
            const geometry = await this.featureMeshManager.getGeometryForLod(feature, 0);
            if (geometry) featureGeometries.push(geometry);
        }

        let terrainFeatureBatch = null;
        if (featureGeometries.length > 0) {
            const mergedGeometry = simpleMergeGeometries(featureGeometries);
            const mergedMaterial = terrainMesh.material.clone();
            if (mergedMaterial.uniforms) mergedMaterial.uniforms.isFeature = { value: 1.0 };
            terrainFeatureBatch = new THREE.Mesh(mergedGeometry, mergedMaterial);
            terrainFeatureBatch.name = `ChunkBatchMesh[${chunkKey}]`;
            this.scene.add(terrainFeatureBatch);
        }

        const staticFeatures = chunkData.staticFeatures ?? [];
        for (let feature of staticFeatures) {
            if (feature.requiresTerrainRimNormals) {
                feature.attachTerrainAccessor(accessor);
            }
        }
        const staticFeatureBatch = await this.loadStaticMeshesLOD(
            chunkKey, staticFeatures, chunkData, environmentState
        );
*/
        const waterMeshes = await this.loadWaterFeatures(
            chunkKey, chunkData.waterFeatures || [], chunkData, environmentState
        );

        this.loadedChunks.set(chunkKey, {
            chunkData,
            terrainFeatureBatch,
            staticFeatureBatch,
            waterMeshes
        });

        return { terrainMesh, waterMeshes };
    }

    async loadStaticMeshesLOD(chunkKey, staticFeatures, chunkData, environmentState) {
        if (!this.loadedChunks.has(chunkKey)) this.loadedChunks.set(chunkKey, {});
        const chunkEntry = this.loadedChunks.get(chunkKey);

        if (!chunkEntry.featureBatch) {
            chunkEntry.featureBatch = new FeatureChunkBatch(this.scene);
        }
        const batch = chunkEntry.featureBatch;

        const groupByTypeVariant = {};
        for (const feature of staticFeatures) {
            const type = feature.type;
            const subtype = feature.subtype || 'default';
            const variant = feature.variant ?? 0;
            const key = `${type}__${subtype}__${variant}`;

            if (!groupByTypeVariant[key]) groupByTypeVariant[key] = [];
            groupByTypeVariant[key].push(feature);
        }

        const lod = chunkData.lodLevel || 0;
        const chunkBounds = {
            minX: chunkData.chunkX * chunkData.size,
            minZ: chunkData.chunkY * chunkData.size,
            maxX: (chunkData.chunkX + 1) * chunkData.size,
            maxZ: (chunkData.chunkY + 1) * chunkData.size,
            size: chunkData.size
        };

        const heightTexture = this.terrainMeshManager.getHeightTexture(chunkData.chunkX, chunkData.chunkY);
        const normalTexture = this.terrainMeshManager.getNormalTexture(chunkData.chunkX, chunkData.chunkY);
        for (const [key, group] of Object.entries(groupByTypeVariant)) {
            if (!batch.batches[key] || !batch.batches[key][lod]) {
                const meshOrSprite = await this.featureMeshManager.getInstancedMeshLOD(
                    group, heightTexture, normalTexture, chunkBounds, environmentState, lod
                );

                if (meshOrSprite) {
                    batch.addBatch(key, lod, meshOrSprite);
                }
            }

            batch.setLod(key, lod);
        }

        return batch;
    }
    async loadTerrainGridSync(chunkKey, chunkData, environmentState) {
        if (this.terrainMeshManager.chunkMeshes.has(chunkKey)) {
            return this.terrainMeshManager.chunkMeshes.get(chunkKey);
        }
    
        // 1. Get Spherical Coordinates
        // The Mapper tells us "This is Face 2, Top-Left UV 0.25,0.25"
        if (this.sphericalChunkMapper) {
            const faceInfo = this.sphericalChunkMapper.getFaceAndLocalCoords(chunkKey);
            chunkData.faceIndex = faceInfo.face;
            chunkData.faceU = faceInfo.uMin;
            chunkData.faceV = faceInfo.vMin;
            chunkData.faceSize = faceInfo.uMax - faceInfo.uMin;
        }

        // 2. Create Mesh Entry (Geometry + Material)
        // Note: TerrainMeshManager should create geometry at local 0,0 
        // because the Vertex Shader handles the world positioning.
        const meshEntry = await this.terrainMeshManager.addChunk(
            chunkData, 
            environmentState
        );
        
        if (!meshEntry) {
            console.error(`🔴 Failed to create terrain mesh for ${chunkKey}`);
            return null;
        }

        // 3. NO SCENE ADDITION
        // We just return the entry. Frontend iterates terrainMeshManager.chunkMeshes to draw.
        // this.scene.add(meshEntry.mesh); <--- DELETED

        return meshEntry;
    }
    async loadChunkSync(chunkKey, chunkData, cameraPosition) {
        if (!chunkData) {
            console.error(`loadChunkSync: No chunk data for ${chunkKey}`);
            return;
        }
    
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        
        if (chunkData.chunkX === undefined) chunkData.chunkX = chunkX;
        if (chunkData.chunkY === undefined) chunkData.chunkY = chunkZ;
    
        const hasTextures = 
            this.textureCache.get(chunkX, chunkZ, 'height') &&
            this.textureCache.get(chunkX, chunkZ, 'tile') &&
            this.textureCache.get(chunkX, chunkZ, 'splatWeight');
        
        if (!hasTextures) {
            console.error(`🔴 Missing textures for ${chunkKey}`);
            return;
        }
    
        if (this.loadedChunks.has(chunkKey)) {
            console.warn(`⚠️ ${chunkKey} already loaded`);
            return;
        }
    
        const loadStart = performance.now();
        const environmentState = this.uniformManager?.currentEnvironmentState || {};
    
        // Uses injected altitudeZoneManager internally
        const terrainMesh = await this.loadTerrainGridSync(chunkKey, chunkData, environmentState);
        
        if (!terrainMesh) {
            console.error(`🔴 Failed to load terrain for ${chunkKey}`);
            return;
        }
    
        // LOD calculation uses injected altitudeZoneManager
        const lodLevel = this.lodManager.getLODForChunkKey(
            chunkKey, 
            cameraPosition,
            this.altitudeZoneManager  // Use injected instance
        );
        chunkData.lodLevel = lodLevel;
    
        this.loadedChunks.set(chunkKey, {
            chunkData,
            terrainFeatureBatch: null,
            waterMeshes: []
        });
    
        const loadTime = performance.now() - loadStart;
        console.log(`✅ Loaded ${chunkKey} in ${loadTime.toFixed(1)}ms (LOD ${lodLevel})`);
    }
    unloadChunk(chunkKey) {
        const lifecycle = this.chunkLifecycle.get(chunkKey) || [];
        lifecycle.push({ 
            event: 'UNLOAD_START', 
            time: performance.now(),
            hasEntry: this.loadedChunks.has(chunkKey)
        });
    
        const entry = this.loadedChunks.get(chunkKey);
        if (!entry) {
            console.error(` UNLOAD FAILED: ${chunkKey} not in loadedChunks`);
            console.log(`Lifecycle:`, lifecycle.slice(-5));
            return;
        }
    
    

        if (entry.featureBatch) entry.featureBatch.disposeAll();
        if (entry.terrainFeatureBatch) {
            entry.terrainFeatureBatch.geometry.dispose();
            entry.terrainFeatureBatch.material.dispose();
        }
        if (entry.waterMeshes) {
            for (const waterMesh of entry.waterMeshes) {
                waterMesh.geometry.dispose();
                waterMesh.material.dispose();
            }
        }
    
        const [cx, cz] = chunkKey.split(',').map(Number);
        const terrainMesh = this.terrainMeshManager.chunkMeshes.get(chunkKey);
        if (terrainMesh) {

        } else {
            console.warn(`No terrain mesh found for ${chunkKey} during unload`);
        }
    
        if (this.streamedFeatureManager) {
            this.streamedFeatureManager.onTerrainChunkUnloaded(cx, cz, chunkKey);
        }
        
        this.loadedChunks.delete(chunkKey);
        this.terrainMeshManager.removeChunk(cx, cz);
    
        lifecycle.push({ 
            event: 'UNLOAD_COMPLETE', 
            time: performance.now()
        });
    
        // Check for rapid reload
        const recentEvents = lifecycle.slice(-10);
        const rapidReload = recentEvents.filter(e => 
            e.event === 'LOAD_START' && 
            performance.now() - e.time < 1000
        ).length > 1;
    
        if (rapidReload) {
            console.error(` RAPID RELOAD DETECTED: ${chunkKey}`);
            console.log(`Recent events:`, recentEvents);
        }
    }
    cleanupAll() {
        this.terrainMeshManager.cleanup();
        this.featureMeshManager.cleanup();
        this.streamedFeatureManager.dispose();
        this.loadedChunks.clear();
        this.loadQueue.clear();
        this.chunkDataCache.clear();
    }
}