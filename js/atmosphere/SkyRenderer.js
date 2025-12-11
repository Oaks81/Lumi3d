import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Geometry } from '../renderer/resources/geometry.js';
import { Material } from '../renderer/resources/material.js';

export class SkyRenderer {
    constructor(backend, atmosphereLUT) {
        this.backend = backend;
        this.atmosphereLUT = atmosphereLUT;
        this.enabled = true;
        this.numSamples = 16;
        this.initialized = false;
        this.skyMaterial = null;
        this.fullscreenGeometry = null;
    }

    async initialize() {
        if (!this.backend) {
            console.warn('[SkyRenderer] No backend provided');
            return;
        }

        const apiName = this.backend.getAPIName?.() || 'webgl2';

        if (apiName === 'webgpu') {
            await this._initializeWebGPU();
        } else {
            await this._initializeWebGL2();
        }

        this.initialized = true;
        console.log('Sky renderer initialized');
    }

    async _initializeWebGPU() {
        this.vertexWGSL = this._getSkyVertexWGSL();
        this.fragmentWGSL = this._getSkyFragmentWGSL();
        this.fullscreenGeometry = this._createFullscreenTriangle();
        this.skyMaterial = new Material({
            name: 'SkyRenderer_WebGPU',
            vertexShader: this.vertexWGSL,
            fragmentShader: this.fragmentWGSL,
            bindGroupLayoutSpec: [
                {
                    label: 'SkyUniforms',
                    entries: [
                        { binding: 0, visibility: 'vertex|fragment', buffer: { type: 'uniform' }, name: 'skyUniforms' },
                        { binding: 1, visibility: 'fragment', buffer: { type: 'uniform' }, name: 'invViewProj' }
                    ]
                },
                {
                    label: 'Transmittance',
                    entries: [
                        { binding: 0, visibility: 'fragment', texture: { sampleType: 'float' }, name: 'transmittanceLUT' },
                        { binding: 1, visibility: 'fragment', sampler: { type: 'filtering' }, name: 'transmittanceSampler' }
                    ]
                }
            ],
            uniforms: {
                skyUniforms: { value: new Float32Array(24) },
                invViewProj: { value: new Float32Array(16) },
                transmittanceLUT: { value: this.atmosphereLUT?.transmittanceLUT || null },
                transmittanceSampler: { value: 'linear' }
            },
            vertexLayout: [], // vertex_index based fullscreen triangle
            depthTest: true,   // ensure pipeline matches render pass depth attachment
            depthWrite: false,
            side: 'double'
        });
        if (this.backend.compileShader) {
            this.backend.compileShader(this.skyMaterial);
        }
    }

    async _initializeWebGL2() {
        this.vertexShader = this._getSkyVertexGLSL();
        this.fragmentShader = this._getSkyFragmentGLSL();

        this.fullscreenGeometry = this._createFullscreenTriangle();
        this.skyMaterial = new Material({
            name: 'SkyRenderer_WebGL2',
            vertexShader: this.vertexShader,
            fragmentShader: this.fragmentShader,
            uniforms: {
                cameraPosition: { value: new THREE.Vector3() },
                viewerAltitude: { value: 0.0 },
                sunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                planetCenter: { value: new THREE.Vector3(0, 0, 0) },
                planetRadius: { value: 50000 },
                atmosphereRadius: { value: 60000 },
                scaleHeightRayleigh: { value: 800 },
                scaleHeightMie: { value: 120 },
                mieAnisotropy: { value: 0.8 },
                rayleighScattering: { value: new THREE.Vector3(5.5e-5, 13.0e-5, 22.4e-5) },
                mieScattering: { value: 21e-5 },
                sunIntensity: { value: 20.0 },
                numSamples: { value: this.numSamples },
                hasLUT: { value: 0.0 },
                invViewProjMatrix: { value: new THREE.Matrix4() },
                transmittanceLUT: { value: this.atmosphereLUT?.transmittanceLUT || null },
            },
            depthTest: false,
            depthWrite: false,
            side: 'double'
        });

        if (this.backend.compileShader) {
            this.backend.compileShader(this.skyMaterial);
        }
    }

    render(camera, atmosphereSettings, sunDir, uniformManager) {
        if (!this.enabled || !this.initialized) return;

        const apiName = this.backend.getAPIName?.() || 'webgl2';

        if (apiName === 'webgpu') {
            this._renderWebGPU(camera, atmosphereSettings, sunDir, uniformManager);
        } else {
            this._renderWebGL2(camera, atmosphereSettings, sunDir, uniformManager);
        }
    }

