// js/world/dataTextureConfiguration.js

export class DataTextureConfig {
    /**
     * @param {Object} options
     * @param {number} [options.textureSize=2048] - Atlas texture size in pixels (power of 2)
     * @param {number} [options.chunkSize=128] - Chunk size in pixels (power of 2)
     */
    constructor(options = {}) {
        this.textureSize = options.textureSize || 2048;
        this.chunkSize = options.chunkSize || 128;
        
        // Validate power of 2
        if (!this._isPowerOfTwo(this.textureSize)) {
            console.warn('[DataTextureConfig] textureSize ' + this.textureSize + ' is not power of 2');
        }
        if (!this._isPowerOfTwo(this.chunkSize)) {
            console.warn('[DataTextureConfig] chunkSize ' + this.chunkSize + ' is not power of 2');
        }
        
        // Validate divisibility
        if (this.textureSize % this.chunkSize !== 0) {
            throw new Error('[DataTextureConfig] textureSize (' + this.textureSize + 
                ') must be divisible by chunkSize (' + this.chunkSize + ')');
        }
        
        // DERIVED VALUES - These are the source of truth
        // Never hardcode "16" anywhere - always use config.chunksPerAxis
        this.chunksPerAxis = this.textureSize / this.chunkSize;
        this.chunksPerAtlas = this.chunksPerAxis * this.chunksPerAxis;
        
        // Texture types that use atlas system
        this.atlasTextureTypes = ['height', 'normal', 'tile', 'splatData', 'macro'];
        
        console.log('[DataTextureConfig] ----------------------------------------');
        console.log('[DataTextureConfig] Configuration created:');
        console.log('[DataTextureConfig]   textureSize: ' + this.textureSize + 'x' + this.textureSize);
        console.log('[DataTextureConfig]   chunkSize: ' + this.chunkSize + 'x' + this.chunkSize);
        console.log('[DataTextureConfig]   chunksPerAxis: ' + this.chunksPerAxis);
        console.log('[DataTextureConfig]   chunksPerAtlas: ' + this.chunksPerAtlas);
        console.log('[DataTextureConfig]   Example: chunk (17,5) -> atlas (' + 
            Math.floor(17/this.chunksPerAxis) + ',' + Math.floor(5/this.chunksPerAxis) + ')');
        console.log('[DataTextureConfig] ----------------------------------------');
    }
    
    _isPowerOfTwo(n) {
        return n > 0 && (n & (n - 1)) === 0;
    }
    
    /**
     * Get atlas coordinates for a given chunk.
     * Uses floor division to handle negative coordinates correctly.
     * 
     * Examples with chunksPerAxis=16:
     *   Chunk (0,0)   -> Atlas (0,0)
     *   Chunk (15,15) -> Atlas (0,0)  
     *   Chunk (16,0)  -> Atlas (1,0)
     *   Chunk (-1,0)  -> Atlas (-1,0)
     *   Chunk (-17,0) -> Atlas (-2,0)
     */
    getAtlasCoords(chunkX, chunkY) {
        const atlasX = Math.floor(chunkX / this.chunksPerAxis);
        const atlasY = Math.floor(chunkY / this.chunksPerAxis);
        return { atlasX, atlasY };
    }
    
    /**
     * Get atlas key object for a given chunk
     */
    getAtlasKeyForChunk(chunkX, chunkY, face = null) {
        const { atlasX, atlasY } = this.getAtlasCoords(chunkX, chunkY);
        
        console.log('[DataTextureConfig] getAtlasKeyForChunk: chunk=(' + chunkX + ',' + chunkY + 
            ') -> atlas=(' + atlasX + ',' + atlasY + ')');
        
        return {
            atlasX,
            atlasY,
            face,
            textureSize: this.textureSize,
            chunkSize: this.chunkSize
        };
    }
    
