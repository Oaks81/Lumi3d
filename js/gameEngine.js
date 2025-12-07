
import { Frontend } from './renderer/frontend/frontend.js';
import { Camera } from './Camera.js';
import { ChunkManager } from './ChunkManager.js';
import { GameTime } from './gameTime.js';
import { EnvironmentState } from './environment/EnvironmentState.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TextureAtlasManager } from './texture/TextureManager.js';
import { Spaceship } from './game/spaceShip.js';
import { SpaceshipModel } from './game/spaceShipModel.js';
import { AltitudeController } from './game/altitudeController.js';
import { GameInputManager } from './GameInputManager.js';
import { TextureCache } from './texture/textureCache.js';
import { WebGL2WorldGenerator } from './world/webgl2WorldGenerator.js';
import { AltitudeZoneManager } from './planet/altitudeZoneManager.js';
import { PlanetConfig } from './planet/planetConfig.js';
import { SphericalChunkMapper } from './planet/sphericalChunkMapper.js';
import { TextureAtlasKey } from './world/textureAtlasKey.js';

import { DEFAULT_ATLAS_CONFIG } from './world/dataTextureConfiguration.js';
function updateCanvasResolution(canvas) {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    
    const width = Math.floor(displayWidth * dpr);
    const height = Math.floor(displayHeight * dpr);
    
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        
        console.log(` Canvas resolution: ${width}x${height} (DPR: ${dpr}, Display: ${displayWidth}x${displayHeight})`);
        return { width, height, changed: true };
    }
    
    return { width, height, changed: false };
}

function debugSphericalRendering() {
    console.log("=== SPHERICAL DEBUG ===");
    
    const engine = window.gameEngine;
    if (!engine) { console.log("No gameEngine"); return; }
    
    const cam = engine.camera;
    if (cam) {
        console.log("Camera position:", cam.position);
        console.log("Camera target/lookAt:", cam.target || cam._target);
        console.log("Camera near/far:", cam.near, cam.far);
    }
    
    const cm = engine.chunkManager;
    if (cm) {
        console.log("Loaded chunks:", cm.loadedChunks?.size || 0);
        const keys = Array.from(cm.loadedChunks?.keys() || []);
        console.log("Chunk keys (first 5):", keys.slice(0, 5));
        
        if (cm.loadedChunks?.size > 0) {
            const firstKey = keys[0];
            const chunk = cm.loadedChunks.get(firstKey);
            console.log("First chunk:", firstKey, chunk);
            console.log("  Has mesh?", !!chunk?.mesh);
            console.log("  Has textureRefs?", !!chunk?.textureRefs);
            if (chunk?.textureRefs) {
                console.log("  textureRefs.heightTexture:", chunk.textureRefs.heightTexture ? "SET" : "NULL");
                console.log("  textureRefs.useAtlasMode:", chunk.textureRefs.useAtlasMode);
                console.log("  textureRefs.uvTransform:", chunk.textureRefs.uvTransform);
            }
        }
    }
    
    const renderer = engine.renderer;
    if (renderer) {
        console.log("Renderer:", renderer);
        console.log("Render list count:", renderer.renderList?.length || renderer._renderList?.length || "unknown");
    }
    
    const tc = engine.textureCache;
    if (tc) {
        console.log("Texture cache entries:", tc.cache?.size || 0);
        console.log("Texture cache stats:", tc.getStats?.() || tc.stats);
        const cacheKeys = Array.from(tc.cache?.keys() || []);
        console.log("Cache keys (first 10):", cacheKeys.slice(0, 10));
    }
    
    const tmm = renderer?.terrainMeshManager || renderer?.chunkLoader?.terrainMeshManager;
    if (tmm) {
        console.log("TerrainMeshManager:", tmm);
        console.log("  Active meshes:", tmm.meshes?.size || tmm._meshes?.size || "unknown");
    }
}

