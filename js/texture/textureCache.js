
// At top of file, add import
import { TextureAtlasKey } from '../world/textureAtlasKey.js';


export class TextureCache {


    constructor(maxSizeBytes = 1024 * 1024 * 1024) {
        this.cache = new Map();
        this.maxSizeBytes = maxSizeBytes;
        this.currentSizeBytes = 0;
        this.id = Math.random().toString(36).substr(2, 9);
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
        console.log(`TextureCache created with ID: ${this.id}, maxSize: ${(maxSizeBytes/1024/1024).toFixed(0)}MB`);
    }


// Update makeKey method to handle both old and new format
makeKey(textureXOrAtlasKey, textureY, type) {
    // NEW: Support TextureAtlasKey objects
    if (textureXOrAtlasKey instanceof TextureAtlasKey) {
        const key = `${type}_${textureXOrAtlasKey.toString()}`;
        console.log(`[TextureCache] makeKey from TextureAtlasKey: "${key}"`);
        return key;
    }
    
    // OLD: Support legacy chunk coordinates (for backward compatibility)
    const key = `${type}_${textureXOrAtlasKey}_${textureY}`;
    console.log(`[TextureCache] makeKey from coords: "${key}"`);
    return key;
}
// Add new method to get texture by chunk coordinates
getByChunkCoords(chunkX, chunkY, type, textureSize = 2048, chunkSize = 128, face = null) {
    const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, textureSize, chunkSize);
    const cacheKey = this.makeKey(atlasKey, null, type);
    
    console.log(`[TextureCache] getByChunkCoords chunk=(${chunkX},${chunkY}) type=${type}`);
    console.log(`[TextureCache]   Looking for: "${cacheKey}"`);
    
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
        console.log(`[TextureCache]   NOT FOUND. Available keys:`, 
            Array.from(this.cache.keys()).filter(k => k.startsWith(type)));
        return null;
    }
    
    console.log(`[TextureCache]   FOUND texture ${entry.texture.width}x${entry.texture.height}`);
    return entry.texture;
}
    has(textureX, textureY, type) {
        return this.cache.has(this.makeKey(textureX, textureY, type));
    }


    get(chunkX, chunkY, type) {
        const key = this.makeKey(chunkX, chunkY, type);
        const entry = this.cache.get(key);
        
        if (entry) {
            entry.lastAccess = performance.now();
            this.stats.hits++;
            return entry.texture;
        }
        
        this.stats.misses++;
        return null;
    }

    set(chunkX, chunkY, type, texture, sizeBytes) {
        const key = this.makeKey(chunkX, chunkY, type);
    
        if (this.cache.has(key)) {
            const old = this.cache.get(key);
            this.currentSizeBytes -= old.sizeBytes;
            
            // Dispose old texture
            if (old.texture) {
                if (old.texture._gpuTexture && old.texture._gpuTexture.texture) {
                    old.texture._gpuTexture.texture.destroy();
                }
                if (old.texture.dispose) {
                    old.texture.dispose();
                }
            }
        }
    
        this.cache.set(key, {
            texture,
            sizeBytes,
            lastAccess: performance.now(),
            created: performance.now(),
            chunkX,
            chunkY,
            type,
            isGPUOnly: texture._isGPUOnly || false // ← Track GPU-only flag
        });
    
        this.currentSizeBytes += sizeBytes;
        this.evictIfNeeded();
    }
    
    removeChunk(chunkX, chunkY) {
        const types = ['height', 'normal', 'tile', 'splatWeight', 'splatType', 'macro'];
        for (const type of types) {
            const key = this.makeKey(chunkX, chunkY, type);
            const entry = this.cache.get(key);
            if (entry) {
                // Destroy GPU texture
                if (entry.texture && entry.texture._gpuTexture) {
                    if (entry.texture._gpuTexture.texture) {
                        entry.texture._gpuTexture.texture.destroy();
                    }
                }
                
                // Dispose wrapper (if has method)
                if (entry.texture && entry.texture.dispose) {
                    entry.texture.dispose();
                }
                
                this.cache.delete(key);
                this.currentSizeBytes -= entry.sizeBytes;
            }
        }
    }
    
    evictIfNeeded() {
        if (this.currentSizeBytes <= this.maxSizeBytes) return;
    
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    
        const target = this.maxSizeBytes * 0.8;
        
        while (this.currentSizeBytes > target && entries.length > 0) {
            const [key, entry] = entries.shift();
            
            // ============================================
            // CRITICAL: For GPU-only textures, warn if evicting
            // (Cannot reconstruct without CPU data)
            // ============================================
            if (entry.isGPUOnly) {
                console.warn(`⚠️ Evicting GPU-only texture: ${key} (cannot reconstruct)`);
            }
            
            // Destroy GPU texture
            if (entry.texture && entry.texture._gpuTexture) {
                if (entry.texture._gpuTexture.texture) {
                    entry.texture._gpuTexture.texture.destroy();
                }
            }
            
            if (entry.texture && entry.texture.dispose) {
                entry.texture.dispose();
            }
            
            this.cache.delete(key);
            this.currentSizeBytes -= entry.sizeBytes;
            this.stats.evictions++;
        }
    }
    clear() {
        for (const entry of this.cache.values()) {
            if (entry.texture) {
                if (entry.texture.dispose) {
                    entry.texture.dispose();
                } else if (entry.texture.destroy) {
                    entry.texture.destroy();
                }
            }
        }
        this.cache.clear();
        this.currentSizeBytes = 0;
    }

    getStats() {
        return {
            ...this.stats,
            cacheSize: this.cache.size,
            bytesUsed: this.currentSizeBytes,
            bytesMax: this.maxSizeBytes,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }
}