    /**
     * Get local position of chunk within its atlas.
     * Returns values in range [0, chunksPerAxis-1].
     */
    getLocalChunkPosition(chunkX, chunkY) {
        const { atlasX, atlasY } = this.getAtlasCoords(chunkX, chunkY);
        
        // Calculate local position within atlas
        // This correctly handles negative coordinates
        const localX = chunkX - (atlasX * this.chunksPerAxis);
        const localY = chunkY - (atlasY * this.chunksPerAxis);
        
        // Sanity check
        if (localX < 0 || localX >= this.chunksPerAxis || 
            localY < 0 || localY >= this.chunksPerAxis) {
            console.error('[DataTextureConfig] Invalid local position! chunk=(' + chunkX + ',' + chunkY + 
                '), atlas=(' + atlasX + ',' + atlasY + '), local=(' + localX + ',' + localY + ')');
        }
        
        return { localX, localY };
    }
    
    /**
     * Get UV transform for chunk within its atlas.
     * Used by shaders to sample correct region of atlas texture.
     * 
     * Returns: { offsetX, offsetY, scale }
     * Shader usage: vec2 atlasUV = chunkUV * scale + vec2(offsetX, offsetY);
     */
    getChunkUVTransform(chunkX, chunkY) {
        const { localX, localY } = this.getLocalChunkPosition(chunkX, chunkY);
        
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
     * Check if chunk is at the (0,0) corner of its atlas.
     */
    isAtAtlasBoundary(chunkX, chunkY) {
        const { localX, localY } = this.getLocalChunkPosition(chunkX, chunkY);
        return localX === 0 && localY === 0;
    }
    
    /**
     * Check if chunk is at any edge of its atlas.
     */
    isAtAtlasEdge(chunkX, chunkY) {
        const { localX, localY } = this.getLocalChunkPosition(chunkX, chunkY);
        return localX === 0 || localY === 0 || 
               localX === this.chunksPerAxis - 1 || 
               localY === this.chunksPerAxis - 1;
    }
    
    /**
     * Get all chunks covered by the atlas containing this chunk.
     */
    getAtlasChunkRange(chunkX, chunkY) {
        const { atlasX, atlasY } = this.getAtlasCoords(chunkX, chunkY);
        
        const minChunkX = atlasX * this.chunksPerAxis;
        const maxChunkX = minChunkX + this.chunksPerAxis - 1;
        const minChunkY = atlasY * this.chunksPerAxis;
        const maxChunkY = minChunkY + this.chunksPerAxis - 1;
        
        console.log('[DataTextureConfig] Atlas (' + atlasX + ',' + atlasY + 
            ') covers chunks X:[' + minChunkX + '..' + maxChunkX + 
            '], Y:[' + minChunkY + '..' + maxChunkY + ']');
        
        return { minChunkX, maxChunkX, minChunkY, maxChunkY };
    }
    
    /**
     * Iterate over all chunks in an atlas.
     */
    *iterateAtlasChunks(atlasX, atlasY) {
        const baseX = atlasX * this.chunksPerAxis;
        const baseY = atlasY * this.chunksPerAxis;
        
        for (let y = 0; y < this.chunksPerAxis; y++) {
            for (let x = 0; x < this.chunksPerAxis; x++) {
                yield { 
                    chunkX: baseX + x, 
                    chunkY: baseY + y,
                    localX: x,
                    localY: y
                };
            }
        }
    }
    
    /**
     * Calculate memory usage for given number of atlases.
     */
    calculateMemoryUsage(atlasCount, bytesPerPixel = 16) {
        const pixelsPerAtlas = this.textureSize * this.textureSize;
        const textureTypesCount = this.atlasTextureTypes.length;
        return atlasCount * pixelsPerAtlas * bytesPerPixel * textureTypesCount;
    }
    
    /**
     * Format memory size for display
     */
    formatMemory(bytes) {
        if (bytes >= 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        } else if (bytes >= 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        } else {
            return (bytes / 1024).toFixed(2) + ' KB';
        }
    }
}

// Default singleton instance
// Change these values to configure atlas size globally
export const DEFAULT_ATLAS_CONFIG = new DataTextureConfig({
    textureSize: 2048,
    chunkSize: 128
});