    _renderWebGPU(camera, atmosphereSettings, sunDir, uniformManager) {
        if (!this.skyMaterial || !this.fullscreenGeometry) return;
        // If LUT not ready, render a simple gradient to avoid stalls/crashes
        const hasLUT = !!(this.atmosphereLUT?.transmittanceLUT && this.atmosphereLUT.transmittanceLUT._gpuTexture);

        const u = this.skyMaterial.uniforms.skyUniforms.value;
        const planetCenter = uniformManager?.uniforms?.planetCenter?.value || new THREE.Vector3();
        const planetRadius = atmosphereSettings?.planetRadius ??
            uniformManager?.uniforms?.atmospherePlanetRadius?.value ?? 50000;
        const atmosphereRadius = atmosphereSettings?.atmosphereRadius ??
            uniformManager?.uniforms?.atmosphereRadius?.value ?? planetRadius + 10000;
        const rayleigh = atmosphereSettings?.rayleighScattering ??
            uniformManager?.uniforms?.atmosphereRayleighScattering?.value ??
            new THREE.Vector3(5.5e-6, 13.0e-6, 22.4e-6);
        const mieScattering = atmosphereSettings?.mieScattering ??
            uniformManager?.uniforms?.atmosphereMieScattering?.value ?? 21e-6;
        const mieAnisotropy = atmosphereSettings?.mieAnisotropy ??
            uniformManager?.uniforms?.atmosphereMieAnisotropy?.value ?? 0.758;
        const sunIntensity = atmosphereSettings?.sunIntensity ??
            uniformManager?.uniforms?.atmosphereSunIntensity?.value ?? 20.0;
        const scaleHeightR = atmosphereSettings?.scaleHeightRayleigh ??
            uniformManager?.uniforms?.atmosphereScaleHeightRayleigh?.value ?? 8000;
        const scaleHeightM = atmosphereSettings?.scaleHeightMie ??
            uniformManager?.uniforms?.atmosphereScaleHeightMie?.value ?? 1200;

        const sDir = (sunDir || uniformManager?.uniforms?.sunLightDirection?.value || new THREE.Vector3(0.5, 1.0, 0.3)).clone().normalize();

        // Pack uniforms (matches SkyUniforms in WGSL)
        u[0] = camera.position.x;
        u[1] = camera.position.y;
        u[2] = camera.position.z;
        u[3] = 0; // viewerAltitude (filled below)
        u[4] = sDir.x;
        u[5] = sDir.y;
        u[6] = sDir.z;
        u[7] = 0;
        u[8] = planetCenter.x;
        u[9] = planetCenter.y;
        u[10] = planetCenter.z;
        u[11] = planetRadius;
        u[12] = atmosphereRadius;
        u[13] = scaleHeightR;
        u[14] = scaleHeightM;
        u[15] = mieAnisotropy;
        u[16] = rayleigh.x;
        u[17] = rayleigh.y;
        u[18] = rayleigh.z;
        u[19] = mieScattering;
        u[20] = sunIntensity;
        u[21] = this.numSamples;
        u[22] = hasLUT ? 1.0 : 0.0;
        u[23] = 0;

        const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        const inv = this.skyMaterial.uniforms.invViewProj.value;
        inv.set(viewProj.clone().invert().elements);

        const viewerAlt = Math.max(0, camera.position.length() - planetRadius);
        u[3] = viewerAlt;

        this.skyMaterial.uniforms.transmittanceLUT.value = hasLUT ? this.atmosphereLUT.transmittanceLUT : null;
        this.backend.draw(this.fullscreenGeometry, this.skyMaterial);
    }

