import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { CloudRenderer } from './cloudRenderer.js';
import { Material } from '../resources/material.js';

export class WebGPUCloudRenderer extends CloudRenderer {
    async initialize() {
        await super.initialize();

        this.material = new Material({
            name: 'VolumetricClouds_WebGPU',
            vertexShader: this._getVertexShader(),
            fragmentShader: this._getFragmentShader(),
            bindGroupLayoutSpec: [
                {
                    label: 'MatricesAndParams',
                    entries: [
                        { binding: 0, visibility: 'vertex|fragment', buffer: { type: 'uniform' }, name: 'matrixUniforms' },
                        { binding: 1, visibility: 'fragment', buffer: { type: 'uniform' }, name: 'cloudParams' }
                    ]
                },
                {
                    label: 'FroxelResources',
                    entries: [
                        { binding: 0, visibility: 'fragment', texture: { sampleType: 'float' }, name: 'froxelTexture' },
                        { binding: 1, visibility: 'fragment', sampler: { type: 'filtering' }, name: 'froxelSampler' }
                    ]
                }
            ],
            uniforms: {
                matrixUniforms: { value: new Float32Array(32) },
                cloudParams: { value: new Float32Array(32) },
                froxelTexture: { value: this.froxelGrid.getTexture() },
                froxelSampler: { value: 'linear' },
                cloudBaseColor: { value: new Float32Array([0.9, 0.95, 1.0, 1.0]) }
            },
            transparent: true,
            // Keep depth test on so the pipeline matches the render pass depth attachment
            depthTest: true,
            depthWrite: false,
            side: 'double'
        });

        if (this.backend.compileShader) {
            this.backend.compileShader(this.material);
        }
    }

    render(camera, environmentState, uniformManager) {
        if (!this.enabled || !this.initialized || !this.material) return;

        const common = this.getCommonUniformValues(camera, environmentState, uniformManager);
        this._writeUniformBuffers(common);
        this.material.uniforms.froxelTexture.value = common.froxelTexture;

        this.backend.draw(this.fullscreenGeometry, this.material);
    }

    _writeUniformBuffers(common) {
        const m = this.material.uniforms.matrixUniforms.value;
        m.set(common.viewMatrix.elements, 0);
        m.set(common.invViewProjMatrix.elements, 16);

        const p = this.material.uniforms.cloudParams.value;
        p[0] = common.cameraPosition.x;
        p[1] = common.cameraPosition.y;
        p[2] = common.cameraPosition.z;
        p[3] = common.time;

        p[4] = common.sunDirection.x;
        p[5] = common.sunDirection.y;
        p[6] = common.sunDirection.z;
        p[7] = common.maxDistance;

        p[8] = common.gridScale.x;
        p[9] = common.gridScale.y;
        p[10] = common.gridScale.z;
        p[11] = common.numSteps;

        p[12] = common.gridDimensions.x;
        p[13] = common.gridDimensions.y;
        p[14] = common.gridDimensions.z;
        p[15] = common.fogDensity;

        p[16] = common.cloudLowCoverage;
        p[17] = common.cloudHighCoverage;
        p[18] = common.cloudAnisotropy;
        p[19] = 0;
        p[20] = 0.92; // cloud tint r
        p[21] = 0.96; // cloud tint g
        p[22] = 1.0;  // cloud tint b
        p[23] = 1.0;
    }

    _getVertexShader() {
        return /* wgsl */`
struct MatrixUniforms {
    viewMatrix : mat4x4<f32>,
    invViewProjMatrix : mat4x4<f32>,
};

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@group(0) @binding(0) var<uniform> matrices : MatrixUniforms;

@vertex
fn main(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = vec4<f32>(input.position.xy, 0.9999, 1.0);
    output.uv = input.position.xy * 0.5 + 0.5;
    return output;
}`;
    }

