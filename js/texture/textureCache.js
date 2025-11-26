// js/texture/textureCache.js
// Phase 3: Full atlas storage support

import { TextureAtlasKey } from '../world/textureAtlasKey.js';
import { DataTextureConfig, DEFAULT_ATLAS_CONFIG } from '../world/dataTextureConfiguration.js';

export class TextureCache {
    constructor(maxSizeBytes = 1024 * 1024 * 1024) {
        this.cache = new Map();
        this.maxSizeBytes = maxSizeBytes;
        this.currentSizeBytes = 0;
        this.id = Math.random().toString(36).substr(2, 9);
        
        // Track atlas usage: Map<atlasKeyString, Set<chunkKeyString>>
        this.atlasUsage = new Map();
        
        // Default atlas config (can be overridden)
        this.atlasConfig = DEFAULT_ATLAS_CONFIG;
        
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            atlasHits: 0,
            atlasMisses: 0
        };
        
        console.log('[TextureCache] Created with ID: ' + this.id + ', maxSize: ' + (maxSizeBytes / 1024 / 1024).toFixed(0) + 'MB');
    }

    /**
     * Set the atlas configuration for this cache
     */
    setAtlasConfig(config) {
        this.atlasConfig = config;
        console.log('[TextureCache] Atlas config set: ' + config.textureSize + 'x' + config.textureSize + ', ' + config.chunksPerAxis + ' chunks per axis');
    }

    /**
     * Generate cache key from various input types.
     * Supports:
     * - TextureAtlasKey object
     * - Legacy chunk coordinates (chunkX, chunkY)
     */
    makeKey(textureXOrAtlasKey, textureY, type) {
        // Support TextureAtlasKey objects
        if (textureXOrAtlasKey instanceof TextureAtlasKey) {
            const key = type + '_' + textureXOrAtlasKey.toString();
            return key;
        }
        
        // Legacy: chunk coordinates
        const key = type + '_' + textureXOrAtlasKey + '_' + textureY;
        return key;
    }

    /**
     * Check if texture exists for given key
     */
    has(textureXOrAtlasKey, textureY, type) {
        const key = this.makeKey(textureXOrAtlasKey, textureY, type);
        return this.cache.has(key);
    }

    /**
     * Get texture by key.
     * Supports both legacy chunk coords and TextureAtlasKey.
     */
    get(chunkXOrAtlasKey, chunkY, type) {
        const key = this.makeKey(chunkXOrAtlasKey, chunkY, type);
        const entry = this.cache.get(key);
        
        if (entry) {
            entry.lastAccess = performance.now();
            this.stats.hits++;
            return entry.texture;
        }
        
        this.stats.misses++;
        return null;
    }

    /**
     * Store texture in cache.
     * Supports both legacy chunk coords and TextureAtlasKey.
     */
    set(chunkXOrAtlasKey, chunkY, type, texture, sizeBytes) {
        const key = this.makeKey(chunkXOrAtlasKey, chunkY, type);
        
        // Determine if this is an atlas key
        const isAtlas = chunkXOrAtlasKey instanceof TextureAtlasKey;
        
        // If replacing existing entry, clean up old texture
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
        
        // Store the entry
        const entry = {
            texture,
            sizeBytes,
            lastAccess: performance.now(),
            created: performance.now(),
            type,
            isAtlas: isAtlas,
            isGPUOnly: texture._isGPUOnly || false
        };
        
        // Store atlas-specific metadata
        if (isAtlas) {
            entry.atlasKey = chunkXOrAtlasKey;
            entry.atlasX = chunkXOrAtlasKey.atlasX;
            entry.atlasY = chunkXOrAtlasKey.atlasY;
            entry.face = chunkXOrAtlasKey.face;
        } else {
            entry.chunkX = chunkXOrAtlasKey;
            entry.chunkY = chunkY;
        }
        
        this.cache.set(key, entry);
        this.currentSizeBytes += sizeBytes;
        
        this.evictIfNeeded();
    }

    /**
     * Get atlas texture for a specific chunk.
     * This is the primary method for atlas-based lookups.
     * 
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkY - Chunk Y coordinate
     * @param {string} type - Texture type (height, normal, tile, etc.)
     * @param {DataTextureConfig} config - Atlas configuration
     * @param {number|null} face - Cube face for spherical terrain
     * @returns {Object|null} - {texture, uvTransform} or null if not found
     */
    getAtlasForChunk(chunkX, chunkY, type, config = null, face = null) {
        const cfg = config || this.atlasConfig;
        
        // Calculate which atlas contains this chunk
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, cfg);
        const cacheKey = this.makeKey(atlasKey, null, type);
        
        const entry = this.cache.get(cacheKey);
        
        if (!entry) {
            this.stats.atlasMisses++;
            return null;
        }
        
        this.stats.atlasHits++;
        entry.lastAccess = performance.now();
        
        // Calculate UV transform for this chunk within the atlas
        const uvTransform = cfg.getChunkUVTransform(chunkX, chunkY);
        
        // Track that this chunk is using this atlas
        this._trackAtlasUsage(atlasKey.toString(), chunkX + ',' + chunkY);
        
        return {
            texture: entry.texture,
            atlasKey: atlasKey,
            uvTransform: uvTransform
        };
    }

    /**
     * Check if atlas exists for a chunk
     */
    hasAtlasForChunk(chunkX, chunkY, type, config = null, face = null) {
        const cfg = config || this.atlasConfig;
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, cfg);
        const cacheKey = this.makeKey(atlasKey, null, type);
        return this.cache.has(cacheKey);
    }

    /**
     * Check if ALL required texture types exist for an atlas
     */
    hasCompleteAtlas(chunkX, chunkY, config = null, face = null) {
        const cfg = config || this.atlasConfig;
        const types = cfg.atlasTextureTypes || ['height', 'normal', 'tile', 'splatData', 'macro'];
        
        for (const type of types) {
            if (!this.hasAtlasForChunk(chunkX, chunkY, type, cfg, face)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get all atlas textures for a chunk
     */
    getAllAtlasTexturesForChunk(chunkX, chunkY, config = null, face = null) {
        const cfg = config || this.atlasConfig;
        const types = cfg.atlasTextureTypes || ['height', 'normal', 'tile', 'splatData', 'macro'];
        const result = {};
        
        for (const type of types) {
            const atlasData = this.getAtlasForChunk(chunkX, chunkY, type, cfg, face);
            if (atlasData) {
                result[type] = atlasData;
            }
        }
        
        return result;
    }

    /**
     * Track which chunks are using which atlas (for smart eviction)
     */
    _trackAtlasUsage(atlasKeyStr, chunkKeyStr) {
        if (!this.atlasUsage.has(atlasKeyStr)) {
            this.atlasUsage.set(atlasKeyStr, new Set());
        }
        this.atlasUsage.get(atlasKeyStr).add(chunkKeyStr);
    }

    /**
     * Mark a chunk as no longer using its atlas
     */
    releaseChunkFromAtlas(chunkX, chunkY, config = null, face = null) {
        const cfg = config || this.atlasConfig;
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, cfg);
        const atlasKeyStr = atlasKey.toString();
        const chunkKeyStr = chunkX + ',' + chunkY;
        
        if (this.atlasUsage.has(atlasKeyStr)) {
            this.atlasUsage.get(atlasKeyStr).delete(chunkKeyStr);
            
            // If no chunks using this atlas, it becomes eligible for eviction
            if (this.atlasUsage.get(atlasKeyStr).size === 0) {
                console.log('[TextureCache] Atlas ' + atlasKeyStr + ' has no active chunks, eligible for eviction');
            }
        }
    }

    /**
     * Remove a chunk's textures (legacy per-chunk mode)
     */
    removeChunk(chunkX, chunkY) {
        const types = ['height', 'normal', 'tile', 'splatWeight', 'splatType', 'splatData', 'macro'];
        
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
                
                // Dispose wrapper
                if (entry.texture && entry.texture.dispose) {
                    entry.texture.dispose();
                }
                
                this.cache.delete(key);
                this.currentSizeBytes -= entry.sizeBytes;
            }
        }
        
        // Also release from any atlas tracking
        this.releaseChunkFromAtlas(chunkX, chunkY);
    }

    /**
     * Remove an entire atlas and all its textures
     */
    removeAtlas(atlasKey) {
        const types = this.atlasConfig.atlasTextureTypes || ['height', 'normal', 'tile', 'splatData', 'macro'];
        const atlasKeyStr = atlasKey.toString();
        
        console.log('[TextureCache] Removing atlas: ' + atlasKeyStr);
        
        for (const type of types) {
            const key = type + '_' + atlasKeyStr;
            const entry = this.cache.get(key);
            
            if (entry) {
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
            }
        }
        
        // Clear atlas usage tracking
        this.atlasUsage.delete(atlasKeyStr);
    }

    /**
     * Evict old textures if over memory budget.
     * Prioritizes evicting atlases with no active chunks.
     */
    evictIfNeeded() {
        if (this.currentSizeBytes <= this.maxSizeBytes) return;

        // Sort by last access time (oldest first)
        const entries = Array.from(this.cache.entries())
            .map(([key, entry]) => {
                // Calculate eviction priority
                // Lower = evict first
                let priority = entry.lastAccess;
                
                // If it's an atlas, check if chunks are still using it
                if (entry.isAtlas && entry.atlasKey) {
                    const atlasKeyStr = entry.atlasKey.toString();
                    const activeChunks = this.atlasUsage.get(atlasKeyStr);
                    
                    if (activeChunks && activeChunks.size > 0) {
                        // Boost priority (less likely to evict) if chunks are using it
                        priority += 1000000 * activeChunks.size;
                    }
                }
                
                return { key, entry, priority };
            })
            .sort((a, b) => a.priority - b.priority);

        const target = this.maxSizeBytes * 0.8;
        
        while (this.currentSizeBytes > target && entries.length > 0) {
            const { key, entry } = entries.shift();
            
            // Warn about evicting GPU-only textures
            if (entry.isGPUOnly) {
                console.warn('[TextureCache] Evicting GPU-only texture: ' + key + ' (cannot reconstruct)');
            }
            
            // Warn about evicting atlas with active chunks
            if (entry.isAtlas && entry.atlasKey) {
                const atlasKeyStr = entry.atlasKey.toString();
                const activeChunks = this.atlasUsage.get(atlasKeyStr);
                if (activeChunks && activeChunks.size > 0) {
                    console.warn('[TextureCache] Evicting atlas with ' + activeChunks.size + ' active chunks: ' + key);
                }
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

    /**
     * Clear all textures from cache
     */
    clear() {
        for (const entry of this.cache.values()) {
            if (entry.texture) {
                if (entry.texture._gpuTexture && entry.texture._gpuTexture.texture) {
                    entry.texture._gpuTexture.texture.destroy();
                }
                if (entry.texture.dispose) {
                    entry.texture.dispose();
                }
            }
        }
        this.cache.clear();
        this.atlasUsage.clear();
        this.currentSizeBytes = 0;
        console.log('[TextureCache] Cleared all textures');
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const atlasCount = Array.from(this.cache.values()).filter(e => e.isAtlas).length;
        const chunkCount = Array.from(this.cache.values()).filter(e => !e.isAtlas).length;
        
        return {
            ...this.stats,
            cacheSize: this.cache.size,
            atlasCount: atlasCount,
            chunkCount: chunkCount,
            bytesUsed: this.currentSizeBytes,
            bytesMax: this.maxSizeBytes,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            atlasHitRate: this.stats.atlasHits / (this.stats.atlasHits + this.stats.atlasMisses) || 0
        };
    }

    /**
     * Get list of all cached atlas keys
     */
    getAtlasKeys() {
        const atlasKeys = new Set();
        
        for (const entry of this.cache.values()) {
            if (entry.isAtlas && entry.atlasKey) {
                atlasKeys.add(entry.atlasKey.toString());
            }
        }
        
        return Array.from(atlasKeys);
    }

    /**
     * Debug: Print cache contents
     */
    debugPrint() {
        console.log('[TextureCache] === Cache Contents ===');
        console.log('  Total entries: ' + this.cache.size);
        console.log('  Memory used: ' + (this.currentSizeBytes / 1024 / 1024).toFixed(2) + ' MB');
        
        const byType = {};
        for (const [key, entry] of this.cache.entries()) {
            const type = entry.type || 'unknown';
            if (!byType[type]) byType[type] = { count: 0, bytes: 0 };
            byType[type].count++;
            byType[type].bytes += entry.sizeBytes;
        }
        
        console.log('  By type:');
        for (const [type, data] of Object.entries(byType)) {
            console.log('    ' + type + ': ' + data.count + ' entries, ' + (data.bytes / 1024 / 1024).toFixed(2) + ' MB');
        }
        
        console.log('  Atlas usage:');
        for (const [atlasKey, chunks] of this.atlasUsage.entries()) {
            console.log('    ' + atlasKey + ': ' + chunks.size + ' active chunks');
        }
    }
}