// worldgen/baseWorldGenerator.js (updated to accept backend)

import { DataTextureConfig } from './dataTextureConfiguration.js';
import { TextureAtlasKey } from './textureAtlasKey.js';

export class BaseWorldGenerator {
    constructor(renderer, textureCache, chunkSize, seed) {
        this.backend = renderer;
        this.textureCache = textureCache;
        this.chunkSize = chunkSize;
        this.seed = seed;
        
        // NEW: Atlas configuration
        this.atlasConfig = new DataTextureConfig({
            textureSize: 2048,
            chunkSize: chunkSize
        });
        
        console.log('[BaseWorldGenerator] Initialized with atlas config:');
        console.log(`  Texture atlas size: ${this.atlasConfig.textureSize}x${this.atlasConfig.textureSize}`);
        console.log(`  Chunk size: ${this.atlasConfig.chunkSize}`);
        console.log(`  Chunks per atlas: ${this.atlasConfig.chunksPerAtlas}`);
        
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
        
        this._ready = this.initialize();
    }
    
    async initialize() {
        await this.initializeAPI();
        await this.initializeModules();
        console.log(`${this.getAPIName()} World Generator initialized`);
    }

    // NEW: Check if atlas exists for chunk
    hasAtlasForChunk(chunkX, chunkY, face = null) {
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        
        // Check if all required texture types exist for this atlas
        for (const type of this.atlasConfig.atlasTextureTypes) {
            const cacheKey = `${type}_${atlasKey.toString()}`;
            if (!this.textureCache.cache.has(cacheKey)) {
                console.log(`[BaseWorldGenerator] Missing atlas texture: ${cacheKey}`);
                return false;
            }
        }
        
        console.log(`[BaseWorldGenerator] Atlas exists for chunk (${chunkX},${chunkY}): ${atlasKey.toString()}`);
        return true;
    }
        
        // NEW: Generate atlas for chunk range
    async generateAtlasForChunk(chunkX, chunkY, face = null) {
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        
        console.log(`[BaseWorldGenerator] Generating atlas: ${atlasKey.toString()}`);
        
        // Get all chunks covered by this atlas
        const chunks = atlasKey.getCoveredChunks();
        console.log(`[BaseWorldGenerator]   Covers ${chunks.length} chunks`);
        
        // TODO: Generate atlas-sized textures
        // For now, just log what we would generate
        for (const type of this.atlasConfig.atlasTextureTypes) {
            console.log(`[BaseWorldGenerator]   Would generate ${type} texture ${this.atlasConfig.textureSize}x${this.atlasConfig.textureSize}`);
        }
        
        return atlasKey;
    }

    getAPIName() {
        return 'Base';
    }
    
    async initializeAPI() {
        throw new Error('initializeAPI must be implemented');
    }
    
    async initializeModules() {
        throw new Error('initializeModules must be implemented');
    }
    
    async generateChunk(chunkX, chunkY) {
        throw new Error('generateChunk must be implemented');
    }
    
    calculateSlope(chunkData, x, z) {
        const h0 = chunkData.getHeight(x, z);
        const h1 = chunkData.getHeight(Math.min(x + 1, chunkData.size - 1), z);
        const h2 = chunkData.getHeight(x, Math.min(z + 1, chunkData.size - 1));
        const dx = Math.abs(h1 - h0);
        const dz = Math.abs(h2 - h0);
        return Math.max(dx, dz);
    }

    createSeededRandom(seed) {
        let s = seed;
        return function() {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }
    
    dispose() {
    }
}