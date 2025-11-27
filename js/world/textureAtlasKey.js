// js/world/textureAtlasKey.js
// Identifies a specific atlas by grid coordinates
// Key format uses config.textureSize for the suffix (dynamic, not hardcoded)

import { DataTextureConfig, DEFAULT_ATLAS_CONFIG } from './dataTextureConfiguration.js';


export class TextureAtlasKey {
    /**
     * @param {number} atlasX - Atlas grid X coordinate
     * @param {number} atlasY - Atlas grid Y coordinate
     * @param {number|null} face - Cube face for spherical terrain (0-5), null for flat
     * @param {DataTextureConfig} config - Atlas configuration
     */
    constructor(atlasX, atlasY, face = null, config = DEFAULT_ATLAS_CONFIG) {
        // Validate inputs
        if (typeof atlasX !== 'number' || isNaN(atlasX)) {
            throw new Error('TextureAtlasKey: Invalid atlasX: ' + atlasX);
        }
        if (typeof atlasY !== 'number' || isNaN(atlasY)) {
            throw new Error('TextureAtlasKey: Invalid atlasY: ' + atlasY);
        }
        if (face !== null && (typeof face !== 'number' || face < 0 || face > 5)) {
            throw new Error('TextureAtlasKey: Invalid face: ' + face + ' (must be 0-5 or null)');
        }
        
        this.atlasX = atlasX;
        this.atlasY = atlasY;
        this.face = face;
        this.config = config;
        
        // Pre-calculate chunk range for this atlas
        this._minChunkX = atlasX * config.chunksPerAxis;
        this._minChunkY = atlasY * config.chunksPerAxis;
        this._maxChunkX = this._minChunkX + config.chunksPerAxis - 1;
        this._maxChunkY = this._minChunkY + config.chunksPerAxis - 1;
        
        console.log('[TextureAtlasKey] Created: atlas=(' + atlasX + ',' + atlasY + '), face=' + face + 
            ', covers chunks [' + this._minChunkX + '..' + this._maxChunkX + 
            ', ' + this._minChunkY + '..' + this._maxChunkY + ']');
    }
    
    /**
     * Generate string key for cache lookups.
     * Format: "atlas_X,Y_SIZE" or "atlas_fF_X,Y_SIZE" for spherical
     * 

     */
    toString() {
        // The suffix is DYNAMIC - it uses this.config.textureSize
        if (this.face === null) {
            return 'atlas_' + this.atlasX + ',' + this.atlasY + '_' + this.config.textureSize;
        }
        return 'atlas_f' + this.face + '_' + this.atlasX + ',' + this.atlasY + '_' + this.config.textureSize;
    }
    
    /**
     * Create TextureAtlasKey from chunk coordinates.
     * This is the primary factory method.
     * 
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkY - Chunk Y coordinate
     * @param {number|null} face - Cube face (null for flat terrain)
     * @param {DataTextureConfig|number} configOrTextureSize - Config object or legacy textureSize
     * @param {number|null} chunkSize - Legacy chunkSize parameter (only if configOrTextureSize is number)
     * @returns {TextureAtlasKey}
     */
    static fromChunkCoords(chunkX, chunkY, face = null, configOrTextureSize = DEFAULT_ATLAS_CONFIG, chunkSize = null) {
        let config;
        
        // Support both new and legacy call signatures
        if (typeof configOrTextureSize === 'number') {
            // Legacy call: fromChunkCoords(x, y, face, 2048, 128)
            console.log('[TextureAtlasKey] Legacy call: textureSize=' + configOrTextureSize + ', chunkSize=' + chunkSize);
            
            if (chunkSize === null) {
                throw new Error('TextureAtlasKey.fromChunkCoords: chunkSize required when textureSize is provided');
            }
            
            config = new DataTextureConfig({
                textureSize: configOrTextureSize,
                chunkSize: chunkSize
            });
        } else if (configOrTextureSize instanceof DataTextureConfig) {
            config = configOrTextureSize;
        } else if (configOrTextureSize && typeof configOrTextureSize === 'object') {
            // Plain object with config properties
            config = new DataTextureConfig(configOrTextureSize);
        } else {
            config = DEFAULT_ATLAS_CONFIG;
        }
        
        // Calculate atlas coordinates using floor division
        const atlasX = Math.floor(chunkX / config.chunksPerAxis);
        const atlasY = Math.floor(chunkY / config.chunksPerAxis);
        
        console.log('[TextureAtlasKey] fromChunkCoords: chunk=(' + chunkX + ',' + chunkY + 
            ') face=' + face + ' -> atlas=(' + atlasX + ',' + atlasY + ')');
        console.log('[TextureAtlasKey]   Config: textureSize=' + config.textureSize + 
            ', chunkSize=' + config.chunkSize + ', chunksPerAxis=' + config.chunksPerAxis);
        
        return new TextureAtlasKey(atlasX, atlasY, face, config);
    }
    
