import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Geometry } from '../renderer/resources/geometry.js';
import { Material } from '../renderer/resources/material.js';
import { Texture, TextureFormat, TextureFilter } from '../renderer/resources/texture.js';

export class OrbitalSphereRenderer {
    constructor(backend, planetConfig) {
        this.backend = backend;
        this.config = planetConfig;
        this.geometry = null;
        this.material = null;
        this.planetTexture = null;
        this.visible = false;
        this.opacity = 0;
        
        this._apiName = backend.getAPIName();
    }
    
    async initialize() {
        this._createGeometry();
        await this._createMaterial();
        this._createPlaceholderTexture();
        
        // CRITICAL: Compile shader AFTER texture is set
        if (this.backend && this.material._needsCompile) {
            await this.backend.compileShader(this.material);
            this.material._needsCompile = false;
        }
        
        console.log(`OrbitalSphereRenderer initialized for ${this.config.name}`);
    }
    
    _createGeometry() {
        const segments = 64;
        const radius = this.config.radius;
        
        const vertexCount = (segments + 1) * (segments + 1);
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        
        let vertIndex = 0;
        for (let y = 0; y <= segments; y++) {
            const v = y / segments;
            const phi = v * Math.PI;
            
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const theta = u * Math.PI * 2;
                
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                const sinTheta = Math.sin(theta);
                const cosTheta = Math.cos(theta);
                
                const px = radius * sinPhi * cosTheta;
                const py = radius * cosPhi;
                const pz = radius * sinPhi * sinTheta;
                
                positions[vertIndex * 3] = px;
                positions[vertIndex * 3 + 1] = py;
                positions[vertIndex * 3 + 2] = pz;
                
                normals[vertIndex * 3] = sinPhi * cosTheta;
                normals[vertIndex * 3 + 1] = cosPhi;
                normals[vertIndex * 3 + 2] = sinPhi * sinTheta;
                
                uvs[vertIndex * 2] = u;
                uvs[vertIndex * 2 + 1] = 1 - v;
                
                vertIndex++;
            }
        }
        
        const indexCount = segments * segments * 6;
        const indices = new Uint32Array(indexCount);
        let indexOffset = 0;
        
        for (let y = 0; y < segments; y++) {
            for (let x = 0; x < segments; x++) {
                const v00 = y * (segments + 1) + x;
                const v01 = v00 + 1;
                const v10 = (y + 1) * (segments + 1) + x;
                const v11 = v10 + 1;
                
                indices[indexOffset++] = v00;
                indices[indexOffset++] = v10;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v10;
                indices[indexOffset++] = v11;
            }
        }
        
        this.geometry = new Geometry();
        this.geometry.setAttribute('position', positions, 3);
        this.geometry.setAttribute('normal', normals, 3);
        this.geometry.setAttribute('uv', uvs, 2);
        this.geometry.setIndex(indices);
        this.geometry.computeBoundingSphere();
    }
    
