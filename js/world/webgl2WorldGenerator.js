// worldgen/webgl2WorldGenerator.js (fixed backend injection)

import { BaseWorldGenerator } from './baseWorldGenerator.js';
import { WebGL2TerrainGenerator } from "./webgl2TerrainGenerator.js";
import { ChunkData } from "./chunkData.js";
import { TreeFeature } from './features/treeFeature.js';

export class WebGL2WorldGenerator extends BaseWorldGenerator {

    constructor(backend, textureCache, chunkSize, seed) {
        super(backend, textureCache, chunkSize, seed);
        this.backend = backend;
        this.gl = null;
    }

    getAPIName() {
        return 'WebGL2';
    }

    async initializeAPI() {
        if (!this.backend) {
            throw new Error('Backend is required for WebGL2WorldGenerator');
        }
        
        this.gl = this.backend.getContext();

        if (!this.gl) {
            throw new Error('WebGL2 context not available from backend');
        }

        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            console.warn('EXT_color_buffer_float not available');
        }
    }

    async initializeModules() {
        if (this.modules.tiledTerrain.enabled) {
            this.modules.tiledTerrain.instance = new WebGL2TerrainGenerator(
                this.backend,
                this.seed,
                this.chunkSize,
                this.macroConfig,
                this.splatConfig,
                this.textureCache
            );
        }
    }

    async generateChunk(chunkX, chunkY) {
        await this._ready;
        const chunkData = new ChunkData(chunkX, chunkY, this.chunkSize);

        if (this.modules.tiledTerrain.enabled &&
            this.modules.tiledTerrain.instance) {
            await this.modules.tiledTerrain.instance.generateTerrain(
                chunkData,
                chunkX,
                chunkY
            );
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

        if (this.modules.staticObjects.enabled &&
            !chunkData.isFullySubmerged) {
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

            if (height < waterLevel) {
                continue;
            }

            const waterMargin = 2.0;
            if (height < waterLevel + waterMargin) {
                continue;
            }

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
    }
}