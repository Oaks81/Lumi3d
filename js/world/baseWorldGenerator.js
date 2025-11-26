// js/world/baseWorldGenerator.js
// Phase 3: Atlas generation integration

import { DataTextureConfig, DEFAULT_ATLAS_CONFIG } from './dataTextureConfiguration.js';
import { TextureAtlasKey } from './textureAtlasKey.js';

export class BaseWorldGenerator {
    constructor(renderer, textureCache, chunkSize, seed) {
        this.backend = renderer;
        this.textureCache = textureCache;
        this.chunkSize = chunkSize;
        this.seed = seed;
        
        // Atlas configuration
        this.atlasConfig = new DataTextureConfig({
            textureSize: 2048,
            chunkSize: chunkSize
        });
        
        // Set the atlas config on the texture cache
        if (this.textureCache && this.textureCache.setAtlasConfig) {
            this.textureCache.setAtlasConfig(this.atlasConfig);
        }
        
        console.log('[BaseWorldGenerator] Initialized with atlas config:');
        console.log('  Texture atlas size: ' + this.atlasConfig.textureSize + 'x' + this.atlasConfig.textureSize);
        console.log('  Chunk size: ' + this.atlasConfig.chunkSize);
        console.log('  Chunks per atlas: ' + this.atlasConfig.chunksPerAtlas);
        
        this.globalWaterLevel = 8.0;
        
        this.macroConfig = {
            biomeScale: 0.001,
            regionScale: 0.0005
        };
        
        this.splatConfig = {
            splatDensity: 4,
            splatKernelSize: 5
        };
        
        this.modules = {
            tiledTerrain: { enabled: true, instance: null },
            staticObjects: { enabled: true, instance: null }
        };
        
        // Track pending atlas generations to avoid duplicates
        this._pendingAtlases = new Map();
        
        this._ready = this.initialize();
    }
    
    async initialize() {
        await this.initializeAPI();
        await this.initializeModules();
        console.log(this.getAPIName() + ' World Generator initialized');
    }

    getAPIName() {
        return 'Base';
    }

    async initializeAPI() {
        // Override in subclass
    }

    async initializeModules() {
        // Override in subclass
    }

    /**
     * Check if atlas exists for a chunk (all required texture types)
     */
    hasAtlasForChunk(chunkX, chunkY, face = null) {
        // Use texture cache's atlas check if available
        if (this.textureCache.hasCompleteAtlas) {
            return this.textureCache.hasCompleteAtlas(chunkX, chunkY, this.atlasConfig, face);
        }
        
        // Fallback: check manually
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        
        for (const type of this.atlasConfig.atlasTextureTypes) {
            const cacheKey = type + '_' + atlasKey.toString();
            if (!this.textureCache.cache.has(cacheKey)) {
                console.log('[BaseWorldGenerator] Missing atlas texture: ' + cacheKey);
                return false;
            }
        }
        
        console.log('[BaseWorldGenerator] Atlas exists for chunk (' + chunkX + ',' + chunkY + '): ' + atlasKey.toString());
        return true;
    }
    
    /**
     * Generate atlas for a chunk's atlas region.
     * Returns immediately if atlas is already being generated.
     */
    async generateAtlasForChunk(chunkX, chunkY, face = null) {
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        const atlasKeyStr = atlasKey.toString();
        
        // Check if already being generated
        if (this._pendingAtlases.has(atlasKeyStr)) {
            console.log('[BaseWorldGenerator] Atlas already being generated: ' + atlasKeyStr);
            return this._pendingAtlases.get(atlasKeyStr);
        }
        
        // Check if already exists
        if (this.hasAtlasForChunk(chunkX, chunkY, face)) {
            console.log('[BaseWorldGenerator] Atlas already exists: ' + atlasKeyStr);
            return { atlasKey: atlasKey, cached: true };
        }
        
        console.log('[BaseWorldGenerator] Generating atlas: ' + atlasKeyStr);
        
        // Create generation promise
        const generationPromise = this._doGenerateAtlas(atlasKey);
        this._pendingAtlases.set(atlasKeyStr, generationPromise);
        
        try {
            const result = await generationPromise;
            return result;
        } finally {
            this._pendingAtlases.delete(atlasKeyStr);
        }
    }
    