    _renderWebGL2(camera, atmosphereSettings, sunDir, uniformManager) {
        if (!this.skyMaterial || !this.fullscreenGeometry) {
            console.warn('[SkyRenderer] WebGL2 resources missing');
            return;
        }

        const uniforms = this.skyMaterial.uniforms;
        const uManager = uniformManager || {};
        const global = uManager.uniforms || {};

        uniforms.cameraPosition.value.copy(camera.position);

        const planetCenter = global.planetCenter?.value || new THREE.Vector3(0, 0, 0);
        uniforms.planetCenter.value.copy(planetCenter);

        const planetRadius = atmosphereSettings?.planetRadius ??
            global.atmospherePlanetRadius?.value ??
            50000;
        uniforms.planetRadius.value = planetRadius;
        uniforms.atmosphereRadius.value = atmosphereSettings?.atmosphereRadius ??
            global.atmosphereRadius?.value ??
            planetRadius + (atmosphereSettings?.atmosphereHeight ?? 10000);

        uniforms.scaleHeightRayleigh.value = atmosphereSettings?.scaleHeightRayleigh ?? global.atmosphereScaleHeightRayleigh?.value ?? 8000;
        uniforms.scaleHeightMie.value = atmosphereSettings?.scaleHeightMie ?? global.atmosphereScaleHeightMie?.value ?? 1200;
        uniforms.rayleighScattering.value.copy(
            atmosphereSettings?.rayleighScattering ?? global.atmosphereRayleighScattering?.value ?? new THREE.Vector3(5.5e-6, 13.0e-6, 22.4e-6)
        );
        uniforms.mieScattering.value = atmosphereSettings?.mieScattering ?? global.atmosphereMieScattering?.value ?? 21e-6;
        uniforms.mieAnisotropy.value = atmosphereSettings?.mieAnisotropy ?? global.atmosphereMieAnisotropy?.value ?? 0.758;
        uniforms.sunIntensity.value = atmosphereSettings?.sunIntensity ?? global.atmosphereSunIntensity?.value ?? 20.0;
        uniforms.numSamples.value = this.numSamples;

        const sunDirValue = (sunDir || global.sunLightDirection?.value || new THREE.Vector3(0.5, 1.0, 0.3)).clone().normalize();
        uniforms.sunDirection.value.copy(sunDirValue);

        const sunStrength = global.sunLightIntensity?.value ?? 1.0;
        const baseSunIntensity = atmosphereSettings?.sunIntensity ?? global.atmosphereSunIntensity?.value ?? 20.0;
        uniforms.sunIntensity.value = baseSunIntensity * sunStrength;

        const hasLUT = !!(this.atmosphereLUT?.transmittanceLUT);
        uniforms.hasLUT.value = hasLUT ? 1.0 : 0.0;
        uniforms.transmittanceLUT.value = hasLUT ? this.atmosphereLUT.transmittanceLUT : null;

        const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        uniforms.invViewProjMatrix.value.copy(viewProj).invert();

        const viewerAlt = global.viewerAltitude?.value ??
            Math.max(0, camera.position.length() - planetRadius);
        uniforms.viewerAltitude.value = viewerAlt;

        this.backend.draw(this.fullscreenGeometry, this.skyMaterial);
    }

    _getSkyVertexWGSL() {
        return `
struct SkyUniforms {
    cameraPosition: vec3<f32>,
    viewerAltitude: f32,
    sunDirection: vec3<f32>,
    _pad0: f32,
    planetCenter: vec3<f32>,
    planetRadius: f32,
    atmosphereRadius: f32,
    scaleHeightRayleigh: f32,
    scaleHeightMie: f32,
    mieAnisotropy: f32,
    rayleighScattering: vec3<f32>,
    mieScattering: f32,
    sunIntensity: f32,
    numSamples: f32,
    hasLUT: f32,
    _pad2: f32,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: SkyUniforms;
@group(0) @binding(1) var<uniform> invViewProjMatrix: mat4x4<f32>;

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    let pos = positions[vertexIndex];
    output.position = vec4<f32>(pos, 0.9999, 1.0);
    output.uv = pos * 0.5 + 0.5;
    return output;
}
`;
    }

