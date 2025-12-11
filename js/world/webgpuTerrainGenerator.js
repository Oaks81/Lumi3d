// js/world/webgpuTerrainGenerator.js

import { createTerrainComputeShader } from './shaders/webgpu/terrainCompute.wgsl.js';
import { createSplatComputeShader } from './shaders/webgpu/splatCompute.wgsl.js';
import { BASE_FEATURE_DISTRIBUTION } from './shaders/featureDistribution.js';
import { StreamedAssetConfig } from '../mesh/streamed/streamedAssetConfig.js';
import { TILE_TYPES } from '../types.js';
import { Texture, TextureFormat, TextureFilter } from '../renderer/resources/texture.js';
import { LODTextureAtlasKey } from './lodTextureAtlasKey.js';

export class WebGPUTerrainGenerator {
    constructor(device, seed, chunkSize, macroConfig, splatConfig, textureCache) {
        this.device = device;
        this.seed = seed;
        this.chunkSize = chunkSize;
        this.macroConfig = macroConfig;
        this.splatDensity = splatConfig.splatDensity || 4;
        this.splatKernelSize = splatConfig.splatKernelSize || 5;
        this.textureCache = textureCache;
        this.atlasSplatDensity = 1; 
        this.arrayPools = new Map(); // key: `${type}_lod${lod}_${size}` -> {texture, capacity, nextLayer, freeLayers, size, wrapper}
        this.useTextureArrays = true; // enable array path with safeguards
        this.maxArrayBytesPerType = 256 * 1024 * 1024; // 256MB cap per LOD/type array
        
        this.worldScale = 1.0;
        this.elevationScale = 0.04;
        this.detailScale = 0.08;
        this.ridgeScale = 0.02;
        this.plateauScale = 0.005;
        this.valleyScale = 0.012;
        // Match the height scale used for tile selection/meshing so heights land in
        // the expected 0..40 range (determineTerrain thresholds around 22)
        this.heightScale = 40.0;
        // Optional LOD atlas config injected by world generator
        this.lodAtlasConfig = null;

        this.streamedTypes = new Map();
        this.initializeStreamedTypes();
        this.initialized = false;
    }

    generateFeatureDistributionForChunk(chunkX, chunkZ, tiles) {
        const featureMix = {};
        const totalTiles = tiles.length || 1;

        for (const asset of StreamedAssetConfig) {
            const typeName = asset.typeName.toLowerCase();
            const valid = asset.config.validTiles || [];
            let matches = 0;
            for (let i = 0; i < tiles.length; i++) {
                if (valid.includes(tiles[i])) matches++;
            }
            featureMix[typeName] = matches / totalTiles;
        }

        return { featureMix };
    }

    async initialize() {
        if (this.initialized) return;
        await this.initializePipelines();
        this.initialized = true;
    }

    initializeStreamedTypes() {
        for (const [tileType, features] of Object.entries(BASE_FEATURE_DISTRIBUTION)) {
            for (const [name, config] of Object.entries(features)) {
                this.streamedTypes.set(name, {
                    name,
                    prob: config.prob,
                    maxDensity: config.maxDensity,
                    validTiles: [TILE_TYPES[tileType]]
                });
            }
        }
    }

