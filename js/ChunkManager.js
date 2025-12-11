import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { PlanetaryChunkAddress } from './planet/planetaryChunkAddress.js';

export class ChunkManager {
    constructor(worldGenerator, options = {}) {
        this.worldGenerator = worldGenerator;
        this.loadedChunks = new Map();
        this.chunkSize = this.worldGenerator.chunkSize;
        
        this.sphericalMapper = options.sphericalMapper || null;
        this.useSphericalProjection = options.useSphericalProjection && this.sphericalMapper !== null;
        
        console.log(` ChunkManager mode: ${this.useSphericalProjection ? 'SPHERICAL' : 'FLAT'}`);

        this.pendingChunks = new Map();
        this.chunkQueue = [];
        this.maxConcurrentChunks = 2;
        this.isProcessing = false;

        this.chunkReadyCallbacks = new Map();
        this.progressCallbacks = new Set();
        this.chunkLoadRadius = 2;
        
        this.lastPlayerChunk = null;
        this._debugFrameCount = 0;
    }

    async initialize() {
        console.log("Chunk manager initializing...");
        console.log(`  Mode: ${this.useSphericalProjection ? 'SPHERICAL' : 'FLAT'}`);
        
        if (this.useSphericalProjection && this.sphericalMapper) {
            console.log("  Spherical mode - waiting for camera position");
            console.log("Chunk manager ready (spherical)");
            return;
        }
        
        // Flat mode - load initial chunks around origin
        const promises = [];
        for (let chunkY = -1; chunkY <= 1; chunkY++) {
            for (let chunkX = -1; chunkX <= 1; chunkX++) {
                const distance = Math.abs(chunkX) + Math.abs(chunkY);
                const key = `${chunkX},${chunkY}`;
                promises.push(this.requestChunk(key, 10 - distance));
            }
        }
        await Promise.allSettled(promises);
        console.log(`Chunk manager ready (flat), loaded: ${this.loadedChunks.size}`);
    }

    async update(playerX, playerY, playerZ = null) {
        this._debugFrameCount++;
        
        if (this.useSphericalProjection && this.sphericalMapper) {
            this._updateSpherical(playerX, playerY, playerZ);
        } else {
            this._updateFlat(playerX, playerY);
        }
        
        this._processChunkQueue();
    }

    _updateSpherical(playerX, playerY, playerZ) {
        const altitude = playerZ ?? 50;
        
        // Convert game coords to Three.js coords
        // Game: (x, y, z) where z = altitude
        // Three: (x, y, z) where y = altitude
        const cameraRenderPos = new THREE.Vector3(
            playerX,
            altitude,
            playerY
        );
        
        // Debug log every 60 frames
        if (this._debugFrameCount % 60 === 1) {
            console.log(' Spherical update:', {
                gameCoords: { x: playerX, y: playerY, z: altitude },
                threeCoords: { x: cameraRenderPos.x, y: cameraRenderPos.y, z: cameraRenderPos.z },
                distFromOrigin: cameraRenderPos.length().toFixed(0),
                planetRadius: this.sphericalMapper.config.radius
            });
        }
        
        const chunkKeys = this.sphericalMapper.getChunksInRadius(
            cameraRenderPos, 
            this.chunkLoadRadius * this.chunkSize
        );
        
        if (this._debugFrameCount === 1) {
            console.log(` First spherical update:`, {
                chunkCount: chunkKeys.length,
                sampleKeys: chunkKeys.slice(0, 3)
            });
        }
        
        this._updateChunkSet(chunkKeys);
    }
    
