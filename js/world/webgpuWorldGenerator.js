// js/world/webgpuWorldGenerator.js
// Phase 4: Full atlas integration with UV transforms in chunk data
//
// Key changes:
// - Properly stores atlas textures in chunkData.textureRefs
// - Includes uvTransform for shader usage
// - Works with both atlas and legacy per-chunk modes

import { BaseWorldGenerator } from './baseWorldGenerator.js';
import { WebGPUTerrainGenerator } from "./webgpuTerrainGenerator.js";
import { ChunkData } from "./chunkData.js";
import { TreeFeature } from './features/treeFeature.js';
import { TextureAtlasKey } from './textureAtlasKey.js';

export class WebGPUWorldGenerator extends BaseWorldGenerator {
    constructor(renderer, textureCache, chunkSize, seed) {
        super(renderer, textureCache, chunkSize, seed);
        
        // Atlas mode flag - set to true to use atlas textures
        this.useAtlasMode = true;
    }

    getAPIName() {
        return 'WebGPU';
    }

    async initializeAPI() {
        if (this.backend && this.backend.device) {
            this.device = this.backend.device;
            this.adapter = this.backend.adapter;
            console.log('[OK] WebGPUWorldGenerator: Attached to existing Backend Device');
            return;
        }

        console.warn('[WARN] WebGPUWorldGenerator: Creating ISOLATED device (Context sharing issues WILL occur)');

        if (!navigator.gpu) {
            throw new Error('WebGPU not supported in this browser');
        }

        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        
        if (!this.adapter) {
            throw new Error('No appropriate GPUAdapter found');
        }

        this.device = await this.adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {
                maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: this.adapter.limits.maxBufferSize
            }
        });

        this.device.lost.then((info) => {
            console.error('[ERROR] WebGPU device lost: ' + info.message);
        });

        console.log('WebGPU device initialized for world generation (Standalone)');
    }

    async initializeModules() {
        if (this.modules.tiledTerrain.enabled) {
            this.modules.tiledTerrain.instance = new WebGPUTerrainGenerator(
                this.device,
                this.seed,
                this.chunkSize,
                this.macroConfig,
                this.splatConfig,
                this.textureCache
            );
            
            await this.modules.tiledTerrain.instance.initialize();
        }
    }

    async generateChunk(chunkX, chunkY, face = null, lod = 0) {
        await this._ready;
        
        // Validate inputs - protect against NaN from ChunkManager bugs
        if (typeof chunkX !== 'number' || isNaN(chunkX) || 
            typeof chunkY !== 'number' || isNaN(chunkY)) {
            console.error('[WebGPUWorldGenerator] Invalid chunk coordinates: (' + chunkX + ',' + chunkY + ')');
            throw new Error('Invalid chunk coordinates: chunkX=' + chunkX + ', chunkY=' + chunkY);
        }
        
        console.log('[WebGPUWorldGenerator] generateChunk(' + chunkX + ', ' + chunkY + ', face=' + face + ', lod=' + lod + ')');
        
        // Create chunk data structure
        const chunkData = new ChunkData(chunkX, chunkY, this.chunkSize);
        if (this.planetConfig) {
            chunkData.isSpherical = true;
            chunkData.baseAltitude = this.planetConfig.radius;
        }
        
        if (this.useAtlasMode) {
            // Atlas mode: generate or get atlas, then reference it
            await this._setupAtlasTextures(chunkData, chunkX, chunkY, face);
        } else {
            // Legacy mode: generate per-chunk textures
            await this._setupLegacyTextures(chunkData, chunkX, chunkY);
        }

        // Calculate water visibility
        chunkData.calculateWaterVisibility(this.globalWaterLevel);

        if (chunkData.hasWater || chunkData.isFullySubmerged) {
            chunkData.waterFeatures = [{
                type: 'water',
                chunkX: chunkX,
                chunkY: chunkY,
                waterLevel: this.globalWaterLevel,
                chunkSize: this.chunkSize,
                waterType: chunkData.isFullySubmerged ? 'deep' : 'shallow'
            }];
        } else {
            chunkData.waterFeatures = [];
        }

        // Generate static objects
        if (this.modules.staticObjects.enabled && !chunkData.isFullySubmerged) {
            this.generateObjectData(chunkData, chunkX, chunkY);
        }

        return chunkData;
    }

    /**
     * Setup atlas textures for a chunk (Phase 4 key method)
     */
    async _setupAtlasTextures(chunkData, chunkX, chunkY, face) {
        // Ensure atlas exists
        const needsAtlas = !this.hasAtlasForChunk(chunkX, chunkY, face);
        
        if (needsAtlas) {
            console.log('[WebGPUWorldGenerator] Generating atlas for chunk (' + chunkX + ',' + chunkY + ')');
            await this.generateAtlasForChunk(chunkX, chunkY, face);
        }
        
        // Get atlas key and UV transform
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        const uvTransform = this.atlasConfig.getChunkUVTransform(chunkX, chunkY);
        
        // Store atlas info in chunk data
        chunkData.atlasKey = atlasKey;
        chunkData.uvTransform = uvTransform;
        chunkData.useAtlasMode = true;
        
        console.log('[WebGPUWorldGenerator] Chunk UV transform: offset=(' + 
            uvTransform.offsetX.toFixed(4) + ',' + uvTransform.offsetY.toFixed(4) + 
            '), scale=' + uvTransform.scale.toFixed(4));
        
        // Get atlas textures from cache
        const atlasTextures = this.getAtlasTexturesForChunk(chunkX, chunkY, face);
        
        // Store texture references (pointing to atlas textures)
        chunkData.textureRefs = {
            chunkX: chunkX,
            chunkY: chunkY,
            atlasKey: atlasKey,
            uvTransform: uvTransform,
            useAtlasMode: true,
            isWebGPU: true,
            // Atlas textures (shared with other chunks in same atlas)
            heightTexture: atlasTextures.height ? atlasTextures.height.texture : null,
            normalTexture: atlasTextures.normal ? atlasTextures.normal.texture : null,
            tileTexture: atlasTextures.tile ? atlasTextures.tile.texture : null,
            splatDataTexture: atlasTextures.splatData ? atlasTextures.splatData.texture : null,
            macroTexture: atlasTextures.macro ? atlasTextures.macro.texture : null
        };
        
        // Extract CPU-side data for gameplay (collision, etc.)
        // This reads a subregion from the atlas
        await this._extractChunkGameplayData(chunkData, atlasKey, chunkX, chunkY);
    }

    /**
     * Extract height and tile data for gameplay from atlas
     */
    async _extractChunkGameplayData(chunkData, atlasKey, chunkX, chunkY) {
        // For now, populate with placeholder data
        // Full implementation would read subregion from GPU texture
        
        const terrainGen = this.modules.tiledTerrain.instance;
        if (terrainGen && terrainGen.extractChunkDataFromAtlas) {
            const data = await terrainGen.extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, this.atlasConfig);
            if (data) {
                this._populateChunkDataFromExtract(chunkData, chunkX, chunkY, data.heightData, data.tileData);
                return;
            }
        }
        
        // Fallback: generate minimal data
        console.warn('[WebGPUWorldGenerator] Could not extract chunk data from atlas, using fallback');
        const size = this.chunkSize + 1;
        const tileSize = this.chunkSize;
        
        chunkData.heights = new Float32Array(size * size);
        chunkData.tiles = new Uint32Array(tileSize * tileSize);
        
        // Fill with placeholder
        for (let i = 0; i < chunkData.heights.length; i++) {
            chunkData.heights[i] = 0;
        }
        for (let i = 0; i < chunkData.tiles.length; i++) {
            chunkData.tiles[i] = 3; // Grass
        }
        
        chunkData.splatDensity = this.splatConfig.splatDensity;
        chunkData.offsetX = chunkX * this.chunkSize;
        chunkData.offsetZ = chunkY * this.chunkSize;
    }

    _populateChunkDataFromExtract(chunkData, chunkX, chunkY, heightData, tileData) {
        // Height Data
        chunkData.heights = new Float32Array(heightData.length / 4);
        for (let i = 0; i < chunkData.heights.length; i++) {
            chunkData.heights[i] = heightData[i * 4];
        }

        // Tile Data
        const tileSize = this.chunkSize;
        chunkData.tiles = new Uint32Array(tileSize * tileSize);
        for (let i = 0; i < chunkData.tiles.length; i++) {
            chunkData.tiles[i] = Math.round(tileData[i * 4] * 255);
        }

        chunkData.splatDensity = this.splatConfig.splatDensity;
        chunkData.offsetX = chunkX * this.chunkSize;
        chunkData.offsetZ = chunkY * this.chunkSize;
        
        // Generate feature distribution
        const terrainGen = this.modules.tiledTerrain.instance;
        if (terrainGen && terrainGen.generateFeatureDistributionForChunk) {
            chunkData.featureDistribution = terrainGen.generateFeatureDistributionForChunk(chunkX, chunkY, chunkData.tiles);
        }
    }

    /**
     * Legacy per-chunk texture setup (backward compatibility)
     */
    async _setupLegacyTextures(chunkData, chunkX, chunkY) {
        chunkData.useAtlasMode = false;
        
        // Use terrain generator directly
        if (this.modules.tiledTerrain.enabled && this.modules.tiledTerrain.instance) {
            await this.modules.tiledTerrain.instance.generateTerrain(chunkData, chunkX, chunkY);
        }
    }

    generateObjectData(chunkData, chunkX, chunkY) {
        const staticFeatures = chunkData.staticFeatures || [];
        const chunkSize = this.chunkSize;

        const chunkSeed = this.seed + chunkX * 73856093 + chunkY * 19349663;
        const rng = this.createSeededRandom(chunkSeed);

        const waterLevel = this.globalWaterLevel;

        const centerX = Math.floor(chunkSize / 2);
        const centerY = Math.floor(chunkSize / 2);
        const centerTile = chunkData.getTile(centerX, centerY);
        const isGrassland = centerTile === 3;
        const isTundra = centerTile === 6;
        const isRocky = centerTile === 5 || centerTile === 7;

        const treeCount = isGrassland ? (1 + Math.floor(rng() * 6)) :
                         isTundra ? (1 + Math.floor(rng() * 3)) :
                         isRocky ? (1 + Math.floor(rng() * 2)) :
                         (3 + Math.floor(rng() * 4));

        for (let i = 0; i < treeCount; i++) {
            const localX = 4 + rng() * (chunkSize - 8);
            const localZ = 4 + rng() * (chunkSize - 8);
            const height = chunkData.getHeight(localX, localZ);

            if (height < waterLevel) continue;

            const waterMargin = 2.0;
            if (height < waterLevel + waterMargin) continue;

            const slope = this.calculateSlope(chunkData, localX, localZ);
            if (slope > 0.5) continue;

            const tree = new TreeFeature({
                subtype: 'BIRCH',
                variant: Math.floor(rng() * 3),
                position: {
                    x: chunkX * chunkSize + localX,
                    y: height,
                    z: chunkY * chunkSize + localZ
                },
                rotation: rng() * Math.PI * 2,
                scale: 0.7 + rng() * 0.5,
                shapeSeed: Math.floor(rng() * 100000)
            });

            staticFeatures.push(tree);
        }

        chunkData.staticFeatures = staticFeatures;
    }

    dispose() {
        if (this.modules.tiledTerrain.instance) {
            this.modules.tiledTerrain.instance.dispose();
        }
        
        // CRITICAL: Do not destroy the device if it belongs to the renderer/backend!
        if (this.device && (!this.backend || this.device !== this.backend.device)) {
            this.device.destroy();
        }
        
        this.device = null;
        this.adapter = null;
    }
}