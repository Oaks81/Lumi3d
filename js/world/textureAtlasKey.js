// js/world/TextureAtlasKey.js
import { DataTextureConfig } from  './dataTextureConfiguration.js';
import { DEFAULT_ATLAS_CONFIG } from './dataTextureConfiguration.js';

export class TextureAtlasKey {
    constructor(atlasX, atlasY, face = null, config = DEFAULT_ATLAS_CONFIG) {
        this.atlasX = atlasX;
        this.atlasY = atlasY;
        this.face = face;
        this.config = config;
        
        console.log(`[TextureAtlasKey] Created: atlas=(${atlasX},${atlasY}), face=${face}, covers ${this.config.chunksPerAxis}x${this.config.chunksPerAxis} chunks`);
    }
    
    toString() {
        if (this.face === null) {
            return `atlas_${this.atlasX},${this.atlasY}_${this.config.textureSize}`;
        }
        return `atlas_f${this.face}_${this.atlasX},${this.atlasY}_${this.config.textureSize}`;
    }
    // Better approach: Make fromString synchronous by requiring config

/**
 * Parse key string back to TextureAtlasKey object
 * @param {string} keyString - Key like "atlas_0,0_2048" or "atlas_f2_1,0_2048"
 * @param {DataTextureConfig} config - Config instance (required for proper initialization)
 */
static fromString(keyString, config) {
    if (!config) {
        console.error('[TextureAtlasKey] fromString requires config parameter');
        throw new Error('TextureAtlasKey.fromString requires DataTextureConfig instance');
    }
    
    console.log(`[TextureAtlasKey] Parsing key: "${keyString}"`);
    
    // Remove "atlas_" prefix
    const withoutPrefix = keyString.replace('atlas_', '');
    
    let face = null;
    let coords, texSize;
    
    if (withoutPrefix.startsWith('f')) {
        // Spherical format: "f0_0,0_2048"
        const parts = withoutPrefix.split('_');
        face = parseInt(parts[0].substring(1)); // Remove 'f' and parse
        coords = parts[1];
        texSize = parseInt(parts[2]);
        
        console.log(`[TextureAtlasKey]   Spherical atlas: face=${face}`);
    } else {
        // Flat format: "0,0_2048"
        const parts = withoutPrefix.split('_');
        coords = parts[0];
        texSize = parseInt(parts[1]);
        
        console.log(`[TextureAtlasKey]   Flat atlas`);
    }
    
    const [atlasX, atlasY] = coords.split(',').map(Number);
    
    console.log(`[TextureAtlasKey]   Result: atlas=(${atlasX},${atlasY}), textureSize=${texSize}`);
    
    // Verify config matches parsed texture size
    if (config.textureSize !== texSize) {
        console.warn(`[TextureAtlasKey]   Config textureSize (${config.textureSize}) does not match key (${texSize})`);
    }
    
    return new TextureAtlasKey(atlasX, atlasY, face, config);
}
    // FIXED: Support both config object AND legacy numeric parameters
    static fromChunkCoords(chunkX, chunkY, face = null, configOrTextureSize = DEFAULT_ATLAS_CONFIG, chunkSize = null) {
        let config;
        
        // Check if 4th param is a config object or a number
        if (typeof configOrTextureSize === 'number') {
            // Legacy call: fromChunkCoords(x, y, face, 2048, 128)
            console.log(`[TextureAtlasKey] Legacy call with textureSize=${configOrTextureSize}, chunkSize=${chunkSize}`);
        
            config = new DataTextureConfig({
                textureSize: configOrTextureSize,
                chunkSize: chunkSize
            });
        } else {
            // New call: fromChunkCoords(x, y, face, config)
            config = configOrTextureSize;
        }
        
        const atlasX = Math.floor(chunkX / config.chunksPerAxis);
        const atlasY = Math.floor(chunkY / config.chunksPerAxis);
        
        console.log(`[TextureAtlasKey] Chunk (${chunkX},${chunkY}) face=${face} -> Atlas (${atlasX},${atlasY})`);
        
        return new TextureAtlasKey(atlasX, atlasY, face, config);
    }
    
    getChunkUVTransform(chunkX, chunkY) {
        return this.config.getChunkUVTransform(chunkX, chunkY);
    }
    
    containsChunk(chunkX, chunkY) {
        const range = this.config.getAtlasChunkRange(chunkX, chunkY);
        const atlasForChunkX = Math.floor(chunkX / this.config.chunksPerAxis);
        const atlasForChunkY = Math.floor(chunkY / this.config.chunksPerAxis);
        
        return atlasForChunkX === this.atlasX && atlasForChunkY === this.atlasY;
    }
    
    getCoveredChunks() {
        const chunks = [];
        const baseX = this.atlasX * this.config.chunksPerAxis;
        const baseY = this.atlasY * this.config.chunksPerAxis;
        
        for (let y = 0; y < this.config.chunksPerAxis; y++) {
            for (let x = 0; x < this.config.chunksPerAxis; x++) {
                chunks.push({
                    chunkX: baseX + x,
                    chunkY: baseY + y
                });
            }
        }
        
        return chunks;
    }
}