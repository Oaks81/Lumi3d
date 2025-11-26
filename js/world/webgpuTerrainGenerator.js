// js/world/webgpuTerrainGenerator.js
// Phase 2: Added atlas texture generation support

import { createTerrainComputeShader } from './shaders/webgpu/terrainCompute.wgsl.js';
import { createSplatComputeShader } from './shaders/webgpu/splatCompute.wgsl.js';
import { BASE_FEATURE_DISTRIBUTION } from './shaders/featureDistribution.js';
import { TILE_TYPES } from '../types.js';
import { Texture, TextureFormat, TextureFilter, TextureWrap } from '../renderer/resources/texture.js';
import { TextureAtlasKey } from './textureAtlasKey.js';

export class WebGPUTerrainGenerator {
    constructor(device, seed, chunkSize, macroConfig, splatConfig, textureCache) {
        this.device = device;
        this.seed = seed;
        this.chunkSize = chunkSize;
        this.macroConfig = macroConfig;
        this.splatDensity = splatConfig.splatDensity || 4;
        this.splatKernelSize = splatConfig.splatKernelSize || 5;
        this.textureCache = textureCache;

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

        // Uniform Buffers (64 bytes for alignment safety)
        this.terrainUniformBuffer = this.device.createBuffer({
            size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.splatUniformBuffer = this.device.createBuffer({
            size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Pipelines
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

    // ========================================================================
    // PHASE 2: Atlas-based texture generation
    // ========================================================================
    
    /**
     * Generate all textures for an entire atlas (covering chunksPerAxis x chunksPerAxis chunks).
     * This replaces multiple calls to generateAllTexturesForChunk with a single GPU dispatch.
     * 
     * @param {TextureAtlasKey} atlasKey - The atlas to generate
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {Promise<Object>} Generated textures and cache keys
     */
    async generateAtlasTextures(atlasKey, config) {
        if (!this.initialized) await this.initialize();
        
        const textureSize = config.textureSize;
        const heightNormalSize = textureSize + 1;  // +1 for vertex sampling
        const tileSize = textureSize;
        const splatSize = textureSize * this.splatDensity;
        
        console.log('[WebGPUTerrainGenerator] Generating atlas textures:');
        console.log('  Atlas key: ' + atlasKey.toString());
        console.log('  Height/Normal size: ' + heightNormalSize + 'x' + heightNormalSize);
        console.log('  Tile size: ' + tileSize + 'x' + tileSize);
        console.log('  Splat size: ' + splatSize + 'x' + splatSize);
        
        // Calculate world origin for this atlas
        // Atlas origin in chunk coordinates, then multiplied by chunkSize for world coords
        const atlasChunkX = atlasKey.atlasX * config.chunksPerAxis;
        const atlasChunkY = atlasKey.atlasY * config.chunksPerAxis;
        
        console.log('  Atlas chunk origin: (' + atlasChunkX + ', ' + atlasChunkY + ')');
        console.log('  World origin: (' + (atlasChunkX * config.chunkSize) + ', ' + (atlasChunkY * config.chunkSize) + ')');
        
        // Create GPU textures for the atlas
        const gpuHeight = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuNormal = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuTile = this.createGPUTexture(tileSize, tileSize);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize);
        
        // Run compute passes with atlas-sized dispatches
        // Note: We pass atlasChunkX/Y as the "chunk coord" so shader computes correct world positions
        await this.runTerrainPassAtlas(gpuHeight, atlasChunkX, atlasChunkY, 0, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuNormal, atlasChunkX, atlasChunkY, 1, heightNormalSize, heightNormalSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuTile, atlasChunkX, atlasChunkY, 2, tileSize, tileSize, config.chunkSize);
        await this.runTerrainPassAtlas(gpuMacro, atlasChunkX, atlasChunkY, 3, splatSize, splatSize, config.chunkSize);
        await this.runSplatPassAtlas(gpuHeight, gpuTile, gpuSplatData, atlasChunkX, atlasChunkY, splatSize, splatSize, config.chunkSize);
        
        // Wrap GPU textures
        const textures = {
            height: this.wrapGPUTexture(gpuHeight, heightNormalSize, heightNormalSize, null),
            normal: this.wrapGPUTexture(gpuNormal, heightNormalSize, heightNormalSize, null),
            tile: this.wrapGPUTexture(gpuTile, tileSize, tileSize, null),
            macro: this.wrapGPUTexture(gpuMacro, splatSize, splatSize, null),
            splatData: this.wrapGPUTexture(gpuSplatData, splatSize, splatSize, null)
        };
        
        // Store in cache using atlas keys
        const atlasKeyStr = atlasKey.toString();
        const bytesPerPixel = 16; // RGBA32F
        
        this.textureCache.set(atlasKey, null, 'height', textures.height, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'normal', textures.normal, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'tile', textures.tile, tileSize * tileSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'macro', textures.macro, splatSize * splatSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'splatData', textures.splatData, splatSize * splatSize * bytesPerPixel);
        
        console.log('[WebGPUTerrainGenerator] Atlas textures generated and cached');
        
        return {
            atlasKey: atlasKey,
            textures: textures
        };
    }
    
    /**
     * Run terrain compute pass for atlas-sized texture.
     * Similar to runTerrainPass but with configurable chunkSize parameter.
     */
    async runTerrainPassAtlas(outTex, atlasChunkX, atlasChunkY, type, w, h, chunkSize) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        
        // Pass atlas origin in chunk coordinates
        v.setInt32(0, atlasChunkX, true);
        v.setInt32(4, atlasChunkY, true);
        v.setInt32(8, chunkSize, true);  // Individual chunk size for world coord calculation
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
        
        // Dispatch workgroups for the full atlas size
        const workgroupsX = Math.ceil(w / 8);
        const workgroupsY = Math.ceil(h / 8);
        console.log('[WebGPUTerrainGenerator] Dispatching ' + workgroupsX + 'x' + workgroupsY + ' workgroups for ' + w + 'x' + h + ' texture (type=' + type + ')');
        
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }
    
    /**
     * Run splat compute pass for atlas-sized texture.
     */
    async runSplatPassAtlas(hTex, tTex, splatDataTex, atlasChunkX, atlasChunkY, w, h, chunkSize) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        v.setInt32(0, atlasChunkX, true);
        v.setInt32(4, atlasChunkY, true);
        v.setInt32(8, chunkSize, true);
        v.setInt32(12, this.seed, true);
        v.setInt32(16, this.splatDensity, true);
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
        
        const workgroupsX = Math.ceil(w / 8);
        const workgroupsY = Math.ceil(h / 8);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
        pass.end();
        this.device.queue.submit([enc.finish()]);
    }
    
    /**
     * Extract chunk data from atlas textures for gameplay (collision, etc.)
     * This reads back a subregion of the atlas for a specific chunk.
     * 
     * @param {TextureAtlasKey} atlasKey - The atlas containing the chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkY - Chunk Y coordinate
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {Promise<{heightData: Float32Array, tileData: Float32Array}>}
     */
    async extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config) {
        // Get the atlas textures from cache
        const heightTexture = this.textureCache.get(atlasKey, null, 'height');
        const tileTexture = this.textureCache.get(atlasKey, null, 'tile');
        
        if (!heightTexture || !tileTexture) {
            console.error('[WebGPUTerrainGenerator] Atlas textures not found for extraction');
            return null;
        }
        
        // Calculate local position within atlas
        const localPos = config.getLocalChunkPosition(chunkX, chunkY);
        const localX = localPos.localX;
        const localY = localPos.localY;
        
        // Calculate pixel offsets
        const heightOffsetX = localX * config.chunkSize;
        const heightOffsetY = localY * config.chunkSize;
        const heightSize = config.chunkSize + 1;
        
        const tileOffsetX = localX * config.chunkSize;
        const tileOffsetY = localY * config.chunkSize;
        const tileSize = config.chunkSize;
        
        console.log('[WebGPUTerrainGenerator] Extracting chunk (' + chunkX + ',' + chunkY + ') from atlas at local (' + localX + ',' + localY + ')');
        
        // Read subregions
        // Note: This requires copying the texture region to a buffer
        const heightData = await this.readTextureSubregion(
            heightTexture._gpuTexture.texture,
            heightOffsetX, heightOffsetY,
            heightSize, heightSize,
            config.textureSize + 1
        );
        
        const tileData = await this.readTextureSubregion(
            tileTexture._gpuTexture.texture,
            tileOffsetX, tileOffsetY,
            tileSize, tileSize,
            config.textureSize
        );
        
        return { heightData, tileData };
    }
    
    /**
     * Read a subregion of a texture (for extracting chunk data from atlas)
     */
    async readTextureSubregion(tex, offsetX, offsetY, width, height, textureWidth) {
        // For now, read the entire texture and extract the subregion
        // A more efficient approach would use copyTextureToBuffer with origin offset
        const fullData = await this.readTextureData(tex, textureWidth, textureWidth);
        
        // Extract subregion
        const subregion = new Float32Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = ((offsetY + y) * textureWidth + (offsetX + x)) * 4;
                const dstIdx = (y * width + x) * 4;
                subregion[dstIdx + 0] = fullData[srcIdx + 0];
                subregion[dstIdx + 1] = fullData[srcIdx + 1];
                subregion[dstIdx + 2] = fullData[srcIdx + 2];
                subregion[dstIdx + 3] = fullData[srcIdx + 3];
            }
        }
        
