// ChunkManager.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { PlanetaryChunkAddress } from './planet/planetaryChunkAddress.js';
export class ChunkManager {
    constructor(worldGenerator, options = {}) {
        this.worldGenerator = worldGenerator;
        this.loadedChunks = new Map();
        this.chunkSize = this.worldGenerator.chunkSize;
        
        this.sphericalMapper = options.sphericalMapper || null;
        this.useSphericalProjection = options.useSphericalProjection && this.sphericalMapper !== null;
        
        console.log(`🗺️ ChunkManager mode: ${this.useSphericalProjection ? 'SPHERICAL' : 'FLAT'}`);

        this.pendingChunks = new Map();
        this.chunkQueue = [];
        this.maxConcurrentChunks = 4; // Increased slightly
        this.isProcessing = false;

        this.chunkReadyCallbacks = new Map();
        this.progressCallbacks = new Set();
        this.chunkLoadRadius = 2;
    }
    async initialize() {
        console.log("Chunk manager initializing...");
        console.log(`  Mode: ${this.useSphericalProjection ? 'SPHERICAL' : 'FLAT'}`);
        
        if (this.useSphericalProjection && this.sphericalMapper) {
            // Spherical mode: chunks load on first update() with camera position
            console.log("  Spherical mode - waiting for camera position");
            console.log("Chunk manager ready (spherical)");
            return;
        }
        
        // Flat mode: load initial chunks around origin
        const promises = [];
        for (let chunkY = -1; chunkY <= 1; chunkY++) {
            for (let chunkX = -1; chunkX <= 1; chunkX++) {
                const distance = Math.abs(chunkX) + Math.abs(chunkY);
                const key = `${chunkX},${chunkY}`;
                promises.push(this.requestChunk(key, null, 10 - distance));
            }
        }
        await Promise.allSettled(promises);
        console.log(`Chunk manager ready (flat), loaded: ${this.loadedChunks.size}`);
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
        // playerZ should be the altitude (game coords)
        const altitude = playerZ ?? 50;
        
        // ✅ FIX: Ensure correct coordinate conversion
        // Game: (x, y, z) where z = altitude
        // Three.js: (x, y, z) where y = altitude
        const cameraRenderPos = new THREE.Vector3(
            playerX,    // Game X → Three X
            altitude,   // Game Z → Three Y (altitude)
            playerY     // Game Y → Three Z
        );
        
        console.log(' Spherical update:', {
            gameCoords: { x: playerX, y: playerY, z: altitude },
            threeCoords: { x: cameraRenderPos.x, y: cameraRenderPos.y, z: cameraRenderPos.z },
            distFromOrigin: cameraRenderPos.length()
        });
        
        const chunkKeys = this.sphericalMapper.getChunksInRadius(
            cameraRenderPos, 
            this.chunkLoadRadius * this.chunkSize
        );
        
        console.log(`  Found ${chunkKeys.length} chunks:`, chunkKeys.slice(0, 3));
        
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
        
        // Debug first load
        if (this.loadedChunks.size === 0 && chunkKeys.length > 0) {
            console.log('🗺️ First chunk load, keys:', chunkKeys.slice(0, 3));
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
       
                this.requestChunk(key);
            }
        }
    }
    async requestChunk(chunkXOrKey, chunkY = null, priority = 10, onReady = null) {
        let chunkKey;
        

        if (typeof chunkXOrKey === 'string') {
            // Full key passed (either "x,y" or "face:x,y:lod")
            chunkKey = chunkXOrKey;
        } else if (chunkY !== null) {
            // Legacy x, y numbers
            chunkKey = `${chunkXOrKey},${chunkY}`;
        } else {
            console.error('requestChunk: Invalid arguments', chunkXOrKey, chunkY);
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
            priority: priority || 0,
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
            const activeTasks = this.pendingChunks.size;
            const availableSlots = this.maxConcurrentChunks - activeTasks;

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

    _addCallback(chunkKey, callback) {
        if (!this.chunkReadyCallbacks.has(chunkKey)) {
            this.chunkReadyCallbacks.set(chunkKey, []);
        }
        this.chunkReadyCallbacks.get(chunkKey).push(callback);
    }
    async _startChunkGeneration(chunkRequest) {
        const { chunkKey, onReady } = chunkRequest;
        
        let chunkX, chunkY, face = null, lod = 0;
        
        if (chunkKey.includes(':')) {
            // Use PlanetaryChunkAddress for robust parsing
            try {
                const address = PlanetaryChunkAddress.fromKey(chunkKey);
                face = address.face;
                chunkX = address.x;
                chunkY = address.y;
                lod = address.lod;
            } catch (e) {
                console.error(`❌ Invalid key in _startChunkGeneration: ${chunkKey}`, e);
                return;
            }
        } else {
            [chunkX, chunkY] = chunkKey.split(',').map(Number);
        }
    
        if (onReady) this._addCallback(chunkKey, onReady);
    
        const chunkPromise = this._generateChunkAsync(chunkX, chunkY, face, lod);
        this.pendingChunks.set(chunkKey, chunkPromise);
    
        try {
            const chunkData = await chunkPromise;
            if (chunkData) {
                this.loadedChunks.set(chunkKey, chunkData);
                
                const callbacks = this.chunkReadyCallbacks.get(chunkKey) || [];
                callbacks.forEach(cb => cb(chunkData));
                this.chunkReadyCallbacks.delete(chunkKey);
                
                this._notifyProgress();
            }
        } catch (error) {
            console.error(`❌ Failed to generate chunk ${chunkKey}:`, error);
        } finally {
            this.pendingChunks.delete(chunkKey);
            setTimeout(() => this._processChunkQueue(), 0);
        }
    }
    

    async _startChunkGeneration(chunkRequest) {
        const { chunkKey, onReady } = chunkRequest;
        
        let chunkX, chunkY, face = null, lod = 0;
        
        if (chunkKey.includes(':')) {
            // Use PlanetaryChunkAddress for robust parsing
            try {
                const address = PlanetaryChunkAddress.fromKey(chunkKey);
                face = address.face;
                chunkX = address.x;
                chunkY = address.y;
                lod = address.lod;
            } catch (e) {
                console.error(`❌ Invalid key in _startChunkGeneration: ${chunkKey}`, e);
                return;
            }
        } else {
            [chunkX, chunkY] = chunkKey.split(',').map(Number);
        }
    
        if (onReady) this._addCallback(chunkKey, onReady);
    
        const chunkPromise = this._generateChunkAsync(chunkX, chunkY, face, lod);
        this.pendingChunks.set(chunkKey, chunkPromise);
    
        try {
            const chunkData = await chunkPromise;
            if (chunkData) {
                this.loadedChunks.set(chunkKey, chunkData);
                
                const callbacks = this.chunkReadyCallbacks.get(chunkKey) || [];
                callbacks.forEach(cb => cb(chunkData));
                this.chunkReadyCallbacks.delete(chunkKey);
                
                this._notifyProgress();
            }
        } catch (error) {
            console.error(`❌ Failed to generate chunk ${chunkKey}:`, error);
        } finally {
            this.pendingChunks.delete(chunkKey);
            setTimeout(() => this._processChunkQueue(), 0);
        }
    }
    
    
    async _generateChunkAsync(chunkX, chunkY, face = null, lod = 0) {
        const chunkData = await this.worldGenerator.generateChunk(chunkX, chunkY, face, lod);
        // Generate features
        if (this.worldGenerator.featureGenerator) {
            try {
                await this.worldGenerator.featureGenerator.generateFeatures(chunkData, chunkX, chunkY);
            } catch (e) {
                console.warn("Feature generation failed", e);
            }
        }
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
    if (!entry) return;
    
    // Notify generator to release resources (e.g. decrement atlas refcount)
    if (this.worldGenerator.releaseChunk) {
        const isSpherical = chunkKey.includes(':');
        if (isSpherical) {
            const address = PlanetaryChunkAddress.fromKey(chunkKey);
            this.worldGenerator.releaseChunk(address.x, address.y, address.face);
        } else {
            const [x, y] = chunkKey.split(',').map(Number);
            this.worldGenerator.releaseChunk(x, y);
        }
    }
    
    if (entry.dispose) entry.dispose();
    this.loadedChunks.delete(chunkKey);
}
}