
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { WebGL2Backend } from '../backend/webGL2Backend.js';
import { WebGPUBackend } from '../backend/webgpuBackend.js';
import { MasterChunkLoader } from '../../mesh/masterChunkLoader.js'; 
import { LODManager } from '../lodManager.js';
import { ChunkCullingManager } from '../chunkCullingManager.js';
import { UniformManager } from '../../lighting/uniformManager.js';
import { ClusteredLightManager } from '../../lighting/clusteredLightManager.js';
import { ClusterGrid } from '../../lighting/clusterGrid.js';
import { CascadedShadowMapRenderer } from '../../shadows/cascadedShadowMapRenderer.js';
import { OrbitalSphereRenderer } from '../orbitalSphereRenderer.js';
import { GenericMeshRenderer } from '../genericMeshRenderer.js';
import { Geometry } from '../resources/geometry.js';
import { Material } from '../resources/material.js';
 
export class Frontend {
    constructor(canvas, options = {}) {
          

        this.canvas = canvas;
        this.backend = null;
        this.backendType = options.backendType || 'webgl2';

        this.textureManager = options.textureManager;
        this.textureCache = options.textureCache;
        this.chunkSize = options.chunkSize || 128;

        this.uniformManager = new UniformManager();
        this.genericMeshRenderer = null;

        this.lodManager = new LODManager({
            chunkSize: this.chunkSize,
        });

        this.chunkCullingManager = new ChunkCullingManager({
            chunkSize: this.chunkSize,
            viewDistance: 160,
            margin: this.chunkSize
        });

        this.masterChunkLoader = null;
        this._instancedTest = null;

        this.camera = {
            position: new THREE.Vector3(0, 50, 0),
            target: new THREE.Vector3(0, 0, 0),
            near: 0.1,
            far: 100000,
            fov: 75,
            aspect: canvas.width / canvas.height,
            matrixWorldInverse: new THREE.Matrix4(),
            projectionMatrix: new THREE.Matrix4()
        };

        this.frameCount = 0;
        this.debugMode = false;

        this.clusterGrid = null;
        this.lightManager = null;
        this.shadowRenderer = null;
        this.planetConfig = null;
        this.sphericalMapper = null;
        this.orbitalSphereRenderer = null;
        this.cloudRenderer = null;
        
    }

    /**
     * Debug helper: create a small instanced grid to validate instancing path.
     * Enable by calling frontend.enableInstancedDebug().
     */
    _setupInstancedDebug() {
        this._instancedTest = null;
        // Disabled by default; call enableInstancedDebug() to activate
    }