        return subregion;
    }

    // ========================================================================
    // Legacy per-chunk generation (kept for backward compatibility)
    // ========================================================================

    async generateTerrain(chunkData, chunkX, chunkY) {
        if (!this.initialized) await this.initialize();

        let heightTexture = this.textureCache.get(chunkX, chunkY, 'height');
        let normalTexture = this.textureCache.get(chunkX, chunkY, 'normal');
        let tileTexture = this.textureCache.get(chunkX, chunkY, 'tile');
        let splatDataTexture = this.textureCache.get(chunkX, chunkY, 'splatData');
        let macroTexture = this.textureCache.get(chunkX, chunkY, 'macro');

        const hasAll = heightTexture && normalTexture && tileTexture && splatDataTexture && macroTexture;
        let heightData, tileData;

        if (!hasAll) {
            const result = await this.generateAllTexturesForChunk(chunkX, chunkY);
            
            // Cache Results
            const size = this.chunkSize + 1;
            const tileSize = this.chunkSize;
            const splatSize = this.chunkSize * this.splatDensity;

            this.textureCache.set(chunkX, chunkY, 'height', result.textures.height, size * size * 16);
            this.textureCache.set(chunkX, chunkY, 'normal', result.textures.normal, size * size * 16);
            this.textureCache.set(chunkX, chunkY, 'tile', result.textures.tile, tileSize * tileSize * 16);
            this.textureCache.set(chunkX, chunkY, 'splatData', result.textures.splatData, splatSize * splatSize * 16);
            this.textureCache.set(chunkX, chunkY, 'macro', result.textures.macro, splatSize * splatSize * 16);

            heightTexture = result.textures.height;
            normalTexture = result.textures.normal;
            tileTexture = result.textures.tile;
            splatDataTexture = result.textures.splatData;
            macroTexture = result.textures.macro;
            heightData = result.heightData;
            tileData = result.tileData;
        } else {
            heightData = heightTexture.data;
            tileData = tileTexture.data;
        }

        this.populateChunkData(chunkData, chunkX, chunkY, heightData, tileData);
        
        chunkData.textureRefs = {
            chunkX, chunkY,
            heightTexture, normalTexture, tileTexture,
            splatDataTexture, 
            macroTexture,
            isWebGPU: true
        };
    }

    async generateAllTexturesForChunk(chunkX, chunkY) {
        const size = this.chunkSize + 1;
        const tileSize = this.chunkSize;
        const splatSize = this.chunkSize * this.splatDensity;
    
        // Create GPU textures
        const gpuHeight = this.createGPUTexture(size, size);
        const gpuNormal = this.createGPUTexture(size, size);
        const gpuTile = this.createGPUTexture(tileSize, tileSize);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize);
    
        // Run compute passes
        await this.runTerrainPass(gpuHeight, chunkX, chunkY, 0, size, size);
        await this.runTerrainPass(gpuNormal, chunkX, chunkY, 1, size, size);
        await this.runTerrainPass(gpuTile, chunkX, chunkY, 2, tileSize, tileSize);
        await this.runTerrainPass(gpuMacro, chunkX, chunkY, 3, splatSize, splatSize);
        await this.runSplatPass(gpuHeight, gpuTile, gpuSplatData, chunkX, chunkY, splatSize, splatSize);
    
        const heightData = await this.readTextureData(gpuHeight, size, size);
        const tileData = await this.readTextureData(gpuTile, tileSize, tileSize);
    
        return {
            textures: {
                height: this.wrapGPUTexture(gpuHeight, size, size, heightData),
                normal: this.wrapGPUTexture(gpuNormal, size, size, null),
                tile: this.wrapGPUTexture(gpuTile, tileSize, tileSize, tileData),
                macro: this.wrapGPUTexture(gpuMacro, splatSize, splatSize, null),
                splatData: this.wrapGPUTexture(gpuSplatData, splatSize, splatSize, null)
            },
            heightData,
            tileData
        };
    }
    
    wrapGPUTexture(gpuTex, w, h, cpuData = null) {
        const t = new Texture({ 
            width: w, 
            height: h, 
            format: TextureFormat.RGBA32F, 
            minFilter: TextureFilter.NEAREST, 
            magFilter: TextureFilter.NEAREST, 
            generateMipmaps: false 
        });
        
        t._gpuTexture = { 
            texture: gpuTex, 
            view: gpuTex.createView(), 
            format: 'rgba32float' 
        };
        
        t._needsUpload = false;
        t._isGPUOnly = (cpuData === null);
        
        if (cpuData !== null) {
            t.data = cpuData;
        }
        
        return t;
    }

    async runTerrainPass(outTex, cx, cy, type, w, h) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        v.setInt32(0, cx, true);
        v.setInt32(4, cy, true);
        v.setInt32(8, this.chunkSize, true);
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

    async runSplatPass(hTex, tTex, splatDataTex, cx, cy, w, h) {
        const data = new ArrayBuffer(64);
        const v = new DataView(data);
        v.setInt32(0, cx, true);
        v.setInt32(4, cy, true);
        v.setInt32(8, this.chunkSize, true);
        v.setInt32(12, this.seed, true);
        v.setInt32(16, this.splatDensity, true);
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

    async readTextureData(tex, w, h) {
        const bytesPerRow = w * 16;
        const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
        const size = alignedBytesPerRow * h;

        const buf = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const enc = this.device.createCommandEncoder();
        enc.copyTextureToBuffer(
            { texture: tex },
            { buffer: buf, bytesPerRow: alignedBytesPerRow },
            [w, h]
        );
        this.device.queue.submit([enc.finish()]);

        await buf.mapAsync(GPUMapMode.READ);
        const src = new Float32Array(buf.getMappedRange());
        const dst = new Float32Array(w * h * 4);

        // Unpack padded rows
        for (let y = 0; y < h; y++) {
            const srcIdx = (y * alignedBytesPerRow) / 4;
            const dstIdx = y * w * 4;
            for (let x = 0; x < w * 4; x++) {
                dst[dstIdx + x] = src[srcIdx + x];
            }
        }
        
        buf.unmap();
        buf.destroy();
        return dst;
    }

    populateChunkData(chunkData, chunkX, chunkY, heightData, tileData) {
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

        chunkData.splatDensity = this.splatDensity;
        chunkData.offsetX = chunkX * this.chunkSize;
        chunkData.offsetZ = chunkY * this.chunkSize;
        
        chunkData.featureDistribution = this.generateFeatureDistributionForChunk(chunkX, chunkY, chunkData.tiles);
    }

    generateFeatureDistributionForChunk(chunkX, chunkZ, tiles) {
        const distribution = {};
        for (const [typeName, config] of this.streamedTypes.entries()) {
            const maxDensity = config.maxDensity || 32;
            const baseDensity = Math.floor(maxDensity * config.prob);
            distribution[typeName] = {
                density: baseDensity,
                validTiles: config.validTiles
            };
        }
        return distribution;
    }

    dispose() {
        if (this.terrainUniformBuffer) {
            this.terrainUniformBuffer.destroy();
            this.terrainUniformBuffer = null;
        }
        if (this.splatUniformBuffer) {
            this.splatUniformBuffer.destroy();
            this.splatUniformBuffer = null;
        }
        this.initialized = false;
    }
}