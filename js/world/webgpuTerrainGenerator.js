// js/world/webgpuTerrainGenerator.js

import { createTerrainComputeShader } from './shaders/webgpu/terrainCompute.wgsl.js';
import { createSplatComputeShader } from './shaders/webgpu/splatCompute.wgsl.js';
import { BASE_FEATURE_DISTRIBUTION } from './shaders/featureDistribution.js';
import { TILE_TYPES } from '../types.js';
import { Texture, TextureFormat, TextureFilter } from '../renderer/resources/texture.js';

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
        
        this.worldScale = 1.0;
        this.elevationScale = 0.04;
        this.detailScale = 0.08;
        this.ridgeScale = 0.02;
        this.plateauScale = 0.005;
        this.valleyScale = 0.012;
        this.heightScale = 40.0;

        this.streamedTypes = new Map();
        this.initializeStreamedTypes();
        this.initialized = false;
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
            size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.splatUniformBuffer = this.device.createBuffer({
            size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.terrainBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } }
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
                { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } }
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
        const heightNormalSize = textureSize + 1;
        const tileSize = textureSize;
        const splatSize = textureSize * this.atlasSplatDensity;
        const bytesPerPixel = 16; 
        const total = (heightNormalSize**2 + heightNormalSize**2 + tileSize**2 + splatSize**2 + splatSize**2) * bytesPerPixel;
        
        return { total, totalMB: (total / 1024 / 1024).toFixed(2) };
    }

    // ========================================================================
    // FIXED: generateAtlasTextures defines 'face' properly
    // ========================================================================
    async generateAtlasTextures(atlasKey, config) {
        if (!this.initialized) await this.initialize();
        
        const textureSize = config.textureSize;
        const heightNormalSize = textureSize + 1;
        const tileSize = textureSize;
        const splatSize = textureSize * this.atlasSplatDensity;

        // 1. DEFINE FACE (This was causing the ReferenceError)
        const face = atlasKey.face !== null ? atlasKey.face : -1;

        const atlasChunkX = atlasKey.atlasX * config.chunksPerAxis;
        const atlasChunkY = atlasKey.atlasY * config.chunksPerAxis;
        
        const gpuHeight = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuNormal = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuTile = this.createGPUTexture(tileSize, tileSize);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize);
        
        // 2. PASS FACE TO RUN FUNCTIONS
        await this.runTerrainPassAtlas(gpuHeight, atlasChunkX, atlasChunkY, face, 0, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuNormal, atlasChunkX, atlasChunkY, face, 1, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuTile, atlasChunkX, atlasChunkY, face, 2, tileSize, tileSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuMacro, atlasChunkX, atlasChunkY, face, 3, splatSize, splatSize, config.chunkSize);
        
        // Splat pass doesn't need face (relies on texture data), but we match the pattern
        await this.runSplatPassAtlas(gpuHeight, gpuTile, gpuSplatData, atlasChunkX, atlasChunkY, splatSize, splatSize, config.chunkSize);
        
        const textures = {
            height: this.wrapGPUTexture(gpuHeight, heightNormalSize, heightNormalSize, null),
            normal: this.wrapGPUTexture(gpuNormal, heightNormalSize, heightNormalSize, null),
            tile: this.wrapGPUTexture(gpuTile, tileSize, tileSize, null),
            macro: this.wrapGPUTexture(gpuMacro, splatSize, splatSize, null),
            splatData: this.wrapGPUTexture(gpuSplatData, splatSize, splatSize, null)
        };
        
        const bytesPerPixel = 16;
        this.textureCache.set(atlasKey, null, 'height', textures.height, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'normal', textures.normal, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'tile', textures.tile, tileSize * tileSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'macro', textures.macro, splatSize * splatSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'splatData', textures.splatData, splatSize * splatSize * bytesPerPixel);
        
        return {
            atlasKey: atlasKey,
            textures: textures,
            memoryUsed: 0
        };
    }
    
    // ========================================================================
    // FIXED: runTerrainPassAtlas now accepts 'face' in arguments
    // ========================================================================
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


    async extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config, face = null) {
        const heightAtlasData = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'height', config, face);
        const tileAtlasData = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'tile', config, face);
        
        if (!heightAtlasData || !tileAtlasData) return null;

        const localPos = config.getLocalChunkPosition(chunkX, chunkY);
        const chunkSize = config.chunkSize;
        const gpuHeightTex = heightAtlasData.texture._gpuTexture?.texture;
        const gpuTileTex = tileAtlasData.texture._gpuTexture?.texture;

        if (!gpuHeightTex || !gpuTileTex) return null;

        try {
             const heightData = await this.readTextureSubregion(
                gpuHeightTex, localPos.localX * chunkSize, localPos.localY * chunkSize, 
                chunkSize + 1, chunkSize + 1, config.textureSize + 1
            );
            const tileData = await this.readTextureSubregion(
                gpuTileTex, localPos.localX * chunkSize, localPos.localY * chunkSize, 
                chunkSize, chunkSize, config.textureSize
            );
            return { heightData, tileData };
        } catch(e) { console.error(e); return null; }
    }
    
    async readTextureSubregion(gpuTex, offsetX, offsetY, width, height, textureWidth) {
        const textureHeight = textureWidth; 
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

    wrapGPUTexture(gpuTex, w, h, cpuData = null) {
        const t = new Texture({ width: w, height: h, format: TextureFormat.RGBA32F, minFilter: TextureFilter.NEAREST, magFilter: TextureFilter.NEAREST, generateMipmaps: false });
        t._gpuTexture = { texture: gpuTex, view: gpuTex.createView(), format: 'rgba32float' };
        t._needsUpload = false;
        t._isGPUOnly = (cpuData === null);
        if (cpuData !== null) t.data = cpuData;
        return t;
    }
}