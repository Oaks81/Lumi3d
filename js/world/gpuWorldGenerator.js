
import { GPUTiledTerrainGenerator } from "./gpuTiledTerrainGenerator.js";
import { ChunkData } from "./chunkData.js";

// Add to ./js/world/gpuWorldGenerator.js
import { WaterFeature } from "./features/waterFeature.js";

import { WebGL2TerrainGenerator } from "./webgl2TerrainGenerator.js";
export class GPUWorldGenerator {
    constructor(renderer, chunkSize, seed = 12345) {
        this.splatConfig = {
            splatDensity: 4,
            splatKernelSize: 3,
        };
        this.renderer = renderer;
        this.seed = seed;
        this.chunkSize = chunkSize;
        this.tileSize = 32;
        this.modules = {
            tiledTerrain: { enabled: true, instance: null },
            walkableFeatures: { enabled: true, instance: null },
            staticObjects: { enabled: true, instance: null },
            structures: { enabled: false, instance: null }
        };
        this.macroConfig = {
            biomeScale: 0.0001,
            regionScale: 0.0005,
            featureScale: 0.002
        };
        this.globalWaterLevel = 8.0;
        this._ready = this._initialize();
    }
    /** lets callers wait for GPU setup */
    ready() { return this._ready; }

    async _initialize() {
        await this.initializeGPU();
        await this.initializeModules();
        console.log('GPU World Generator initialised');
    }

    
    async initializeGPU() {
        // Get the WebGL2RenderingContext from your Three.js renderer
        if (!this.renderer) throw new Error('No renderer provided to GPUWorldGenerator');
    
        // Three.js gives us access to its internal WebGL context
        const gl = this.renderer.getContext();
    
        if (!(gl instanceof WebGL2RenderingContext)) {
            throw new Error('WebGL2 not supported or renderer is not using a WebGL2 context.');
        }
    
        this.gl = gl;
        console.log('✅ WebGL2 context initialized for terrain generation');
    
        // Optionally, check required extensions
        if (!gl.getExtension('EXT_color_buffer_float')) {
            console.warn('EXT_color_buffer_float not supported. Floating-point render targets may fail.');
        }
    }
    
    
    createComputePipelines() {
        // Shared noise generation pipeline
        const noiseShader = `
            struct NoiseParams {
                seed: u32,
                scale: f32,
                octaves: u32,
                lacunarity: f32,
                persistence: f32,
            };
            
            @group(0) @binding(0) var<uniform> params: NoiseParams;
            @group(0) @binding(1) var<storage, read_write> output: array<f32>;
            
            // Perlin noise implementation
            fn hash(p: vec2<u32>) -> u32 {
                var h = p.x ^ (p.y << 16u);
                h = h ^ (h >> 13u);
                h = h * 1664525u + 1013904223u;
                return h;
            }
            
            fn fade(t: f32) -> f32 {
                return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
            }
            
            fn lerp(a: f32, b: f32, t: f32) -> f32 {
                return a + t * (b - a);
            }
            
            fn grad(hash: u32, x: f32, y: f32) -> f32 {
                let h = hash & 3u;
                let u = select(y, x, h < 2u);
                let v = select(x, y, h < 2u);
                return select(u, -u, (h & 1u) == 0u) + select(v, -v, (h & 2u) == 0u);
            }
            
            fn perlin2D(x: f32, y: f32) -> f32 {
                let ix = u32(floor(x)) & 255u;
                let iy = u32(floor(y)) & 255u;
                
                let fx = x - floor(x);
                let fy = y - floor(y);
                
                let u = fade(fx);
                let v = fade(fy);
                
                let a = hash(vec2(ix, iy)) + params.seed;
                let b = hash(vec2(ix + 1u, iy)) + params.seed;
                let c = hash(vec2(ix, iy + 1u)) + params.seed;
                let d = hash(vec2(ix + 1u, iy + 1u)) + params.seed;
                
                return lerp(
                    lerp(grad(a, fx, fy), grad(b, fx - 1.0, fy), u),
                    lerp(grad(c, fx, fy - 1.0), grad(d, fx - 1.0, fy - 1.0), u),
                    v
                );
            }
            
            fn octaveNoise(x: f32, y: f32) -> f32 {
                var value = 0.0;
                var amplitude = 1.0;
                var frequency = params.scale;
                var maxValue = 0.0;
                
                for (var i = 0u; i < params.octaves; i++) {
                    value += perlin2D(x * frequency, y * frequency) * amplitude;
                    maxValue += amplitude;
                    amplitude *= params.persistence;
                    frequency *= params.lacunarity;
                }
                
                return value / maxValue;
            }
            
            @compute @workgroup_size(8, 8)
            fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let index = global_id.y * 256u + global_id.x;
                if (index >= arrayLength(&output)) {
                    return;
                }
                
                let x = f32(global_id.x);
                let y = f32(global_id.y);
                
                output[index] = octaveNoise(x, y);
            }
        `;
        this.noiseComputePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: this.device.createShaderModule({ code: noiseShader }),
                entryPoint: 'main'
            }
        });
    }


    generateObjectData(chunkData, chunkX, chunkY) {
        // Use existing staticFeatures or create new array
        const staticFeatures = chunkData.staticFeatures || [];
        const chunkSize = this.chunkSize;
    
        const chunkSeed = this.seed + chunkX * 73856093 + chunkY * 19349663;
        const rng = this.createSeededRandom(chunkSeed);
    
        // Get water level for this chunk (disable per chunk elevation)
        const waterLevel = 8.0;
    
        // Determine biome type
        const centerX = Math.floor(chunkSize / 2);
        const centerY = Math.floor(chunkSize / 2);
        const centerTile = chunkData.getTile(centerX, centerY);
        const isGrassland = centerTile === 3;
        const isTundra = centerTile === 6;
        const isRocky = centerTile === 5 || centerTile === 7;
  
    
        chunkData.staticFeatures = staticFeatures;
    
   
       
    }

    calculateSlope(chunkData, x, z) {
        const h0 = chunkData.getHeight(x, z);
        const h1 = chunkData.getHeight(Math.min(x + 1, chunkData.size - 1), z);
        const h2 = chunkData.getHeight(x, Math.min(z + 1, chunkData.size - 1));
        const dx = Math.abs(h1 - h0);
        const dz = Math.abs(h2 - h0);
        return Math.max(dx, dz);
    }
    
    checkFlatness(chunkData, centerX, centerZ, radius) {
        const centerHeight = chunkData.getHeight(centerX, centerZ);
        let totalDiff = 0;
        let count = 0;
        
        // IMPROVED: Use average deviation instead of max deviation
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = Math.max(0, Math.min(chunkData.size - 1, centerX + dx));
                const z = Math.max(0, Math.min(chunkData.size - 1, centerZ + dz));
                const h = chunkData.getHeight(x, z);
                totalDiff += Math.abs(h - centerHeight);
                count++;
            }
        }
        
        const avgDiff = totalDiff / count;
        // Returns 1 for perfectly flat, decreases as terrain gets more uneven
        // Normalize so 1.0 unit of height difference = 0.5 flatness
        return Math.max(0, 1.0 - avgDiff);
    }
    
    createSeededRandom(seed) {
        let s = seed;
        return function() {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }

    async initializeModules() {
        if (this.modules.tiledTerrain.enabled) {
            if (!this.gl) {
                throw new Error('WebGL2 context not initialized before initializing modules');
            }
    
            console.log('🧱 Initializing WebGL2TerrainGenerator...');
    
            this.modules.tiledTerrain.instance = new WebGL2TerrainGenerator(
                this.gl,
                this.seed,
                this.chunkSize,
                this.macroConfig,
                this.splatConfig
            );
        }
    
        // Add other modules (e.g. water, objects, etc.) here if needed
    }
    
    // NEW: Large-scale noise (consistent across neighboring chunks)
getLargeScaleNoise(chunkX, chunkY) {
    // Use chunk coordinates directly (not tile coordinates)
    // Very low frequency = large features
    const x = chunkX * 0.1; // 0.1 = ~10 chunks per feature
    const y = chunkY * 0.1;
    
    // Simple hash-based noise (you can use proper noise if you have it)
    const seed = this.seed;
    let hash = Math.floor(x * 1000) ^ (Math.floor(y * 1000) << 16) ^ seed;
    hash = ((hash >> 13) ^ hash) * 15731;
    hash = (hash * hash * 15731 + 789221) & 0x7fffffff;
    
    return (hash / 0x7fffffff); // 0 to 1
}

    enableModule(moduleName, enabled = true) {
        if (this.modules[moduleName]) {
            this.modules[moduleName].enabled = enabled;
        }
    }
// In webgl2WorldGenerator.js
async generateChunk(chunkX, chunkY) {
    await this._ready;
    const chunkData = new ChunkData(chunkX, chunkY, this.chunkSize);

    if (this.modules.tiledTerrain.enabled && this.modules.tiledTerrain.instance) {
        // ✅ CRITICAL: This must complete BEFORE we return the chunk
        await this.modules.tiledTerrain.instance.generateTerrain(
            chunkData,
            chunkX,
            chunkY
        );
        

        const textureCache = this.textureCache;
        const hasTextures = 
            textureCache.get(chunkX, chunkY, 'height') &&
            textureCache.get(chunkX, chunkY, 'tile') &&
            textureCache.get(chunkX, chunkY, 'splatWeight') &&
            textureCache.get(chunkX, chunkY, 'splatType') &&
            textureCache.get(chunkX, chunkY, 'macro');
        
        if (!hasTextures) {
            throw new Error(`❌ CRITICAL: Textures not cached for chunk ${chunkX},${chunkY} after generation!`);
        }
        
        console.log(`✅ Chunk ${chunkX},${chunkY} fully generated with textures`);
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
    
    async generateInitialChunks(centerX, centerY, radius) {
        console.log("Generating initial chunks..");
        await this._ready; 
        const chunks = [];
        for (let x = -radius; x <= radius; x++) {
            for (let y = -radius; y <= radius; y++) {
                const chunkX = centerX + x;
                const chunkY = centerY + y;
                chunks.push(await this.generateChunk(chunkX, chunkY));
            }
        }
        return chunks;
    }
    
    async generateNoise(width, height, noiseParams) {
        const outputBuffer = this.device.createBuffer({
            size: width * height * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        
        const paramsBuffer = this.device.createBuffer({
            size: 20, // 5 * 4 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        // Write parameters
        const paramsData = new ArrayBuffer(20);
        const paramsView = new DataView(paramsData);
        paramsView.setUint32(0, noiseParams.seed, true);
        paramsView.setFloat32(4, noiseParams.scale, true);
        paramsView.setUint32(8, noiseParams.octaves, true);
        paramsView.setFloat32(12, noiseParams.lacunarity || 2.0, true);
        paramsView.setFloat32(16, noiseParams.persistence || 0.5, true);
        
        this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);
        
        const bindGroup = this.device.createBindGroup({
            layout: this.terrainComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: heightsBuffer } },
                { binding: 2, resource: { buffer: tilesBuffer } },
                { binding: 3, resource: { buffer: macroBuffer } }
            ]
        });
        
        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.noiseComputePipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        computePass.end();
        
        // Read back results
        const readBuffer = this.device.createBuffer({
            size: width * height * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, width * height * 4);
        this.device.queue.submit([commandEncoder.finish()]);
        
        await readBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(readBuffer.getMappedRange());
        const copy = new Float32Array(result);
        readBuffer.unmap();
        
        return copy;
    }
}


