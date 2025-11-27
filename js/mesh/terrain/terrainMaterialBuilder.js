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
            faceSize = 1.0,
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

        // Calculate Atlas Uniforms
        let finalAtlasUVOffset = new THREE.Vector2(0, 0);
        let finalAtlasUVScale = 1.0;
        let finalUseAtlasMode = useAtlasMode ? 1 : 0;

        if (useAtlasMode && uvTransform) {
            finalAtlasUVOffset.set(uvTransform.offsetX, uvTransform.offsetY);
            finalAtlasUVScale = uvTransform.scale;
        }

        // Build Uniforms
        const uniforms = {
            // Planet
            planetRadius: { value: planetConfig.radius },
            planetOrigin: { value: planetConfig.origin },
            chunkFace: { value: faceIndex },
            
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

        // Clone Global Uniforms (Lights, Camera, etc) from UniformManager
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

        // WebGPU Layout
        let vertexLayout = null;
        if (apiName === 'webgpu') {
            vertexLayout = [
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, // pos
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }, // norm
                { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }  // uv
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