// js/mesh/masterChunkLoader.js
import { TerrainMeshManager } from "./terrain/TerrainMeshManager.js";
import { WaterMeshManager } from './water/WaterMeshManager.js';
import { ChunkLoadQueue } from './chunkLoadQueue.js';
import { ChunkKey } from '../world/chunkKey.js';
import { TextureAtlasKey } from '../world/textureAtlasKey.js';

export class MasterChunkLoader {

    constructor(backend, textureManager, textureCache, uniformManager, lodManager, altitudeZoneManager, chunkSize, cacheSize = 100) {
        this._backend = backend;
        this.textureManager = textureManager;
        this.textureCache = textureCache;
        this.uniformManager = uniformManager;
        this.lodManager = lodManager;
        this.altitudeZoneManager = altitudeZoneManager;
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

        // Water mesh manager
        this.waterMeshManager = new WaterMeshManager(
            this.terrainMeshManager,
            textureManager,
            uniformManager,
            chunkSize
        );

        this.chunkLifecycle = new Map();
        this.lastCacheCleanup = 0;
        this.cacheCleanupInterval = 5000;
        this.loadedChunks = new Map(); // Maps string key -> entry
        
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

    /**
     * Main update loop called by Frontend
     */
    async update(cameraPosition, terrain, deltaTime, planetConfig, sphericalMapper) {

        // 1. Queue operations based on camera distance
        this.queueChunkOperations(cameraPosition, terrain);
        
        // 2. Process the async load/unload queues
        await this.processQueues(terrain, planetConfig, sphericalMapper);
        
        // 3. Periodic cache cleanup
        const now = performance.now();
        if (now - this.lastCacheCleanup > this.cacheCleanupInterval) {
            this.cleanupCache();
            this.lastCacheCleanup = now;
        }
    }

    cleanupCache() {
        const maxCacheAge = 30000; // 30 seconds
        const now = performance.now();
        
        for (const [key, data] of this.chunkDataCache.entries()) {
            if (!data.timestamp) data.timestamp = now;
            if (now - data.timestamp > maxCacheAge && !this.loadQueue.pendingLoads.has(key)) {
                this.chunkDataCache.delete(key);
            }
        }
        
        if (this.chunkDataCache.size > 200) {
            console.warn(`Large chunkDataCache size: ${this.chunkDataCache.size}`);
        }
    }

    queueChunkOperations(cameraPosition, terrain) {

        const visibleChunkKeys = new Set(terrain.keys());

        // 1. Queue LOADS for visible chunks not yet loaded
        for (const [chunkKeyStr, chunkData] of terrain) {
            if (!this.loadedChunks.has(chunkKeyStr)) {
                
                let distSq = 0;
                
                if (chunkData.isSpherical && this.altitudeZoneManager) {

                    distSq = 100; 
                } else {
                    // Flat distance
                    const chunkCenterX = chunkData.chunkX * this.chunkSize + this.chunkSize / 2;
                    const chunkCenterZ = chunkData.chunkY * this.chunkSize + this.chunkSize / 2;
                    const dx = chunkCenterX - cameraPosition.x;
                    const dz = chunkCenterZ - cameraPosition.z;
                    distSq = dx * dx + dz * dz;
                }

                const priority = 1000000 / (distSq + 1);

                this.loadQueue.queueLoad(chunkKeyStr, priority);

                // Cache data needed for loading
                if (!this.chunkDataCache.has(chunkKeyStr)) {
                    this.chunkDataCache.set(chunkKeyStr, {
                        chunkData: chunkData,
                        cameraPosition: cameraPosition.clone ? cameraPosition.clone() : { ...cameraPosition },
                        timestamp: performance.now()
                    });
                }
            }
        }

        for (const loadedKey of this.loadedChunks.keys()) {
            if (!visibleChunkKeys.has(loadedKey)) {
                this.loadQueue.queueUnload(loadedKey);
            }
        }

        this.loadQueue.sortByPriority();
    }

    async processQueues(terrain, planetConfig, sphericalMapper) {
        const startTime = performance.now();
        const maxTime = 8; // ms per frame budget for chunk ops

        const unloads = this.loadQueue.getNextUnloads(5);
        for (const chunkKey of unloads) {
            this.unloadChunk(chunkKey);
            this.debugStats.unloadsThisSecond++;
            if (performance.now() - startTime > maxTime) break;
        }
      

        if (performance.now() - startTime < maxTime) {
            const loads = this.loadQueue.getNextLoads(3);
            for (const chunkKeyStr of loads) {
                const cached = this.chunkDataCache.get(chunkKeyStr);
          
                const chunkData = cached?.chunkData || terrain.get(chunkKeyStr);
                const camPos = cached?.cameraPosition || { x: 0, y: 0, z: 0 };

                if (chunkData) {
                    await this.loadChunkSync(chunkKeyStr, chunkData, camPos, planetConfig, sphericalMapper);
                    this.chunkDataCache.delete(chunkKeyStr);
                    this.debugStats.loadsThisSecond++;
                }
                if (performance.now() - startTime > maxTime) break;
            }
        }

        // Debug logging
        const now = performance.now();
        if (now - this.debugStats.lastSecond > 1000) {
            if (this.debugStats.loadsThisSecond > 0 || this.debugStats.unloadsThisSecond > 0) {
                // console.log(`⚡ Chunk ops/sec: ${this.debugStats.loadsThisSecond} loads, ${this.debugStats.unloadsThisSecond} unloads`);
            }
            this.debugStats.loadsThisSecond = 0;
            this.debugStats.unloadsThisSecond = 0;
            this.debugStats.lastSecond = now;
        }
    }

    /**
     * Load a chunk synchronously (GPU upload happens here)
     */
    async loadChunkSync(chunkKeyStr, chunkData, cameraPosition, planetConfig, sphericalMapper) {
        if (!chunkData) {
            console.error(`loadChunkSync: No chunk data for ${chunkKeyStr}`);
            return;
        }

        // Parse key to support both Flat ("x,y") and Spherical ("face:x,y:lod")
        const keyObj = ChunkKey.fromString(chunkKeyStr);
        const chunkX = keyObj.x;
        const chunkY = keyObj.y;
        const face = keyObj.face; // null for flat


        let hasTextures = false;
        let useAtlas = false;
        let atlasKey = null;

        // Check for Atlas existence first (Preferred)
        if (this.textureCache.hasAtlasForChunk) {
            // "height" is the minimum required texture type
            if (this.textureCache.hasAtlasForChunk(chunkX, chunkY, 'height', null, face)) {
                hasTextures = true;
                useAtlas = true;
                // Get the Atlas Key for metadata
                const atlasData = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'height', null, face);
                atlasKey = atlasData.atlasKey;
     
                chunkData.useAtlasMode = true;
                chunkData.atlasKey = atlasData.atlasKey;
                chunkData.uvTransform = atlasData.uvTransform;
            }
        }

        // Fallback to legacy single-texture check
        if (!hasTextures) {
            hasTextures = this.textureCache.get(chunkX, chunkY, 'height') &&
                          this.textureCache.get(chunkX, chunkY, 'tile');
            if (hasTextures) {
                chunkData.useAtlasMode = false;
            }
        }

        if (!hasTextures) {
            // Textures not ready in cache yet (generation is async)

            return; 
        }

        if (this.loadedChunks.has(chunkKeyStr)) {
            return; // Already loaded
        }

        const loadStart = performance.now();
        const environmentState = this.uniformManager?.currentEnvironmentState || {};

        chunkData.chunkX = chunkX;
        chunkData.chunkY = chunkY;
        if (face !== null) chunkData.face = face;

        const meshEntry = await this.terrainMeshManager.addChunk(chunkData, environmentState, chunkKeyStr, planetConfig, sphericalMapper);

        if (!meshEntry) {
            console.error(`Failed to create mesh for ${chunkKeyStr}`);
            return;
        }

        const lodLevel = this.lodManager.getLODForChunkKey(
            chunkKeyStr, 
            cameraPosition, 
            this.altitudeZoneManager
        );
        chunkData.lodLevel = lodLevel;

        // Load Water (Optional)
        const waterMeshes = await this.loadWaterFeatures(
            chunkKeyStr, chunkData.waterFeatures || [], chunkData, environmentState
        );

        // Store in loaded map
        this.loadedChunks.set(chunkKeyStr, {
            chunkData,
            terrainFeatureBatch: null, // Features temporarily disabled for migration
            waterMeshes
        });


    }

