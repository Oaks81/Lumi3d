//js/mesh/terrain/terrainMaterialBuilder.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Material } from '../../renderer/resources/material.js';

export class TerrainMaterialBuilder {
    static _shaderBuilders = new Map();

    static async _loadShaderBuilders(apiName) {
        if (this._shaderBuilders.has(apiName)) {
            return this._shaderBuilders.get(apiName);
        }

        console.log(`[TerrainMaterialBuilder] Loading shader builders for API: ${apiName}`);

        let builders;
        if (apiName === 'webgpu') {
            try {
                console.log(' Attempting to load WebGPU shaders from:');
                console.log('  - ./shaders/webgpu/terrainChunkVertexShaderBuilder.js');
                console.log('  - ./shaders/webgpu/terrainChunkFragmentShaderBuilder.js');
                
                const vertex = await import('./shaders/webgpu/terrainChunkVertexShaderBuilder.js');
                const fragment = await import('./shaders/webgpu/terrainChunkFragmentShaderBuilder.js');
                
                if (!vertex.buildTerrainChunkVertexShader || !fragment.buildTerrainChunkFragmentShader) {
                    throw new Error('WebGPU shader builders missing export functions');
                }
                
                builders = {
                    buildTerrainChunkVertexShader: vertex.buildTerrainChunkVertexShader,
                    buildTerrainChunkFragmentShader: fragment.buildTerrainChunkFragmentShader
                };
                
                console.log(' WebGPU shaders loaded successfully');
            } catch (e) {
                console.error(" Failed to load WebGPU shaders:", e);
                console.error(" Check that files exist at:");
                console.error("   renderer/terrain/shaders/webgpu/terrainChunkVertexShaderBuilder.js");
                console.error("   renderer/terrain/shaders/webgpu/terrainChunkFragmentShaderBuilder.js");
                throw new Error(`Cannot load WebGPU shaders: ${e.message}`);
            }
        } else {
            const vertex = await import('./shaders/webgl2/terrainChunkVertexShaderBuilder.js');
            const fragment = await import('./shaders/webgl2/terrainChunkFragmentShaderBuilder.js');
            builders = {
                buildTerrainChunkVertexShader: vertex.buildTerrainChunkVertexShader,
                buildTerrainChunkFragmentShader: fragment.buildTerrainChunkFragmentShader
            };
        }

        this._shaderBuilders.set(apiName, builders);
        return builders;
    }