    _getSkyFragmentWGSL() {
        return `
struct SkyUniforms {
    cameraPosition: vec3<f32>,
    viewerAltitude: f32,
    sunDirection: vec3<f32>,
    _pad0: f32,
    planetCenter: vec3<f32>,
    planetRadius: f32,
    atmosphereRadius: f32,
    scaleHeightRayleigh: f32,
    scaleHeightMie: f32,
    mieAnisotropy: f32,
    rayleighScattering: vec3<f32>,
    mieScattering: f32,
    sunIntensity: f32,
    numSamples: f32,
    hasLUT: f32,
    _pad2: f32,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: SkyUniforms;
@group(0) @binding(1) var<uniform> invViewProjMatrix: mat4x4<f32>;
@group(1) @binding(0) var transmittanceLUT: texture_2d<f32>;
@group(1) @binding(1) var transmittanceSampler: sampler;

const PI: f32 = 3.14159265359;

fn raySphereIntersect(origin: vec3<f32>, dir: vec3<f32>, center: vec3<f32>, radius: f32) -> vec2<f32> {
    let oc = origin - center;
    let a = dot(dir, dir);
    let b = 2.0 * dot(oc, dir);
    let c = dot(oc, oc) - radius * radius;
    let discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) {
        return vec2<f32>(-1.0, -1.0);
    }
    let sqrtD = sqrt(discriminant);
    let t1 = (-b - sqrtD) / (2.0 * a);
    let t2 = (-b + sqrtD) / (2.0 * a);
    return vec2<f32>(t1, t2);
}

fn rayleighPhase(cosTheta: f32) -> f32 {
    return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn miePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = (1.0 - g2);
    let denom = 4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / max(denom, 0.0001);
}

fn getTransmittanceUV(altitude: f32, cosTheta: f32) -> vec2<f32> {
    let H = sqrt(max(0.0, uniforms.atmosphereRadius * uniforms.atmosphereRadius - uniforms.planetRadius * uniforms.planetRadius));
    let rho = sqrt(max(0.0, (uniforms.planetRadius + altitude) * (uniforms.planetRadius + altitude) - uniforms.planetRadius * uniforms.planetRadius));
    let u = clamp(rho / max(H, 0.001), 0.0, 1.0);
    let r = uniforms.planetRadius + altitude;
    let dMin = uniforms.atmosphereRadius - r;
    let dMax = rho + H;
    let cosT = clamp(cosTheta, -1.0, 1.0);
    let d = dMin + (cosT * 0.5 + 0.5) * (dMax - dMin);
    let v = clamp((d - dMin) / max(dMax - dMin, 0.001), 0.0, 1.0);
    return vec2<f32>(u, v);
}

fn sampleTransmittance(altitude: f32, cosTheta: f32) -> vec3<f32> {
    let uv = getTransmittanceUV(altitude, cosTheta);
    return textureSample(transmittanceLUT, transmittanceSampler, uv).rgb;
}

fn getDensity(altitude: f32) -> vec2<f32> {
    let densityR = exp(-max(0.0, altitude) / uniforms.scaleHeightRayleigh);
    let densityM = exp(-max(0.0, altitude) / uniforms.scaleHeightMie);
    return vec2<f32>(densityR, densityM);
}

fn getRayDirection(uv: vec2<f32>) -> vec3<f32> {
    let ndc = vec4<f32>(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 1.0, 1.0);
    var worldPos = invViewProjMatrix * ndc;
    worldPos /= worldPos.w;
    return normalize(worldPos.xyz - uniforms.cameraPosition);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4<f32> {
    let rayDir = getRayDirection(input.uv);
    let rayOrigin = uniforms.cameraPosition;

    let planetHit = raySphereIntersect(rayOrigin, rayDir, uniforms.planetCenter, uniforms.planetRadius);
    let atmoHit = raySphereIntersect(rayOrigin, rayDir, uniforms.planetCenter, uniforms.atmosphereRadius);
    let atmoMask = select(0.0, 1.0, atmoHit.y >= 0.0);
    let planetMask = select(1.0, 0.0, planetHit.x > 0.0);

    let tStart = max(0.0, atmoHit.x) * atmoMask;
    let tEnd = atmoHit.y * atmoMask;
    let marchLength = max(tEnd - tStart, 0.0);

    let numSteps = i32(uniforms.numSamples);
    let stepSize = marchLength / max(uniforms.numSamples, 1.0);

    var inscatter = vec3<f32>(0.0);
    var transmittance = vec3<f32>(1.0);

    let cosTheta = dot(rayDir, uniforms.sunDirection);
    let phaseR = rayleighPhase(cosTheta);
    let phaseM = miePhase(cosTheta, uniforms.mieAnisotropy);

    for (var i: i32 = 0; i < numSteps; i++) {
        let t = tStart + (f32(i) + 0.5) * stepSize;
        let samplePos = rayOrigin + rayDir * t;
        let sampleAltitude = length(samplePos - uniforms.planetCenter) - uniforms.planetRadius;

        let sampleMask = select(0.0, 1.0, sampleAltitude >= 0.0);

        let density = getDensity(sampleAltitude);

        let upAtSample = normalize(samplePos - uniforms.planetCenter);
        let cosSunZenith = dot(uniforms.sunDirection, upAtSample);
        let sunVisibility = max(cosSunZenith, 0.0);
        let sunTransmittance = sampleTransmittance(sampleAltitude, cosSunZenith) * sunVisibility;

        let scatterR = uniforms.rayleighScattering * density.x * phaseR;
        let scatterM = vec3<f32>(uniforms.mieScattering * density.y * phaseM);

        let scatterContrib = (scatterR + scatterM) * sunTransmittance * sunVisibility * stepSize * sampleMask;
        inscatter += transmittance * scatterContrib;

        let extinctionR = uniforms.rayleighScattering * density.x * sampleMask;
        let extinctionM = vec3<f32>(uniforms.mieScattering * density.y * 1.1 * sampleMask);
        transmittance *= exp(-(extinctionR + extinctionM) * stepSize);
    }

    var skyColor = inscatter * uniforms.sunIntensity * atmoMask * planetMask;

    let altitudeFade = smoothstep(15000.0, 50000.0, uniforms.viewerAltitude);
    skyColor *= (1.0 - altitudeFade);

    // Gradient fallback to avoid flat white if LUT is missing or invalid
    let sunAlt = clamp(uniforms.sunDirection.y * 0.5 + 0.5, 0.0, 1.0);
    let horizonColor = mix(vec3<f32>(0.6, 0.7, 0.8), vec3<f32>(0.9, 0.6, 0.3), 1.0 - sunAlt);
    let zenithColor = mix(vec3<f32>(0.15, 0.25, 0.6), vec3<f32>(0.4, 0.5, 0.7), sunAlt);
    let gradT = pow(clamp(1.0 - input.uv.y, 0.0, 1.0), 2.0);
    let gradientSky = mix(zenithColor, horizonColor, gradT);

    // Always keep a gradient floor so the sky is never flat white
    skyColor = max(skyColor, gradientSky * (sunAlt + 0.25));

    // Simple tonemap to prevent blowout
    skyColor = skyColor / (skyColor + vec3<f32>(1.0));

    return vec4<f32>(skyColor, 1.0);
}
`;
    }

