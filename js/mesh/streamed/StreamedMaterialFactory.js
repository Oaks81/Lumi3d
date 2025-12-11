import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Material } from '../../renderer/resources/material.js';
import { buildStreamedChunkVertexShader } from './buildStreamedChunkVertexShader.js';
import { buildStreamedChunkFragmentShader } from './buildStreamedChunkFragmentShader.js';

/**
 * Factory for creating streamed feature materials that work with both backends.
 */
export class StreamedMaterialFactory {
    /**
     * @param {import('../../renderer/backend/backend.js').Backend} backend
     * @param {Object} uniformManager
     */
    constructor(backend, uniformManager) {
        this.backend = backend;
        this.uniformManager = uniformManager;
        this.apiName = backend?.getAPIName?.() || 'webgl2';
    }

    /**
     * Create a backend-specific material for a streamed feature type.
     * @param {string} typeName
     * @param {Object} config
     * @param {number} chunkSize
     * @returns {Promise<Material>}
     */
    async createMaterial(typeName, config, chunkSize) {
        const isWebGPU = this.apiName === 'webgpu';
        const shaders = isWebGPU ? this._buildWebGPUShaders() : this._buildWebGLShaders();

        const material = new Material({
            name: `StreamedFeature_${typeName}`,
            vertexShader: shaders.vertexShader,
            fragmentShader: shaders.fragmentShader,
            uniforms: this._createBaseUniforms(config, chunkSize),
            side: 'double',
            transparent: true,
            depthWrite: false,
            depthTest: true,
            vertexLayout: this._getVertexLayout(),
            bindGroupLayoutSpec: isWebGPU ? this._getBindGroupLayoutSpec() : null
        });

        if (this.uniformManager) {
            this.uniformManager.registerMaterial(material);
        }

        return material;
    }

    _createBaseUniforms(config, chunkSize) {
        return {
            viewMatrix: { value: new THREE.Matrix4() },
            projectionMatrix: { value: new THREE.Matrix4() },
            u_noiseSeed: { value: config.noiseSeed || 0 },
            u_chunkOffset: { value: new THREE.Vector2() },
            u_chunkSize: { value: chunkSize },
            u_gridSpacing: { value: config.gridSpacing || 1 },
            u_instancesPerRow: { value: Math.ceil(chunkSize / (config.gridSpacing || 1)) },
            u_maxDistance: { value: config.maxRenderDistance || (config.streamRadius || 100) * 0.9 },
            u_taperStartDistance: { value: config.taperStartDistance || (config.streamRadius || 100) * 0.5 },
            u_taperEndDistance: { value: config.taperEndDistance || (config.streamRadius || 100) * 0.85 },
            u_minCullDistance: { value: config.minCullDistance || 2 },
            u_density: { value: config.density || 0.8 },
            u_waterLevel: { value: 8.0 },
            u_cameraPosition: { value: new THREE.Vector3() },
            u_time: { value: 0 },
            u_windStrength: { value: config.windStrength || 0.05 },
            plantColor: { value: config.color || new THREE.Color(0.4, 0.7, 0.3) },
            u_heightTexture: { value: null },
            u_tileTypeTexture: { value: null },
            cameraUniforms: { value: new Float32Array(36) },
            featureParams: { value: new Float32Array(16) }
        };
    }

    _getVertexLayout() {
        return [
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
        ];
    }

    _getBindGroupLayoutSpec() {
        return [
            {
                label: 'StreamedFeatureCamera',
                entries: [
                    { binding: 0, name: 'cameraUniforms', visibility: 'vertex', buffer: { type: 'uniform' } },
                    { binding: 1, name: 'featureParams', visibility: 'vertex|fragment', buffer: { type: 'uniform' } }
                ]
            },
            {
                label: 'StreamedFeatureTextures',
                entries: [
                    { binding: 0, name: 'u_heightTexture', visibility: 'vertex|fragment', texture: { sampleType: 'unfilterable-float' } },
                    { binding: 1, name: 'u_tileTypeTexture', visibility: 'vertex|fragment', texture: { sampleType: 'unfilterable-float' } },
                    // Unfilterable textures require a non-filtering sampler
                    { binding: 2, name: 'featureSampler', visibility: 'vertex|fragment', sampler: { type: 'non-filtering' } }
                ]
            }
        ];
    }