    static async create(options) {
        const {
            backend,
            atlasTextures,
            lookupTables,
            cachedTextures,
            chunkOffsetX = 0,
            chunkOffsetZ = 0,
            chunkSize = 128,
            environmentState = {},
            uniformManager = null,
            faceIndex = 0,
            faceU = 0,
            faceV = 0,
            faceSize = 1.0,
            planetConfig = { radius: 50000, origin: new THREE.Vector3(0,0,0) }
        } = options;

        if (!backend) {
            console.error(" TerrainMaterialBuilder: Backend is NULL!");
            return;
        }

        // Detect API
        let apiName = 'webgl2';
        if (backend && typeof backend.getAPIName === 'function') {
            apiName = backend.getAPIName();
        } else if (backend && backend.device) {
            apiName = 'webgpu';
        }

        console.log(`🔧 Creating terrain material for ${apiName}`);

        const builders = await this._loadShaderBuilders(apiName);

        // Build shaders
        const shaderOptions = { 
            maxLightIndices: 8192 
        };
        const vertexShader = builders.buildTerrainChunkVertexShader();
        const fragmentShader = builders.buildTerrainChunkFragmentShader(shaderOptions);

        // ============================================
        // DEBUG: Validate shader language
        // ============================================
        console.log(' Vertex Shader (first 200 chars):\n' + vertexShader.substring(0, 200));
        console.log(' Fragment Shader (first 200 chars):\n' + fragmentShader.substring(0, 200));
        console.log(' Shader language detected:', vertexShader.includes('#version') ? ' GLSL' : ' WGSL');

        // ============================================
        // Build ALL uniforms
        // ============================================
        const uniforms = {
            // === NEW PLANET UNIFORMS ===
            planetRadius: { value: planetConfig.radius },
            planetOrigin: { value: planetConfig.origin },
            chunkFace: { value: faceIndex },
            chunkLocation: { value: new THREE.Vector2(faceU, faceV) },
            chunkSizeUV: { value: faceSize },
            
            // Chunk-specific
            chunkOffset: { value: new THREE.Vector2(chunkOffsetX, chunkOffsetZ) },
            chunkSize: { value: chunkSize },
            chunkWidth: { value: chunkSize },
            chunkHeight: { value: chunkSize },
            maxTileTypes: { value: 256 },

            // LOD settings
            lodLevel: { value: 0 },
            geometryLOD: { value: 0 },
            splatLODBias: { value: 0.0 },
            macroLODBias: { value: 0.0 },
            detailFade: { value: 1.0 },
            enableSplatLayer: { value: 1.0 },
            enableMacroLayer: { value: 1.0 },
            enableClusteredLights: { value: 1.0 },

            // Chunk textures
            heightTexture: { value: cachedTextures.height },
            normalTexture: { value: cachedTextures.normal },
            tileTexture: { value: cachedTextures.tile },
            splatDataMap: { value: cachedTextures.splatData },
            macroMaskTexture: { value: cachedTextures.macro },

            // Lookup tables
            tileTypeLookup: { value: lookupTables.tileTypeLookup },
            macroTileTypeLookup: { value: lookupTables.macroTileTypeLookup },
            numVariantsTex: { value: lookupTables.numVariantsTex },

            // Atlas textures
            atlasTexture: { value: atlasTextures.micro },
            atlasTextureSize: {
                value: new THREE.Vector2(
                    atlasTextures.micro.image?.width || atlasTextures.micro.width || 1024,
                    atlasTextures.micro.image?.height || atlasTextures.micro.height || 1024
                )
            },
            level2AtlasTexture: { value: atlasTextures.macro1024 },
            level2AtlasTextureSize: {
                value: new THREE.Vector2(
                    atlasTextures.macro1024.image?.width || atlasTextures.macro1024.width || 1024,
                    atlasTextures.macro1024.image?.height || atlasTextures.macro1024.height || 1024
                )
            },

            // Material settings
            macroScale: { value: 0.1 },
            level2Blend: { value: 0.7 },
            tileScale: { value: 1.0 },
            isFeature: { value: 0.0 },

            // Season data
            numSeasons: { value: 4 },
            currentSeason: { value: 0 },
            nextSeason: { value: 1 },
            seasonTransition: { value: 0.0 },
        };

        // ============================================
        // Clone global uniforms from UniformManager
        // ============================================
        if (uniformManager && uniformManager.uniforms) {
            const globalUniforms = uniformManager.uniforms;
            const globalUniformsToClone = [
                'modelMatrix', 'viewMatrix', 'projectionMatrix',
                'sunLightColor', 'sunLightIntensity', 'sunLightDirection',
                'moonLightColor', 'moonLightIntensity', 'moonLightDirection',
                'ambientLightColor', 'ambientLightIntensity',
                'skyAmbientColor', 'groundAmbientColor',
                'thunderLightIntensity', 'thunderLightColor', 'thunderLightPosition',
                'playerLightColor', 'playerLightIntensity',
                'playerLightPosition', 'playerLightDistance',
                'fogColor', 'fogDensity',
                'weatherIntensity', 'currentWeather',
                'shadowMapCascade0', 'shadowMapCascade1', 'shadowMapCascade2',
                'shadowMatrixCascade0', 'shadowMatrixCascade1', 'shadowMatrixCascade2',
                'cascadeSplits', 'numCascades',
                'shadowBias', 'shadowNormalBias', 'shadowMapSize', 'receiveShadow',
                'cameraPosition', 'cameraNear', 'cameraFar',
                'clusterDimensions', 'clusterDataTexture',
                'lightDataTexture', 'lightIndicesTexture',
                'numLights', 'maxLightsPerCluster'
            ];

            for (const key of globalUniformsToClone) {
                if (globalUniforms[key] && !uniforms[key]) {
                    uniforms[key] = {
                        value: this._cloneUniformValue(globalUniforms[key].value)
                    };
                }
            }
        }

        // ============================================
        // Pre-define vertex layout for WebGPU
        // ============================================
        let vertexLayout = null;
        if (apiName === 'webgpu') {
            vertexLayout = [
                { 
                    arrayStride: 12, 
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] 
                }, // position
                { 
                    arrayStride: 12, 
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] 
                }, // normal
                { 
                    arrayStride: 8,  
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] 
                }  // uv
            ];
        }

        const material = new Material({
            name: 'TerrainMaterial',
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms,
            side: 'front',
            depthTest: true,
            depthWrite: true,
            isInstanced: false,
            vertexLayout: vertexLayout,
            defines: {
                USE_TILE_TEXTURE: true,
                USE_HEIGHT_TEXTURE: true,
                USE_NORMAL_TEXTURE: true
            }
        });

        material._apiName = apiName;

        console.log('Material texture validation:', {
            height: `${cachedTextures.height?.width}x${cachedTextures.height?.height}`,
            normal: `${cachedTextures.normal?.width}x${cachedTextures.normal?.height}`,
            tile: `${cachedTextures.tile?.width}x${cachedTextures.tile?.height}`,
            splatWeight: `${cachedTextures.splatWeight?.width}x${cachedTextures.splatWeight?.height}`,
            macro: `${cachedTextures.macro?.width}x${cachedTextures.macro?.height}`,
            microAtlas: `${atlasTextures.micro?.width}x${atlasTextures.micro?.height}`,
            macroAtlas: `${atlasTextures.macro1024?.width}x${atlasTextures.macro1024?.height}`
        });

        return material;
    }

    static _cloneUniformValue(value) {
        if (value === null || value === undefined) return value;
        if (value.isVector2) return value.clone();
        if (value.isVector3) return value.clone();
        if (value.isVector4) return value.clone();
        if (value.isColor) return value.clone();
        if (value.isMatrix3) return value.clone();
        if (value.isMatrix4) return value.clone();
        if (Array.isArray(value)) return [...value];
        if (ArrayBuffer.isView(value)) return value.slice();
        return value;
    }
}