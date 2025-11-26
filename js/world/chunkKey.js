// js/world/chunkKey.js
// Unified chunk key system supporting both flat and spherical modes
// with proper atlas key integration

import { TextureAtlasKey } from './textureAtlasKey.js';
import { DEFAULT_ATLAS_CONFIG } from './dataTextureConfiguration.js';

/**
 * Unified chunk key class that handles both flat and spherical terrain modes.
 * Provides consistent conversion to TextureAtlasKey for texture caching.
 * 
 * Key formats:
 * - Flat:      "x,y"           (e.g., "17,5")
 * - Spherical: "face:x,y:lod"  (e.g., "2:17,5:0")
 */
export class ChunkKey {
    /**
     * @param {number} x - Chunk X coordinate
     * @param {number} y - Chunk Y coordinate  
     * @param {number|null} face - Cube face for spherical terrain (0-5), null for flat
     * @param {number} lod - Level of detail (default 0)
     */
    constructor(x, y, face = null, lod = 0) {
        // Validate inputs
        if (typeof x !== 'number' || isNaN(x)) {
            throw new Error('ChunkKey: Invalid x coordinate: ' + x);
        }
        if (typeof y !== 'number' || isNaN(y)) {
            throw new Error('ChunkKey: Invalid y coordinate: ' + y);
        }
        if (face !== null && (typeof face !== 'number' || face < 0 || face > 5)) {
            throw new Error('ChunkKey: Invalid face: ' + face + ' (must be 0-5 or null)');
        }
        
        this.x = x;
        this.y = y;
        this.face = face;  // null for flat terrain, 0-5 for cube faces
        this.lod = lod;
    }
    
    /**
     * Generate string key for Map lookups
     * Flat:      "x,y"
     * Spherical: "face:x,y:lod"
     */
    toString() {
        if (this.face === null) {
            return this.x + ',' + this.y;
        }
        return this.face + ':' + this.x + ',' + this.y + ':' + this.lod;
    }
    
    /**
     * Parse key string back to ChunkKey object
     * @param {string} keyString - Key like "17,5" or "2:17,5:0"
     * @returns {ChunkKey}
     */
    static fromString(keyString) {
        if (typeof keyString !== 'string') {
            throw new Error('ChunkKey.fromString: Expected string, got ' + typeof keyString);
        }
        
        if (keyString.includes(':')) {
            // Spherical format: "face:x,y:lod"
            const parts = keyString.split(':');
            if (parts.length !== 3) {
                throw new Error('ChunkKey.fromString: Invalid spherical format: "' + keyString + '"');
            }
            
            const face = parseInt(parts[0], 10);
            const coords = parts[1].split(',');
            if (coords.length !== 2) {
                throw new Error('ChunkKey.fromString: Invalid coordinates in: "' + keyString + '"');
            }
            const x = parseInt(coords[0], 10);
            const y = parseInt(coords[1], 10);
            const lod = parseInt(parts[2], 10);
            
            if (isNaN(face) || isNaN(x) || isNaN(y) || isNaN(lod)) {
                throw new Error('ChunkKey.fromString: Failed to parse spherical key: "' + keyString + '"');
            }
            
            console.log('[ChunkKey] Parsed spherical: "' + keyString + '" -> face=' + face + 
                ', x=' + x + ', y=' + y + ', lod=' + lod);
            return new ChunkKey(x, y, face, lod);
        } else {
            // Flat format: "x,y"
            const parts = keyString.split(',');
            if (parts.length !== 2) {
                throw new Error('ChunkKey.fromString: Invalid flat format: "' + keyString + '"');
            }
            
            const x = parseInt(parts[0], 10);
            const y = parseInt(parts[1], 10);
            
            if (isNaN(x) || isNaN(y)) {
                throw new Error('ChunkKey.fromString: Failed to parse flat key: "' + keyString + '"');
            }
            
            console.log('[ChunkKey] Parsed flat: "' + keyString + '" -> x=' + x + ', y=' + y);
            return new ChunkKey(x, y, null, 0);
        }
    }
    
    /**
     * Check if this is a flat terrain chunk
     */
    isFlat() {
        return this.face === null;
    }
    
    /**
     * Check if this is a spherical chunk
     */
    isSpherical() {
        return this.face !== null;
    }
    
    /**
     * Convert chunk key to TextureAtlasKey for texture caching.
     * This is the KEY METHOD for atlas system integration.
     * 
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {TextureAtlasKey}
     * 
     * Example:
     *   const chunk = new ChunkKey(17, 5);
     *   const atlas = chunk.toAtlasKey(config);
     *   // With chunksPerAxis=16: atlas represents (1,0) containing chunks [16-31, 0-15]
     */
    toAtlasKey(config = DEFAULT_ATLAS_CONFIG) {
        // Delegate to TextureAtlasKey's fromChunkCoords which handles the math
        const atlasKey = TextureAtlasKey.fromChunkCoords(
            this.x, 
            this.y, 
            this.face, 
            config
        );
        
        console.log('[ChunkKey] toAtlasKey: chunk=(' + this.x + ',' + this.y + 
            ') face=' + this.face + ' -> atlas=' + atlasKey.toString());
        
        return atlasKey;
    }
    
    /**
     * Get the UV transform for this chunk within its atlas
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {{offsetX: number, offsetY: number, scale: number}}
     */
    getUVTransform(config = DEFAULT_ATLAS_CONFIG) {
        return config.getChunkUVTransform(this.x, this.y);
    }
    
    /**
     * Get all chunk keys that share the same atlas as this chunk
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {ChunkKey[]}
     */
    getSiblingChunks(config = DEFAULT_ATLAS_CONFIG) {
        const atlasKey = this.toAtlasKey(config);
        const covered = atlasKey.getCoveredChunks();
        
        return covered.map(function(c) {
            return new ChunkKey(c.chunkX, c.chunkY, this.face, this.lod);
        }, this);
    }
    
    /**
     * Legacy method for backward compatibility
     * @deprecated Use toAtlasKey() instead
     */
    getTextureCacheKey() {
        console.warn('[ChunkKey] getTextureCacheKey() is deprecated. Use toAtlasKey() instead.');
        return this.x + ',' + this.y;
    }
    
    /**
     * Check equality with another ChunkKey
     */
    equals(other) {
        if (!(other instanceof ChunkKey)) return false;
        return this.x === other.x && 
               this.y === other.y && 
               this.face === other.face && 
               this.lod === other.lod;
    }
    
    /**
     * Create a copy of this chunk key
     */
    clone() {
        return new ChunkKey(this.x, this.y, this.face, this.lod);
    }
    
    /**
     * Get chunk at relative offset
     * @param {number} dx - X offset
     * @param {number} dy - Y offset
     * @returns {ChunkKey}
     */
    offset(dx, dy) {
        return new ChunkKey(this.x + dx, this.y + dy, this.face, this.lod);
    }
}