    _getFragmentShader() {
        return /* wgsl */`
struct MatrixUniforms {
    viewMatrix : mat4x4<f32>,
    invViewProjMatrix : mat4x4<f32>,
};

struct CloudParams {
    cameraPosition : vec3<f32>,
    time : f32,
    sunDirection : vec3<f32>,
    maxDistance : f32,
    gridScale : vec3<f32>,
    numSteps : f32,
    gridDimensions : vec3<f32>,
    fogDensity : f32,
    cloudLow : f32,
    cloudHigh : f32,
    cloudAnisotropy : f32,
    _pad0 : f32,
    cloudTint : vec4<f32>
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@group(0) @binding(0) var<uniform> matrices : MatrixUniforms;
@group(0) @binding(1) var<uniform> params : CloudParams;
@group(1) @binding(0) var froxelTexture : texture_2d<f32>;
@group(1) @binding(1) var froxelSampler : sampler;

// Packed tint in params.cloudTint

const PI : f32 = 3.14159265359;

fn getRayDirection(uv : vec2<f32>) -> vec3<f32> {
    let ndc = vec4<f32>(uv * 2.0 - 1.0, 1.0, 1.0);
    var world = matrices.invViewProjMatrix * ndc;
    world = world / world.w;
    return normalize(world.xyz - params.cameraPosition);
}

fn sampleFroxel(viewPos : vec3<f32>) -> vec4<f32> {
    let zN = clamp(-viewPos.z / params.maxDistance, 0.0, 0.999);
    let xN = clamp(viewPos.x / params.gridScale.x * 0.5 + 0.5, 0.0, 0.999);
    let yN = clamp(viewPos.y / params.gridScale.y * 0.5 + 0.5, 0.0, 0.999);

    let idx = vec3<f32>(xN, yN, zN) * (params.gridDimensions - vec3<f32>(1.0));
    let zi = floor(idx.z + 0.5);
    let yi = floor(idx.y + 0.5);
    let xi = floor(idx.x + 0.5);

    let u = (xi + 0.5) / params.gridDimensions.x;
    let v = (yi + zi * params.gridDimensions.y + 0.5) /
            (params.gridDimensions.y * params.gridDimensions.z);
    return textureSample(froxelTexture, froxelSampler, vec2<f32>(u, v));
}

fn hgPhase(cosTheta : f32, g : f32) -> f32 {
    let g2 = g * g;
    let denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (1.0 - g2) / (4.0 * PI * max(denom, 0.001));
}

@fragment
fn main(input : VertexOutput) -> @location(0) vec4<f32> {
    let rayDir = getRayDirection(input.uv);
    let steps = max(u32(params.numSteps), 1u);
    let stepSize = params.maxDistance / f32(steps);

    var accum = vec3<f32>(0.0);
    var trans = 1.0;

    let cosSun = dot(rayDir, params.sunDirection);
    let cloudPhase = hgPhase(cosSun, params.cloudAnisotropy);
    let fogPhase = 1.0 / (4.0 * PI);

    for (var i : u32 = 0u; i < 128u; i = i + 1u) {
        if (i >= steps) { break; }
        let t = (f32(i) + 0.5) * stepSize;
        let samplePos = params.cameraPosition + rayDir * t;
        let viewPos = (matrices.viewMatrix * vec4<f32>(samplePos, 1.0)).xyz;
        let cell = sampleFroxel(viewPos);

        let fog = params.fogDensity * cell.r;
        let cldLow = cell.g * params.cloudLow;
        let cldHigh = cell.b * params.cloudHigh;
        let density = fog + cldLow + cldHigh;
        let mask = select(0.0, 1.0, density > 0.00001);
        let phase = mix(fogPhase, cloudPhase, clamp(cldLow + cldHigh, 0.0, 1.0));
        let scatter = vec3<f32>(density * phase) * (0.65 + 0.6 * cell.a) * params.cloudTint.rgb * mask;
        accum += trans * scatter * stepSize;
        trans *= exp(-density * stepSize * 1.25 * mask);
    }

    let alpha = clamp(1.0 - trans, 0.0, 1.0);
    return vec4<f32>(accum, alpha);
}`;
    }
}
