// js/world/webgpuTerrainGenerator.js
// Phase 2+: Atlas texture generation with MEMORY OPTIMIZATIONS
//
// Memory optimizations:
// 1. Splat density reduced to 1 for atlas mode (was 4 = 16x memory!)
// 2. Memory estimation before generation
//
// With splatDensity=1:
//   Per atlas (2048x2048): ~326 MB total
//   - Height: 67 MB, Normal: 67 MB, Tile: 64 MB, Macro: 64 MB, Splat: 64 MB
//
// With splatDensity=4 (old, BAD):
//   Per atlas: ~2.2 GB total (macro and splat were 8192x8192 = 1GB each!)

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

        // OPTIMIZATION: For atlas mode, use reduced splat density
        // Full splat detail can be computed per-chunk on demand if needed
        this.atlasSplatDensity = 1;  // Was 4, now 1 for atlas (saves 16x memory!)
        
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

    /**
     * Estimate memory for atlas generation
     */
    estimateAtlasMemory(config) {
        const textureSize = config.textureSize;
        const heightNormalSize = textureSize + 1;
        const tileSize = textureSize;
        // OPTIMIZED: Use reduced splat density for atlas
        const splatSize = textureSize * this.atlasSplatDensity;
        
        const bytesPerPixel = 16; // RGBA32F
        
        const heightMem = heightNormalSize * heightNormalSize * bytesPerPixel;
        const normalMem = heightNormalSize * heightNormalSize * bytesPerPixel;
        const tileMem = tileSize * tileSize * bytesPerPixel;
        const macroMem = splatSize * splatSize * bytesPerPixel;
        const splatMem = splatSize * splatSize * bytesPerPixel;
        
        const total = heightMem + normalMem + tileMem + macroMem + splatMem;
        
        return {
            height: heightMem,
            normal: normalMem,
            tile: tileMem,
            macro: macroMem,
            splatData: splatMem,
            total: total,
            totalMB: (total / 1024 / 1024).toFixed(2)
        };
    }

    // ========================================================================
    // PHASE 2: Atlas-based texture generation (OPTIMIZED)
    // ========================================================================
    
    /**
     * Generate all textures for an entire atlas.
     * OPTIMIZED: Uses reduced splat density (1 instead of 4) to save memory.
     * 
     * Memory per atlas (2048x2048, splatDensity=1):
     * - Height: 67 MB, Normal: 67 MB, Tile: 64 MB, Macro: 64 MB, Splat: 64 MB
     * - Total: ~326 MB (was 2.2 GB with density=4!)
     */
    async generateAtlasTextures(atlasKey, config) {
        if (!this.initialized) await this.initialize();
        
        const textureSize = config.textureSize;
        const heightNormalSize = textureSize + 1;
        const tileSize = textureSize;
        
        // OPTIMIZATION: Use reduced splat density for atlas mode
        const splatSize = textureSize * this.atlasSplatDensity;
        
        // Estimate and log memory usage
        const memEstimate = this.estimateAtlasMemory(config);
        console.log('[WebGPUTerrainGenerator] Generating atlas textures:');
        console.log('  Atlas key: ' + atlasKey.toString());
        console.log('  Height/Normal size: ' + heightNormalSize + 'x' + heightNormalSize);
        console.log('  Tile size: ' + tileSize + 'x' + tileSize);
        console.log('  Splat size: ' + splatSize + 'x' + splatSize + ' (density=' + this.atlasSplatDensity + ')');
        console.log('  Estimated memory: ' + memEstimate.totalMB + ' MB');
        
        // Calculate world origin for this atlas
        const atlasChunkX = atlasKey.atlasX * config.chunksPerAxis;
        const atlasChunkY = atlasKey.atlasY * config.chunksPerAxis;
        
        console.log('  Atlas chunk origin: (' + atlasChunkX + ', ' + atlasChunkY + ')');
        
        // Create GPU textures for the atlas
        const gpuHeight = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuNormal = this.createGPUTexture(heightNormalSize, heightNormalSize);
        const gpuTile = this.createGPUTexture(tileSize, tileSize);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize);
        
        // Run compute passes
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
        const bytesPerPixel = 16;
        
        this.textureCache.set(atlasKey, null, 'height', textures.height, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'normal', textures.normal, heightNormalSize * heightNormalSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'tile', textures.tile, tileSize * tileSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'macro', textures.macro, splatSize * splatSize * bytesPerPixel);
        this.textureCache.set(atlasKey, null, 'splatData', textures.splatData, splatSize * splatSize * bytesPerPixel);
        
        console.log('[WebGPUTerrainGenerator] Atlas textures generated and cached');
        
        return {
            atlasKey: atlasKey,
            textures: textures,
            memoryUsed: memEstimate.total
        };
    }
    
    /**
     * Run terrain compute pass for atlas-sized texture.
     */
    async runTerrainPassAtlas(outTex, atlasChunkX, atlasChunkY, type, w, h, chunkSize) {
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
        
        const workgroupsX = Math.ceil(w / 8);
        const workgroupsY = Math.ceil(h / 8);
        
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
        v.setInt32(16, this.atlasSplatDensity, true);  // Use atlas splat density
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
     * Extract chunk data from an atlas texture.
     * Reads a subregion of the atlas corresponding to a specific chunk.
     * Used for gameplay data (collision detection, height queries).
     * 
     * @param {TextureAtlasKey} atlasKey - The atlas containing the chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkY - Chunk Y coordinate
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {Object|null} - {heightData, tileData} or null if extraction fails
     */
    async extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config) {
        console.log('[WebGPUTerrainGenerator] extractChunkDataFromAtlas: chunk=(' + chunkX + ',' + chunkY + ')');
        
        // Get the atlas textures from cache
        const heightAtlasData = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'height', config);
        const tileAtlasData = this.textureCache.getAtlasForChunk(chunkX, chunkY, 'tile', config);
        
        if (!heightAtlasData || !tileAtlasData) {
            console.warn('[WebGPUTerrainGenerator] Atlas textures not found for chunk (' + chunkX + ',' + chunkY + ')');
            return null;
        }
        
        // Get local position within atlas
        const localPos = config.getLocalChunkPosition(chunkX, chunkY);
        const localX = localPos.localX;
        const localY = localPos.localY;
        
        console.log('[WebGPUTerrainGenerator]   Local position in atlas: (' + localX + ',' + localY + ')');
        
        // Calculate pixel offsets
        const heightSize = this.chunkSize + 1;
        const tileSize = this.chunkSize;
        
        const heightOffsetX = localX * this.chunkSize;
        const heightOffsetY = localY * this.chunkSize;
        const tileOffsetX = localX * this.chunkSize;
        const tileOffsetY = localY * this.chunkSize;
        
        console.log('[WebGPUTerrainGenerator]   Height offset: (' + heightOffsetX + ',' + heightOffsetY + '), size: ' + heightSize);
        console.log('[WebGPUTerrainGenerator]   Tile offset: (' + tileOffsetX + ',' + tileOffsetY + '), size: ' + tileSize);
        
        try {
            // Get the GPU textures
            const heightTex = heightAtlasData.texture;
            const tileTex = tileAtlasData.texture;
            
            if (!heightTex || !tileTex) {
                console.warn('[WebGPUTerrainGenerator] GPU textures not available');
                return null;
            }
            
            // Get the underlying GPU texture
            const gpuHeightTex = heightTex._gpuTexture ? heightTex._gpuTexture.texture : null;
            const gpuTileTex = tileTex._gpuTexture ? tileTex._gpuTexture.texture : null;
            
            if (!gpuHeightTex || !gpuTileTex) {
                console.warn('[WebGPUTerrainGenerator] No GPU texture handles available');
                return null;
            }
            
            // Read subregions from the atlas textures
            const heightData = await this.readTextureSubregion(
                gpuHeightTex, 
                heightOffsetX, heightOffsetY, 
                heightSize, heightSize,
                config.textureSize + 1  // Atlas height texture is textureSize+1
            );
            
            const tileData = await this.readTextureSubregion(
                gpuTileTex,
                tileOffsetX, tileOffsetY,
                tileSize, tileSize,
                config.textureSize  // Atlas tile texture is textureSize
            );
            
            console.log('[WebGPUTerrainGenerator]   Extracted height data: ' + heightData.length + ' floats');
            console.log('[WebGPUTerrainGenerator]   Extracted tile data: ' + tileData.length + ' floats');
            
            return { heightData, tileData };
            
        } catch (error) {
            console.error('[WebGPUTerrainGenerator] Failed to extract chunk data:', error);
            return null;
        }
    }
    
    /**
     * Read a subregion from a GPU texture.
     * Note: WebGPU doesn't support reading subregions directly, so we read the full texture
     * and extract the subregion on CPU. This could be optimized with a compute shader.
     */
    async readTextureSubregion(gpuTex, offsetX, offsetY, width, height, textureWidth) {
        // For now, read the full texture and extract subregion
        // This is inefficient but works. Optimization: use compute shader to copy subregion
        
        const textureHeight = textureWidth; // Assume square
        const bytesPerRow = textureWidth * 16; // RGBA32F = 16 bytes per pixel
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
        
        // Extract subregion
        const subregion = new Float32Array(width * height * 4);
        
        for (let y = 0; y < height; y++) {
            const srcRow = offsetY + y;
            const srcRowOffset = (srcRow * alignedBytesPerRow) / 4; // In floats
            
            for (let x = 0; x < width; x++) {
                const srcX = offsetX + x;
                const srcIdx = srcRowOffset + srcX * 4;
                const dstIdx = (y * width + x) * 4;
                
                subregion[dstIdx + 0] = fullData[srcIdx + 0];
                subregion[dstIdx + 1] = fullData[srcIdx + 1];
                subregion[dstIdx + 2] = fullData[srcIdx + 2];
                subregion[dstIdx + 3] = fullData[srcIdx + 3];
            }
        }
        
        readBuffer.unmap();
        readBuffer.destroy();
        
        return subregion;
    }

    // ========================================================================
    // Chunk data extraction from atlas (for gameplay - collision, etc.)
    // ========================================================================
    
    /**
     * Extract height and tile data for a specific chunk from an atlas texture.
     * This is needed for gameplay (collision detection, height queries, etc.)
     * 
     * @param {TextureAtlasKey} atlasKey - The atlas containing this chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkY - Chunk Y coordinate
     * @param {DataTextureConfig} config - Atlas configuration
     * @returns {Promise<{heightData: Float32Array, tileData: Float32Array}|null>}
     */
    async extractChunkDataFromAtlas(atlasKey, chunkX, chunkY, config) {
        console.log('[WebGPUTerrainGenerator] extractChunkDataFromAtlas: chunk=(' + chunkX + ',' + chunkY + ')');
        
        // Get the atlas textures from cache
        const heightTexture = this.textureCache.get(atlasKey, null, 'height');
        const tileTexture = this.textureCache.get(atlasKey, null, 'tile');
        
        if (!heightTexture || !tileTexture) {
            console.warn('[WebGPUTerrainGenerator] Atlas textures not found for ' + atlasKey.toString());
            return null;
        }
        
        // Calculate the local position of this chunk within the atlas
        const localPos = config.getLocalChunkPosition(chunkX, chunkY);
        const chunkSize = config.chunkSize;
        
        // Calculate pixel offsets within the atlas texture
        const heightOffsetX = localPos.localX * chunkSize;
        const heightOffsetY = localPos.localY * chunkSize;
        const heightWidth = chunkSize + 1;
        const heightHeight = chunkSize + 1;
        
        const tileOffsetX = localPos.localX * chunkSize;
        const tileOffsetY = localPos.localY * chunkSize;
        const tileWidth = chunkSize;
        const tileHeight = chunkSize;
        
        console.log('[WebGPUTerrainGenerator]   Local position: (' + localPos.localX + ',' + localPos.localY + ')');
        console.log('[WebGPUTerrainGenerator]   Height region: offset=(' + heightOffsetX + ',' + heightOffsetY + '), size=' + heightWidth + 'x' + heightHeight);
        
        // Get the GPU textures
        const gpuHeightTex = heightTexture._gpuTexture ? heightTexture._gpuTexture.texture : null;
        const gpuTileTex = tileTexture._gpuTexture ? tileTexture._gpuTexture.texture : null;
        
        if (!gpuHeightTex || !gpuTileTex) {
            console.warn('[WebGPUTerrainGenerator] GPU textures not available');
            return null;
        }
        
        // Read subregions from GPU textures
        const heightData = await this.readTextureSubregion(
            gpuHeightTex, 
            heightOffsetX, heightOffsetY, 
            heightWidth, heightHeight
        );
        
        const tileData = await this.readTextureSubregion(
            gpuTileTex,
            tileOffsetX, tileOffsetY,
            tileWidth, tileHeight
        );
        
        console.log('[WebGPUTerrainGenerator]   Extracted ' + (heightData.length / 4) + ' height pixels, ' + (tileData.length / 4) + ' tile pixels');
        
        return { heightData, tileData };
    }

    /**
     * Read a subregion from a GPU texture
     */
    async readTextureSubregion(tex, offsetX, offsetY, width, height) {
        const bytesPerPixel = 16;  // RGBA32F
        const bytesPerRow = width * bytesPerPixel;
        const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
        const bufferSize = alignedBytesPerRow * height;
        
        const stagingBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
            {
                texture: tex,
                origin: { x: offsetX, y: offsetY, z: 0 }
            },
            {
                buffer: stagingBuffer,
                bytesPerRow: alignedBytesPerRow,
                rowsPerImage: height
            },
            { width: width, height: height, depthOrArrayLayers: 1 }
        );
        
        this.device.queue.submit([encoder.finish()]);
        
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const srcData = new Float32Array(stagingBuffer.getMappedRange());
        const dstData = new Float32Array(width * height * 4);
        
        for (let y = 0; y < height; y++) {
            const srcRowStart = (y * alignedBytesPerRow) / 4;
            const dstRowStart = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                dstData[dstRowStart + x] = srcData[srcRowStart + x];
            }
        }
        
        stagingBuffer.unmap();
        stagingBuffer.destroy();
        
        return dstData;
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
    
        const gpuHeight = this.createGPUTexture(size, size);
        const gpuNormal = this.createGPUTexture(size, size);
        const gpuTile = this.createGPUTexture(tileSize, tileSize);
        const gpuMacro = this.createGPUTexture(splatSize, splatSize);
        const gpuSplatData = this.createGPUTexture(splatSize, splatSize);
    
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
        chunkData.heights = new Float32Array(heightData.length / 4);
        for (let i = 0; i < chunkData.heights.length; i++) {
            chunkData.heights[i] = heightData[i * 4];
        }

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