async _createMaterial() {
    const vertexShader = this._apiName === 'webgpu' 
        ? this._getWebGPUVertexShader() 
        : this._getWebGL2VertexShader();
    const fragmentShader = this._apiName === 'webgpu'
        ? this._getWebGPUFragmentShader()
        : this._getWebGL2FragmentShader();
    
    // ============================================
    // FIX: Provide explicit vertex layout for WebGPU
    // ============================================
    let vertexLayout = null;
    if (this._apiName === 'webgpu') {
        vertexLayout: [
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
        ]
    }
    
    this.material = new Material({
        name: 'OrbitalSphereMaterial',
        vertexShader,
        fragmentShader,
        uniforms: {
            modelMatrix: { value: new THREE.Matrix4() },
            viewMatrix: { value: new THREE.Matrix4() },
            projectionMatrix: { value: new THREE.Matrix4() },
            planetOrigin: { value: this.config.origin.clone() },
            planetRadius: { value: this.config.radius },
            sunDirection: { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
            opacity: { value: 1.0 },
            planetTexture: { value: null },
            planetTextureSampler: { value: 'linear' }  // ✅ Add sampler
            
        },
        side: 'back',
        depthTest: true,
        depthWrite: true,
        transparent: true,
        vertexLayout: vertexLayout  // ✅ Add explicit layout
    });
    
    this.material._needsCompile = true;
}
    
    _createPlaceholderTexture() {
        const size = 512;
        const data = new Uint8Array(size * size * 4);
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                
                const u = x / size;
                const v = y / size;
                
                const lat = (v - 0.5) * Math.PI;
                const lon = u * Math.PI * 2;
                
                const noise1 = Math.sin(lon * 4) * Math.cos(lat * 4) * 0.5 + 0.5;
                const noise2 = Math.sin(lon * 8 + 1.5) * Math.cos(lat * 8 + 0.7) * 0.3;
                const combined = noise1 + noise2;
                
                const isOcean = combined < 0.45;
                const isMountain = combined > 0.7;
                
                if (isOcean) {
                    data[i] = 30;
                    data[i + 1] = 60;
                    data[i + 2] = 150;
                } else if (isMountain) {
                    const snow = Math.abs(lat) > 1.0 || combined > 0.85;
                    if (snow) {
                        data[i] = 240;
                        data[i + 1] = 240;
                        data[i + 2] = 240;
                    } else {
                        data[i] = 100;
                        data[i + 1] = 80;
                        data[i + 2] = 60;
                    }
                } else {
                    const green = 80 + combined * 80;
                    data[i] = 50;
                    data[i + 1] = green;
                    data[i + 2] = 30;
                }
                data[i + 3] = 255;
            }
        }
        
        this.planetTexture = new Texture({
            width: size,
            height: size,
            format: TextureFormat.RGBA8,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR,
            data: data
        });
        
        this.backend.createTexture(this.planetTexture);
        this.material.uniforms.planetTexture.value = this.planetTexture;
    }
    
    setPlanetTexture(texture) {
        if (this.planetTexture && this.planetTexture !== texture) {
            this.backend.deleteTexture(this.planetTexture);
        }
        this.planetTexture = texture;
        this.material.uniforms.planetTexture.value = texture;
    }
    
    update(camera, sunDirection, altitudeZoneManager) {
        this.visible = altitudeZoneManager.shouldRenderOrbitalSphere();
        this.opacity = altitudeZoneManager.getOrbitalSphereBlendFactor();
        
        if (!this.visible) return;
        
        this.material.uniforms.viewMatrix.value.copy(camera.matrixWorldInverse);
        this.material.uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
        this.material.uniforms.sunDirection.value.copy(sunDirection).normalize();
        this.material.uniforms.opacity.value = this.opacity;
        
        const modelMatrix = new THREE.Matrix4();
        modelMatrix.makeTranslation(
            this.config.origin.x,
            this.config.origin.y,
            this.config.origin.z
        );
        this.material.uniforms.modelMatrix.value.copy(modelMatrix);
    }
    
    render() {
        
 
        if (!this.visible || this.opacity <= 0) return;
        this.backend.draw(this.geometry, this.material);
    }
    
    _getWebGPUVertexShader() {
        return `
struct VertexUniforms {
    modelMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    planetOrigin: vec3<f32>,
    planetRadius: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) vUv: vec2<f32>,
    @location(1) vNormal: vec3<f32>,
    @location(2) vWorldPosition: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: VertexUniforms;

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    let worldPosition = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
    output.vWorldPosition = worldPosition.xyz;
    
    let viewPosition = uniforms.viewMatrix * worldPosition;
    output.clipPosition = uniforms.projectionMatrix * viewPosition;
    
    output.vUv = input.uv;
    output.vNormal = normalize((uniforms.modelMatrix * vec4<f32>(input.normal, 0.0)).xyz);
    
    return output;
}
`;
    }
    
    _getWebGPUFragmentShader() {
        return `
    struct FragmentUniforms {
        sunDirection: vec3<f32>,
        opacity: f32,
    }
    
    @group(0) @binding(1) var<uniform> fragUniforms: FragmentUniforms;
    @group(1) @binding(0) var planetTexture: texture_2d<f32>;
    @group(1) @binding(1) var textureSampler: sampler;
    
    struct VertexOutput {
        @builtin(position) clipPosition: vec4<f32>,
        @location(0) vUv: vec2<f32>,
        @location(1) vNormal: vec3<f32>,
        @location(2) vWorldPosition: vec3<f32>,
    }
    
    @fragment
    fn main(input: VertexOutput) -> @location(0) vec4<f32> {
        let baseColor = textureSample(planetTexture, textureSampler, input.vUv).rgb;
        
        let normal = normalize(input.vNormal);
        let NdotL = max(dot(normal, fragUniforms.sunDirection), 0.0);
        
        let ambient = 0.1;
        let lighting = ambient + NdotL * 0.9;
        
        let finalColor = baseColor * lighting;
        
        return vec4<f32>(finalColor, fragUniforms.opacity);
    }
    `;
    }
    
    
    _getWebGL2VertexShader() {
        return `#version 300 es
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec2 vUv;
out vec3 vNormal;
out vec3 vWorldPosition;

void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    
    vUv = uv;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
}
`;
    }
    
    _getWebGL2FragmentShader() {
        return `#version 300 es
precision highp float;

uniform vec3 sunDirection;
uniform float opacity;
uniform sampler2D planetTexture;

in vec2 vUv;
in vec3 vNormal;
in vec3 vWorldPosition;

out vec4 fragColor;

void main() {
    vec3 baseColor = texture(planetTexture, vUv).rgb;
    
    vec3 normal = normalize(vNormal);
    float NdotL = max(dot(normal, sunDirection), 0.0);
    
    float ambient = 0.1;
    float lighting = ambient + NdotL * 0.9;
    
    vec3 finalColor = baseColor * lighting;
    
    fragColor = vec4(finalColor, opacity);
}
`;
    }
    
    dispose() {
        if (this.geometry) {
            this.geometry.dispose();
        }
        if (this.material) {
            this.backend.deleteShader(this.material);
            this.material.dispose();
        }
        if (this.planetTexture) {
            this.backend.deleteTexture(this.planetTexture);
        }
    }
}