    async loadWaterFeatures(chunkKey, waterFeatures, chunkData, environmentState) {
        if (!this.waterMeshManager) return [];
        return await this.waterMeshManager.loadWaterFeatures(
            chunkKey, waterFeatures, chunkData, environmentState
        );
    }

    unloadChunk(chunkKeyStr) {
        const entry = this.loadedChunks.get(chunkKeyStr);
        if (!entry) return;

        // 1. Clean up meshes
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

        // 2. Notify Managers
        const keyObj = ChunkKey.fromString(chunkKeyStr);
        
   
        this.terrainMeshManager.removeChunk(chunkKeyStr);

        if (this.streamedFeatureManager) {
            this.streamedFeatureManager.onTerrainChunkUnloaded(keyObj.x, keyObj.y, chunkKeyStr);
        }
        
    
        if (this.textureCache.releaseChunkFromAtlas) {
            this.textureCache.releaseChunkFromAtlas(
                keyObj.x, 
                keyObj.y, 
                null, // config (default)
                keyObj.face
            );
        }

        this.loadedChunks.delete(chunkKeyStr);
    }

    cleanupAll() {
        if (this.terrainMeshManager) this.terrainMeshManager.cleanup();
        if (this.waterMeshManager) this.waterMeshManager.cleanup();
        
        if (this.streamedFeatureManager) this.streamedFeatureManager.dispose();
        
        this.loadedChunks.clear();
        this.loadQueue.clear();
        this.chunkDataCache.clear();
        console.log("MasterChunkLoader cleaned up");
    }
}