export class GameEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error('Canvas element not found');
        }
        updateCanvasResolution(this.canvas);
        this.chunkSize = 128;
        this.textureCache = new TextureCache();
        window.gameEngine = this;
        window.debug = debugSphericalRendering;
    }

    diagnoseChunkKeys() {
        console.log('=== DIAGNOSTIC ===');
        const cmKeys = Array.from(this.chunkManager.loadedChunks.keys()).slice(0, 3);
        const tmm = this.renderer?.masterChunkLoader?.terrainMeshManager;
        if (tmm) {
            const tmmKeys = Array.from(tmm.chunkMeshes.keys()).slice(0, 3);
            console.log('ChunkManager:', cmKeys);
            console.log('TerrainMeshManager:', tmmKeys);
            console.log('Match:', cmKeys[0] === tmmKeys[0]);
            
            const first = tmm.chunkMeshes.values().next().value;
            if (first?.material?.uniforms) {
                const u = first.material.uniforms;
                console.log('chunkLocation:', u.chunkLocation?.value);
                console.log('Should be around (0.4, 0.5), NOT (7, 8)');
            }
        }
        console.log('==================');
    }
    toggleCameraMode() {
        this.cameraMode = this.cameraMode === 'manual' ? 'follow' : 'manual';
        console.log('Camera mode:', this.cameraMode);
    
        if (this.cameraMode === 'follow') {
            this.camera.follow(this.spaceship);
            this.camera.resetOrbit();
        } else {
            this.camera.unfollow();
        }
    }
    updateManualCamera(deltaTime, keys, mouseDelta) {
        const moveSpeed = 50 * deltaTime;
    
        let forward = 0, right = 0, up = 0;
    
        if (keys['w'] || keys['W']) forward += moveSpeed;
        if (keys['s'] || keys['S']) forward -= moveSpeed;
        if (keys['a'] || keys['A']) right -= moveSpeed;
        if (keys['d'] || keys['D']) right += moveSpeed;
        if (keys['q'] || keys['Q']) up -= moveSpeed;
        if (keys['e'] || keys['E']) up += moveSpeed;
        
        if (keys['Shift']) {
            forward *= 3;
            right *= 3;
            up *= 3;
        }
    
        if (forward !== 0 || right !== 0 || up !== 0) {
            this.camera.moveRelative(forward, right, up);
        }
    
        if (this.inputManager.isLeftDragging()) {
            this.camera.handleManualLook(mouseDelta.x, mouseDelta.y);
        }
    }
    async start() {
        console.log('Starting game engine...');
        if (!this.chunkSize || this.chunkSize <= 0) {
            throw new Error(`Invalid chunkSize: ${this.chunkSize}`);
        }

        console.log('========== RENDER DIAGNOSTIC START ==========');

        const usePlanetaryMode = true;
   
        if (usePlanetaryMode) {
            this.planetConfig = PlanetConfig.createSmallMoon({ 
                name: 'TestPlanet',
                radius: 50000,
                atmosphereHeight: 10000,
                surfaceChunkSize: this.chunkSize,
                surfaceAltitude: 500,
                lowAltitude: 2000,
                transitionAltitude: 10000,
                orbitalAltitude: 25000,
                originX: 0,
                originY: 0,
                originZ: 0,
            });
        

            this.altitudeZoneManager = new AltitudeZoneManager(this.planetConfig);
    
            this.planetConfig.altitudeZoneManager = this.altitudeZoneManager;
            this.sphericalMapper = new SphericalChunkMapper(this.planetConfig, 16);
        } else {
            console.log('Using FLAT TERRAIN mode (no planetary projection)');
            this.planetConfig = null;
            this.altitudeZoneManager = null;
            this.sphericalMapper = null;
        }
    
        updateCanvasResolution(this.canvas);
    
        this.inputManager = new GameInputManager(this.canvas);
        this.gameTime = new GameTime();
    
        const useWebGPU = false;
        const backendType = useWebGPU ? 'webgpu' : 'webgl2';
    
        this.renderer = new Frontend(this.canvas, {
            textureCache: this.textureCache,
            chunkSize: this.chunkSize,
            backendType: backendType
        });
        await this.renderer.initialize(this.planetConfig, this.sphericalMapper);
    
        
        const actualApiName = this.renderer.getBackendType();
        console.log(`Renderer initialized with ${actualApiName} backend`);

        let gpuDevice = null;
        if (actualApiName === 'webgpu') {
            gpuDevice = this.renderer.backend.device;
        }
    
        this.textureManager = new TextureAtlasManager(true, actualApiName, gpuDevice);
        this.textureManager.backend = this.renderer.backend;  

        this.renderer.textureManager = this.textureManager;

        console.log('Initializing texture atlases...');
        await this.textureManager.initializeAtlases(true);
        console.log('Texture atlases loaded');

console.log('=== Testing TextureAtlasKey System ===');

const testChunks = [
    [0, 0],
    [15, 15],
    [16, 0],
    [17, 5],
    [32, 32]
];


console.log('\n=== Testing key parsing ===');
const testKeys = [
    'atlas_0,0_2048',
    'atlas_1,0_2048',
    'atlas_f0_0,0_2048',
    'atlas_f2_1,1_2048'
];

for (const keyStr of testKeys) {
    console.log(`\nParsing: "${keyStr}"`);
    const parsed = TextureAtlasKey.fromString(keyStr, DEFAULT_ATLAS_CONFIG);
    console.log(`  Reconstructed: "${parsed.toString()}"`);
    console.log(`  Match: ${keyStr === parsed.toString()}`);
}

console.log('=== TextureAtlasKey tests complete ===\n');
    
   
        await this.renderer.initializeChunkLoader();


    
        if (useWebGPU && 'gpu' in navigator) {
            console.log("Running WebGPU mode for world generation");
            const { WebGPUWorldGenerator } = await import('./world/webgpuWorldGenerator.js');
            this.worldGenerator = new WebGPUWorldGenerator(
                this.renderer.getBackend(),
                this.textureCache,
                this.chunkSize,
                12345
            );
        } else {
            console.log("Running WebGL2 mode for world generation");
            this.worldGenerator = new WebGL2WorldGenerator(
                this.renderer.getBackend(),
                this.textureCache,
                this.chunkSize,
                12345
            );
        }
    
        await this.worldGenerator._ready;
    
        this.environmentState = new EnvironmentState(this.gameTime, this.planetConfig);
    
        this.spaceship = new Spaceship();
        this.spaceshipModel = new SpaceshipModel();
        this.altitudeController = new AltitudeController(this.spaceship);
        this.chunkManager = new ChunkManager(this.worldGenerator, {
            sphericalMapper: this.sphericalMapper,
            useSphericalProjection: usePlanetaryMode,
        });
    
        this.cameraMode = 'manual';
        this.manualCamera = {
            position: new THREE.Vector3(0, 50, 0),
            target: new THREE.Vector3(0, 0, 0),
            moveSpeed: 20,
            lookSpeed: 0.002
        };
    
        this.camera = new Camera({
            aspect: this.canvas.width / this.canvas.height,
            cameraDistance: 12,
            cameraHeight: 6,
            cameraAngle: 0.25,
            cameraSmoothing: 0.15
        });
        if (this.spaceshipModel && this.spaceshipModel.mesh) {
            this.renderer.genericMeshRenderer.addMesh('spaceship', this.spaceshipModel.mesh);
        }
        window.addEventListener('keydown', (e) => {
            if (e.key === 'v') {
                this.toggleCameraMode();
            }
        });
    
        this._resizeHandler = () => this.handleResize();
        this.isGameActive = false;
        this.gameState = null;
    
        this.setupUI();
    
        await this.chunkManager.initialize();
    
        setTimeout(() => {
            console.log('Initial terrain state:', {
                loadedChunks: Array.from(this.chunkManager.loadedChunks.keys()),
                chunk_0_0: this.chunkManager.getChunk(0, 0) ? 'exists' : 'missing',
                sampleHeight: this.chunkManager.getChunk(0, 0)?.getHeight(32, 32),
                mode: this.chunkManager.useSphericalProjection ? 'spherical' : 'flat'
            });
        }, 1000);
    
        this.camera.follow(this.spaceship);


console.log('Camera created:', {
    position: this.camera.position,
    fov: this.camera.fov,
    near: this.camera.near,
    far: this.camera.far
});

console.log('ChunkManager initialized:', {
    loadedChunks: this.chunkManager.loadedChunks.size,
    keys: Array.from(this.chunkManager.loadedChunks.keys()),
    mode: this.chunkManager.useSphericalProjection ? 'spherical' : 'flat'
});

console.log('Spaceship reset:', {
    position: this.spaceship.position,
    expectedAltitude: this.planetConfig ? this.planetConfig.radius + 100 : 100
});

setTimeout(() => {
    const meshManager = this.renderer?.masterChunkLoader?.terrainMeshManager;
    console.log('Mesh check (after 1s):', {
        meshCount: meshManager?.chunkMeshes?.size || 0,
        meshKeys: meshManager ? Array.from(meshManager.chunkMeshes.keys()) : [],
        textureCache: this.textureCache?.cache?.size || 0
    });
    
    if (meshManager?.chunkMeshes?.size > 0) {
        const [key, mesh] = meshManager.chunkMeshes.entries().next().value;
        console.log('  First mesh:', {
            key,
            visible: mesh.visible,
            hasGeometry: !!mesh.geometry,
            hasMaterial: !!mesh.material,
            vertexCount: mesh.geometry?.attributes?.get?.('position')?.count
        });
    }
}, 1000);

console.log('========== RENDER DIAGNOSTIC END ==========');
    



        this.inputManager.start();
    
        this.isGameActive = true;
    
        let spawnX = 0;
        let spawnY = 0;
        let spawnZ = 100;
        
        if (this.planetConfig) {
   
            
            const spawnHeight = 1500;
            spawnZ = this.planetConfig.radius + spawnHeight;
            
            console.log(' Planetary spawn calculation:', {
                planetRadius: this.planetConfig.radius,
                spawnHeight: spawnHeight,
                calculatedSpawnZ: spawnZ
            });
        }
        this.spaceship.reset(spawnX, spawnY, spawnZ);
        console.log(' Spaceship spawned at:', this.spaceship.position);
        this.camera.follow(this.spaceship);
        console.log(' Camera snapped to:', this.camera.position);
        
        this.inputManager.start();
        this.isGameActive = true;
        
        console.log('Game engine started');
    }
    stop() {
        this.isGameActive = false;
        this.inputManager.stop();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        console.log('Game engine stopped');
    }