    enableInstancedDebug() {
        const gridSize = 16;
        const quad = this._buildQuadGeometry();
        const instanceCount = gridSize * gridSize;

        const instanceData = new Float32Array(instanceCount * 4);
        let idx = 0;
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                instanceData[idx++] = x * 2.0;
                instanceData[idx++] = 0.0;
                instanceData[idx++] = y * 2.0;
                instanceData[idx++] = 1.0;
            }
        }
        quad.instanceCount = instanceCount;
        quad.setAttribute('instanceOffset', instanceData, 4, false, { stepMode: 'instance', slot: 3 });

        const vs = `
struct DebugUniforms {
  viewMatrix : mat4x4<f32>,
  projectionMatrix : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : DebugUniforms;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
  @location(3) inst     : vec4<f32>,
};
struct VertexOutput {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) vUv : vec2<f32>,
};
@vertex
fn main(input : VertexInput) -> VertexOutput {
  var output : VertexOutput;
  let worldPos = vec4<f32>(input.position + input.inst.xyz, 1.0);
  let viewPos = uniforms.viewMatrix * worldPos;
  output.clipPosition = uniforms.projectionMatrix * viewPos;
  output.vUv = input.uv;
  return output;
}
`;

        const fs = `
@fragment
fn main(@location(0) vUv : vec2<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(vUv, 0.0, 1.0);
}
`;

        const mat = new Material({
            name: 'InstancedDebug',
            vertexShader: vs,
            fragmentShader: fs,
            vertexLayout: [
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
                { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }] }
            ],
            uniforms: {
                viewMatrix: { value: new THREE.Matrix4() },
                projectionMatrix: { value: new THREE.Matrix4() }
            },
            bindGroupLayoutSpec: [
                {
                    entries: [
                        { binding: 0, visibility: 'vertex', buffer: { type: 'uniform' } }
                    ]
                }
            ]
        });

        this._instancedTest = { geometry: quad, material: mat };
        console.log('Instanced debug enabled:', { instances: instanceCount });
    }

    _buildQuadGeometry() {
        const geom = new Geometry();
        const positions = new Float32Array([
            -0.5, 0, -0.5,
             0.5, 0, -0.5,
             0.5, 0,  0.5,
            -0.5, 0,  0.5,
        ]);
        const normals = new Float32Array([
            0,1,0, 0,1,0, 0,1,0, 0,1,0
        ]);
        const uvs = new Float32Array([
            0,0, 1,0, 1,1, 0,1
        ]);
        const indices = new Uint16Array([0,1,2, 0,2,3]);
        geom.setAttribute('position', positions, 3);
        geom.setAttribute('normal', normals, 3);
        geom.setAttribute('uv', uvs, 2);
        geom.setIndex(indices);
        geom.computeBoundingSphere();
        return geom;
    }

    getBackend() {
        return this.backend;
    }

    getBackendType() {
        return this.backendType;
    }

    // Expose loaded chunks through MasterChunkLoader
    get loadedChunks() {
        return this.masterChunkLoader?.loadedChunks || new Map();
    }

    // Expose terrainMeshManager through MasterChunkLoader
    get terrainMeshManager() {
        return this.masterChunkLoader?.terrainMeshManager || null;
    }

    updateCamera(gameState) {
        if (gameState.camera) {
            const camPos = gameState.camera.position;
            const camTarget = gameState.camera.target;
    
            if (camPos.isVector3) {
                this.camera.position.copy(camPos);
            } else {
                this.camera.position.set(camPos.x, camPos.y, camPos.z); 
            }
    
            if (camTarget.isVector3) {
                this.camera.target.copy(camTarget);
            } else {
                this.camera.target.set(camTarget.x, camTarget.y, camTarget.z);
            }
    
            this._updateCameraMatrices();
        }
    
        this.uniformManager.updateCameraParameters(this.camera);
    }

    _updateCameraMatrices() {
        const position = this.camera.position;
        const target = this.camera.target;
    
        // 1. Calculate View Direction (Z-Axis)
        const zAxis = new THREE.Vector3().subVectors(position, target).normalize();
        
        // 2. Calculate "Up" Vector
        // For a planet, "Up" is the direction from the planet center to the camera.
        // Assuming planet is at (0,0,0)
        let up = new THREE.Vector3().copy(position).normalize();
        
        // EDGE CASE: If camera is at (0,0,0) (impossible) or math fails, fallback
        if (up.lengthSq() < 0.0001) up.set(0, 1, 0);

        // SINGULARITY CHECK:
        // If View Dir (zAxis) and Up Vector are parallel (looking straight down),
        // we can't derive "Right" (xAxis). We must arbitrarily choose a different "Up".
        // This usually happens at the poles.
        const dot = Math.abs(zAxis.dot(up));
        if (dot > 0.99) {
            // Camera is looking straight down/up relative to gravity.
            // Perturb 'up' slightly to Z-axis to get a valid cross product.
            up.set(0, 0, 1); 
        }
    
        // 3. Calculate Right Vector (X-Axis)
        const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
        
        // 4. Recalculate True Up Vector (Y-Axis) to ensure orthogonality
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    
        const te = this.camera.matrixWorldInverse.elements;
    
        // Fill Matrix
        te[0] = xAxis.x; te[4] = xAxis.y; te[8] = xAxis.z;
        te[1] = yAxis.x; te[5] = yAxis.y; te[9] = yAxis.z;
        te[2] = zAxis.x; te[6] = zAxis.y; te[10] = zAxis.z;
    
        te[12] = -xAxis.dot(position);
        te[13] = -yAxis.dot(position);
        te[14] = -zAxis.dot(position);
    
        te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect;
        const near = this.camera.near;
        const far = this.camera.far;
    
        const top = near * Math.tan(fov / 2);
        const height = 2 * top;
        const width = aspect * height;
    
        const pe = this.camera.projectionMatrix.elements;
    
        pe[0] = 2 * near / width;
        pe[4] = 0;
        pe[8] = 0;
        pe[12] = 0;
    
        pe[1] = 0;
        pe[5] = 2 * near / height;
        pe[9] = 0;
        pe[13] = 0;
    
        pe[2] = 0;
        pe[6] = 0;
        pe[10] = -(far + near) / (far - near);
        pe[14] = -2 * far * near / (far - near);
    
        pe[3] = 0;
        pe[7] = 0;
        pe[11] = -1;
        pe[15] = 0;

        if (this.uniformManager) {
            this.uniformManager.updateCameraParameters(this.camera);
        }
    }
    async initializeChunkLoader() {
        if (!this.textureManager) {
            throw new Error('Cannot initialize chunk loader: textureManager not set');
        }
    
        console.log('Initializing MasterChunkLoader with textureManager...');
    
       
        this.masterChunkLoader = new MasterChunkLoader(
            this.backend,
            this.textureManager,
            this.textureCache,
            this.uniformManager,
            this.lodManager,
            this.planetConfig?.altitudeZoneManager || null, 
            this.chunkSize,
            100
        );
    
        await this.masterChunkLoader.initialize();
    
    // Pass atmosphere LUT if available
    if (this.atmosphereLUT && this.masterChunkLoader.terrainMeshManager) {
        this.masterChunkLoader.terrainMeshManager.setAtmosphereLUT(this.atmosphereLUT);
    }

        console.log('MasterChunkLoader initialized successfully');
    }
    
    async updateChunks(gameState, environmentState, deltaTime, planetConfig, sphericalMapper) {

        if (!this.masterChunkLoader) {
            console.warn('MasterChunkLoader not initialized yet');
            return;
        }
    
        if (this.uniformManager) {
            this.uniformManager.currentEnvironmentState = environmentState;
        }

        await this.masterChunkLoader.update(
            this.camera.position,
            gameState.terrain,
            deltaTime,
            planetConfig,
            sphericalMapper,
        );

        this.uniformManager.updateFromEnvironmentState(environmentState);

        // Optionally push env uniforms to meshes if supported
        if (this.masterChunkLoader.terrainMeshManager?.updateEnvUniforms) {
            this.masterChunkLoader.terrainMeshManager.updateEnvUniforms(
                environmentState,
                this.camera,
                null,
                null
            );
        }
    }
    updateLighting(environmentState) {
        this.clusterGrid.updateFromCamera(this.camera);
        this.lightManager.assignLightsToClusters(this.camera);
        const clusterTextures = this.lightManager.buildGPUBuffers();

        this.uniformManager.updateFromClusteredLights(
            this.clusterGrid,
            this.lightManager,
            clusterTextures
        );

        this.uniformManager.updateFromLightManager(this.lightManager);
    }


    async initialize(planetConfig = null, sphericalMapper = null) {
        this.planetConfig = planetConfig;
        this.sphericalMapper = sphericalMapper;
        if (this.backendType === 'webgpu' && navigator.gpu) {
            try {
                this.backend = new WebGPUBackend(this.canvas);
                await this.backend.initialize();
                console.log('Frontend initialized with WebGPU backend');
            } catch (error) {
                console.warn('WebGPU initialization failed, falling back to WebGL2:', error);
                this.backendType = 'webgl2';
            }
            if (this.backend && this.backend._pipelineCache) {
                console.log('Clearing pipeline cache');
                this.backend._pipelineCache.clear();
            }
        }
    
        if (this.backendType === 'webgl2' || !this.backend) {
            this.backend = new WebGL2Backend(this.canvas);
            await this.backend.initialize();
            console.log('Frontend initialized with WebGL2 backend');
        }
    
        this.backend.setViewport(0, 0, this.canvas.width, this.canvas.height);
        this.genericMeshRenderer = new GenericMeshRenderer(this.backend);
        console.log('GenericMeshRenderer initialized');


        if (this.planetConfig && this.planetConfig.hasAtmosphere) {
            this.uniformManager.updateFromPlanetConfig(this.planetConfig);

            const { PlanetAtmosphereSettings } = await import('../../planet/atmosphere/planetAtmosphereSettings.js');
            this.atmosphereSettings = this.planetConfig.atmosphereSettings ||
                PlanetAtmosphereSettings.createForPlanet(this.planetConfig.radius);

            const { AtmosphericScatteringLUT } = await import('../atmosphere/atmosphericScatteringLUT.js');
            this.atmosphereLUT = await AtmosphericScatteringLUT.create(
                this.backend,
                this.uniformManager
            );
            this.atmosphereLUT.update();
            if (this.atmosphereLUT && this.masterChunkLoader?.terrainMeshManager) {
                this.masterChunkLoader.terrainMeshManager.setAtmosphereLUT(this.atmosphereLUT);
            }

            console.log('AtmosphericScatteringLUT initialized');
            console.log('PlanetAtmosphereSettings initialized');

            const { SkyRenderer } = await import('../../atmosphere/SkyRenderer.js');
            this.skyRenderer = new SkyRenderer(this.backend, this.atmosphereLUT);
            await this.skyRenderer.initialize();
        }
        const cloudConfig = {
            gridDimensions: { x: 24, y: 16, z: 24 },
            volumeSize: new THREE.Vector3(8000, 4000, 12000),
            maxDistance: 12000,
            numSteps: this.backendType === 'webgpu' ? 48 : 40,
            cloudAnisotropy: 0.65
        };
        if (this.backendType === 'webgpu') {
            const { WebGPUCloudRenderer } = await import('../clouds/webgpuCloudRenderer.js');
            this.cloudRenderer = new WebGPUCloudRenderer(this.backend, cloudConfig);
        } else {
            const { WebGL2CloudRenderer } = await import('../clouds/webgl2CloudRenderer.js');
            this.cloudRenderer = new WebGL2CloudRenderer(this.backend, cloudConfig);
        }
        await this.cloudRenderer.initialize();
        if (this.atmosphereLUT) {
            const { AerialPerspectiveTest } = await import('../atmosphere/aerialPerspectiveTest.js');
            this.aerialTest = new AerialPerspectiveTest(
                this.backend,
                this.uniformManager,
                this.atmosphereLUT
            );
            await this.aerialTest.initialize();
        }

        this._setupInstancedDebug(); // Safe no-op if disabled
        this.clusterGrid = new ClusterGrid({
            gridSizeX: 16,
            gridSizeY: 8,
            gridSizeZ: 24,
            useLogarithmicDepth: true
        });
    
        this.lightManager = new ClusteredLightManager(this.clusterGrid, {
            maxLightsPerCluster: 32,
            maxLightIndices: 8192
        });
    
        this.shadowRenderer = new CascadedShadowMapRenderer(this.backend, {
            numCascades: 3,
            shadowMapSize: 2048,
            cascadeSplits: [30, 90, 200],
            shadowBias: 0.001,
            shadowNormalBias: 0.1
        });
    
        this.uniformManager.uniforms.ambientLightIntensity.value = 0.5;
        this.uniformManager.uniforms.ambientLightColor.value.set(0xffffff);
        this.uniformManager.uniforms.skyAmbientColor.value.set(0x87ceeb);
        this.uniformManager.uniforms.groundAmbientColor.value.set(0x8b7355);
        this.uniformManager.uniforms.sunLightIntensity.value = 1.0;
        this.uniformManager.uniforms.sunLightColor.value.set(0xffffff);
        this.uniformManager.uniforms.sunLightDirection.value.set(0.5, 1.0, 0.3).normalize();
        this.lodManager.setPlanetaryConfig(this.planetConfig, this.sphericalMapper);

        if (this.planetConfig) {
            const { OrbitalSphereRenderer } = await import('../orbitalSphereRenderer.js');
            this.orbitalSphereRenderer = new OrbitalSphereRenderer(
                this.backend,
                this.planetConfig
            );
   
    this.camera.far = this.planetConfig.radius * 3;  // 150000 for radius 50000
    this.camera.near = 1.0;  // Increase near plane too for depth precision

            await this.orbitalSphereRenderer.initialize();
            console.log('OrbitalSphereRenderer initialized');
        } else {
            console.log('Skipping OrbitalSphereRenderer (flat terrain mode)');
            this.orbitalSphereRenderer = null;
        }
        
        return this;
    }
    
    async updateShadows(environmentState) {
        return;
        if (!this.shadowRenderer) return;

        const shadowData = await this.shadowRenderer.renderCascades(
            this.loadedChunks,
            environmentState.sunLightDirection,
            this.camera.position,
            this.camera
        );

        this.uniformManager.updateFromShadowRenderer(shadowData);
    }


    async render(gameState, environmentState, deltaTime, planetConfig, sphericalMapper) {
        if (!this.textureManager?.loaded || !gameState.terrain) return;

        if (this.atmosphereLUT && this.atmosphereSettings) {
            await this.atmosphereLUT.compute(this.atmosphereSettings);
        }

        if (this.backendType === 'webgpu' && this.backend.device) {
            this.backend.device.pushErrorScope('validation');
        }

        this.frameCount++;
    
        this.updateCamera(gameState);
        if (this.planetConfig && this.uniformManager.currentPlanetConfig !== this.planetConfig) {
            this.uniformManager.updateFromPlanetConfig(this.planetConfig);
        }
        
        await this.updateChunks(gameState, environmentState, deltaTime, planetConfig, sphericalMapper);
        this.updateLighting(environmentState);
    
        if (this.frameCount % 2 === 0) {
            await this.updateShadows(environmentState);
        }
    
        this.backend.setRenderTarget(null);
        this.backend.setClearColor(0.0, 0.0, 0.0, 1.0);
        this.backend.clear(true, true, false);

        if (this.skyRenderer && this.atmosphereSettings) {
            const sunDir = environmentState?.sunLightDirection ||
                this.uniformManager.uniforms.sunLightDirection.value;
            this.skyRenderer.render(
                this.camera,
                this.atmosphereSettings,
                sunDir,
                this.uniformManager
            );
        }

        if (this.cloudRenderer) {
            this.cloudRenderer.update(this.camera, environmentState, this.uniformManager, deltaTime || 0, this.frameCount);
            this.cloudRenderer.render(this.camera, environmentState, this.uniformManager);
        }

        if (this.orbitalSphereRenderer && gameState.altitudeZoneManager) {
            this.orbitalSphereRenderer.update(
                this.camera,
                environmentState.sunLightDirection,
                gameState.altitudeZoneManager
            );
            this.orbitalSphereRenderer.render();
        }
    
        this.renderTerrain();
        this.renderGenericMeshes();
        if (this.aerialTest) {
           // this.aerialTest.render();
        }
        if (this.backendType === 'webgpu') {
            this.backend.submitCommands();
            
            // Check for validation errors
            const error = await this.backend.device.popErrorScope();
            if (error) {
                console.error('WebGPU validation error:', error.message);
            }
        }
    }

    renderGenericMeshes() {
        // Optional instanced debug draw
        if (this._instancedTest) {
            const { geometry, material } = this._instancedTest;
            material.uniforms.viewMatrix.value.copy(this.camera.matrixWorldInverse);
            material.uniforms.projectionMatrix.value.copy(this.camera.projectionMatrix);
            this.backend.draw(geometry, material);
        }

        if (!this.genericMeshRenderer) return;
        
        const viewMatrix = this.camera.matrixWorldInverse;
        const projectionMatrix = this.camera.projectionMatrix;
        
        this.genericMeshRenderer.render(viewMatrix, projectionMatrix);
    }
    
    renderTerrain() {
        const viewMatrix = this.camera.matrixWorldInverse;
        const projectionMatrix = this.camera.projectionMatrix;
    
        const terrainMeshManager = this.masterChunkLoader.terrainMeshManager;

        if (this.frameCount === 1) {
            console.log(' renderTerrain() called');
            console.log('  Camera position:', this.camera.position);
            console.log('  Mesh count:', terrainMeshManager.chunkMeshes.size);
            
            for (const [key, entry] of terrainMeshManager.chunkMeshes) {
                console.log(`  Chunk ${key}:`, {
                    visible: entry.visible,
                    hasGeometry: !!entry.geometry,
                    hasMaterial: !!entry.material,
                    vertexCount: entry.geometry?.attributes?.get('position')?.count,
                    indexCount: entry.geometry?.index?.count
                });
            }
        }
        let drawnCount = 0;
        let skippedCount = 0;
    
        for (const [chunkKey, meshEntry] of terrainMeshManager.chunkMeshes) {
            if (!meshEntry) {
                console.warn(' Null mesh entry for', chunkKey);
                skippedCount++;
                continue;
            }
    
            if (!meshEntry.visible) {
                skippedCount++;
                continue;
            }
    
            if (!meshEntry.geometry) {
                console.error(' Missing geometry for', chunkKey);
                skippedCount++;
                continue;
            }
    
            if (!meshEntry.material) {
                console.error('Missing material for', chunkKey);
                skippedCount++;
                continue;
            }
    
            // Update matrices
            if (!meshEntry.material.uniforms.viewMatrix) {
                meshEntry.material.uniforms.viewMatrix = { value: new THREE.Matrix4() };
            }
            if (!meshEntry.material.uniforms.projectionMatrix) {
                meshEntry.material.uniforms.projectionMatrix = { value: new THREE.Matrix4() };
            }
            if (!meshEntry.material.uniforms.modelMatrix) {
                meshEntry.material.uniforms.modelMatrix = { value: new THREE.Matrix4() };
            }
            if (meshEntry.material.uniforms.cameraPosition) {
                meshEntry.material.uniforms.cameraPosition.value.copy(this.camera.position);
            }
    
            meshEntry.material.uniforms.viewMatrix.value.copy(viewMatrix);
            meshEntry.material.uniforms.projectionMatrix.value.copy(projectionMatrix);
            meshEntry.material.uniforms.modelMatrix.value.identity();  

            try {
                this.backend.draw(meshEntry.geometry, meshEntry.material);
                drawnCount++;
            } catch (error) {
                console.error(' Draw error for', chunkKey, error);
            }
        }
    

        if (this.frameCount === 1) {
            console.log(' First render:', {
                totalMeshes: terrainMeshManager.chunkMeshes.size,
                drawn: drawnCount,
                skipped: skippedCount,
                viewMatrix: viewMatrix.elements.slice(0, 4),
                projectionMatrix: projectionMatrix.elements.slice(0, 4)
            });
        }
    
        return drawnCount;
    }

    handleResize(width, height) {
        this.camera.aspect = width / height;
        this._updateCameraMatrices();
        this.backend.setViewport(0, 0, width, height);
    }

    async switchPlanet(planetConfig) {
        const { PlanetAtmosphereSettings } = await import(
            '../../planet/atmosphere/planetAtmosphereSettings.js'
        );
        this.atmosphereSettings = PlanetAtmosphereSettings.createForPlanet(
            planetConfig.radius,
            planetConfig.atmosphereOptions || {}
        );
        if (this.atmosphereLUT) {
            this.atmosphereLUT.invalidate();
        }
    }

    async switchPlanetPreset(presetName) {
        const { PlanetAtmosphereSettings } = await import(
            '../../planet/atmosphere/planetAtmosphereSettings.js'
        );
        this.atmosphereSettings = PlanetAtmosphereSettings.createPreset(presetName);
        if (this.atmosphereLUT) {
            this.atmosphereLUT.invalidate();
        }
    }

    dispose() {
        if (this.genericMeshRenderer) {
            this.genericMeshRenderer.cleanup();
        }
        if (this.atmosphereLUT) {
            this.atmosphereLUT.dispose();
        }
        this.masterChunkLoader.cleanupAll();
        this.lightManager.cleanup();
        this.shadowRenderer.cleanup();
        this.backend.dispose();
    }
}
