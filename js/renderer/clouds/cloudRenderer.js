import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { FroxelGrid } from './froxelGrid.js';
import { Geometry } from '../resources/geometry.js';

export class CloudRenderer {
    constructor(backend, config = {}) {
        this.backend = backend;
        this.enabled = true;
        this.initialized = false;
        this.time = 0;

        this.config = {
            gridDimensions: config.gridDimensions || { x: 24, y: 16, z: 24 },
            volumeSize: config.volumeSize || new THREE.Vector3(8000, 4000, 12000),
            maxDistance: config.maxDistance || 12000,
            numSteps: config.numSteps || 40,
            cloudAnisotropy: config.cloudAnisotropy || 0.65
        };

        this.froxelGrid = new FroxelGrid(
            backend,
            this.config.gridDimensions,
            {
                volumeSize: this.config.volumeSize,
                maxDistance: this.config.maxDistance,
                baseFogDensity: config.baseFogDensity,
                seed: config.seed
            }
        );

        this.fullscreenGeometry = null;
        this._tmpInvViewProj = new THREE.Matrix4();
    }

    async initialize() {
        this.fullscreenGeometry = this._createFullscreenTriangle();
        this.initialized = true;
    }

    update(camera, environmentState, uniformManager, deltaTime = 0, frame = 0) {
        if (!this.enabled) return;
        this.time += deltaTime;
        this.froxelGrid.update(camera, environmentState, uniformManager, this.time, frame);
    }

    getCommonUniformValues(camera, environmentState, uniformManager) {
        const sunDir = (environmentState?.sunLightDirection ||
            uniformManager?.uniforms?.sunLightDirection?.value ||
            new THREE.Vector3(0.4, 1, 0.2)).clone().normalize();
        const viewProj = new THREE.Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        this._tmpInvViewProj.copy(viewProj).invert();

        const weights = this.froxelGrid.getCoverageForWeather(
            environmentState?.currentWeather,
            environmentState?.weatherIntensity
        );

        return {
            cameraPosition: camera.position,
            sunDirection: sunDir,
            viewMatrix: camera.matrixWorldInverse,
            invViewProjMatrix: this._tmpInvViewProj,
            froxelTexture: this.froxelGrid.getTexture(),
            gridDimensions: new THREE.Vector3(
                this.config.gridDimensions.x,
                this.config.gridDimensions.y,
                this.config.gridDimensions.z
            ),
            gridScale: this.config.volumeSize,
            maxDistance: this.config.maxDistance,
            numSteps: this.config.numSteps,
            cloudLowCoverage: weights.low,
            cloudHighCoverage: weights.high,
            fogDensity: environmentState?.fogDensity ??
                uniformManager?.uniforms?.fogDensity?.value ?? 0.0001,
            time: this.time,
            cloudAnisotropy: this.config.cloudAnisotropy
        };
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
