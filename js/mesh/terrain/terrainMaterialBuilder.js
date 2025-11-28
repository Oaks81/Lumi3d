import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Material } from '../../renderer/resources/material.js';

export class TerrainMaterialBuilder {
    static _shaderBuilders = new Map();

    static async _loadShaderBuilders(apiName) {
        if (this._shaderBuilders.has(apiName)) {
            return this._shaderBuilders.get(apiName);
        }

        let builders;
        if (apiName === 'webgpu') {
            try {
                // Ensure these paths match your project structure
                const vertex = await import('./shaders/webgpu/terrainChunkVertexShaderBuilder.js');
                const fragment = await import('./shaders/webgpu/terrainChunkFragmentShaderBuilder.js');
                builders = {
                    buildTerrainChunkVertexShader: vertex.buildTerrainChunkVertexShader,
                    buildTerrainChunkFragmentShader: fragment.buildTerrainChunkFragmentShader
                };
            } catch (e) {
                console.error("Failed to load WebGPU shaders", e);
                throw e;
            }
        } else {
            // WebGL2 fallbacks
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
            // SPHERICAL PARAMS
            faceIndex = -1,
            faceU = 0, // This is likely integer ChunkX
            faceV = 0, // This is likely integer ChunkY
            faceSize = 16, // chunksPerFace (default 16)
            planetConfig = { radius: 50000, origin: new THREE.Vector3(0,0,0) },
            useAtlasMode = false,
            uvTransform = null
        } = options;

        let apiName = 'webgl2';
        if (backend && typeof backend.getAPIName === 'function') {
            apiName = backend.getAPIName();
        }

        const builders = await this._loadShaderBuilders(apiName);
        const vertexShader = builders.buildTerrainChunkVertexShader();
        const fragmentShader = builders.buildTerrainChunkFragmentShader({ maxLightIndices: 8192 });

        // === CALC SPHERICAL PROJECTION UNIFORMS ===
        let chunkLocation = new THREE.Vector2(0, 0);
        let chunkSizeUV = 1.0;

        if (faceIndex !== -1) {
            // Convert Integer Chunk Coordinates (e.g., 7, 8) to Face UVs (e.g., 0.4375, 0.5)
            // faceSize should be the number of chunks across a face (e.g., 16)
            const chunksPerFace = faceSize || 16; 
            const u = faceU / chunksPerFace; 
            const v = faceV / chunksPerFace;
            
            chunkLocation.set(u, v);
            chunkSizeUV = 1.0 / chunksPerFace;
            
            // Debug check (remove later)
            if (Math.random() < 0.001) {
               console.log(`Chunk Mat: Face ${faceIndex} (${faceU},${faceV}) -> UV ${u.toFixed(3)},${v.toFixed(3)} Scale ${chunkSizeUV}`);
            }
        }

        // Atlas Uniforms
        let finalAtlasUVOffset = new THREE.Vector2(0, 0);
        let finalAtlasUVScale = 1.0;
        let finalUseAtlasMode = useAtlasMode ? 1 : 0;

        if (useAtlasMode && uvTransform) {
            finalAtlasUVOffset.set(uvTransform.offsetX, uvTransform.offsetY);
            finalAtlasUVScale = uvTransform.scale;
        }

        // Build Uniforms
        const uniforms = {
            // === PLANET PROJECTION ===
            planetRadius: { value: planetConfig.radius },
            planetOrigin: { value: planetConfig.origin },
            chunkFace: { value: faceIndex },
            chunkLocation: { value: chunkLocation }, // <--- CRITICAL FOR VERTEX SHADER
            chunkSizeUV: { value: chunkSizeUV },     // <--- CRITICAL FOR VERTEX SHADER
            
            // Standard
            chunkOffset: { value: new THREE.Vector2(chunkOffsetX, chunkOffsetZ) },
            chunkSize: { value: chunkSize },
            
            // Textures
            heightTexture: { value: cachedTextures.height },
            normalTexture: { value: cachedTextures.normal },
            tileTexture: { value: cachedTextures.tile },
            splatDataMap: { value: cachedTextures.splatData },
            
            // Lookups & Globals
            tileTypeLookup: { value: lookupTables.tileTypeLookup },
            atlasTexture: { value: atlasTextures.micro },
            level2AtlasTexture: { value: atlasTextures.macro1024 },
            
            // Atlas System
            atlasUVOffset: { value: finalAtlasUVOffset },
            atlasUVScale: { value: finalAtlasUVScale },
            useAtlasMode: { value: finalUseAtlasMode },
        };

        // Clone Global Uniforms
        if (uniformManager && uniformManager.uniforms) {
            const keys = [
                'modelMatrix', 'viewMatrix', 'projectionMatrix',
                'cameraPosition', 'sunLightDirection', 'sunLightColor', 'sunLightIntensity',
                'ambientLightColor', 'fogColor', 'fogDensity'
            ];
            for (const key of keys) {
                if (uniformManager.uniforms[key]) {
                    uniforms[key] = { value: this._cloneUniformValue(uniformManager.uniforms[key].value) };
                }
            }
        }

        // WebGPU Layout (Matches VertexInput struct in shader)
        let vertexLayout = null;
        if (apiName === 'webgpu') {
            vertexLayout = [
                // Loc 0: Position (3x float32)
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, 
                // Loc 1: Normal (3x float32)
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }, 
                // Loc 2: UV (2x float32)
                { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }  
            ];
        }

        const material = new Material({
            name: 'TerrainMaterial',
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms,
            side: 'front', // Or 'double' if you are inside the sphere
            depthTest: true,
            depthWrite: true,
            vertexLayout: vertexLayout,
            defines: {
                USE_ATLAS_MODE: finalUseAtlasMode
            }
        });

        material._apiName = apiName;
        return material;
    }

    static _cloneUniformValue(value) {
        if (value && value.clone) return value.clone();
        if (Array.isArray(value)) return [...value];
        return value;
    }
}