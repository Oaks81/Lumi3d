
export class DataTextureConfig {
    constructor(options = {}) {
        // Atlas texture size (power of 2)
        this.textureSize = options.textureSize || 2048;
        
        // Chunk size in world units
        this.chunkSize = options.chunkSize || 128;
        
        // Derived: how many chunks fit along one axis of atlas
        this.chunksPerAxis = this.textureSize / this.chunkSize;
        
        // Derived: total chunks per atlas
        this.chunksPerAtlas = this.chunksPerAxis * this.chunksPerAxis;
        
        // Texture types that use atlas system
        this.atlasTextureTypes = ['height', 'normal', 'tile', 'splatData', 'macro'];
        
        console.log('[TextureAtlasConfig] Configuration:');
        console.log(`  Texture size: ${this.textureSize}x${this.textureSize}`);
        console.log(`  Chunk size: ${this.chunkSize}x${this.chunkSize}`);
        console.log(`  Chunks per axis: ${this.chunksPerAxis}`);
        console.log(`  Chunks per atlas: ${this.chunksPerAtlas}`);
        console.log(`  Atlas types: ${this.atlasTextureTypes.join(', ')}`);
    }
    
    /**
     * Get atlas key for a given chunk
     */
    getAtlasKeyForChunk(chunkX, chunkY, face = null) {
        const atlasX = Math.floor(chunkX / this.chunksPerAxis);
        const atlasY = Math.floor(chunkY / this.chunksPerAxis);
        
        console.log(`[TextureAtlasConfig] Chunk (${chunkX},${chunkY}) -> Atlas (${atlasX},${atlasY})`);
        
        return {
            atlasX,
            atlasY,
            face,
            textureSize: this.textureSize,
            chunkSize: this.chunkSize
        };
    }
    
    /**
     * Get UV transform for chunk within its atlas
     */
    getChunkUVTransform(chunkX, chunkY) {
        const atlasX = Math.floor(chunkX / this.chunksPerAxis);
        const atlasY = Math.floor(chunkY / this.chunksPerAxis);
        
        const localX = chunkX - (atlasX * this.chunksPerAxis);
        const localY = chunkY - (atlasY * this.chunksPerAxis);
        
        const uvScale = 1.0 / this.chunksPerAxis;
        const uvOffsetX = localX * uvScale;
        const uvOffsetY = localY * uvScale;
        
        return {
            offsetX: uvOffsetX,
            offsetY: uvOffsetY,
            scale: uvScale
        };
    }
    
    /**
     * Check if chunk is at atlas boundary (needs new atlas generation)
     */
    isAtAtlasBoundary(chunkX, chunkY) {
        const localX = chunkX % this.chunksPerAxis;
        const localY = chunkY % this.chunksPerAxis;
        
        return localX === 0 || localY === 0;
    }
    
    /**
     * Get all chunks covered by atlas containing this chunk
     */
    getAtlasChunkRange(chunkX, chunkY) {
        const atlasX = Math.floor(chunkX / this.chunksPerAxis);
        const atlasY = Math.floor(chunkY / this.chunksPerAxis);
        
        const minChunkX = atlasX * this.chunksPerAxis;
        const maxChunkX = minChunkX + this.chunksPerAxis - 1;
        const minChunkY = atlasY * this.chunksPerAxis;
        const maxChunkY = minChunkY + this.chunksPerAxis - 1;
        
        console.log(`[TextureAtlasConfig] Atlas (${atlasX},${atlasY}) covers:`);
        console.log(`  Chunk X: [${minChunkX}..${maxChunkX}]`);
        console.log(`  Chunk Y: [${minChunkY}..${maxChunkY}]`);
        
        return { minChunkX, maxChunkX, minChunkY, maxChunkY };
    }
}

// Default singleton instance
export const DEFAULT_ATLAS_CONFIG = new DataTextureConfig({
    textureSize: 2048,
    chunkSize: 128
});