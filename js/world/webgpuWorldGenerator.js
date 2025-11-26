// js/world/webgpuWorldGenerator.js
// Fix: Added TextureAtlasKey import

import { BaseWorldGenerator } from './baseWorldGenerator.js';
import { WebGPUTerrainGenerator } from "./webgpuTerrainGenerator.js";
import { ChunkData } from "./chunkData.js";
import { TreeFeature } from './features/treeFeature.js';
import { TextureAtlasKey } from './textureAtlasKey.js';  // ADDED: Missing import

export class WebGPUWorldGenerator extends BaseWorldGenerator {
    constructor(renderer, textureCache, chunkSize, seed) {
        super(renderer, textureCache, chunkSize, seed);
    }

    getAPIName() {
        return 'WebGPU';
    }

    async initializeAPI() {
        // FIX: Use 'this.backend' (inherited from BaseWorldGenerator)
        // The GameEngine passes the backend instance to the constructor.
        if (this.backend && this.backend.device) {
            this.device = this.backend.device;
            this.adapter = this.backend.adapter;
            console.log('[OK] WebGPUWorldGenerator: Attached to existing Backend Device');
            return;
        }

        // --- FALLBACK: Only create a device if we are running standalone (no backend) ---
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
                this.device, // Now uses the SHARED device
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
        
        console.log('[WebGPUWorldGenerator] generateChunk(' + chunkX + ', ' + chunkY + ', face=' + face + ', lod=' + lod + ')');
        
        // Check if atlas exists for this chunk
        const needsAtlas = !this.hasAtlasForChunk(chunkX, chunkY, face);
        
        if (needsAtlas) {
            console.log('[WebGPUWorldGenerator] Atlas not found, generating...');
            await this.generateAtlasForChunk(chunkX, chunkY, face);
        } else {
            console.log('[WebGPUWorldGenerator] Atlas already exists');
        }
        
        // Create chunk data structure
        const chunkData = new ChunkData(chunkX, chunkY, this.chunkSize);
        if (this.planetConfig) {
            chunkData.isSpherical = true;
            chunkData.baseAltitude = this.planetConfig.radius;
        }
        
        // Store atlas info in chunk data
        // TextureAtlasKey is now properly imported
        const atlasKey = TextureAtlasKey.fromChunkCoords(chunkX, chunkY, face, this.atlasConfig);
        chunkData.atlasKey = atlasKey;
        chunkData.uvTransform = atlasKey.getChunkUVTransform(chunkX, chunkY);
        
        console.log('[WebGPUWorldGenerator] Chunk UV transform:', chunkData.uvTransform);
        
        // Generate terrain textures for this chunk (legacy per-chunk for now)
        // Phase 2 will change this to atlas-based generation
        if (this.modules.tiledTerrain.enabled && this.modules.tiledTerrain.instance) {
            await this.modules.tiledTerrain.instance.generateTerrain(chunkData, chunkX, chunkY);
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