// worldgen/webgl2TerrainGenerator.js (FIXED)

import { Texture, TextureFormat, TextureFilter, TextureWrap } from '../renderer/resources/texture.js';
import { RenderTarget } from '../renderer/resources/RenderTarget.js';
import { Geometry } from '../renderer/resources/geometry.js';
import { Material } from '../renderer/resources/material.js';
import { terrainVertexShader, terrainFragmentShader } from './shaders/webgl2/terrainCompute.glsl.js';
import { splatVertexShader, splatFragmentShader } from './shaders/webgl2/splatCompute.glsl.js';
import { BASE_FEATURE_DISTRIBUTION } from './shaders/featureDistribution.js';
import { TILE_TYPES } from '../types.js';

export class WebGL2TerrainGenerator {
    constructor(backend, seed, chunkSize, macroConfig, splatConfig, textureCache) {
        this.backend = backend;
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
        
        this.terrainMaterial = null;
        this.splatMaterial = null;
        this.quadGeometry = null;
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized) return;
        
        this.quadGeometry = this.createQuadGeometry();
        this.terrainMaterial = this.createTerrainMaterial();
        this.splatMaterial = this.createSplatMaterial();
        
        this.backend.compileShader(this.terrainMaterial);
        this.backend.compileShader(this.splatMaterial);
        