    _buildWebGLShaders() {
        return {
            vertexShader: buildStreamedChunkVertexShader(),
            fragmentShader: buildStreamedChunkFragmentShader()
        };
    }

    _buildWebGPUShaders() {
        const vertexShader = `
struct CameraUniforms {
    viewMatrix : mat4x4<f32>,
    projectionMatrix : mat4x4<f32>,
    cameraPosition : vec4<f32>,
};

struct FeatureParams {
    chunkOffset_size_spacing : vec4<f32>, // offset.x, offset.y, chunkSize, gridSpacing
    distances : vec4<f32>,                // instancesPerRow, maxDistance, taperStart, taperEnd
    densityWaterNoiseTime : vec4<f32>,    // density, waterLevel, noiseSeed, time
    windColor : vec4<f32>,                // windStrength, plantColor.r, plantColor.g, plantColor.b
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(0) @binding(1) var<uniform> params : FeatureParams;
@group(1) @binding(0) var heightTexture : texture_2d<f32>;
@group(1) @binding(1) var tileTypeTexture : texture_2d<f32>;
@group(1) @binding(2) var featureSampler : sampler;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPos : vec3<f32>,
    @location(1) alpha : f32,
    @location(2) viewPos : vec3<f32>,
};

fn hash(x : f32, y : f32, seed : f32) -> f32 {
    return fract(sin(dot(vec3<f32>(x, y, seed), vec3<f32>(12.9898, 78.233, 45.164))) * 43758.5453);
}

fn smoothTaper(distance : f32, start : f32, endVal : f32) -> f32 {
    if (distance < start) {
        return 1.0;
    }
    if (distance > endVal) {
        return 0.0;
    }
    let t = (distance - start) / (endVal - start);
    return 1.0 - smoothstep(0.0, 1.0, t);
}

fn isCulledByFrustum(worldPos : vec3<f32>, radius : f32) -> bool {
    let clipPos = camera.projectionMatrix * camera.viewMatrix * vec4<f32>(worldPos, 1.0);
    let margin = radius * clipPos.w;
    return (clipPos.x < -clipPos.w - margin || clipPos.x > clipPos.w + margin ||
            clipPos.y < -clipPos.w - margin || clipPos.y > clipPos.w + margin ||
            clipPos.z < -clipPos.w - margin || clipPos.z > clipPos.w + margin);
}

@vertex
fn main(input : VertexInput, @builtin(instance_index) instanceIndex : u32) -> VertexOutput {
    var output : VertexOutput;

    let chunkOffset = params.chunkOffset_size_spacing.xy;
    let chunkSize = params.chunkOffset_size_spacing.z;
    let gridSpacing = params.chunkOffset_size_spacing.w;

    let instancesPerRow = params.distances.x;
    let maxDistance = params.distances.y;
    let taperStart = params.distances.z;
    let taperEnd = params.distances.w;

    let density = params.densityWaterNoiseTime.x;
    let waterLevel = params.densityWaterNoiseTime.y;
    let noiseSeed = params.densityWaterNoiseTime.z;
    let time = params.densityWaterNoiseTime.w;

    let windStrength = params.windColor.x;

    let gridX = f32(instanceIndex % u32(instancesPerRow));
    let gridZ = f32(instanceIndex / u32(instancesPerRow));

    let jitterX = hash(gridX, gridZ, 0.1 + noiseSeed) * gridSpacing * 0.8;
    let jitterZ = hash(gridX, gridZ, 0.2 + noiseSeed) * gridSpacing * 0.8;

    let worldXZ = chunkOffset + vec2<f32>(
        gridX * gridSpacing + jitterX,
        gridZ * gridSpacing + jitterZ
    );

    let cameraXZ = camera.cameraPosition.xz;
    let distanceToCamera = distance(worldXZ, cameraXZ);

    let randomOffset = hash(gridX, gridZ, 0.5 + noiseSeed) * 3.0;
    if (distanceToCamera > maxDistance + randomOffset) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let cullMargin = gridSpacing * 1.5;
    let cullDistance = maxDistance + hash(gridX, gridZ, 0.5 + noiseSeed) * cullMargin;
    if (distanceToCamera > cullDistance) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let distanceAlpha = smoothTaper(distanceToCamera, taperStart, taperEnd);
    if (distanceAlpha <= 0.01) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let densityFalloff = mix(1.0, 0.3, clamp((distanceToCamera - taperStart) / (maxDistance - taperStart), 0.0, 1.0));
    let effectiveDensity = density * densityFalloff;
    if (hash(gridX, gridZ, 0.3 + noiseSeed) > effectiveDensity) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let localXZ = worldXZ - chunkOffset;
    let texUv = clamp(localXZ / chunkSize, vec2<f32>(0.001, 0.001), vec2<f32>(0.999, 0.999));
    let terrainHeight = textureSampleLevel(heightTexture, featureSampler, texUv, 0.0).r;

    if (terrainHeight <= waterLevel + 0.1) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let worldPosHeight = vec3<f32>(worldXZ.x, terrainHeight, worldXZ.y);
    if (isCulledByFrustum(worldPosHeight, 2.0)) {
        output.clipPosition = vec4<f32>(2.0, 2.0, 2.0, 0.0);
        return output;
    }

    let rotation = hash(gridX, gridZ, 0.4 + noiseSeed) * 6.2831853;
    let c = cos(rotation);
    let s = sin(rotation);

    let scaleMultiplier = mix(1.0, 0.85, clamp((distanceToCamera - taperStart) / (maxDistance - taperStart), 0.0, 1.0));
    let localPos = input.position * scaleMultiplier;

    let rotatedPos = vec3<f32>(
        localPos.x * c - localPos.z * s,
        localPos.y,
        localPos.x * s + localPos.z * c
    );

    let windPhase = time + (worldXZ.x * 0.1 + worldXZ.y * 0.1);
    let windSway = sin(windPhase) * cos(windPhase * 0.7) * windStrength;
    let swayWeight = clamp(localPos.y / 0.8, 0.0, 1.0);

    let worldPos = vec3<f32>(
        worldXZ.x + rotatedPos.x + windSway * swayWeight,
        terrainHeight + rotatedPos.y,
        worldXZ.y + rotatedPos.z
    );

    let viewPos = camera.viewMatrix * vec4<f32>(worldPos, 1.0);
    output.viewPos = viewPos.xyz;
    output.worldPos = worldPos;
    output.alpha = distanceAlpha;
    output.clipPosition = camera.projectionMatrix * viewPos;
    return output;
}
`;

        const fragmentShader = `
struct CameraUniforms {
    viewMatrix : mat4x4<f32>,
    projectionMatrix : mat4x4<f32>,
    cameraPosition : vec4<f32>,
};

struct FeatureParams {
    chunkOffset_size_spacing : vec4<f32>,
    distances : vec4<f32>,
    densityWaterNoiseTime : vec4<f32>,
    windColor : vec4<f32>,
};

@group(0) @binding(1) var<uniform> params : FeatureParams;

struct FragmentInput {
    @location(0) worldPos : vec3<f32>,
    @location(1) alpha : f32,
    @location(2) viewPos : vec3<f32>,
};

@fragment
fn main(input : FragmentInput) -> @location(0) vec4<f32> {
    if (input.alpha < 0.01) {
        discard;
    }

    let normal = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
    let diffuse = max(0.4, dot(normal, lightDir));

    let plantColor = vec3<f32>(params.windColor.y, params.windColor.z, params.windColor.w);
    let litColor = plantColor * diffuse;

    let dist = length(input.viewPos);
    let fogFactor = smoothstep(60.0, 100.0, dist);
    let fogColor = vec3<f32>(0.7, 0.8, 0.9);
    let finalColor = mix(litColor, fogColor, fogFactor);

    return vec4<f32>(finalColor, input.alpha);
}
`;

        return { vertexShader, fragmentShader };
    }
}
