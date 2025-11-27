import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { RenderTarget } from '../renderer/resources/RenderTarget.js';
import { Material } from '../renderer/resources/material.js';
import { TextureFormat, TextureFilter } from '../renderer/resources/texture.js';

export class CascadedShadowMapRenderer {
    constructor(backend, options = {}) {
        this.backend = backend;
        this.apiName = backend.getAPIName?.() || 'webgl2';

        this.numCascades = options.numCascades || 3;
        this.shadowMapSize = options.shadowMapSize || 2048;
        this.cascadeSplits = options.cascadeSplits || [30, 90, 200];

        this.shadowBias = 0.0005;
        this.shadowNormalBias = 0.05;

        this.cascades = [];
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        for (let i = 0; i < this.numCascades; i++) {
            this.cascades.push(this.createCascade(i));
        }

        const shaders = await this._loadShaders();
   
this.depthMaterial = new Material({
    vertexShader: shaders.vertexShader,
    fragmentShader: shaders.fragmentShader,
    uniforms: {
        modelMatrix: { value: new THREE.Matrix4() },
        viewMatrix: { value: new THREE.Matrix4() },
        projectionMatrix: { value: new THREE.Matrix4() }
    },
    side: 'double',
    vertexLayout: this.apiName === 'webgpu' ? [
        {
            arrayStride: 12,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
        }
    ] : undefined
});

this.instancedDepthMaterial = new Material({
    vertexShader: shaders.instancedVertexShader,
    fragmentShader: shaders.fragmentShader,
    uniforms: {
        modelMatrix: { value: new THREE.Matrix4() },
        viewMatrix: { value: new THREE.Matrix4() },
        projectionMatrix: { value: new THREE.Matrix4() }
    },
    side: 'double',
    vertexLayout: this.apiName === 'webgpu' ? [
        // Position
        {
            arrayStride: 12,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
        },
        // Instance matrix (4 slots)
        {
            arrayStride: 64,
            stepMode: 'instance',
            attributes: [
                { shaderLocation: 1, offset: 0,  format: 'float32x4' },
                { shaderLocation: 2, offset: 16, format: 'float32x4' },
                { shaderLocation: 3, offset: 32, format: 'float32x4' },
                { shaderLocation: 4, offset: 48, format: 'float32x4' }
            ]
        }
    ] : undefined
});

        this.backend.compileShader(this.depthMaterial);
        this.backend.compileShader(this.instancedDepthMaterial);

        this.frameCount = 0;
        this.initialized = true;

        console.log(`CascadedShadowMapRenderer initialized with ${this.numCascades} cascades (${this.apiName})`);
    }

    async _loadShaders() {
        if (this.apiName === 'webgpu') {
            const module = await import('./shaders/webgpu/shadow.js');
            return {
                vertexShader: module.shadowDepthVertex,
                fragmentShader: module.shadowDepthFragment,
                instancedVertexShader: module.shadowDepthInstancedVertex
            };
        } else {
            const module = await import('./shaders/webgl2/shadow.js');
            return {
                vertexShader: module.shadowDepthVertex,
                fragmentShader: module.shadowDepthFragment,
                instancedVertexShader: module.shadowDepthInstancedVertex
            };
        }
    }
    

    createCascade(index) {
        const sizes = [4096, 2048, 1024];
        const size = sizes[index] || 2048;
    
        const cascade = {
            index: index,
            camera: {
                left: -50,
                right: 50,
                top: 50,
                bottom: -50,
                near: 0.5,
                far: 500,
                position: new THREE.Vector3(),
                projectionMatrix: new THREE.Matrix4(),
                matrixWorldInverse: new THREE.Matrix4()
            },
            renderTarget: new RenderTarget(size, size, {
                format: TextureFormat.RGBA8, // FIXED: Use RGBA8 instead of RGBA32F
                minFilter: TextureFilter.LINEAR, // FIXED: Can be filtered now
                magFilter: TextureFilter.LINEAR,
                depthBuffer: true
            }),
            shadowMatrix: new THREE.Matrix4(),
            split: {
                near: index === 0 ? 0 : this.cascadeSplits[index - 1],
                far: this.cascadeSplits[index]
            },
            shadowMapSize: size,
            lastUpdateFrame: 0
        };
    
        return cascade;
    }

    async renderCascades(scene, lightDirection, cameraPosition, camera) {
        if (!this.initialized) {
            await this.initialize();
        }

        this.frameCount++;

        this.renderCascade(scene, lightDirection, cameraPosition, camera, this.cascades[0]);
        this.renderCascade(scene, lightDirection, cameraPosition, camera, this.cascades[1]);

        if (this.frameCount % 2 === 0) {
            this.renderCascade(scene, lightDirection, cameraPosition, camera, this.cascades[2]);
        }

        return this._getCachedShadowData();
    }

    _getCachedShadowData() {
        return {
            cascades: this.cascades,
            numCascades: this.numCascades,
            shadowBias: this.shadowBias,
            shadowNormalBias: this.shadowNormalBias,
            shadowMapSize: this.shadowMapSize
        };
    }