    /**
     * Parse key string back to TextureAtlasKey object.
     * 
     * @param {string} keyString - Key like "atlas_0,0_2048" or "atlas_f2_1,0_2048"
     * @param {DataTextureConfig} config - Config instance (required)
     * @returns {TextureAtlasKey}
     */
    static fromString(keyString, config = DEFAULT_ATLAS_CONFIG) {
        if (!config) {
            throw new Error('TextureAtlasKey.fromString requires config parameter');
        }
        
        console.log('[TextureAtlasKey] Parsing key: "' + keyString + '"');
        
        // Remove "atlas_" prefix
        if (!keyString.startsWith('atlas_')) {
            throw new Error('TextureAtlasKey.fromString: Invalid key format (missing "atlas_" prefix): "' + keyString + '"');
        }
        
        const withoutPrefix = keyString.substring(6); // Remove "atlas_"
        
        let face = null;
        let coords, texSize;
        
        if (withoutPrefix.startsWith('f')) {
            // Spherical format: "f0_0,0_2048"
            const faceEnd = withoutPrefix.indexOf('_');
            if (faceEnd === -1) {
                throw new Error('TextureAtlasKey.fromString: Invalid spherical format: "' + keyString + '"');
            }
            
            face = parseInt(withoutPrefix.substring(1, faceEnd), 10);
            const rest = withoutPrefix.substring(faceEnd + 1);
            const parts = rest.split('_');
            
            if (parts.length !== 2) {
                throw new Error('TextureAtlasKey.fromString: Invalid format: "' + keyString + '"');
            }
            
            coords = parts[0];
            texSize = parseInt(parts[1], 10);
            
            console.log('[TextureAtlasKey]   Spherical atlas: face=' + face);
        } else {
            // Flat format: "0,0_2048"
            const parts = withoutPrefix.split('_');
            
            if (parts.length !== 2) {
                throw new Error('TextureAtlasKey.fromString: Invalid format: "' + keyString + '"');
            }
            
            coords = parts[0];
            texSize = parseInt(parts[1], 10);
            
            console.log('[TextureAtlasKey]   Flat atlas');
        }
        
        const coordParts = coords.split(',');
        if (coordParts.length !== 2) {
            throw new Error('TextureAtlasKey.fromString: Invalid coordinates: "' + coords + '"');
        }
        
        const atlasX = parseInt(coordParts[0], 10);
        const atlasY = parseInt(coordParts[1], 10);
        
        if (isNaN(atlasX) || isNaN(atlasY) || isNaN(texSize)) {
            throw new Error('TextureAtlasKey.fromString: Failed to parse values from: "' + keyString + '"');
        }
        
        console.log('[TextureAtlasKey]   Result: atlas=(' + atlasX + ',' + atlasY + '), textureSize=' + texSize);
        
        // Warn if config doesnt match parsed texture size
        if (config.textureSize !== texSize) {
            console.warn('[TextureAtlasKey]   WARNING: Config textureSize (' + config.textureSize + 
                ') does not match key (' + texSize + ')');
        }
        
        return new TextureAtlasKey(atlasX, atlasY, face, config);
    }
    
    /**
     * Get UV transform for a specific chunk within this atlas.
     */
    getChunkUVTransform(chunkX, chunkY) {
        // Verify chunk is in this atlas
        if (!this.containsChunk(chunkX, chunkY)) {
            console.warn('[TextureAtlasKey] getChunkUVTransform: chunk (' + chunkX + ',' + chunkY + 
                ') is not in atlas ' + this.toString());
        }
        
        return this.config.getChunkUVTransform(chunkX, chunkY);
    }
    
    /**
     * Check if this atlas contains the given chunk.
     */
    containsChunk(chunkX, chunkY) {
        return chunkX >= this._minChunkX && chunkX <= this._maxChunkX &&
               chunkY >= this._minChunkY && chunkY <= this._maxChunkY;
    }
    
    /**
     * Get all chunks covered by this atlas.
     */
    getCoveredChunks() {
        const chunks = [];
        
        for (let y = 0; y < this.config.chunksPerAxis; y++) {
            for (let x = 0; x < this.config.chunksPerAxis; x++) {
                chunks.push({
                    chunkX: this._minChunkX + x,
                    chunkY: this._minChunkY + y
                });
            }
        }
        
        return chunks;
    }
    
    /**
     * Get the chunk range covered by this atlas.
     */
    getChunkRange() {
        return {
            minChunkX: this._minChunkX,
            maxChunkX: this._maxChunkX,
            minChunkY: this._minChunkY,
            maxChunkY: this._maxChunkY
        };
    }
    
    /**
     * Check equality with another TextureAtlasKey.
     */
    equals(other) {
        if (!(other instanceof TextureAtlasKey)) return false;
        return this.atlasX === other.atlasX &&
               this.atlasY === other.atlasY &&
               this.face === other.face &&
               this.config.textureSize === other.config.textureSize;
    }
    
    /**
     * Get adjacent atlas keys.
     */
    getAdjacentAtlases() {
        return {
            left: new TextureAtlasKey(this.atlasX - 1, this.atlasY, this.face, this.config),
            right: new TextureAtlasKey(this.atlasX + 1, this.atlasY, this.face, this.config),
            top: new TextureAtlasKey(this.atlasX, this.atlasY - 1, this.face, this.config),
            bottom: new TextureAtlasKey(this.atlasX, this.atlasY + 1, this.face, this.config)
        };
    }
}