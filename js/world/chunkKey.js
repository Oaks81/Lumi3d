// js/world/ChunkKey.js

/**
 * Unified chunk key system supporting both flat and spherical modes
 */
export class ChunkKey {
    constructor(x, y, face = null, lod = 0) {
        this.x = x;
        this.y = y;
        this.face = face;  // null for flat terrain
        this.lod = lod;
    }
    
    /**
     * Generate string key for Map lookups
     * Flat:      "x,y"
     * Spherical: "face:x,y:lod"
     */
    toString() {
        if (this.face === null) {
            return `${this.x},${this.y}`;
        }
        return `${this.face}:${this.x},${this.y}:${this.lod}`;
    }
    
    /**
     * Parse key string back to ChunkKey object
     */
    static fromString(keyString) {
        if (keyString.includes(':')) {
            // Spherical format: "face:x,y:lod"
            const parts = keyString.split(':');
            const face = parseInt(parts[0]);
            const [x, y] = parts[1].split(',').map(Number);
            const lod = parseInt(parts[2]);
            
            console.log(`[ChunkKey] Parsed spherical key: "${keyString}" -> face=${face}, x=${x}, y=${y}, lod=${lod}`);
            
            return new ChunkKey(x, y, face, lod);
        } else {
            // Flat format: "x,y"
            const [x, y] = keyString.split(',').map(Number);
            
            console.log(`[ChunkKey] Parsed flat key: "${keyString}" -> x=${x}, y=${y}`);
            
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
     * Get texture cache key (always uses x,y regardless of mode)
     */
    getTextureCacheKey() {
        return `${this.x},${this.y}`;
    }
    
    equals(other) {
        if (!(other instanceof ChunkKey)) return false;
        return this.x === other.x && 
               this.y === other.y && 
               this.face === other.face && 
               this.lod === other.lod;
    }
}