    renderCascade(scene, lightDirection, cameraPosition, camera, cascade) {
        const { far } = cascade.split;

        const cascadeCenter = new THREE.Vector3(
            cameraPosition.x,
            0,
            cameraPosition.z
        );

        const fov = camera.fov * Math.PI / 180;
        const frustumHeight = 2.0 * Math.tan(fov / 2) * far;
        const frustumWidth = frustumHeight * camera.aspect;

        const padding = 20;
        const cameraSize = Math.max(frustumWidth, frustumHeight) / 2 + padding;

        cascade.camera.left = -cameraSize;
        cascade.camera.right = cameraSize;
        cascade.camera.top = cameraSize;
        cascade.camera.bottom = -cameraSize;
        cascade.camera.near = 0.5;
        cascade.camera.far = 500;

        this._updateOrthographicProjection(cascade.camera);

        const lightDistance = 200;
        const shadowCameraPos = lightDirection.clone()
            .multiplyScalar(lightDistance)
            .add(cascadeCenter);

        const worldUnitsPerTexel = (cameraSize * 2) / cascade.shadowMapSize;
        shadowCameraPos.x = Math.floor(shadowCameraPos.x / worldUnitsPerTexel) * worldUnitsPerTexel;
        shadowCameraPos.z = Math.floor(shadowCameraPos.z / worldUnitsPerTexel) * worldUnitsPerTexel;

        cascade.camera.position.copy(shadowCameraPos);

        this._lookAt(cascade.camera, cascadeCenter);

        cascade.shadowMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        cascade.shadowMatrix.multiply(cascade.camera.projectionMatrix);
        cascade.shadowMatrix.multiply(cascade.camera.matrixWorldInverse);

        this.backend.setRenderTarget(cascade.renderTarget);
        this.backend.setClearColor(1, 1, 1, 1);
        this.backend.clear(true, true, false);

        this._renderSceneDepth(scene, cascade.camera);

        this.backend.setRenderTarget(null);

        cascade.lastUpdateFrame = this.frameCount;
    }

    _updateOrthographicProjection(camera) {
        const dx = (camera.right - camera.left) / 2;
        const dy = (camera.top - camera.bottom) / 2;
        const cx = (camera.right + camera.left) / 2;
        const cy = (camera.top + camera.bottom) / 2;

        const left = cx - dx;
        const right = cx + dx;
        const top = cy + dy;
        const bottom = cy - dy;

        const p = camera.projectionMatrix.elements;

        p[0] = 2 / (right - left);
        p[4] = 0;
        p[8] = 0;
        p[12] = -(right + left) / (right - left);

        p[1] = 0;
        p[5] = 2 / (top - bottom);
        p[9] = 0;
        p[13] = -(top + bottom) / (top - bottom);

        p[2] = 0;
        p[6] = 0;
        p[10] = -2 / (camera.far - camera.near);
        p[14] = -(camera.far + camera.near) / (camera.far - camera.near);

        p[3] = 0;
        p[7] = 0;
        p[11] = 0;
        p[15] = 1;
    }

    _lookAt(camera, target) {
        const position = camera.position;

        const zAxis = new THREE.Vector3().subVectors(position, target).normalize();
        const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);

        const te = camera.matrixWorldInverse.elements;

        te[0] = xAxis.x; te[4] = xAxis.y; te[8] = xAxis.z;
        te[1] = yAxis.x; te[5] = yAxis.y; te[9] = yAxis.z;
        te[2] = zAxis.x; te[6] = zAxis.y; te[10] = zAxis.z;

        te[12] = -xAxis.dot(position);
        te[13] = -yAxis.dot(position);
        te[14] = -zAxis.dot(position);

        te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    }

    _renderSceneDepth(scene, shadowCamera) {
        const viewMatrix = shadowCamera.matrixWorldInverse;
        const projectionMatrix = shadowCamera.projectionMatrix;

        this.depthMaterial.uniforms.viewMatrix.value = viewMatrix;
        this.depthMaterial.uniforms.projectionMatrix.value = projectionMatrix;
        this.instancedDepthMaterial.uniforms.viewMatrix.value = viewMatrix;
        this.instancedDepthMaterial.uniforms.projectionMatrix.value = projectionMatrix;

        for (const [chunkKey, entry] of scene.entries()) {
            if (!entry || !entry.meshEntry) continue;

            const meshEntry = entry.meshEntry;
            if (!meshEntry.visible) continue;

            const modelMatrix = new THREE.Matrix4();
            modelMatrix.makeTranslation(
                meshEntry.position.x,
                meshEntry.position.y,
                meshEntry.position.z
            );

            this.depthMaterial.uniforms.modelMatrix.value = modelMatrix;
            this.backend.draw(meshEntry.geometry, this.depthMaterial);
        }
    }

    cleanup() {
        for (const cascade of this.cascades) {
            cascade.renderTarget.dispose();
        }
        if (this.depthMaterial) {
            this.backend.deleteShader(this.depthMaterial);
            this.depthMaterial.dispose();
        }
        if (this.instancedDepthMaterial) {
            this.backend.deleteShader(this.instancedDepthMaterial);
            this.instancedDepthMaterial.dispose();
        }
    }
}