    /**
     * Actually generate the atlas textures
     */
    async _doGenerateAtlas(atlasKey) {
        console.log('[BaseWorldGenerator] _doGenerateAtlas: ' + atlasKey.toString());
        
        // Get covered chunks for logging
        const chunks = atlasKey.getCoveredChunks();
        console.log('[BaseWorldGenerator]   Covers ' + chunks.length + ' chunks');
        console.log('[BaseWorldGenerator]   Range: X=[' + chunks[0].chunkX + '..' + chunks[chunks.length-1].chunkX + 
            '], Y=[' + chunks[0].chunkY + '..' + chunks[chunks.length-1].chunkY + ']');
        
        // Use terrain generator to create atlas textures
        if (this.modules.tiledTerrain.enabled && this.modules.tiledTerrain.instance) {
            const generator = this.modules.tiledTerrain.instance;
            
            // Check if generator has atlas support
            if (generator.generateAtlasTextures) {
                console.log('[BaseWorldGenerator]   Using atlas texture generation');
                const result = await generator.generateAtlasTextures(atlasKey, this.atlasConfig);
                return result;
            } else {
                console.warn('[BaseWorldGenerator]   Generator does not support atlas mode, using stub');
                return this._generateAtlasStub(atlasKey);
            }
        } else {
            console.warn('[BaseWorldGenerator]   No terrain generator, using stub');
            return this._generateAtlasStub(atlasKey);
        }
    }
    
    /**
     * Stub atlas generation (for testing without actual GPU generation)
     */
    _generateAtlasStub(atlasKey) {
        console.log('[BaseWorldGenerator] STUB: Would generate atlas ' + atlasKey.toString());
        
        for (const type of this.atlasConfig.atlasTextureTypes) {
            console.log('[BaseWorldGenerator]   Would generate ' + type + ' texture ' + 
                this.atlasConfig.textureSize + 'x' + this.atlasConfig.textureSize);
        }
        
        return {
            atlasKey: atlasKey,
            stub: true
        };
    }
    
    /**
     * Get atlas textures for a chunk
     */
    getAtlasTexturesForChunk(chunkX, chunkY, face = null) {
        if (this.textureCache.getAllAtlasTexturesForChunk) {
            return this.textureCache.getAllAtlasTexturesForChunk(chunkX, chunkY, this.atlasConfig, face);
        }
        
        // Fallback manual lookup
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        const uvTransform = this.atlasConfig.getChunkUVTransform(chunkX, chunkY);
        const result = {};
        
        for (const type of this.atlasConfig.atlasTextureTypes) {
            const texture = this.textureCache.get(atlasKey, null, type);
            if (texture) {
                result[type] = {
                    texture: texture,
                    atlasKey: atlasKey,
                    uvTransform: uvTransform
                };
            }
        }
        
        return result;
    }

    /**
     * Release a chunk (mark it as no longer using its atlas)
     */
    releaseChunk(chunkX, chunkY, face = null) {
        if (this.textureCache.releaseChunkFromAtlas) {
            this.textureCache.releaseChunkFromAtlas(chunkX, chunkY, this.atlasConfig, face);
        }
    }

    /**
     * Seeded random number generator
     */
    createSeededRandom(seed) {
        let s = seed;
        return function() {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
    }

    /**
     * Calculate terrain slope at a point
     */
    calculateSlope(chunkData, x, z) {
        const h0 = chunkData.getHeight(x, z);
        const h1 = chunkData.getHeight(Math.min(x + 1, chunkData.size - 1), z);
        const h2 = chunkData.getHeight(x, Math.min(z + 1, chunkData.size - 1));
        const dx = Math.abs(h1 - h0);
        const dz = Math.abs(h2 - h0);
        return Math.max(dx, dz);
    }

    /**
     * Set planet configuration for spherical terrain
     */
    setPlanetConfig(config) {
        this.planetConfig = config;
        console.log('[BaseWorldGenerator] Planet config set: radius=' + config.radius);
    }

    dispose() {
        // Override in subclass
    }
}