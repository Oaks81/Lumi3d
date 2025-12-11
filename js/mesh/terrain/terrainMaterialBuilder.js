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
                faceIndex = -1,
                faceU = 0,
                faceV = 0,
                faceSize = 16,
                planetConfig = null,
                useAtlasMode = false,
                uvTransform = null,
                heightScale = 1.0,
                lod = 0,
                enableInstancing = false
            } = options;
        
            if (!backend) {
                console.error(" TerrainMaterialBuilder: Backend is NULL!");
                return null;
            }
        
            let apiName = 'webgl2';
            if (backend && typeof backend.getAPIName === 'function') {
                apiName = backend.getAPIName();
            } else if (backend && backend.device) {
                apiName = 'webgpu';
            }
        
            console.log(`[TerrainMaterialBuilder] Creating terrain material for ${apiName}`);
            console.log(`[TerrainMaterialBuilder] Cached textures:`, {
                height: cachedTextures.height ? `${cachedTextures.height.width}x${cachedTextures.height.height}` : 'NULL',
                normal: cachedTextures.normal ? `${cachedTextures.normal.width}x${cachedTextures.normal.height}` : 'NULL',
                tile: cachedTextures.tile ? `${cachedTextures.tile.width}x${cachedTextures.tile.height}` : 'NULL',
                splatData: cachedTextures.splatData ? 'SET' : 'NULL',
                macro: cachedTextures.macro ? 'SET' : 'NULL'
            });
        
            const builders = await this._loadShaderBuilders(apiName);
        
            const shaderOptions = { maxLightIndices: 8192 };
            const vertexShader = builders.buildTerrainChunkVertexShader({ instanced: enableInstancing });
            const fragmentShader = builders.buildTerrainChunkFragmentShader(shaderOptions);
        
            const isSpherical = faceIndex >= 0 && faceIndex <= 5;
            const chunkSizeUV = 1.0 / faceSize;
            const chunkLocationU = faceU * chunkSizeUV;
            const chunkLocationV = faceV * chunkSizeUV;
            
            // Normalize planetary configuration once for uniform access
            const pConfig = planetConfig || { 
                radius: 50000, 
                origin: { x: 0, y: 0, z: 0 }, 
                atmosphereHeight: 10000, 
                atmosphereSettings: {} 
            };
        
            const radius = pConfig.radius || 50000;
            const origin = pConfig.origin || { x: 0, y: 0, z: 0 };
        
            // Build defines - these MUST be set for textures to work
            const defines = {};
            
            if (cachedTextures.height) {
                defines.USE_HEIGHT_TEXTURE = true;
                console.log('[TerrainMaterialBuilder] USE_HEIGHT_TEXTURE enabled');
            }
            if (cachedTextures.normal) {
                defines.USE_NORMAL_TEXTURE = true;
                console.log('[TerrainMaterialBuilder] USE_NORMAL_TEXTURE enabled');
            }
            if (cachedTextures.tile) {
                defines.USE_TILE_TEXTURE = true;
                console.log('[TerrainMaterialBuilder] USE_TILE_TEXTURE enabled');
            }
        
            console.log('[TerrainMaterialBuilder] Defines:', defines);
        

        if (isSpherical) {
            console.log(`[TerrainMaterialBuilder] Face ${faceIndex} chunk (${faceU},${faceV}):`, {
                chunkLocation: { u: chunkLocationU, v: chunkLocationV },
                chunkSizeUV: chunkSizeUV,
                faceUVRange: {
                    minU: chunkLocationU,
                    maxU: chunkLocationU + chunkSizeUV,
                    minV: chunkLocationV,
                    maxV: chunkLocationV + chunkSizeUV
                }
            });
        }

        // =============================================
        // Build ALL uniforms
        // =============================================
        const uniforms = {
            // Aerial Perspective / Atmosphere
            transmittanceLUT: { value: options.transmittanceLUT || null },
            aerialPerspectiveEnabled: { value: options.aerialPerspectiveEnabled ?? 1.0 },
            planetCenter: { value: new THREE.Vector3(
                pConfig.origin?.x ?? 0,
                pConfig.origin?.y ?? 0,
                pConfig.origin?.z ?? 0
            )},
            atmospherePlanetRadius: { value: pConfig.radius || 50000 },
            atmosphereRadius: { value: (pConfig.radius || 50000) + (pConfig.atmosphereHeight || 10000) },
            atmosphereScaleHeightRayleigh: { value: pConfig.atmosphereSettings?.scaleHeightRayleigh ?? 800 },
            atmosphereScaleHeightMie: { value: pConfig.atmosphereSettings?.scaleHeightMie ?? 120 },
            atmosphereRayleighScattering: { value: pConfig.atmosphereSettings?.rayleighScattering?.clone() ?? new THREE.Vector3(5.5e-5, 13.0e-5, 22.4e-5) },
            atmosphereMieScattering: { value: pConfig.atmosphereSettings?.mieScattering ?? 21e-5 },
            atmosphereMieAnisotropy: { value: pConfig.atmosphereSettings?.mieAnisotropy ?? 0.8 },
            atmosphereSunIntensity: { value: pConfig.atmosphereSettings?.sunIntensity ?? 20.0 },
            
            // === BASIC CHUNK ===
            chunkOffset: { value: new THREE.Vector2(chunkOffsetX, chunkOffsetZ) },
            chunkSize: { value: chunkSize },
            chunkWidth: { value: chunkSize },
            chunkHeight: { value: chunkSize },
            maxTileTypes: { value: 256 },

            // === LOD SETTINGS ===
            lodLevel: { value: 0 },
            geometryLOD: { value: lod },
            splatLODBias: { value: 0.0 },
            macroLODBias: { value: 0.0 },
            detailFade: { value: 1.0 },
            enableSplatLayer: { value: 1.0 },
            enableMacroLayer: { value: 1.0 },
            enableClusteredLights: { value: 1.0 },
            useInstancing: { value: enableInstancing ? 1.0 : 0.0 },

            // === CHUNK TEXTURES ===
            heightTexture: { value: cachedTextures.height },
            normalTexture: { value: cachedTextures.normal },
            tileTexture: { value: cachedTextures.tile },
            splatDataMap: { value: cachedTextures.splatData },
            macroMaskTexture: { value: cachedTextures.macro },

            // === LOOKUP TABLES ===
            tileTypeLookup: { value: lookupTables.tileTypeLookup },
            macroTileTypeLookup: { value: lookupTables.macroTileTypeLookup },
            numVariantsTex: { value: lookupTables.numVariantsTex },

            // === ATLAS TEXTURES ===
            atlasTexture: { value: atlasTextures.micro },
            atlasTextureSize: {
                value: new THREE.Vector2(
                    atlasTextures.micro?.image?.width || atlasTextures.micro?.width || 1024,
                    atlasTextures.micro?.image?.height || atlasTextures.micro?.height || 1024
                )
            },
            level2AtlasTexture: { value: atlasTextures.macro1024 },
            level2AtlasTextureSize: {
                value: new THREE.Vector2(
                    atlasTextures.macro1024?.image?.width || atlasTextures.macro1024?.width || 1024,
                    atlasTextures.macro1024?.image?.height || atlasTextures.macro1024?.height || 1024
                )
            },

            // === MATERIAL SETTINGS ===
            macroScale: { value: 0.1 },
            level2Blend: { value: 0.7 },
            tileScale: { value: 1.0 },
            isFeature: { value: 0.0 },

            // === SEASON ===
            numSeasons: { value: 4 },
            currentSeason: { value: 0 },
            nextSeason: { value: 1 },
            seasonTransition: { value: 0.0 },
            
            // =============================================
            // SPHERICAL PROJECTION UNIFORMS (NEW!)
            // =============================================
            planetRadius: { value: radius },
            planetOrigin: { value: new THREE.Vector3(origin.x, origin.y, origin.z) },
            chunkFace: { value: isSpherical ? faceIndex : -1 },
            chunkLocation: { value: new THREE.Vector2(chunkLocationU, chunkLocationV) },
            chunkSizeUV: { value: chunkSizeUV },
            
            // Height displacement scale
            heightScale: { value: heightScale },
            
            // =============================================
            // ATLAS UV TRANSFORM (NEW!)
            // =============================================
            useAtlasMode: { value: useAtlasMode ? 1 : 0 },
            atlasUVOffset: { value: new THREE.Vector2(
                uvTransform?.offsetX || 0,
                uvTransform?.offsetY || 0
            )},
            atlasUVScale: { value: uvTransform?.scale || 1.0 },
        };

        // =============================================
        // Clone global uniforms from UniformManager
        // =============================================
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

        // =============================================
        // Pre-define vertex layout for WebGPU
        // =============================================
        let vertexLayout = null;
        if (apiName === 'webgpu') {
            vertexLayout = [
                { 
                    arrayStride: 12, 
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] 
                },
                { 
                    arrayStride: 12, 
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] 
                },
                { 
                    arrayStride: 8,  
                    stepMode: 'vertex', 
                    attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] 
                }
            ];
            if (enableInstancing) {
                vertexLayout.push(
                    { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }] },
                    { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] }
                );
            }
        }

        const material = new Material({
            name: 'TerrainMaterial',
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms,
            defines,  // CRITICAL: Pass defines here
            side: 'double',  // Changed from 'double' for proper backface culling
            depthTest: true,
            depthWrite: true,
            isInstanced: enableInstancing,
            vertexLayout: vertexLayout,
        });

        material._apiName = apiName;

        // Debug log
        console.log('[TerrainMaterialBuilder] Material created:', {
            height: `${cachedTextures.height?.width}x${cachedTextures.height?.height}`,
            spherical: isSpherical,
            face: faceIndex,
            chunkLocation: `(${chunkLocationU.toFixed(3)}, ${chunkLocationV.toFixed(3)})`,
            useAtlasMode: useAtlasMode
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
