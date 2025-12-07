import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { CloudRenderer } from './cloudRenderer.js';
import { Material } from '../resources/material.js';

export class WebGL2CloudRenderer extends CloudRenderer {
    async initialize() {
        await super.initialize();

        this.material = new Material({
            name: 'VolumetricClouds_WebGL2',
            vertexShader: this._getVertexShader(),
            fragmentShader: this._getFragmentShader(),
            uniforms: {
                cameraPosition: { value: new THREE.Vector3() },
                sunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                viewMatrix: { value: new THREE.Matrix4() },
                invViewProjMatrix: { value: new THREE.Matrix4() },
                gridScale: { value: this.config.volumeSize.clone() },
                gridDimensions: { value: new THREE.Vector3(
                    this.config.gridDimensions.x,
                    this.config.gridDimensions.y,
                    this.config.gridDimensions.z
                ) },
                maxDistance: { value: this.config.maxDistance },
                numSteps: { value: this.config.numSteps },
                cloudLowCoverage: { value: 0.3 },
                cloudHighCoverage: { value: 0.2 },
                fogDensity: { value: 0.0001 },
                time: { value: 0 },
                cloudAnisotropy: { value: this.config.cloudAnisotropy },
                froxelTexture: { value: this.froxelGrid.getTexture() }
            },
            transparent: true,
            depthTest: false,
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
        const u = this.material.uniforms;

        u.cameraPosition.value.copy(common.cameraPosition);
        u.sunDirection.value.copy(common.sunDirection);
        u.viewMatrix.value.copy(common.viewMatrix);
        u.invViewProjMatrix.value.copy(common.invViewProjMatrix);
        u.gridScale.value.copy(common.gridScale);
        u.gridDimensions.value.copy(common.gridDimensions);
        u.maxDistance.value = common.maxDistance;
        u.numSteps.value = common.numSteps;
        u.cloudLowCoverage.value = common.cloudLowCoverage;
        u.cloudHighCoverage.value = common.cloudHighCoverage;
        u.fogDensity.value = common.fogDensity;
        u.time.value = common.time;
        u.cloudAnisotropy.value = common.cloudAnisotropy;
        u.froxelTexture.value = common.froxelTexture;

        this.backend.draw(this.fullscreenGeometry, this.material);
    }

    _getVertexShader() {
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
        }`;
    }

    _getFragmentShader() {
        return `#version 300 es
        precision highp float;

        in vec2 vUv;
        out vec4 fragColor;

        uniform vec3 cameraPosition;
        uniform vec3 sunDirection;
        uniform mat4 viewMatrix;
        uniform mat4 invViewProjMatrix;
        uniform vec3 gridScale;
        uniform vec3 gridDimensions;
        uniform float maxDistance;
        uniform int numSteps;
        uniform float cloudLowCoverage;
        uniform float cloudHighCoverage;
        uniform float fogDensity;
        uniform float time;
        uniform float cloudAnisotropy;
        uniform sampler2D froxelTexture;

        const float PI = 3.14159265359;

        vec3 getRayDirection(vec2 uv) {
            vec4 ndc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
            vec4 world = invViewProjMatrix * ndc;
            world /= world.w;
            return normalize(world.xyz - cameraPosition);
        }

        vec4 sampleFroxel(vec3 viewPos) {
            float zN = clamp(-viewPos.z / maxDistance, 0.0, 0.999);
            float xN = clamp(viewPos.x / gridScale.x * 0.5 + 0.5, 0.0, 0.999);
            float yN = clamp(viewPos.y / gridScale.y * 0.5 + 0.5, 0.0, 0.999);

            vec3 coord = vec3(xN, yN, zN);
            vec3 idx = coord * (gridDimensions - vec3(1.0));
            float zi = floor(idx.z + 0.5);
            float yi = floor(idx.y + 0.5);
            float xi = floor(idx.x + 0.5);

            float u = (xi + 0.5) / gridDimensions.x;
            float v = (yi + zi * gridDimensions.y + 0.5) / (gridDimensions.y * gridDimensions.z);
            return texture(froxelTexture, vec2(u, v));
        }

        float henyeiGreenstein(float cosTheta, float g) {
            float g2 = g * g;
            float denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
            return (1.0 - g2) / (4.0 * PI * max(denom, 0.001));
        }

        void main() {
            vec3 rayDir = getRayDirection(vUv);
            float stepSize = maxDistance / float(numSteps);

            vec3 accum = vec3(0.0);
            float trans = 1.0;

            float cosSun = dot(rayDir, sunDirection);
            float cloudPhase = henyeiGreenstein(cosSun, cloudAnisotropy);
            float fogPhase = 1.0 / (4.0 * PI);

            for (int i = 0; i < 128; i++) {
                if (i >= numSteps) break;
                float t = (float(i) + 0.5) * stepSize;
                vec3 samplePos = cameraPosition + rayDir * t;
                vec3 viewPos = (viewMatrix * vec4(samplePos, 1.0)).xyz;

                vec4 cell = sampleFroxel(viewPos);
                float fog = fogDensity * cell.r;
                float cldLow = cell.g * cloudLowCoverage;
                float cldHigh = cell.b * cloudHighCoverage;
                float density = fog + cldLow + cldHigh;
                if (density <= 1e-5) continue;

                float phase = mix(fogPhase, cloudPhase, clamp(cldLow + cldHigh, 0.0, 1.0));
                vec3 scatter = vec3(density * phase) * (0.65 + 0.6 * cell.a);

                accum += trans * scatter * stepSize;
                trans *= exp(-density * stepSize * 1.25);
                if (trans < 0.02) break;
            }

            vec3 color = accum;
            float alpha = clamp(1.0 - trans, 0.0, 1.0);
            fragColor = vec4(color, alpha);
        }`;
    }
}