update(deltaTime) {
    if (!this.isGameActive) return;
    deltaTime = Math.min(deltaTime, 0.1);
    this.gameTime.update();

    const cameraRenderPos = new THREE.Vector3(
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z
    );

    if (this.altitudeZoneManager) {
        this.altitudeZoneManager.update(cameraRenderPos, deltaTime);
    }

    const cameraGameX = cameraRenderPos.x;
    const cameraGameY = cameraRenderPos.z;
    const cameraGameZ = cameraRenderPos.y;

    const terrainHeight = this.getTerrainHeightAt(
        this.spaceship.position.x,
        this.spaceship.position.y,
        this.spaceship.position.z
    );


    const keys = this.inputManager.getKeys();
    const mouseDelta = this.inputManager.getMouseDelta();
    const wheelDelta = this.inputManager.getWheelDelta();

    if (this.cameraMode === 'manual') {
        this.updateManualCamera(deltaTime, keys, mouseDelta);
        
    } else {
        this.altitudeController.update(deltaTime, keys);

        const shipState = this.spaceship.update(deltaTime, terrainHeight);

        if (shipState === 'crashed') {
            this.onCrash();
        }

        if (this.inputManager.isLeftDragging()) {
            this.camera.handleOrbitInput(mouseDelta.x, mouseDelta.y);
        }

        if (wheelDelta !== 0) {
            this.camera.handleZoom(wheelDelta);
        }

        this.camera.update();
    }

    this.spaceshipModel.update(this.spaceship.getState());
    if (this.renderer && this.renderer.genericMeshRenderer) {
        this.renderer.genericMeshRenderer.updateMesh('spaceship');
    }
    this.chunkManager.update(
        cameraGameX,
        cameraGameY,
        cameraGameZ
    );

    this.gameState = {
        time: performance.now(),
        player: this.spaceship,
        spaceship: this.spaceship,
        terrain: this.chunkManager.loadedChunks,
        objects: new Map(),
        camera: this.camera,
        altitudeZoneManager: this.altitudeZoneManager
    };
    
    this.environmentState.update(this.gameState);

    this.updateUI();
}