    async initializePipelines() {
        const terrainShaderCode = createTerrainComputeShader();
        this.terrainShaderModule = this.device.createShaderModule({
            label: 'Terrain Compute', code: terrainShaderCode
        });

        const splatShaderCode = createSplatComputeShader();
        this.splatShaderModule = this.device.createShaderModule({
            label: 'Splat Compute', code: splatShaderCode
        });

        this.terrainUniformBuffer = this.device.createBuffer({
            size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.splatUniformBuffer = this.device.createBuffer({
            size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.terrainBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { 
                    binding: 1, 
                    visibility: GPUShaderStage.COMPUTE, 
                    storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' }
                }
            ]
        });
        this.terrainPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.terrainBindGroupLayout] }),
            compute: { module: this.terrainShaderModule, entryPoint: 'main' }
        });

        this.splatBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
                { 
                    binding: 3, 
                    visibility: GPUShaderStage.COMPUTE, 
                    storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' }
                }
            ]
        });
        this.splatPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.splatBindGroupLayout] }),
            compute: { module: this.splatShaderModule, entryPoint: 'main' }
        });
    }

    createGPUTexture(width, height, format = 'rgba32float') {
        return this.device.createTexture({
            size: [width, height],
            format: format,
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
        });
    }

    estimateAtlasMemory(config) {
        const textureSize = config.textureSize;
        // Force height/normal atlas to exact atlas size for clean UVs
        const heightNormalSize = textureSize;
        const tileSize = textureSize;
        const splatSize = textureSize * this.atlasSplatDensity;
        const bytesPerPixel = 16; 
        const total = (heightNormalSize**2 + heightNormalSize**2 + tileSize**2 + splatSize**2 + splatSize**2) * bytesPerPixel;
        
        return { total, totalMB: (total / 1024 / 1024).toFixed(2) };
    }

    async generateAtlasTextures(atlasKey, config) {
        if (!this.initialized) await this.initialize();
        
        const textureSize = config.textureSize;
        const heightNormalSize = textureSize;
        const tileSize = textureSize;
        const splatSize = textureSize * this.atlasSplatDensity;

        // 1. DEFINE FACE (This was causing the ReferenceError)
        const face = atlasKey.face !== null ? atlasKey.face : -1;

        const atlasChunkX = atlasKey.atlasX * config.chunksPerAxis;
        const atlasChunkY = atlasKey.atlasY * config.chunksPerAxis;
        
        //let textureFormat = 'rgba16float';
        let textureFormat = 'rgba32float';

        // Use default (rgba16float) for these
        const gpuHeight = this.createGPUTexture(heightNormalSize, heightNormalSize, textureFormat);
        
        const gpuNormal = this.createGPUTexture(heightNormalSize, heightNormalSize, textureFormat);
        const gpuTile = this.createGPUTexture(tileSize, tileSize, textureFormat);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize, textureFormat);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize, textureFormat);


        await this.runTerrainPassAtlas(gpuHeight, atlasChunkX, atlasChunkY, face, 0, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuNormal, atlasChunkX, atlasChunkY, face, 1, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuTile, atlasChunkX, atlasChunkY, face, 2, tileSize, tileSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuMacro, atlasChunkX, atlasChunkY, face, 3, splatSize, splatSize, config.chunkSize);
        
        // Splat pass doesn't need face (relies on texture data), but we match the pattern
        await this.runSplatPassAtlas(gpuHeight, gpuTile, gpuSplatData, atlasChunkX, atlasChunkY, splatSize, splatSize, config.chunkSize);
        
        const textures = {
            height: this.wrapGPUTexture(gpuHeight, heightNormalSize, heightNormalSize, textureFormat),
            normal: this.wrapGPUTexture(gpuNormal, heightNormalSize, heightNormalSize, textureFormat),
            tile: this.wrapGPUTexture(gpuTile, tileSize, tileSize, textureFormat),
            macro: this.wrapGPUTexture(gpuMacro, splatSize, splatSize, textureFormat),
            splatData: this.wrapGPUTexture(gpuSplatData, splatSize, splatSize, textureFormat)
        };
        const bytesPerPixel = 8;
        this.textureCache.set(atlasKey, null, 'height', textures.height, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'normal', textures.normal, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'tile', textures.tile, tileSize * tileSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'macro', textures.macro, splatSize * splatSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'splatData', textures.splatData, splatSize * splatSize * bytesPerPixel);
        
        // Also register these as LOD0 atlases so hierarchical path is used immediately
        if (this.lodAtlasConfig && this.textureCache.setLODAtlas) {
            const baseChunkX = atlasKey.atlasX * config.chunksPerAxis;
            const baseChunkY = atlasKey.atlasY * config.chunksPerAxis;
            const lodKey = LODTextureAtlasKey.fromChunkCoords(
                baseChunkX,
                baseChunkY,
                0,
                atlasKey.face ?? null,
                this.lodAtlasConfig
            );
        const lodSizes = {
            height: heightNormalSize * heightNormalSize * bytesPerPixel,
            normal: heightNormalSize * heightNormalSize * bytesPerPixel,
            tile: tileSize * tileSize * bytesPerPixel,
            macro: splatSize * splatSize * bytesPerPixel,
            splatData: splatSize * splatSize * bytesPerPixel
        };
        this.textureCache.setLODAtlas(lodKey, 'height', textures.height, lodSizes.height);
        this.textureCache.setLODAtlas(lodKey, 'normal', textures.normal, lodSizes.normal);
        this.textureCache.setLODAtlas(lodKey, 'tile', textures.tile, lodSizes.tile);
        this.textureCache.setLODAtlas(lodKey, 'macro', textures.macro, lodSizes.macro);
        this.textureCache.setLODAtlas(lodKey, 'splatData', textures.splatData, lodSizes.splatData);
        }
        
        return {
            atlasKey: atlasKey,
            textures: textures,
            memoryUsed: 0
        };
    }

    /**
     * Generate atlas textures at a specific LOD level
     */
    async generateLODAtlasTextures(atlasKey, config) {
        if (!this.initialized) await this.initialize();
        
        const lodConfig = config.getConfigForLOD(atlasKey.lod);
        const textureSize = lodConfig.textureSize;
        const arrayCapacity = 128; // layers per LOD/type array
        
        console.log(`[WebGPUTerrainGenerator] Generating LOD ${atlasKey.lod} atlas:`, {
            key: atlasKey.toString(),
            textureSize: `${textureSize}×${textureSize}`,
            worldCoverage: `${config.worldCoverage}m`,
            pixelsPerMeter: lodConfig.pixelsPerMeter
        });
        
        const worldOriginX = atlasKey.atlasX * config.worldCoverage;
        const worldOriginY = atlasKey.atlasY * config.worldCoverage;
        
        const gpuHeight = this.createGPUTexture(textureSize, textureSize, 'rgba32float');
        const gpuNormal = this.createGPUTexture(textureSize, textureSize, 'rgba32float');
        const gpuTile = this.createGPUTexture(textureSize, textureSize, 'rgba32float');
        const gpuMacro = this.createGPUTexture(textureSize, textureSize, 'rgba32float');
        const gpuSplatData = this.createGPUTexture(textureSize, textureSize, 'rgba32float');
        
        await this.runLODTerrainPass(gpuHeight, worldOriginX, worldOriginY, 
            config.worldCoverage, atlasKey.face, 0, textureSize, atlasKey.lod);
        await this.runLODTerrainPass(gpuNormal, worldOriginX, worldOriginY,
            config.worldCoverage, atlasKey.face, 1, textureSize, atlasKey.lod);
        await this.runLODTerrainPass(gpuTile, worldOriginX, worldOriginY,
            config.worldCoverage, atlasKey.face, 2, textureSize, atlasKey.lod);
        await this.runLODTerrainPass(gpuMacro, worldOriginX, worldOriginY,
            config.worldCoverage, atlasKey.face, 3, textureSize, atlasKey.lod);
        
        await this.runLODSplatPass(gpuHeight, gpuTile, gpuSplatData,
            worldOriginX, worldOriginY, config.worldCoverage, textureSize, atlasKey.lod);
        
        const textures = {
            height: this.wrapGPUTexture(gpuHeight, textureSize, textureSize, 'rgba32float'),
            normal: this.wrapGPUTexture(gpuNormal, textureSize, textureSize, 'rgba32float'),
            tile: this.wrapGPUTexture(gpuTile, textureSize, textureSize, 'rgba32float'),
            macro: this.wrapGPUTexture(gpuMacro, textureSize, textureSize, 'rgba32float'),
            splatData: this.wrapGPUTexture(gpuSplatData, textureSize, textureSize, 'rgba32float')
        };

        // Upload into texture arrays (per LOD/type) for future array sampling
        const arrayInfoByType = {};
        const uploadToArray = (type, sourceTex) => {
            if (!this.useTextureArrays) return;
            const bytesPerLayer = textureSize * textureSize * 16; // rgba32float
            const maxLayersByBudget = Math.max(1, Math.floor(this.maxArrayBytesPerType / bytesPerLayer));
            const capacity = Math.max(1, Math.min(arrayCapacity, maxLayersByBudget));
            const poolKey = `${type}_lod${atlasKey.lod}_${textureSize}`;
            let pool = this.arrayPools.get(poolKey);
            if (!pool) {
                const arrayTex = this.device.createTexture({
                    size: [textureSize, textureSize, capacity],
                    format: 'rgba32float',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
                });
                pool = { texture: arrayTex, capacity, nextLayer: 0, freeLayers: [], size: textureSize };
                this.arrayPools.set(poolKey, pool);
            }
            let layer = -1;
            if (pool.freeLayers.length > 0) {
                layer = pool.freeLayers.pop();
            } else if (pool.nextLayer < pool.capacity) {
                layer = pool.nextLayer++;
            } else {
                console.warn(`[WebGPUTerrainGenerator] Array pool full for ${poolKey} (cap ${pool.capacity}), skipping array upload`);
                return;
            }
            // Copy via encoder for broader compatibility
            const encoder = this.device.createCommandEncoder();
            encoder.copyTextureToTexture(
                { texture: sourceTex._gpuTexture.texture },
                { texture: pool.texture, origin: { x: 0, y: 0, z: layer } },
                [textureSize, textureSize, 1]
            );
            this.device.queue.submit([encoder.finish()]);
            if (!pool.wrapper) {
                const wrap = new Texture({
                    width: textureSize,
                    height: textureSize,
                    depth: pool.capacity,
                    format: TextureFormat.RGBA32F,
                    minFilter: TextureFilter.LINEAR,
                    magFilter: TextureFilter.LINEAR,
                    generateMipmaps: false
                });
                wrap._gpuTexture = { texture: pool.texture };
                wrap._isArray = true;
                pool.wrapper = wrap;
            }
            arrayInfoByType[type] = { layer, arrayTexture: pool.wrapper };
        };

        uploadToArray('height', textures.height);
        uploadToArray('normal', textures.normal);
        uploadToArray('tile', textures.tile);
        uploadToArray('macro', textures.macro);
        uploadToArray('splatData', textures.splatData);
        
        const bytesPerPixel = 16;
        const textureTypes = ['height', 'normal', 'tile', 'macro', 'splatData'];
        for (const type of textureTypes) {
            const size = textureSize * textureSize * bytesPerPixel;
            this.textureCache.setLODAtlas(atlasKey, type, textures[type], size, arrayInfoByType[type] || null);
        }
        
        return {
            atlasKey: atlasKey,
            textures: textures,
            lod: atlasKey.lod,
            textureSize: textureSize
        };
    }
    

    async runTerrainPassAtlas(outTex, atlasChunkX, atlasChunkY, face, type, w, h, chunkSize) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        
        v.setInt32(0, atlasChunkX, true);
        v.setInt32(4, atlasChunkY, true);
        v.setInt32(8, chunkSize, true);
        v.setInt32(12, this.seed, true);
        v.setFloat32(16, this.elevationScale, true);
        v.setFloat32(20, this.heightScale, true);
        v.setFloat32(24, this.macroConfig.biomeScale || 0.004, true);
        v.setFloat32(28, this.macroConfig.regionScale || 0.00007, true);
        v.setFloat32(32, this.detailScale, true);
        v.setFloat32(36, this.ridgeScale, true);
        v.setFloat32(40, this.valleyScale, true);
        v.setFloat32(44, this.plateauScale, true);
        v.setFloat32(48, this.worldScale, true);
        v.setInt32(52, type, true);
        // Write Face ID to byte 56
        v.setInt32(56, face, true); 

        this.device.queue.writeBuffer(this.terrainUniformBuffer, 0, data);
        
        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.terrainPipeline);
        pass.setBindGroup(0, this.device.createBindGroup({
            layout: this.terrainBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.terrainUniformBuffer } },
                { binding: 1, resource: outTex.createView() }
            ]
        }));
        
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }

    async runLODTerrainPass(outTex, worldOriginX, worldOriginY, worldCoverage, face, type, textureSize, lod) {
        const data = new ArrayBuffer(80);
        const v = new DataView(data);
        
        // World-space parameters (constant for all LODs)
        v.setFloat32(0, worldOriginX, true);
        v.setFloat32(4, worldOriginY, true);
        v.setFloat32(8, worldCoverage, true);
        v.setInt32(12, this.seed, true);
        
        // Noise parameters
        v.setFloat32(16, this.elevationScale, true);
        v.setFloat32(20, this.heightScale, true);
        v.setFloat32(24, this.macroConfig.biomeScale || 0.004, true);
        v.setFloat32(28, this.macroConfig.regionScale || 0.00007, true);
        v.setFloat32(32, this.detailScale, true);
        v.setFloat32(36, this.ridgeScale, true);
        v.setFloat32(40, this.valleyScale, true);
        v.setFloat32(44, this.plateauScale, true);
        v.setFloat32(48, this.worldScale, true);
        
        // Output type and LOD
        v.setInt32(52, type, true);
        v.setInt32(56, face !== null ? face : -1, true);
        v.setInt32(60, lod, true);
        v.setInt32(64, textureSize, true);
        
        this.device.queue.writeBuffer(this.terrainUniformBuffer, 0, data);
        
        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.terrainPipeline);
        pass.setBindGroup(0, this.device.createBindGroup({
            layout: this.terrainBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.terrainUniformBuffer } },
                { binding: 1, resource: outTex.createView() }
            ]
        }));
        
        pass.dispatchWorkgroups(Math.ceil(textureSize / 8), Math.ceil(textureSize / 8));
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }
    
    async runSplatPassAtlas(hTex, tTex, splatDataTex, atlasChunkX, atlasChunkY, w, h, chunkSize) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        v.setInt32(0, atlasChunkX, true);
        v.setInt32(4, atlasChunkY, true);
        v.setInt32(8, chunkSize, true);
        v.setInt32(12, this.seed, true);
        v.setInt32(16, this.atlasSplatDensity, true);
        v.setInt32(20, this.splatKernelSize, true);

        this.device.queue.writeBuffer(this.splatUniformBuffer, 0, data);

        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.splatPipeline);
        pass.setBindGroup(0, this.device.createBindGroup({
            layout: this.splatBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.splatUniformBuffer } },
                { binding: 1, resource: hTex.createView() },
                { binding: 2, resource: tTex.createView() },
                { binding: 3, resource: splatDataTex.createView() }
            ]
        }));
        
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }

    /**
     * Run splat generation for LOD atlases.
     * chunkSize is expressed in texels-per-chunk for the current atlas resolution.
     */
    async runLODSplatPass(hTex, tTex, splatDataTex, worldOriginX, worldOriginY, worldCoverage, textureSize, lod) {
        const chunksPerAtlas = Math.max(1, Math.floor(worldCoverage / this.chunkSize));
        const chunkSizeTex = Math.max(1, Math.floor(textureSize / chunksPerAtlas));
        const chunkCoordX = Math.floor(worldOriginX / this.chunkSize);
        const chunkCoordY = Math.floor(worldOriginY / this.chunkSize);

        const data = new ArrayBuffer(80);
        const v = new DataView(data);
        v.setInt32(0, chunkCoordX, true);
        v.setInt32(4, chunkCoordY, true);
        v.setInt32(8, chunkSizeTex, true);
        v.setInt32(12, this.seed, true);
        v.setInt32(16, this.atlasSplatDensity, true);
        v.setInt32(20, this.splatKernelSize, true);

        this.device.queue.writeBuffer(this.splatUniformBuffer, 0, data);

        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.splatPipeline);
        pass.setBindGroup(0, this.device.createBindGroup({
            layout: this.splatBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.splatUniformBuffer } },
                { binding: 1, resource: hTex.createView() },
                { binding: 2, resource: tTex.createView() },
                { binding: 3, resource: splatDataTex.createView() }
            ]
        }));

        pass.dispatchWorkgroups(Math.ceil(textureSize / 8), Math.ceil(textureSize / 8));
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }


    async extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config, face = null) {
        const lod = atlasKey?.lod ?? 0;
        const heightAtlasData =
            this.textureCache.getLODAtlasForChunk?.(chunkX, chunkY, 'height', lod, face, config) ||
            this.textureCache.getAtlasForChunk?.(chunkX, chunkY, 'height', config, face);
        const tileAtlasData =
            this.textureCache.getLODAtlasForChunk?.(chunkX, chunkY, 'tile', lod, face, config) ||
            this.textureCache.getAtlasForChunk?.(chunkX, chunkY, 'tile', config, face);
        
        if (!heightAtlasData || !tileAtlasData) return null;

        const localPos = config.getLocalChunkPosition(chunkX, chunkY);
        const gpuHeightTex = heightAtlasData.texture._gpuTexture?.texture;
        const gpuTileTex = tileAtlasData.texture._gpuTexture?.texture;
        if (!gpuHeightTex || !gpuTileTex) return null;

        // Determine per-chunk texel dimensions for this LOD
        const lodCfg = config.getConfigForLOD ? config.getConfigForLOD(lod) : null;
        const atlasTextureSize = lodCfg?.textureSize || config.textureSize;
        const chunksPerAtlas = lodCfg?.chunksPerAtlas || config.chunksPerAtlas || 1;
        const texelsPerChunk = Math.max(1, Math.floor(atlasTextureSize / chunksPerAtlas));

        const offsetX = localPos.localX * texelsPerChunk;
        const offsetY = localPos.localY * texelsPerChunk;

        try {
            const heightData = await this.readTextureSubregion(
                gpuHeightTex,
                offsetX,
                offsetY,
                Math.min(texelsPerChunk + 1, atlasTextureSize - offsetX),
                Math.min(texelsPerChunk + 1, atlasTextureSize - offsetY),
                atlasTextureSize
            );
            const tileData = await this.readTextureSubregion(
                gpuTileTex,
                offsetX,
                offsetY,
                Math.min(texelsPerChunk, atlasTextureSize - offsetX),
                Math.min(texelsPerChunk, atlasTextureSize - offsetY),
                atlasTextureSize
            );
            return { heightData, tileData };
        } catch(e) { console.error(e); return null; }
    }
    
    async readTextureSubregion(gpuTex, offsetX, offsetY, width, height, textureWidth) {
        const textureHeight = textureWidth; 
        // RGBA32F = 16 bytes per pixel
        const bytesPerRow = textureWidth * 16;
        const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
        const bufferSize = alignedBytesPerRow * textureHeight;
        
        const readBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
            { texture: gpuTex },
            { buffer: readBuffer, bytesPerRow: alignedBytesPerRow },
            [textureWidth, textureHeight]
        );
        this.device.queue.submit([encoder.finish()]);
        
        await readBuffer.mapAsync(GPUMapMode.READ);
        const fullData = new Float32Array(readBuffer.getMappedRange());
        const subregion = new Float32Array(width * height * 4);
        
        for (let y = 0; y < height; y++) {
            const srcRow = offsetY + y;
            const srcRowOffset = (srcRow * alignedBytesPerRow) / 4; 
            for (let x = 0; x < width; x++) {
                const srcIdx = srcRowOffset + (offsetX + x) * 4;
                const dstIdx = (y * width + x) * 4;
                subregion.set(fullData.subarray(srcIdx, srcIdx + 4), dstIdx);
            }
        }
        
        readBuffer.unmap();
        readBuffer.destroy();
        return subregion;
    }

    wrapGPUTexture(gpuTex, w, h, formatOverride = 'rgba32float') {
        const fmt = TextureFormat.RGBA32F;
        const t = new Texture({ 
            width: w, height: h, 
            format: fmt,
            minFilter: TextureFilter.LINEAR, 
            magFilter: TextureFilter.LINEAR 
        });
        t._gpuTexture = { texture: gpuTex, view: gpuTex.createView(), format: formatOverride };
        t._needsUpload = false;
        t._isGPUOnly = true;
        return t;
    }
}
