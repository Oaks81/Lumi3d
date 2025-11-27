
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
export class Frontend {
    constructor(canvas, options = {}) {
          

        this.canvas = canvas;
        this.backend = null;
        this.backendType = options.backendType || 'webgl2';

        this.textureManager = options.textureManager;
        this.textureCache = options.textureCache;
        this.chunkSize = options.chunkSize || 64;

        this.uniformManager = new UniformManager();

        this.lodManager = new LODManager({
            chunkSize: this.chunkSize,
        });

        this.chunkCullingManager = new ChunkCullingManager({
            chunkSize: this.chunkSize,
            viewDistance: 160,
            margin: this.chunkSize
        });

        this.masterChunkLoader = null;

        this.camera = {
            position: new THREE.Vector3(0, 50, 0),
            target: new THREE.Vector3(0, 0, 0),
            near: 0.1,
            far: 15000,
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
        this.orbitalSphereRenderer = null;
        
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
                // FIX: Do NOT swap Z and Y. Trust the engine's Y-up coordinates.
                this.camera.position.set(camPos.x, camPos.y, camPos.z); 
            }
    
            if (camTarget.isVector3) {
                this.camera.target.copy(camTarget);
            } else {
                // FIX: Do NOT swap Z and Y.
                this.camera.target.set(camTarget.x, camTarget.y, camTarget.z);
            }
    
            this._updateCameraMatrices();
        }
    
        this.uniformManager.updateCameraParameters(this.camera);
    }

    _updateCameraMatrices() {
        const position = this.camera.position;
        const target = this.camera.target;
    
        const zAxis = new THREE.Vector3().subVectors(position, target).normalize();
        const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    
        const te = this.camera.matrixWorldInverse.elements;
    
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
    
        // Verify camera is reasonable
        if (this.frameCount === 1) {
            console.log('📷 Camera setup:', {
                position: { x: position.x, y: position.y, z: position.z },
                target: { x: target.x, y: target.y, z: target.z },
                fov: this.camera.fov,
                aspect: this.camera.aspect.toFixed(2),
                near: this.camera.near,
                far: this.camera.far
            });
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
    
        console.log('MasterChunkLoader initialized successfully');
    }
    
    async updateChunks(gameState, environmentState, deltaTime) {
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
            deltaTime
        );
    
        this.uniformManager.updateFromEnvironmentState(environmentState);
    
        if (this.masterChunkLoader.terrainMeshManager) {
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


    async initialize(planetConfig = null) {
        this.planetConfig = planetConfig;
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
                console.log('🧹 Clearing pipeline cache');
                this.backend._pipelineCache.clear();
            }
        }
    
        if (this.backendType === 'webgl2' || !this.backend) {
            this.backend = new WebGL2Backend(this.canvas);
            await this.backend.initialize();
            console.log('Frontend initialized with WebGL2 backend');
        }
    
        this.backend.setViewport(0, 0, this.canvas.width, this.canvas.height);
    
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
    

        if (this.planetConfig) {
            const { OrbitalSphereRenderer } = await import('../orbitalSphereRenderer.js');
            this.orbitalSphereRenderer = new OrbitalSphereRenderer(
                this.backend,
                this.planetConfig
            );
            await this.orbitalSphereRenderer.initialize();
            console.log('OrbitalSphereRenderer initialized');
        } else {
            console.log('⏭Skipping OrbitalSphereRenderer (flat terrain mode)');
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


    async render(gameState, environmentState, deltaTime) {
        if (!this.textureManager?.loaded || !gameState.terrain) return;
    
        this.backend.device.pushErrorScope('validation');
    
        this.frameCount++;
    
        this.updateCamera(gameState);
        await this.updateChunks(gameState, environmentState, deltaTime);
        this.updateLighting(environmentState);
    
        if (this.frameCount % 2 === 0) {
            await this.updateShadows(environmentState);
        }
    
        this.backend.setRenderTarget(null);
        this.backend.setClearColor(0.0, 0.0, 0.0, 1.0);
        this.backend.clear(true, true, false);
    

        if (this.orbitalSphereRenderer && gameState.altitudeZoneManager) {
            this.orbitalSphereRenderer.update(
                this.camera,
                environmentState.sunLightDirection,
                gameState.altitudeZoneManager
            );
            this.orbitalSphereRenderer.render();
        }
    
        this.renderTerrain();
    
        if (this.backendType === 'webgpu') {
            this.backend.submitCommands();
        }
    
        const error = await this.backend.device.popErrorScope();
        if (error) {
            console.error('WebGPU validation error:', error.message);
        }
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
    
            meshEntry.material.uniforms.viewMatrix.value.copy(viewMatrix);
            meshEntry.material.uniforms.projectionMatrix.value.copy(projectionMatrix);
    
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

    dispose() {

        this.masterChunkLoader.cleanupAll();
        this.lightManager.cleanup();
        this.shadowRenderer.cleanup();
        this.backend.dispose();
    }
}