    _updateFlat(playerX, playerY) {
        const viewDistance = 160;
        
        const minChunkX = Math.floor((playerX - viewDistance) / this.chunkSize);
        const maxChunkX = Math.ceil((playerX + viewDistance) / this.chunkSize);
        const minChunkY = Math.floor((playerY - viewDistance) / this.chunkSize);
        const maxChunkY = Math.ceil((playerY + viewDistance) / this.chunkSize);
        
        const chunkKeys = [];
        
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cy = minChunkY; cy <= maxChunkY; cy++) {
                chunkKeys.push(`${cx},${cy}`);
            }
        }
        
        this._updateChunkSet(chunkKeys);
    }

    _updateChunkSet(chunkKeys) {
        const visibleSet = new Set(chunkKeys);
        
        if (visibleSet.size === 0) {
            if (this._debugFrameCount === 1) {
                console.warn('No visible chunks in first update!');
            }
            return;
        }
        
        // Debug first update
        if (this._debugFrameCount === 1 && chunkKeys.length > 0) {
            console.log('First chunk keys:', chunkKeys.slice(0, 5));
        }
        
        // Unload chunks not in visible set
        for (const [key, chunkData] of this.loadedChunks) {
            if (!visibleSet.has(key)) {
                this.unloadChunk(key);
            }
        }
        
        for (const key of chunkKeys) {
            if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
   
                this.requestChunk(key, 0);
            }
        }
    }

    _estimateChunkDistance(chunkX, chunkY, face = null) {
        const cam = this.lastCameraPosition || { x: 0, y: 0, z: 0 };
        const chunkCenterX = (chunkX + 0.5) * this.chunkSize;
        const chunkCenterZ = (chunkY + 0.5) * this.chunkSize;
        const dx = chunkCenterX - cam.x;
        const dz = chunkCenterZ - cam.z;
        const dy = cam.y || 0;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    async requestChunk(chunkKeyOrX, priorityOrY = 0, onReady = null) {
        let chunkKey;
        let priority = 0;
        
        if (typeof chunkKeyOrX === 'string') {
            // New format: requestChunk("2:7,7:0", priority)
            chunkKey = chunkKeyOrX;
            priority = typeof priorityOrY === 'number' ? priorityOrY : 0;
        } else if (typeof chunkKeyOrX === 'number' && typeof priorityOrY === 'number') {
            // Legacy format: requestChunk(x, y, priority)
            // This is for FLAT mode only
            chunkKey = `${chunkKeyOrX},${priorityOrY}`;
            priority = onReady || 0;
            onReady = null;
        } else {
            console.error('requestChunk: Invalid arguments', chunkKeyOrX, priorityOrY);
            return null;
        }
        
        // Already loaded?
        if (this.loadedChunks.has(chunkKey)) {
            return this.loadedChunks.get(chunkKey);
        }
        
        // Already pending?
        if (this.pendingChunks.has(chunkKey)) {
            return null;
        }
        
        // Queue for loading
        this.chunkQueue.push({ 
            chunkKey, 
            priority,
            onReady 
        });
        
        // Sort by priority (higher first)
        this.chunkQueue.sort((a, b) => b.priority - a.priority);
        
        this._processChunkQueue();
        return null;
    }

    async _processChunkQueue() {
        if (this.isProcessing || this.chunkQueue.length === 0) return;

        this.isProcessing = true;

        try {
            const activeTasks = Array.from(this.pendingChunks.values());
            const availableSlots = this.maxConcurrentChunks - activeTasks.length;

            for (let i = 0; i < Math.min(availableSlots, this.chunkQueue.length); i++) {
                const chunkRequest = this.chunkQueue.shift();
                if (chunkRequest) {
                    this._startChunkGeneration(chunkRequest);
                }
            }
        } finally {
            this.isProcessing = false;
        }

        if (this.chunkQueue.length > 0) {
            setTimeout(() => this._processChunkQueue(), 10);
        }
    }

    async _startChunkGeneration(chunkRequest) {
        const { chunkKey, onReady } = chunkRequest;

        let chunkX, chunkY, face = null, lod = 0;
        
        if (chunkKey.includes(':')) {
            // Planetary format: "face:x,y:lod" e.g., "2:7,7:0"
            try {
                const address = PlanetaryChunkAddress.fromKey(chunkKey);
                face = address.face;
                chunkX = address.x;
                chunkY = address.y;
                lod = address.lod;
                
                // Debug log for first few chunks
                if (this.loadedChunks.size < 5) {
                    console.log(` Parsing planetary key "${chunkKey}" -> face=${face}, x=${chunkX}, y=${chunkY}`);
                }
            } catch (e) {
                console.error(`Failed to parse planetary key: "${chunkKey}"`, e);
                return;
            }
        } else {
            // Flat format: "x,y"
            const parts = chunkKey.split(',');
            chunkX = parseInt(parts[0]);
            chunkY = parseInt(parts[1]);
            
            if (this.loadedChunks.size < 5) {
                console.log(`Parsing flat key "${chunkKey}" -> x=${chunkX}, y=${chunkY}`);
            }
        }
    
        // Register callback
        if (onReady) {
            if (!this.chunkReadyCallbacks.has(chunkKey)) {
                this.chunkReadyCallbacks.set(chunkKey, []);
            }
            this.chunkReadyCallbacks.get(chunkKey).push(onReady);
        }

        // Compute LOD for this chunk using hierarchical atlas distances if available
        try {
            const distance = this._estimateChunkDistance(chunkX, chunkY, face);
            const computedLOD = this.worldGenerator?.lodAtlasConfig?.getLODForDistance(distance);
            if (typeof computedLOD === 'number') {
                lod = computedLOD;
            }
        } catch (e) {
            console.warn('Failed to compute LOD for chunk', chunkKey, e);
        }

        
        const chunkPromise = this._generateChunkAsync(chunkX, chunkY, face, lod);
        this.pendingChunks.set(chunkKey, chunkPromise);
    
        try {
            const chunkData = await chunkPromise;
            this.loadedChunks.set(chunkKey, chunkData);
    
            // Call callbacks
            const callbacks = this.chunkReadyCallbacks.get(chunkKey) || [];
            callbacks.forEach(callback => callback(chunkData));
            this.chunkReadyCallbacks.delete(chunkKey);
    
            this._notifyProgress();
    
            if (this.loadedChunks.size <= 5) {
                console.log(` Chunk ${chunkKey} loaded (face=${face})`);
            }
    
        } catch (error) {
            console.error(` Failed to generate chunk ${chunkKey}:`, error);
        } finally {
            this.pendingChunks.delete(chunkKey);
            setTimeout(() => this._processChunkQueue(), 0);
        }
    }

    async _generateChunkAsync(chunkX, chunkY, face = null, lod = 0) {
        const chunkData = await this.worldGenerator.generateChunk(
            chunkX, 
            chunkY, 
            face, 
            lod
        );
        this._generateFeaturesAsync(chunkData, chunkX, chunkY);
        return chunkData;
    }

    async _generateFeaturesAsync(chunkData, chunkX, chunkY) {
        try {
            if (this.worldGenerator.featureGenerator) {
                await this.worldGenerator.featureGenerator.generateFeatures(chunkData, chunkX, chunkY);
            }
        } catch (error) {
            console.error(`Feature generation failed for chunk (${chunkX}, ${chunkY}):`, error);
        }
    }

    onProgress(callback) {
        this.progressCallbacks.add(callback);
    }

    offProgress(callback) {
        this.progressCallbacks.delete(callback);
    }

    _notifyProgress() {
        const stats = {
            loadedChunks: this.loadedChunks.size,
            pendingChunks: this.pendingChunks.size,
            queuedChunks: this.chunkQueue.length
        };
        this.progressCallbacks.forEach(callback => callback(stats));
    }

    getStats() {
        return {
            loadedChunks: this.loadedChunks.size,
            pendingChunks: this.pendingChunks.size,
            queuedChunks: this.chunkQueue.length,
            maxConcurrent: this.maxConcurrentChunks,
            mode: this.useSphericalProjection ? 'spherical' : 'flat'
        };
    }

    getChunk(chunkX, chunkY) {
        const chunkKey = `${chunkX},${chunkY}`;
        return this.loadedChunks.get(chunkKey) || null;
    }

    worldToChunkCoords(worldX, worldZ) {
        return {
            chunkX: Math.floor(worldX / this.chunkSize),
            chunkY: Math.floor(worldZ / this.chunkSize)
        };
    }

    unloadChunk(chunkKey) {
        const entry = this.loadedChunks.get(chunkKey);
        if (!entry) return;
        this.loadedChunks.delete(chunkKey);
        console.log(` Unloaded chunk ${chunkKey}`);
    }
}