        this.initialized = true;
        console.log('WebGL2TerrainGenerator initialized');
    }
    
    createQuadGeometry() {
        const geometry = new Geometry();
        
        const positions = new Float32Array([
            -1, -1, 0,
             1, -1, 0,
             1,  1, 0,
            -1,  1, 0
        ]);
        
        const uvs = new Float32Array([
            0, 0,
            1, 0,
            1, 1,
            0, 1
        ]);
        
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        
        return geometry;
    }
    
    createTerrainMaterial() {
        return new Material({
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            uniforms: {
                // FIX: Use array for ivec2 uniforms
                u_chunkCoord: { value: [0, 0], type: 'ivec2' },
                u_chunkSize: { value: this.chunkSize, type: 'int' },
                u_seed: { value: this.seed, type: 'int' },
                u_elevationScale: { value: this.elevationScale, type: 'float' },
                u_heightScale: { value: this.heightScale, type: 'float' },
                u_biomeScale: { value: this.macroConfig.biomeScale || 0.004, type: 'float' },
                u_regionScale: { value: this.macroConfig.regionScale || 0.00007, type: 'float' },
                u_detailScale: { value: this.detailScale, type: 'float' },
                u_ridgeScale: { value: this.ridgeScale, type: 'float' },
                u_valleyScale: { value: this.valleyScale, type: 'float' },
                u_plateauScale: { value: this.plateauScale, type: 'float' },
                u_worldScale: { value: this.worldScale, type: 'float' },
                u_outputType: { value: 0, type: 'int' },
                u_renderHalo: { value: 0.0, type: 'float' }
            },
            depthTest: false,
            depthWrite: false
        });
    }
    
    createSplatMaterial() {
        return new Material({
            vertexShader: splatVertexShader,
            fragmentShader: splatFragmentShader,
            uniforms: {
                u_heightMap: { value: null, type: 'sampler2D' },
                u_tileMap: { value: null, type: 'sampler2D' },
                // FIX: Use array for ivec2 uniforms
                u_chunkCoord: { value: [0, 0], type: 'ivec2' },
                u_chunkSize: { value: this.chunkSize, type: 'int' },
                u_splatDensity: { value: this.splatDensity, type: 'int' },
                u_kernelSize: { value: this.splatKernelSize, type: 'int' },
                u_seed: { value: this.seed, type: 'int' }
            },
            depthTest: false,
            depthWrite: false
        });
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

    createRenderTarget(width, height, options = {}) {
        const {
            format = TextureFormat.RGBA32F,
            colorCount = 1,
            minFilter = TextureFilter.NEAREST,
            magFilter = TextureFilter.NEAREST,
            depthBuffer = false
        } = options;

        return new RenderTarget(width, height, {
            format,
            colorCount,
            minFilter,
            magFilter,
            depthBuffer
        });
    }

    async generateTerrain(chunkData, chunkX, chunkY) {
        if (!this.initialized) {
            this.initialize();
        }
        let heightTexture = this.textureCache.get(chunkX, chunkY, 'height');
        let normalTexture = this.textureCache.get(chunkX, chunkY, 'normal');
        let tileTexture = this.textureCache.get(chunkX, chunkY, 'tile');
        let splatWeightTexture = this.textureCache.get(chunkX, chunkY, 'splatWeight');
        let splatTypeTexture = this.textureCache.get(chunkX, chunkY, 'splatType');
        let macroTexture = this.textureCache.get(chunkX, chunkY, 'macro');

        const hasAllTextures = heightTexture && normalTexture && tileTexture &&
                               splatWeightTexture && splatTypeTexture && macroTexture;

        let heightData, tileData;

        if (!hasAllTextures) {
            const result = await this.generateAllTexturesForChunk(chunkX, chunkY);

            const size = this.chunkSize + 1;
            const tileSize = this.chunkSize;
            const splatSize = this.chunkSize * this.splatDensity;

            const heightSizeBytes = size * size * 4 * 4;
            const normalSizeBytes = size * size * 4 * 4;
            const tileSizeBytes = tileSize * tileSize * 4 * 4;
            const macroSizeBytes = splatSize * splatSize * 4 * 4;
            const splatWeightSizeBytes = splatSize * splatSize * 4 * 4;
            const splatTypeSizeBytes = splatSize * splatSize * 4 * 4;

            this.textureCache.set(chunkX, chunkY, 'height', result.textures.height, heightSizeBytes);
            this.textureCache.set(chunkX, chunkY, 'normal', result.textures.normal, normalSizeBytes);
            this.textureCache.set(chunkX, chunkY, 'tile', result.textures.tile, tileSizeBytes);
            this.textureCache.set(chunkX, chunkY, 'splatWeight', result.textures.splatWeight, splatWeightSizeBytes);
            this.textureCache.set(chunkX, chunkY, 'splatType', result.textures.splatType, splatTypeSizeBytes);
            this.textureCache.set(chunkX, chunkY, 'macro', result.textures.macro, macroSizeBytes);

            heightTexture = result.textures.height;
            normalTexture = result.textures.normal;
            tileTexture = result.textures.tile;
            splatWeightTexture = result.textures.splatWeight;
            splatTypeTexture = result.textures.splatType;
            macroTexture = result.textures.macro;

            heightData = result.heightData;
            tileData = result.tileData;
        } else {
            console.log(`Using cached textures for chunk ${chunkX},${chunkY}`);

            const size = this.chunkSize + 1;
            const tileSize = this.chunkSize;

            const heightRT = new RenderTarget(size, size, {
                format: TextureFormat.RGBA32F,
                depthBuffer: false
            });
            heightRT.colorAttachments[0] = heightTexture;
            
            heightData = this.backend.readPixels(heightRT, 0, 0, size, size, 'rgba');

            const tileRT = new RenderTarget(tileSize, tileSize, {
                format: TextureFormat.RGBA32F,
                depthBuffer: false
            });
            tileRT.colorAttachments[0] = tileTexture;
            
            tileData = this.backend.readPixels(tileRT, 0, 0, tileSize, tileSize, 'rgba');
        }

        this.populateChunkData(chunkData, chunkX, chunkY, heightData, tileData);

        chunkData.textureRefs = {
            chunkX,
            chunkY,
            heightTexture,
            normalTexture,
            tileTexture,
            splatWeightTexture,
            splatTypeTexture,
            macroTexture
        };
    }

    populateChunkData(chunkData, chunkX, chunkY, heightData, tileData) {
        const tileSize = this.chunkSize;
        const size = this.chunkSize + 1;

        const tilesCount = tileSize * tileSize;
        chunkData.tiles = new Uint32Array(tilesCount);
        for (let i = 0; i < tilesCount; i++) {
            chunkData.tiles[i] = Math.round(tileData[i * 4]);
        }

        const heightsCount = size * size;
        chunkData.heights = new Float32Array(heightsCount);
        for (let i = 0; i < heightsCount; i++) {
            chunkData.heights[i] = heightData[i * 4];
        }

        chunkData.splatDensity = this.splatDensity;
        chunkData.offsetX = chunkX * this.chunkSize;
        chunkData.offsetZ = chunkY * this.chunkSize;
        chunkData.featureDistribution = this.generateFeatureDistributionForChunk(
            chunkX, chunkY, chunkData.tiles
        );
    }

    async generateAllTexturesForChunk(chunkX, chunkY) {
        const size = this.chunkSize + 1;
        const tileSize = this.chunkSize;
        const splatSize = this.chunkSize * this.splatDensity;

        const heightRT = this.createRenderTarget(size, size, {
            format: TextureFormat.RGBA32F
        });

        const normalRT = this.createRenderTarget(size, size, {
            format: TextureFormat.RGBA32F,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR
        });

    console.log(` Creating normal RT for chunk (${chunkX}, ${chunkY})`);
    console.log(`   Requested: ${size}x${size}`);
    console.log(`   RT object: ${normalRT.width}x${normalRT.height}`);
    console.log(`   Texture: ${normalRT.texture.width}x${normalRT.texture.height}`);

        const tileRT = this.createRenderTarget(tileSize, tileSize, {
            format: TextureFormat.RGBA32F,
            minFilter: TextureFilter.NEAREST,
            magFilter: TextureFilter.NEAREST
        });

        const macroRT = this.createRenderTarget(splatSize, splatSize, {
            format: TextureFormat.RGBA32F,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR
        });

        const splatRT = this.createRenderTarget(splatSize, splatSize, {
            format: TextureFormat.RGBA32F,
            colorCount: 2,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR
        });

        this.terrainMaterial.uniforms.u_chunkCoord.value = [chunkX, chunkY];

        this.terrainMaterial.uniforms.u_outputType.value = 0;
        this.renderToTarget(heightRT, this.terrainMaterial);

        const heightData = this.backend.readPixels(heightRT, 0, 0, size, size, 'rgba');

        this.terrainMaterial.uniforms.u_outputType.value = 1;
        this.renderToTarget(normalRT, this.terrainMaterial);
        
        const gl = this.backend.gl;
        const vp = gl.getParameter(gl.VIEWPORT);
        console.log(`   Viewport: [${vp[0]}, ${vp[1]}, ${vp[2]}, ${vp[3]}]`);


        this.terrainMaterial.uniforms.u_outputType.value = 2;
        this.renderToTarget(tileRT, this.terrainMaterial);

        const tileData = this.backend.readPixels(tileRT, 0, 0, tileSize, tileSize, 'rgba');

        this.terrainMaterial.uniforms.u_outputType.value = 3;
        this.renderToTarget(macroRT, this.terrainMaterial);

        if (!heightRT.texture._gpuTexture) {
            this.backend.createTexture(heightRT.texture);
        }
        if (!tileRT.texture._gpuTexture) {
            this.backend.createTexture(tileRT.texture);
        }
        
        this.splatMaterial.uniforms.u_heightMap.value = heightRT.texture;
        this.splatMaterial.uniforms.u_tileMap.value = tileRT.texture;
        // FIX: Set chunk coord as array for ivec2
        this.splatMaterial.uniforms.u_chunkCoord.value = [chunkX, chunkY];
        this.renderToTarget(splatRT, this.splatMaterial);

        this.backend.setRenderTarget(null);

        const textures = {
            height: heightRT.texture,
            normal: normalRT.texture,
            tile: tileRT.texture,
            macro: macroRT.texture,
            splatWeight: splatRT.textures[0],
            splatType: splatRT.textures[1]
        };

        textures.normal.minFilter = TextureFilter.LINEAR;
        textures.normal.magFilter = TextureFilter.LINEAR;
        textures.splatWeight.minFilter = TextureFilter.LINEAR;
        textures.splatWeight.magFilter = TextureFilter.LINEAR;

        for (const tex of Object.values(textures)) {
            tex.wrapS = TextureWrap.CLAMP;
            tex.wrapT = TextureWrap.CLAMP;
        }

        return { textures, heightData, tileData };
    }
    
    renderToTarget(renderTarget, material) {
        this.backend.setRenderTarget(renderTarget);
        this.backend.clear(true, false, false);
        this.backend.draw(this.quadGeometry, material);
    }

    generateFeatureDistributionForChunk(chunkX, chunkZ, tiles) {
        const distribution = {};

        for (const [typeName, config] of this.streamedTypes.entries()) {
            const maxDensity = config.maxDensity || 32;
            const baseDensity = config.prob || 0.5;
            const density = Math.sqrt(baseDensity * maxDensity) / this.chunkSize;
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

                    if (!config.validTiles.includes(tileType)) continue;

                    positions.push({ x, z });
                }
            }

            distribution[config.name] = positions;
        }

        return { featureMix: {}, ...distribution };
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
    
    dispose() {
        if (this.quadGeometry) {
            this.quadGeometry.dispose();
        }
        if (this.terrainMaterial) {
            this.backend.deleteShader(this.terrainMaterial);
            this.terrainMaterial.dispose();
        }
        if (this.splatMaterial) {
            this.backend.deleteShader(this.splatMaterial);
            this.splatMaterial.dispose();
        }
    }
}