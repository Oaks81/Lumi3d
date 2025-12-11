// js/world/lodAtlasConfig.js
// Configuration for hierarchical LOD atlas system

export class LODAtlasConfig {
    /**
     * @param {Object} options
     * @param {number} options.worldCoverage - World space coverage per atlas in meters (e.g., 1024)
     * @param {number} options.baseTextureSize - Texture size at LOD 0 (e.g., 1024 or 2048)
     * @param {number} options.baseChunkSize - Chunk size in meters (e.g., 64, 128, 256)
     * @param {number} options.maxLODLevels - Maximum LOD levels (e.g., 5)
     */
    constructor(options = {}) {
        // World-space constants (same for all LOD levels)
        this.worldCoverage = options.worldCoverage || 1024;
        this.baseChunkSize = options.baseChunkSize || 128;
        
        // Texture sizes
        this.baseTextureSize = options.baseTextureSize || 1024;
        this.maxLODLevels = options.maxLODLevels || 5;
        
        // Derived values
        this.chunksPerAtlas = this.worldCoverage / this.baseChunkSize;
        
        // Validate
        if (!this._isPowerOfTwo(this.worldCoverage)) {
            console.warn('[LODAtlasConfig] worldCoverage should be power of 2');
        }
        if (!this._isPowerOfTwo(this.baseTextureSize)) {
            throw new Error('[LODAtlasConfig] baseTextureSize must be power of 2');
        }
        if (!this._isPowerOfTwo(this.baseChunkSize)) {
            throw new Error('[LODAtlasConfig] baseChunkSize must be power of 2');
        }
        if (this.worldCoverage % this.baseChunkSize !== 0) {
            throw new Error('[LODAtlasConfig] worldCoverage must be divisible by baseChunkSize');
        }
        
        // Pre-calculate LOD level configurations
        this.lodConfigs = this._buildLODConfigs();
        
        // Distance thresholds for LOD selection (in meters)
        this.lodDistances = options.lodDistances || this._defaultLODDistances();
        
        console.log('[LODAtlasConfig] Initialized:');
        console.log(`  World coverage: ${this.worldCoverage}m × ${this.worldCoverage}m per atlas`);
        console.log(`  Base chunk size: ${this.baseChunkSize}m`);
        console.log(`  Chunks per atlas: ${this.chunksPerAtlas} × ${this.chunksPerAtlas}`);
        console.log(`  LOD levels: ${this.maxLODLevels}`);
        this._logLODTable();
    }
    
    _isPowerOfTwo(n) {
        return n > 0 && (n & (n - 1)) === 0;
    }
    
    _buildLODConfigs() {
        const configs = [];
        
        for (let lod = 0; lod < this.maxLODLevels; lod++) {
            const divisor = Math.pow(2, lod);
            
            configs.push({
                lod: lod,
                textureSize: Math.max(64, Math.floor(this.baseTextureSize / divisor)),
                pixelsPerMeter: (this.baseTextureSize / divisor) / this.worldCoverage,
                // Vertex grid size for geometry (segments + 1 vertices per side)
                gridSegments: Math.max(4, Math.floor(this.baseChunkSize / divisor)),
                metersPerVertex: divisor,
                worldCoverage: this.worldCoverage,
                chunksPerAtlas: this.chunksPerAtlas
            });
        }
        
        return configs;
    }
    
    _defaultLODDistances() {
        // Push mid/low LODs farther out to reduce near-field pops
        return [1200, 3200, 8000, 16000, Infinity];
    }
    
    _logLODTable() {
        console.log('  LOD | Texture  | Segments | m/Vertex | Distance Range');
        console.log('  ----|----------|----------|----------|---------------');
        for (let i = 0; i < this.lodConfigs.length; i++) {
            const cfg = this.lodConfigs[i];
            const distStart = i === 0 ? 0 : this.lodDistances[i - 1];
            const distEnd = this.lodDistances[i] === Infinity ? '∞' : this.lodDistances[i];
            console.log(`   ${i}  | ${cfg.textureSize.toString().padStart(4)}×${cfg.textureSize.toString().padEnd(4)} | ${cfg.gridSegments.toString().padStart(4)}×${cfg.gridSegments.toString().padEnd(4)} | ${cfg.metersPerVertex.toString().padStart(8)} | ${distStart}-${distEnd}m`);
        }
    }
    
    getLODForDistance(distance) {
        for (let lod = 0; lod < this.lodDistances.length; lod++) {
            if (distance < this.lodDistances[lod]) {
                return Math.min(lod, this.maxLODLevels - 1);
            }
        }
        return this.maxLODLevels - 1;
    }
    
    getConfigForLOD(lod) {
        const clampedLOD = Math.max(0, Math.min(lod, this.lodConfigs.length - 1));
        return this.lodConfigs[clampedLOD];
    }
    
    getAtlasCoords(worldX, worldY) {
        const atlasX = Math.floor(worldX / this.worldCoverage);
        const atlasY = Math.floor(worldY / this.worldCoverage);
        return { atlasX, atlasY };
    }
    
    getChunkCoords(worldX, worldY) {
        const chunkX = Math.floor(worldX / this.baseChunkSize);
        const chunkY = Math.floor(worldY / this.baseChunkSize);
        return { chunkX, chunkY };
    }
    
    getLocalChunkPosition(chunkX, chunkY) {
        const atlasX = Math.floor(chunkX / this.chunksPerAtlas);
        const atlasY = Math.floor(chunkY / this.chunksPerAtlas);
        const localX = chunkX - (atlasX * this.chunksPerAtlas);
        const localY = chunkY - (atlasY * this.chunksPerAtlas);
        return { localX, localY, atlasX, atlasY };
    }
    
    getChunkUVTransform(chunkX, chunkY) {
        const { localX, localY } = this.getLocalChunkPosition(chunkX, chunkY);
        const uvScale = 1.0 / this.chunksPerAtlas;
        
        return {
            offsetX: localX * uvScale,
            offsetY: localY * uvScale,
            scale: uvScale
        };
    }
}

export const DEFAULT_LOD_ATLAS_CONFIG = new LODAtlasConfig({
    worldCoverage: 1024,
    baseTextureSize: 1024,
    baseChunkSize: 128,
    maxLODLevels: 5
});
