// renderer/frontend/Frontend.js (main orchestrator - simplified for terrain focus)

import { WebGL2Backend } from '../backend/WebGL2Backend.js';
import { WebGPUBackend } from '../backend/WebGPUBackend.js';
import { TerrainMeshManager } from '../terrain/TerrainMeshManager.js';
import { LODManager } from './lodManager.js';
import { ChunkCullingManager } from './chunkCullingManager.js';
import { UniformManager } from '../../lighting/uniformManager.js';

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
        
        this.terrainMeshManager = null;
        this.loadedChunks = new Map();
        
        this.camera = {
            position: { x: 0, y: 50, z: 0 },
            target: { x: 0, y: 0, z: 0 },
            near: 0.1,
            far: 15000,
            fov: 75,
            aspect: canvas.width / canvas.height
        };
        
        this.frameCount = 0;
        this.debugMode = false;
    }
    
    async initialize() {
        if (this.backendType === 'webgpu') {
            this.backend = new WebGPUBackend(this.canvas);
        } else {
            this.backend = new WebGL2Backend(this.canvas);
        }
        
        await this.backend.initialize();
        
        this.terrainMeshManager = new TerrainMeshManager(
            this.backend,
            this.textureManager,
            this.textureCache,
            this.uniformManager,
            this.lodManager
        );
        
        console.log('Frontend initialized with', this.backendType, 'backend');
    }
    
    updateCamera(gameState) {
        if (gameState.camera) {
            const camPos = gameState.camera.position;
            const camTarget = gameState.camera.target;
            this.camera.position = { x: camPos.x, y: camPos.z, z: camPos.y };
            this.camera.target = { x: camTarget.x, y: camTarget.z, z: camTarget.y };
        }
        
        this.uniformManager.updateCameraParameters(this.camera);
    }
    
    updateChunks(gameState, environmentState, deltaTime) {
        if (this.uniformManager) {
            this.uniformManager.currentEnvironmentState = environmentState;
        }

        const cullingResult = this.chunkCullingManager.updateVisibleChunks(
            gameState.terrain,
            this.camera.position
        );

        for (const loadedKey of this.loadedChunks.keys()) {
            if (!cullingResult.chunksToStay.has(loadedKey)) {
                this.unloadChunk(loadedKey);
            }
        }

        for (const chunkKey of cullingResult.visibleChunks) {
            if (!this.loadedChunks.has(chunkKey)) {
                const chunk = gameState.terrain.get(chunkKey);
                if (chunk) {
                    const lodLevel = this.lodManager.getLODForChunkKey(
                        chunkKey,
                        this.camera.position,
                        false
                    );
                    chunk.lodLevel = lodLevel;
                    this.loadChunk(chunkKey, chunk, environmentState);
                }
            }
        }

        for (const [chunkKey, chunkEntry] of this.loadedChunks.entries()) {
            const chunk = chunkEntry.chunkData;
            const oldLodLevel = chunk.lodLevel;

            const newLodLevel = this.lodManager.getLODForChunkKey(
                chunkKey,
                this.camera.position,
                false
            );

            if (oldLodLevel !== newLodLevel) {
                chunk.lodLevel = newLodLevel;
                this.terrainMeshManager.markChunkLODDirty(chunkKey);
            }
        }

        this.terrainMeshManager.updateEnvUniforms(environmentState);
    }
    
    loadChunk(chunkKey, chunkData, environmentState) {
        const meshEntry = this.terrainMeshManager.addChunk(chunkData, environmentState);
        if (!meshEntry) {
            console.error(`Failed to load terrain mesh for ${chunkKey}`);
            return;
        }

        this.loadedChunks.set(chunkKey, {
            chunkData,
            meshEntry
        });

        console.log(`Loaded chunk ${chunkKey} at LOD ${chunkData.lodLevel}`);
    }
    
    unloadChunk(chunkKey) {
        const entry = this.loadedChunks.get(chunkKey);
        if (!entry) return;

        const [cx, cz] = chunkKey.split(',').map(Number);
        this.terrainMeshManager.removeChunk(cx, cz);
        this.loadedChunks.delete(chunkKey);
    }
    
    render(gameState, environmentState, deltaTime)  {
        if (!this.textureManager?.loaded || !gameState.terrain) return;

        this.frameCount++;
        
        this.updateCamera(gameState);
        this.updateChunks(gameState, environmentState, deltaTime);

        this.backend.setRenderTarget(null);
        this.backend.setClearColor(0.5, 0.6, 0.7, 1.0);
        this.backend.clear(true, true, false);

        this.renderTerrain();
    }
    
    renderTerrain() {
        for (const [chunkKey, entry] of this.loadedChunks) {
            const meshEntry = entry.meshEntry;
            if (!meshEntry || !meshEntry.visible) continue;

            this.backend.draw(meshEntry.geometry, meshEntry.material);
        }
    }
    
    handleResize(width, height) {
        this.camera.aspect = width / height;
    }
    
    dispose() {
        this.terrainMeshManager.cleanup();
        this.loadedChunks.clear();
        this.backend.dispose();
    }
}