    _getSkyVertexGLSL() {
        return `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
    vec2 positions[3];
    positions[0] = vec2(-1.0, -1.0);
    positions[1] = vec2(3.0, -1.0);
    positions[2] = vec2(-1.0, 3.0);

    vec2 pos = positions[gl_VertexID];
    gl_Position = vec4(pos, 0.9999, 1.0);
    vUv = pos * 0.5 + 0.5;
}
`;
    }

    _getSkyFragmentGLSL() {
        return `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec3 cameraPosition;
uniform float viewerAltitude;
uniform vec3 sunDirection;
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float scaleHeightRayleigh;
uniform float scaleHeightMie;
uniform float mieAnisotropy;
uniform vec3 rayleighScattering;
uniform float mieScattering;
uniform float sunIntensity;
uniform int numSamples;
uniform mat4 invViewProjMatrix;
uniform float hasLUT;

uniform sampler2D transmittanceLUT;

const float PI = 3.14159265359;

vec2 raySphereIntersect(vec3 origin, vec3 dir, vec3 center, float radius) {
    vec3 oc = origin - center;
    float a = dot(dir, dir);
    float b = 2.0 * dot(oc, dir);
    float c = dot(oc, oc) - radius * radius;
    float discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) {
        return vec2(-1.0, -1.0);
    }
    float sqrtD = sqrt(discriminant);
    float t1 = (-b - sqrtD) / (2.0 * a);
    float t2 = (-b + sqrtD) / (2.0 * a);
    return vec2(t1, t2);
}

float rayleighPhase(float cosTheta) {
    return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
    float g2 = g * g;
    float num = (1.0 - g2);
    float denom = 4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / max(denom, 0.0001);
}

vec2 getTransmittanceUV(float altitude, float cosTheta) {
    float H = sqrt(max(0.0, atmosphereRadius * atmosphereRadius - planetRadius * planetRadius));
    float rho = sqrt(max(0.0, (planetRadius + altitude) * (planetRadius + altitude) - planetRadius * planetRadius));
    float u = clamp(rho / max(H, 0.001), 0.0, 1.0);
    float r = planetRadius + altitude;
    float dMin = atmosphereRadius - r;
    float dMax = rho + H;
    float cosT = clamp(cosTheta, -1.0, 1.0);
    float d = dMin + (cosT * 0.5 + 0.5) * (dMax - dMin);
    float v = clamp((d - dMin) / max(dMax - dMin, 0.001), 0.0, 1.0);
    return vec2(u, v);
}

vec3 sampleTransmittance(float altitude, float cosTheta) {
    vec2 uv = getTransmittanceUV(altitude, cosTheta);
    return texture(transmittanceLUT, uv).rgb;
}

vec2 getDensity(float altitude) {
    float densityR = exp(-max(0.0, altitude) / scaleHeightRayleigh);
    float densityM = exp(-max(0.0, altitude) / scaleHeightMie);
    return vec2(densityR, densityM);
}

vec3 getRayDirection(vec2 uv) {
    vec4 ndc = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 1.0, 1.0);
    vec4 worldPos = invViewProjMatrix * ndc;
    worldPos /= worldPos.w;
    return normalize(worldPos.xyz - cameraPosition);
}

void main() {
    vec3 rayDir = getRayDirection(vUv);
    vec3 rayOrigin = cameraPosition;

    vec2 planetHit = raySphereIntersect(rayOrigin, rayDir, planetCenter, planetRadius);
    if (planetHit.x > 0.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 atmoHit = raySphereIntersect(rayOrigin, rayDir, planetCenter, atmosphereRadius);
    if (atmoHit.y < 0.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float tStart = max(0.0, atmoHit.x);
    float tEnd = atmoHit.y;
    float marchLength = tEnd - tStart;

    float stepSize = marchLength / float(numSamples);

    vec3 inscatter = vec3(0.0);
    vec3 transmittance = vec3(1.0);

    float cosTheta = dot(rayDir, sunDirection);
    float phaseR = rayleighPhase(cosTheta);
    float phaseM = miePhase(cosTheta, mieAnisotropy);

    for (int i = 0; i < 64; i++) {
        if (i >= numSamples) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 samplePos = rayOrigin + rayDir * t;
        float sampleAltitude = length(samplePos - planetCenter) - planetRadius;

        if (sampleAltitude < 0.0) continue;

        vec2 density = getDensity(sampleAltitude);

        vec3 upAtSample = normalize(samplePos - planetCenter);
        float cosSunZenith = dot(sunDirection, upAtSample);
        float sunVisibility = max(cosSunZenith, 0.0); // Only light-facing samples contribute
        vec3 sunTransmittance = sampleTransmittance(sampleAltitude, cosSunZenith) * sunVisibility;

        vec3 scatterR = rayleighScattering * density.x * phaseR;
        vec3 scatterM = vec3(mieScattering * density.y * phaseM);

        vec3 scatterContrib = (scatterR + scatterM) * sunTransmittance * sunVisibility * stepSize;
        inscatter += transmittance * scatterContrib;

        vec3 extinctionR = rayleighScattering * density.x;
        vec3 extinctionM = vec3(mieScattering * density.y * 1.1);
        transmittance *= exp(-(extinctionR + extinctionM) * stepSize);
    }

    vec3 skyColor = inscatter * sunIntensity;

    float altitudeFade = smoothstep(15000.0, 50000.0, viewerAltitude);
    skyColor *= (1.0 - altitudeFade);

    // Add a simple atmospheric gradient to keep daytime visibly blue or as fallback
    float sunAlt = clamp(sunDirection.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 horizonColor = mix(vec3(0.6, 0.7, 0.8), vec3(0.9, 0.6, 0.3), 1.0 - sunAlt);
    vec3 zenithColor = mix(vec3(0.15, 0.25, 0.6), vec3(0.4, 0.5, 0.7), sunAlt);
    float gradT = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.0);
    vec3 gradientSky = mix(zenithColor, horizonColor, gradT);

    // Always keep a gradient floor so the sky is never flat white
    skyColor = max(skyColor, gradientSky * (sunAlt + 0.25));

    // Simple tonemap to avoid blowout
    skyColor = skyColor / (skyColor + vec3(1.0));

    fragColor = vec4(skyColor, 1.0);
}
`;
    }

    dispose() {
        this.initialized = false;
        this.skyMaterial = null;
        this.fullscreenGeometry = null;
    }

    _createFullscreenTriangle() {
        const geom = new Geometry();
        const positions = new Float32Array([
            -1, -1, 0,
             3, -1, 0,
            -1,  3, 0,
        ]);
        const normals = new Float32Array([
            0, 0, 1,
            0, 0, 1,
            0, 0, 1
        ]);
        const uvs = new Float32Array([
            0, 0,
            2, 0,
            0, 2
        ]);

        geom.setAttribute('position', positions, 3);
        geom.setAttribute('normal', normals, 3);
        geom.setAttribute('uv', uvs, 2);
        return geom;
    }
}
