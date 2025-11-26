// ChunkManager.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class ChunkManager {
    constructor(worldGenerator, options = {}) {
        this.worldGenerator = worldGenerator;
        this.loadedChunks = new Map();
        this.chunkSize = this.worldGenerator.chunkSize;
        
        // ============================================
        // SPHERICAL PROJECTION CONFIGURATION
        // Set to false for flat terrain (original behavior)
        // Set to true for planetary spherical projection
        // ============================================
        this.sphericalMapper = options.sphericalMapper || null;
        this.useSphericalProjection = options.useSphericalProjection && this.sphericalMapper !== null;
        
        console.log(`🗺️ ChunkManager mode: ${this.useSphericalProjection ? 'SPHERICAL' : 'FLAT'}`);
        
        if (this.useSphericalProjection) {
            console.log(`  Planet-aware chunk mapping enabled`);
        } else {
            console.log(`  Classic flat terrain chunk mapping`);
        }

        // Track async operations and priorities
        this.pendingChunks = new Map();
        this.chunkQueue = [];
        this.maxConcurrentChunks = 2;
        this.isProcessing = false;

        // Callbacks for when chunks are ready
        this.chunkReadyCallbacks = new Map();
        this.progressCallbacks = new Set();
        this.chunkLoadRadius = 2;
        
        // Track last player position (for flat mode)
        this.lastPlayerChunk = null;
    }

    async initialize() {
        console.log("Chunk manager initializing...")
        const promises = [];
        // Only load chunks in immediate vicinity for initial load
        for (let chunkY = -1; chunkY <= 1; chunkY++) {
            for (let chunkX = -1; chunkX <= 1; chunkX++) {
                const distance = Math.abs(chunkX) + Math.abs(chunkY);
                promises.push(this.requestChunk(chunkX, chunkY, distance));
            }
        }
        await Promise.allSettled(promises);
        console.log("Chunk manager ready")
    }

    /**
     * Update chunk loading based on player position
     * @param {number} playerX - Player X position (horizontal)
     * @param {number} playerY - Player Y position (horizontal in game coords, or Z in Three.js)
     * @param {number} playerZ - Player altitude (optional, defaults to 50)
     */

    async update(playerX, playerY, playerZ = null) {
        if (this.useSphericalProjection && this.sphericalMapper) {
            this._updateSpherical(playerX, playerY, playerZ);
        } else {
            this._updateFlat(playerX, playerY);
        }
        
        this._processChunkQueue();
    }

    _updateSpherical(playerX, playerY, playerZ) {
        const altitude = playerZ ?? 50;
        
        // Convert to render coords
        const cameraRenderPos = new THREE.Vector3(
            playerX,
            altitude,
            playerY
        );
        
        
        const chunkKeys = this.sphericalMapper.getChunksInRadius(
            cameraRenderPos, 
            this.chunkLoadRadius * this.chunkSize
        );
        
   
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
            console.warn('⚠️ No visible chunks');
            return;
        }
        
        // Unload chunks not in visible set
        for (const [key, chunkData] of this.loadedChunks) {
            if (!visibleSet.has(key)) {
                this.unloadChunk(key);
            }
        }
        
        // Load new chunks
        for (const key of chunkKeys) {
            if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
                const [x, y] = key.split(',').map(Number);
                this.requestChunk(x, y, 0);
            }
        }
    }


    async requestChunk(chunkX, chunkY, priority = 10, onReady = null) {
        let chunkKey;
        if (typeof chunkX === 'string' && chunkX.includes(':')) {
            // Planetary key format
            chunkKey = chunkX;
            priority = chunkY; // Second arg is priority
            onReady = priority; // Third arg is callback
        } else {
            // Flat key format
            chunkKey = `${chunkX},${chunkY}`;
        }
    
        // Already loaded
        if (this.loadedChunks.has(chunkKey)) {
            if (onReady) onReady(this.loadedChunks.get(chunkKey));
            return this.loadedChunks.get(chunkKey);
        }
    
        // Already loaded
        if (this.loadedChunks.has(chunkKey)) {
            if (onReady) onReady(this.loadedChunks.get(chunkKey));
            return this.loadedChunks.get(chunkKey);
        }

        // Already pending
        if (this.pendingChunks.has(chunkKey)) {
            if (onReady) {
                if (!this.chunkReadyCallbacks.has(chunkKey)) {
                    this.chunkReadyCallbacks.set(chunkKey, []);
                }
                this.chunkReadyCallbacks.get(chunkKey).push(onReady);
            }
            return this.pendingChunks.get(chunkKey);
        }

        // Check if already in queue
        const existingRequest = this.chunkQueue.find(req => req.chunkKey === chunkKey);
        if (existingRequest) {
            // Update priority if higher (lower number = higher priority)
            if (priority < existingRequest.priority) {
                existingRequest.priority = priority;
                this.chunkQueue.sort((a, b) => a.priority - b.priority);
            }
            if (onReady) {
                if (!this.chunkReadyCallbacks.has(chunkKey)) {
                    this.chunkReadyCallbacks.set(chunkKey, []);
                }
                this.chunkReadyCallbacks.get(chunkKey).push(onReady);
            }
            return null;
        }

        // Add to queue
        this.chunkQueue.push({
            chunkX,
            chunkY,
            chunkKey,
            priority,
            onReady
        });

        // Sort queue by priority
        this.chunkQueue.sort((a, b) => a.priority - b.priority);

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

        // Continue processing if there are more chunks
        if (this.chunkQueue.length > 0) {
            setTimeout(() => this._processChunkQueue(), 10);
        }
    }
    async _startChunkGeneration(chunkRequest) {
        const { chunkKey, onReady } = chunkRequest;
        
        // Parse key (supports both formats)
        let chunkX, chunkY, face = null, lod = 0;
        
        if (chunkKey.includes(':')) {
            // Planetary format: "face:x,y:lod"
            const address = PlanetaryChunkAddress.fromKey(chunkKey);
            face = address.face;
            chunkX = address.x;
            chunkY = address.y;
            lod = address.lod;
        } else {
            // Flat format: "x,y"
            [chunkX, chunkY] = chunkKey.split(',').map(Number);
        }
    
        // Register callback
        if (onReady) {
            if (!this.chunkReadyCallbacks.has(chunkKey)) {
                this.chunkReadyCallbacks.set(chunkKey, []);
            }
            this.chunkReadyCallbacks.get(chunkKey).push(onReady);
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
    
            console.log(`✅ Chunk ${chunkKey} loaded`);
    
        } catch (error) {
            console.error(`❌ Failed to generate chunk ${chunkKey}:`, error);
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

    // Progress tracking
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

// js/ChunkManager.js

/**
 * Get tile at world position
 * @param {number} worldX - World X coordinate (horizontal)
 * @param {number} worldY - World Y coordinate (horizontal in flat mode, or vertical in some contexts)
 * @param {number} worldZ - World Z coordinate (altitude/vertical)
 * @returns {number|null} Tile type
 */
getTileAtWorldPosition(worldX, worldY, worldZ = null) {
    // ============================================
    // COORDINATE SYSTEM CLARIFICATION:
    // Game coords: (x, y, z) where z = altitude
    // Three.js:    (x, y, z) where y = altitude
    // 
    // This method accepts GAME coordinates
    // ============================================
    
    if (this.useSphericalProjection && this.sphericalMapper) {
        // ============================================
        // SPHERICAL MODE
        // ============================================
        
        // Determine altitude
        const altitude = worldZ ?? 50; // worldZ is altitude in game coords
        
        // Convert game coords → Three.js coords
        const pos3D = new THREE.Vector3(
            worldX,     // X stays X (horizontal)
            altitude,   // Game Z → Three Y (altitude)
            worldY      // Game Y → Three Z (horizontal)
        );
        
        // Find chunk containing this position
        const chunkKey = this.sphericalMapper.worldPositionToChunkKey(pos3D);
        
        if (!chunkKey) {
            console.warn(`No chunk found for position (${worldX.toFixed(0)}, ${worldY.toFixed(0)}, ${altitude.toFixed(0)})`);
            return null;
        }
        
        // Parse chunk key
        const [chunkX, chunkY] = chunkKey.split(',').map(Number);
        const chunk = this.getChunk(chunkX, chunkY);
        
        if (!chunk) {
            return null; // Chunk not loaded yet
        }
        
        // Convert world position to chunk-local tile coordinates
        // This requires spherical UV mapping
        const { face, u, v } = this.sphericalMapper.getFaceAndLocalCoords(chunkKey);
        
        // Map UV [0,1] to tile indices
        const localX = Math.floor(u * this.worldGenerator.tilesPerChunk);
        const localY = Math.floor(v * this.worldGenerator.tilesPerChunk);
        
        return chunk.getTile(localX, localY);
        
    } else {
        // ============================================
        // FLAT MODE
        // ============================================
        
        // In flat mode, worldX and worldY are both horizontal
        // (Z altitude is ignored for tile lookup)
        const { chunkX, chunkY } = this.worldToChunkCoords(worldX, worldY);
        const chunk = this.getChunk(chunkX, chunkY);
        
        if (!chunk) return null;
        
        // Convert world coords to local tile coords
        const localX = Math.floor((worldX % this.chunkSize) / this.worldGenerator.tileSize);
        const localY = Math.floor((worldY % this.chunkSize) / this.worldGenerator.tileSize);
        
        // Clamp to valid range
        const clampedX = Math.max(0, Math.min(this.worldGenerator.tilesPerChunk - 1, localX));
        const clampedY = Math.max(0, Math.min(this.worldGenerator.tilesPerChunk - 1, localY));
        
        return chunk.getTile(clampedX, clampedY);
    }
}

/**
 * Convert world coordinates to chunk coordinates
 * @param {number} worldX - Horizontal X
 * @param {number} worldZ - Horizontal Z (NOT altitude)
 */
worldToChunkCoords(worldX, worldZ) {
    return {
        chunkX: Math.floor(worldX / this.chunkSize),
        chunkY: Math.floor(worldZ / this.chunkSize)  // ✅ Note: chunkY uses worldZ
    };
}

    unloadChunk(chunkKey) {
        const entry = this.loadedChunks.get(chunkKey);
        if (!entry) {
            return;
        }
    
        // Remove from loaded chunks
        this.loadedChunks.delete(chunkKey);
        
        console.log(`🗑️ Unloaded chunk ${chunkKey}`);
    }
}