getTerrainHeightAt(gameX, gameY, gameZ = null) {
   
    const chunkSize = this.worldGenerator.chunkSize;
    const chunkX = Math.floor(gameX / chunkSize);
    const chunkY = Math.floor(gameY / chunkSize);
    
    const chunkKey = `${chunkX},${chunkY}`;
    const chunk = this.chunkManager.getChunk(chunkX, chunkY);
    
    if (!chunk) {
        if (this.planetConfig) {
            return this.planetConfig.origin.y + this.planetConfig.radius;
        }
        return 0;
    }

    const localX = gameX - (chunkX * chunkSize);
    const localY = gameY - (chunkY * chunkSize);
    
    return chunk.getHeight(localX, localY);
}
    async render(deltaTime) {
        if (!this.isGameActive) return;
        if (this.renderer && this.gameState) {
            this.renderer.render(this.gameState, this.environmentState, deltaTime, this.planetConfig, this.sphericalMapper);
        }
    }



    onCrash() {
        console.log('GAME OVER - Crashed!');
        this.showCrashScreen();
        
        setTimeout(() => {
            this.resetGame();
        }, 3000);
    }

    resetGame() {
        this.spaceship.reset(0, 0, 15);
        this.hideCrashScreen();
    }

    setupUI() {
        const ui = document.createElement('div');
        ui.id = 'game-ui';
        ui.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            color: white;
            font-family: monospace;
            font-size: 14px;
            background: rgba(0,0,0,0.5);
            padding: 10px;
            border-radius: 5px;
            pointer-events: none;
            z-index: 100;
        `;
        document.body.appendChild(ui);
        this.uiElement = ui;
        
        const crashScreen = document.createElement('div');
        crashScreen.id = 'crash-screen';
        crashScreen.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: red;
            font-family: monospace;
            font-size: 48px;
            font-weight: bold;
            display: none;
            z-index: 200;
            text-shadow: 2px 2px 4px black;
        `;
        crashScreen.textContent = 'CRASHED!';
        document.body.appendChild(crashScreen);
        this.crashScreen = crashScreen;
    }

    updateUI() {
        if (!this.uiElement) return;
    
        const shipState = this.spaceship.getState();
        const zoneInfo = this.altitudeZoneManager?.getDebugInfo();
    
        const controlsInfo = this.cameraMode === 'follow' ? `
            <div style="color: #00ff00; font-size: 12px;">
                <strong>FLIGHT MODE</strong><br>
                <div style="font-size: 10px; line-height: 1.3; margin-left: 10px;">
                    W/S: Throttle | A/D: Turn<br>
                    Z/X: Pitch | Q/E: Vertical<br>
                    Mouse Drag: Orbit Camera<br>
                    Wheel: Zoom | V: Free Cam
                </div>
            </div>
        ` : `
            <div style="color: #ffff00; font-size: 12px;">
                <strong>FREE CAMERA</strong><br>
                <div style="font-size: 10px;">
                    WASD: Move | QE: Up/Down<br>
                    Shift: Fast | Drag: Look<br>
                    V: Follow Mode
                </div>
            </div>
        `;
    
        const flightInfo = `
            <div style="margin-top: 8px; border-top: 1px solid #555; padding-top: 5px;">
                <strong style="font-size: 11px;">SHIP</strong><br>
                <div style="font-family: 'Courier New'; font-size: 10px; line-height: 1.3;">
                Speed: <span style="color: #0ff;">${shipState.speed.toFixed(1)}</span><br>
                Pos: ${shipState.position.x.toFixed(0)}, ${shipState.position.y.toFixed(0)}, ${shipState.position.z.toFixed(0)}
                </div>
            </div>
        `;
    
        const altitudeInfo = zoneInfo ? `
            <div style="margin-top: 8px; border-top: 1px solid #555; padding-top: 5px;">
                <strong style="font-size: 11px;">PLANET</strong><br>
                <div style="font-family: 'Courier New'; font-size: 10px; line-height: 1.3;">
                Altitude: <span style="color: #0ff;">${zoneInfo.altitude.toFixed(0)}m</span><br>
                Zone: <span style="color: #ff0;">${zoneInfo.zone.toUpperCase()}</span><br>
                Horizon: ${zoneInfo.horizonDistance.toFixed(0)}m<br>
                Terrain: ${(zoneInfo.terrainBlend * 100).toFixed(0)}%<br>
                Orbital: ${(zoneInfo.orbitalBlend * 100).toFixed(0)}%
                </div>
            </div>
        ` : '';
    
        this.uiElement.innerHTML = controlsInfo + flightInfo + altitudeInfo;
    }
    showCrashScreen() {
        if (this.crashScreen) {
            this.crashScreen.style.display = 'block';
        }
    }

    hideCrashScreen() {
        if (this.crashScreen) {
            this.crashScreen.style.display = 'none';
        }
    }

    setupAudioInput(pitchCallback) {
        this.altitudeController.setupPitchInput(pitchCallback);
        console.log('Audio input configured');
    }
    
    onPitchDetected(noteEvent, intensity) {
        this.altitudeController.onPitchEvent(noteEvent, intensity);
    }

    handleResize() {
        const result = updateCanvasResolution(this.canvas);
        
        if (result.changed) {
            if (this.renderer && this.renderer.backend) {
                this.renderer.backend.setViewport(0, 0, result.width, result.height);
            }
            
            if (this.camera) {
                this.camera.aspect = result.width / result.height;
                
                if (this.renderer && this.renderer.camera) {
                    this.renderer.camera.aspect = result.width / result.height;
                    this.renderer._updateCameraMatrices();
                }
            }
            
            console.log('Resize handled: Camera aspect updated');
        }
    }

    getStats() {
        return {
            spaceship: this.spaceship.getState(),
            chunks: this.chunkManager.getStats(),
            fps: 0
        };
    }
}
