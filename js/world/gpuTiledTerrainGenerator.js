        import { GrassFeature } from './features/grassFeature.js';
        import { ShrubFeature } from './features/shrubFeature.js';
        import { TILE_TYPES } from '../types.js';
        const BASE_FEATURE_DISTRIBUTION = {
            GRASS: { grass: { prob: 0.8, maxDensity: 64 }, rock: { prob: 0.05, maxDensity: 8 }, flower: { prob: 0.15, maxDensity: 16 } },
            FOREST_FLOOR: { grass: { prob: 0.6, maxDensity: 48 }, rock: { prob: 0.1, maxDensity: 12 }, flower: { prob: 0.3, maxDensity: 24 } },
            SAND: { grass: { prob: 0.1, maxDensity: 8 }, rock: { prob: 0.3, maxDensity: 16 }, pebble: { prob: 0.6, maxDensity: 32 } },
            STONE: { grass: { prob: 0.05, maxDensity: 4 }, rock: { prob: 0.9, maxDensity: 72 }, pebble: { prob: 0.05, maxDensity: 8 } },
        };
        

          function hash2D(x, y, seed) {
            // Simple integer hash (deterministic)
            const s = Math.sin((x * 374761393 + y * 668265263 + seed * 69069) % 1e7) * 43758.5453;
            return s - Math.floor(s);
          }
          
          function smoothNoise2D(x, y, seed) {
            // Coherent low-frequency noise using interpolation
            const xi = Math.floor(x);
            const yi = Math.floor(y);
            const xf = x - xi;
            const yf = y - yi;
          
            const n00 = hash2D(xi, yi, seed);
            const n10 = hash2D(xi + 1, yi, seed);
            const n01 = hash2D(xi, yi + 1, seed);
            const n11 = hash2D(xi + 1, yi + 1, seed);
          
            const u = xf * xf * (3.0 - 2.0 * xf);
            const v = yf * yf * (3.0 - 2.0 * yf);
          
            const nx0 = n00 * (1.0 - u) + n10 * u;
            const nx1 = n01 * (1.0 - u) + n11 * u;
            return nx0 * (1.0 - v) + nx1 * v;
          }
          
        export class GPUTiledTerrainGenerator {
            constructor(device, seed, chunkSize, macroConfig, splatConfig) {
                this.splatKernelSize = splatConfig.splatKernelSize || 5;
                this.device = device;
                this.seed = seed;
                this.chunkSize = chunkSize;
                this.macroConfig = macroConfig;
                this.splatDensity = splatConfig.splatDensity || 4; 
                // Terrain/biome configuration
                this.worldScale = 1.0;
                this.elevationScale = 0.04;
                this.detailScale = 0.08;
                this.ridgeScale = 0.02;
                this.plateauScale = 0.005;
                this.valleyScale = 0.012;
                this.heightScale = 40.0;
                this.streamedTypes = new Map();

                for (const [tileType, features] of Object.entries(BASE_FEATURE_DISTRIBUTION)) {
                    for (const [name, config] of Object.entries(features)) {
                        this.streamedTypes.set(name, {
                            name,
                            prob: config.prob,
                            maxDensity: config.maxDensity,
                            validTiles: [TILE_TYPES[tileType]]  // map string to your tile enum
                        });
                    }
                }
                this.createTerrainPipeline();
            }

            createTerrainPipeline() {
                // === WGSL Shader for full terrain + splat blend ===
                const terrainShader = `TODO`;
                this.terrainComputePipeline = this.device.createComputePipeline({
                    layout: 'auto',
                    compute: {
                        module: this.device.createShaderModule({ code: terrainShader }),
                        entryPoint: 'main'
                    }
                });
            }

            generateFeatureDistributionForChunk(chunkX, chunkZ, tiles) {
                const distribution = {};
            
                for (const [typeName, config] of this.streamedTypes.entries()) {
                    const maxDensity = config.maxDensity || 32;
                    const baseDensity = config.prob || 0.5;
                    
                    // Calculate density based on probability
                    const density = Math.sqrt(baseDensity * maxDensity) / 
                        this.chunkSize;
            
                    const positions = [];
                    const gridSize = this.chunkSize;
            
                    for (let i = 0; i < gridSize * density; i++) {
                        for (let j = 0; j < gridSize * density; j++) {
                            const x = i / density + Math.random();
                            const z = j / density + Math.random();
            
                            const tileX = Math.floor(x);
                            const tileZ = Math.floor(z);
                            
                            if (tileX >= gridSize || tileZ >= gridSize) continue;
                            
                            const tileIdx = tileZ * gridSize + tileX;
                            const tileType = tiles[tileIdx];
            
                            if (!config.validTiles.includes(tileType)) {
                                continue;
                            }
            
                            positions.push({ x, z });
                        }
                    }
            
                    distribution[config.name] = positions;
                }
            
                return { featureMix: {}, ...distribution };
            }
            
            async generateTerrain(chunkData, chunkX, chunkY) {
                // ---- Buffer size calculations ----
                const heightsSize  = (this.chunkSize + 1) * (this.chunkSize + 1);
                const tilesSize    = this.chunkSize * this.chunkSize;
                const normalsSize  = (this.chunkSize + 1) * (this.chunkSize + 1) * 3;
                const splatSize    = this.chunkSize * this.splatDensity;
                const macroSize = splatSize * splatSize;
                const blendWeightsSize = splatSize * splatSize * 4;
                const blendTypesSize   = splatSize * splatSize * 4;

                const waterHeightsSize = heightsSize;
                const waterDepthsSize = heightsSize;
            
                // ---- Create GPU buffers ----
                const heightsBuffer = this.device.createBuffer({
                    size: heightsSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const tilesBuffer = this.device.createBuffer({
                    size: tilesSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const macroBuffer = this.device.createBuffer({
                    size: macroSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const normalsBuffer = this.device.createBuffer({
                    size: normalsSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const blendWeightsBuffer = this.device.createBuffer({
                    size: blendWeightsSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const blendTypesBuffer = this.device.createBuffer({
                    size: blendTypesSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });

                    // NEW: Water buffers
                const waterHeightsBuffer = this.device.createBuffer({
                    size: waterHeightsSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                
                const waterDepthsBuffer = this.device.createBuffer({
                    size: waterDepthsSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });

                // ---- Uniform buffer for parameters ----
                const paramsBuffer = this.device.createBuffer({
                    size: 64, // 14 * 4 bytes
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
                
                const paramsData = new ArrayBuffer(64);
                const paramsView = new DataView(paramsData);
                let offset = 0;
                paramsView.setInt32(offset, chunkX, true); offset += 4;
                paramsView.setInt32(offset, chunkY, true); offset += 4;
                paramsView.setUint32(offset, this.chunkSize, true); offset += 4;
                paramsView.setUint32(offset, this.seed, true); offset += 4;
                paramsView.setFloat32(offset, this.elevationScale, true); offset += 4;
                paramsView.setFloat32(offset, this.heightScale, true); offset += 4;
                paramsView.setFloat32(offset, this.macroConfig.biomeScale, true); offset += 4;
                paramsView.setFloat32(offset, this.macroConfig.regionScale, true); offset += 4;
                paramsView.setFloat32(offset, this.detailScale, true); offset += 4;
                paramsView.setFloat32(offset, this.ridgeScale, true); offset += 4;
                paramsView.setFloat32(offset, this.valleyScale, true); offset += 4;
                paramsView.setFloat32(offset, this.plateauScale, true); offset += 4;
                paramsView.setFloat32(offset, this.worldScale, true); offset += 4;
                paramsView.setUint32(offset, this.splatDensity, true); offset += 4;
                paramsView.setUint32(offset, this.splatKernelSize, true); offset += 4;
                paramsView.setInt32 (offset, 0, true); // _pad
                
                this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

                // ---- Bind group ----
                const bindGroup = this.device.createBindGroup({
                    layout: this.terrainComputePipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: paramsBuffer } },
                        { binding: 1, resource: { buffer: heightsBuffer } },
                        { binding: 2, resource: { buffer: tilesBuffer } },
                        { binding: 3, resource: { buffer: macroBuffer } },
                        { binding: 4, resource: { buffer: normalsBuffer } },
                        { binding: 5, resource: { buffer: blendWeightsBuffer } },
                        { binding: 6, resource: { buffer: blendTypesBuffer } },
                        { binding: 7, resource: { buffer: waterHeightsBuffer } }, // NEW
                        { binding: 8, resource: { buffer: waterDepthsBuffer } },  // NEW
                    ]
                });

                // ---- GPU compute pass ----
                const commandEncoder = this.device.createCommandEncoder();
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(this.terrainComputePipeline);
                computePass.setBindGroup(0, bindGroup);
                const maxDim = Math.max(this.chunkSize + 1, splatSize);


                computePass.dispatchWorkgroups(
                    Math.ceil(maxDim / 8),
                    Math.ceil(maxDim / 8)
                );
                computePass.end();

                // ---- Prepare read-back buffers ----
                const heightsReadBuffer = this.device.createBuffer({
                    size: heightsSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                const tilesReadBuffer = this.device.createBuffer({
                    size: tilesSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                const macroReadBuffer = this.device.createBuffer({
                    size: macroSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                const normalsReadBuffer = this.device.createBuffer({
                    size: normalsSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                const blendWeightsReadBuffer = this.device.createBuffer({
                    size: blendWeightsSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                const blendTypesReadBuffer = this.device.createBuffer({
                    size: blendTypesSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                // NEW: Create read buffers for water data
                const waterHeightsReadBuffer = this.device.createBuffer({
                    size: waterHeightsSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                
                const waterDepthsReadBuffer = this.device.createBuffer({
                    size: waterDepthsSize * 4,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                // ---- Copy data from GPU output buffers to read-back buffers ----
                commandEncoder.copyBufferToBuffer(heightsBuffer, 0, heightsReadBuffer, 0, heightsSize * 4);
                commandEncoder.copyBufferToBuffer(tilesBuffer, 0, tilesReadBuffer, 0, tilesSize * 4);
                commandEncoder.copyBufferToBuffer(macroBuffer, 0, macroReadBuffer, 0, macroSize * 4);
                commandEncoder.copyBufferToBuffer(normalsBuffer, 0, normalsReadBuffer, 0, normalsSize * 4);
                commandEncoder.copyBufferToBuffer(blendWeightsBuffer, 0, blendWeightsReadBuffer, 0, blendWeightsSize * 4);
                commandEncoder.copyBufferToBuffer(blendTypesBuffer, 0, blendTypesReadBuffer, 0, blendTypesSize * 4);
                // Copy water data
                commandEncoder.copyBufferToBuffer(
                    waterHeightsBuffer, 0, waterHeightsReadBuffer, 0, waterHeightsSize * 4
                );
                commandEncoder.copyBufferToBuffer(
                    waterDepthsBuffer, 0, waterDepthsReadBuffer, 0, waterDepthsSize * 4
                );
                this.device.queue.submit([commandEncoder.finish()]);

                // ---- Await GPU read-back ----
                await Promise.all([
                    heightsReadBuffer.mapAsync(GPUMapMode.READ),
                    tilesReadBuffer.mapAsync(GPUMapMode.READ),
                    macroReadBuffer.mapAsync(GPUMapMode.READ),
                    normalsReadBuffer.mapAsync(GPUMapMode.READ),
                    blendWeightsReadBuffer.mapAsync(GPUMapMode.READ),
                    blendTypesReadBuffer.mapAsync(GPUMapMode.READ),
                    waterHeightsReadBuffer.mapAsync(GPUMapMode.READ), // NEW
                    waterDepthsReadBuffer.mapAsync(GPUMapMode.READ),  // NEW
                ]);

                // ---- Copy/validate into CPU arrays ----
                const heights = new Float32Array(heightsReadBuffer.getMappedRange());
                const tiles = new Uint32Array(tilesReadBuffer.getMappedRange());
                const macroData = new Float32Array(macroReadBuffer.getMappedRange());

                const normals = new Float32Array(normalsReadBuffer.getMappedRange());
                const blendWeights = new Float32Array(blendWeightsReadBuffer.getMappedRange());
                const blendTypes = new Uint32Array(blendTypesReadBuffer.getMappedRange());
                // NEW: Read water data
                const waterHeights = new Float32Array(waterHeightsReadBuffer.getMappedRange());
                const waterDepths = new Float32Array(waterDepthsReadBuffer.getMappedRange());


                // ---- Output ----
                chunkData.heights = heights.slice();
                chunkData.tiles = tiles.slice();
                chunkData.macroData = macroData.slice();
                
                chunkData.normals = normals.slice();
                chunkData.blendWeights = blendWeights.slice();
                chunkData.blendTypes = blendTypes.slice();



                chunkData.splatDensity = this.splatDensity;  // ADD THIS LINE
                chunkData.offsetX = chunkX * this.chunkSize;
                chunkData.offsetZ = chunkY * this.chunkSize;
                    // NEW: Store water data
                chunkData.waterData = waterHeights.slice();
                chunkData.waterDepth = waterDepths.slice();
        // Calculate water statistics
        let waterCellCount = 0;
        let totalDepth = 0;
        let maxDepth = 0;
        let minWaterHeight = Infinity;
        let maxWaterHeight = -Infinity;
        let riverCount = 0; // depth < 2
        let lakeCount = 0;  // depth 2-10
        let oceanCount = 0; // depth > 10

        for (let i = 0; i < waterDepths.length; i++) {
            const depth = waterDepths[i];
            if (depth > 0) {
                waterCellCount++;
                totalDepth += depth;
                maxDepth = Math.max(maxDepth, depth);
                
                const waterHeight = waterHeights[i];
                minWaterHeight = Math.min(minWaterHeight, waterHeight);
                maxWaterHeight = Math.max(maxWaterHeight, waterHeight);
                
                if (depth < 2) riverCount++;
                else if (depth < 10) lakeCount++;
                else oceanCount++;
            }
        }
        chunkData.hasWater = waterCellCount > 0;
        if (chunkData.hasWater) {
            const avgDepth = totalDepth / waterCellCount;
            const coverage = (waterCellCount / waterDepths.length * 100).toFixed(1);
            
            console.log(`💧 WATER in chunk (${chunkX}, ${chunkY}):
        Coverage: ${coverage}% (${waterCellCount}/${waterDepths.length} cells)
        Depth: avg=${avgDepth.toFixed(2)}, max=${maxDepth.toFixed(2)}
        Height range: ${minWaterHeight.toFixed(2)} to ${maxWaterHeight.toFixed(2)}
        Types: ${riverCount} river, ${lakeCount} lake, ${oceanCount} ocean cells`);
        } else {
            console.log(`🏜️  No water in chunk (${chunkX}, ${chunkY})`);
        }

        chunkData.featureDistribution = this.generateFeatureDistributionForChunk(chunkX, chunkY, chunkData.tiles);
        console.log(`🗺️  Generated terrain for chunk (${chunkX}, ${chunkY})`, chunkData);
                heightsReadBuffer.unmap();
                tilesReadBuffer.unmap();
                macroReadBuffer.unmap();
                normalsReadBuffer.unmap();
                blendWeightsReadBuffer.unmap();
                blendTypesReadBuffer.unmap();
                waterHeightsReadBuffer.unmap();
                waterDepthsReadBuffer.unmap();
            }
            

            countTileType(tiles, tileType) {
                let count = 0;
                for (let i = 0; i < tiles.length; i++) {
                    if (tiles[i] === tileType) {
                        count++;
                    }
                }
                return count;
            }
   
            calculateSlope(chunkData, x, z) {
                const h0 = chunkData.getHeight(x, z);
                const h1 = chunkData.getHeight(Math.min(x + 1, chunkData.size - 1), z);
                const h2 = chunkData.getHeight(x, Math.min(z + 1, chunkData.size - 1));
                const dx = Math.abs(h1 - h0);
                const dz = Math.abs(h2 - h0);
                return Math.max(dx, dz);
            }
            createSeededRandom(seed) {
                let s = seed;
                return function() {
                    s = Math.sin(s) * 10000;
                    return s - Math.floor(s);
                };
            }
        }