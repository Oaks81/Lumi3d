import { BaseWorldGenerator } from './baseWorldGenerator.js';
import { WebGPUTerrainGenerator } from "./webgpuTerrainGenerator.js";
import { ChunkData } from "./chunkData.js";
import { TreeFeature } from './features/treeFeature.js';
import { TextureAtlasKey } from './textureAtlasKey.js';
import { LODAtlasConfig } from './lodAtlasConfig.js';
import { LODTextureAtlasKey } from './lodTextureAtlasKey.js';

export class WebGPUWorldGenerator extends BaseWorldGenerator {
    constructor(renderer, textureCache, chunkSize, seed) {
        super(renderer, textureCache, chunkSize, seed);
        
        this.useAtlasMode = true;
        this.generationHeightScale = 40.0;
        this.renderHeightScale = 2000.0;

        // Prepare LOD atlas config aligned with existing atlas coverage; generate LOD0 for now
        const worldCoverage = this.atlasConfig.chunkSize * this.atlasConfig.chunksPerAxis;
        this.lodAtlasConfig = new LODAtlasConfig({
            worldCoverage,
            baseTextureSize: this.atlasConfig.textureSize,
            baseChunkSize: chunkSize,
            maxLODLevels: 5
        });
        if (this.textureCache?.setLODAtlasConfig) {
            this.textureCache.setLODAtlasConfig(this.lodAtlasConfig);
        }
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
            this.modules.tiledTerrain.instance.heightScale = this.generationHeightScale;
            this.modules.tiledTerrain.instance.lodAtlasConfig = this.lodAtlasConfig;
            
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

        const chunkData = new ChunkData(chunkX, chunkY, this.chunkSize);
        const genScale = Math.max(this.generationHeightScale, 0.0001);
        chunkData.heightScale = this.renderHeightScale / genScale;
        chunkData.face = face;
        chunkData.lodLevel = lod;
        if (this.planetConfig) {
            chunkData.isSpherical = true;
            chunkData.baseAltitude = this.planetConfig.radius;
        }
        
        if (this.useAtlasMode) {
            await this._setupAtlasTextures(chunkData, chunkX, chunkY, face, lod);
        } else {
            await this._setupLegacyTextures(chunkData, chunkX, chunkY);
        }

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

        if (this.modules.staticObjects.enabled && !chunkData.isFullySubmerged) {
            this.generateObjectData(chunkData, chunkX, chunkY);
        }

        return chunkData;
    }

    /**
     * Setup atlas textures for a chunk (LOD-aware)
     */
    async _setupAtlasTextures(chunkData, chunkX, chunkY, face, lodLevel = 0) {
        const cfg = this.lodAtlasConfig || this.atlasConfig;
        const targetLOD = Math.max(0, Math.min(lodLevel || 0, cfg.maxLODLevels ? cfg.maxLODLevels - 1 : 8));
        const faceId = face ?? null;

        // Ensure required LOD atlases exist (generate missing levels up to targetLOD)
        if (this.modules.tiledTerrain.enabled && this.modules.tiledTerrain.instance?.generateLODAtlasTextures && this.textureCache?.hasLODAtlasForChunk) {
            for (let lod = 0; lod <= targetLOD; lod++) {
                const hasLOD = this.textureCache.hasLODAtlasForChunk(chunkX, chunkY, 'height', lod, faceId, cfg);
                if (!hasLOD) {
                    const atlasKey = LODTextureAtlasKey.fromChunkCoords(chunkX, chunkY, lod, faceId, cfg);
                    await this.modules.tiledTerrain.instance.generateLODAtlasTextures(atlasKey, cfg);
                }
            }
        } else {
            // Legacy single-resolution path as fallback
            const needsAtlas = !this.hasAtlasForChunk(chunkX, chunkY, face);
            if (needsAtlas) {
                console.log('[WebGPUWorldGenerator] Generating atlas for chunk (' + chunkX + ',' + chunkY + ')');
                await this.generateAtlasForChunk(chunkX, chunkY, face);
            }
        }

        // Fetch atlas textures for target LOD (LOD-aware first, fallback to legacy)
        let atlasKey = null;
        let uvTransform = null;
        let atlasTextures = {};

        if (this.textureCache.getLODAtlasForChunk && cfg) {
            const fetchLOD = (type) => this.textureCache.getLODAtlasForChunk(chunkX, chunkY, type, targetLOD, faceId, cfg);
            const h = fetchLOD('height');
            const n = fetchLOD('normal');
            const t = fetchLOD('tile');
            const s = fetchLOD('splatData');
            const m = fetchLOD('macro');

            if (h && t) {
                atlasKey = h.atlasKey;
                uvTransform = h.uvTransform;
                atlasTextures = {
                    height: h.texture,
                    normal: n?.texture || h.texture,
                    tile: t.texture,
                    splatData: s?.texture || h.texture,
                    macro: m?.texture || h.texture
                };
            }
        }

        if (!atlasKey) {
            // Fallback to legacy atlas
            atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
            uvTransform = this.atlasConfig.getChunkUVTransform(chunkX, chunkY);
            const legacy = this.getAtlasTexturesForChunk(chunkX, chunkY, face);
            atlasTextures = {
                height: legacy.height ? legacy.height.texture : null,
                normal: legacy.normal ? legacy.normal.texture : null,
                tile: legacy.tile ? legacy.tile.texture : null,
                splatData: legacy.splatData ? legacy.splatData.texture : null,
                macro: legacy.macro ? legacy.macro.texture : null
            };
        }

        chunkData.atlasKey = atlasKey;
        chunkData.uvTransform = uvTransform;
        chunkData.useAtlasMode = true;
        chunkData.lodLevel = targetLOD;
        
        chunkData.textureRefs = {
            chunkX: chunkX,
            chunkY: chunkY,
            atlasKey: atlasKey,
            uvTransform: uvTransform,
            useAtlasMode: true,
            isWebGPU: true,
            heightTexture: atlasTextures.height,
            normalTexture: atlasTextures.normal,
            tileTexture: atlasTextures.tile,
            splatDataTexture: atlasTextures.splatData,
            macroTexture: atlasTextures.macro
        };
        
        await this._extractChunkGameplayData(chunkData, atlasKey, chunkX, chunkY, cfg, faceId);
    }

    /**
     * Extract height and tile data for gameplay from atlas
     */
    async _extractChunkGameplayData(chunkData, atlasKey, chunkX, chunkY, config = this.atlasConfig, face = null) {
        // For now, populate with placeholder data
        // Full implementation would read subregion from GPU texture
        
        const terrainGen = this.modules.tiledTerrain.instance;
        if (terrainGen && terrainGen.extractChunkDataFromAtlas) {
            const data = await terrainGen.extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config, face);
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
        chunkData.heights = new Float32Array(heightData.length / 4);
        for (let i = 0; i < chunkData.heights.length; i++) {
            chunkData.heights[i] = heightData[i * 4];
        }

        const tileSize = this.chunkSize;
        chunkData.tiles = new Uint32Array(tileSize * tileSize);
        for (let i = 0; i < chunkData.tiles.length; i++) {
            chunkData.tiles[i] = Math.round(tileData[i * 4] * 255);
        }

        chunkData.splatDensity = this.splatConfig.splatDensity;
        chunkData.offsetX = chunkX * this.chunkSize;
        chunkData.offsetZ = chunkY * this.chunkSize;
        
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
        
        if (this.device && (!this.backend || this.device !== this.backend.device)) {
            this.device.destroy();
        }
        
        this.device = null;
        this.adapter = null;
    }
}
