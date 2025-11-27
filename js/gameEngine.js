
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

export class GameEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error('Canvas element not found');
        }
        updateCanvasResolution(this.canvas);
        this.chunkSize = 128;
        this.textureCache = new TextureCache();
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
            console.log('🗺️ Using FLAT TERRAIN mode (no planetary projection)');
            this.planetConfig = null;
            this.altitudeZoneManager = null;
            this.sphericalMapper = null;
        }
    
        updateCanvasResolution(this.canvas);
    
        this.inputManager = new GameInputManager(this.canvas);
        this.gameTime = new GameTime();
    
        const useWebGPU = true;
        const backendType = useWebGPU ? 'webgpu' : 'webgl2';
    
        this.renderer = new Frontend(this.canvas, {
            textureCache: this.textureCache,
            chunkSize: this.chunkSize,
            backendType: backendType
        });
        await this.renderer.initialize(this.planetConfig);
    
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


// Test 1: Chunk to atlas mapping
const testChunks = [
    [0, 0],
    [15, 15],
    [16, 0],
    [17, 5],
    [32, 32]
];

for (const [cx, cy] of testChunks) {
    console.log(`\nTest chunk (${cx},${cy}):`);
    const atlasKey = TextureAtlasKey.fromChunkCoords(cx, cy, null, 2048, 128);
    console.log(`  Atlas key: "${atlasKey.toString()}"`);
    
    const uvTransform = atlasKey.getChunkUVTransform(cx, cy);
    console.log(`  UV transform: offset=(${uvTransform.offsetX.toFixed(4)}, ${uvTransform.offsetY.toFixed(4)}), scale=${uvTransform.scale.toFixed(4)}`);
    
    console.log(`  Contains chunk: ${atlasKey.containsChunk(cx, cy)}`);
}

// Test 2: Parse key strings
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

        const useWebGPUWorldGen = true;
    
        if (useWebGPUWorldGen && 'gpu' in navigator) {
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
    
        this.environmentState = new EnvironmentState(this.gameTime);
    
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
            console.log('🗺️ Initial terrain state:', {
                loadedChunks: Array.from(this.chunkManager.loadedChunks.keys()),
                chunk_0_0: this.chunkManager.getChunk(0, 0) ? 'exists' : 'missing',
                sampleHeight: this.chunkManager.getChunk(0, 0)?.getHeight(32, 32),
                mode: this.chunkManager.useSphericalProjection ? 'spherical' : 'flat'
            });
        }, 1000);
    
        this.camera.follow(this.spaceship);
        this.inputManager.start();
    
        this.isGameActive = true;
    
        let spawnX = 0;
        let spawnY = 0;
        let spawnZ = 100;
        
        if (this.planetConfig) {
            const surfaceAltitude = this.planetConfig.origin.y + this.planetConfig.radius;
            spawnZ = surfaceAltitude + 100;
            
            console.log('🌍 Planetary spawn:', {
                origin: this.planetConfig.origin,
                radius: this.planetConfig.radius,
                surfaceAltitude: surfaceAltitude,
                spawnZ: spawnZ
            });
        }
        this.spaceship.reset(spawnX, spawnY, spawnZ);
        console.log('🚀 Spaceship spawned at:', this.spaceship.position);
        this.camera.follow(this.spaceship);
        console.log('📷 Camera snapped to:', this.camera.position);
        
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

    // ============================================
    // Camera position is in RENDER coords (Y-up)
    // ============================================
    const cameraRenderPos = new THREE.Vector3(
        this.camera.position.x,   // Render X (east)
        this.camera.position.y,   // Render Y (altitude) ← UP!
        this.camera.position.z    // Render Z (north)
    );

    // Update altitude zone manager (expects render coords)
    if (this.altitudeZoneManager) {
        this.altitudeZoneManager.update(cameraRenderPos, deltaTime);
    }

    // ============================================
    // Convert camera position to GAME coords for terrain lookup
    // ============================================
    const cameraGameX = cameraRenderPos.x;      // X stays same
    const cameraGameY = cameraRenderPos.z;      // Render Z → Game Y (north)
    const cameraGameZ = cameraRenderPos.y;      // Render Y → Game Z (altitude)

    // Get terrain height at spaceship position
    const terrainHeight = this.getTerrainHeightAt(
        this.spaceship.position.x,
        this.spaceship.position.y,
        this.spaceship.position.z
    );


    // Get user input
    const keys = this.inputManager.getKeys();
    const mouseDelta = this.inputManager.getMouseDelta();
    const wheelDelta = this.inputManager.getWheelDelta();

    // ============================================
    // CAMERA MODE HANDLING
    // ============================================
    if (this.cameraMode === 'manual') {
        // Manual/free camera mode
        this.updateManualCamera(deltaTime, keys, mouseDelta);
        
    } else {
        // Follow mode - camera follows spaceship
        
        // Update altitude controller (handles pitch input)
        this.altitudeController.update(deltaTime, keys);

        // Update spaceship physics
        const shipState = this.spaceship.update(deltaTime, terrainHeight);

        // Check for crash
        if (shipState === 'crashed') {
            this.onCrash();
        }

        // Handle camera orbit controls
        if (this.inputManager.isLeftDragging()) {
            this.camera.handleOrbitInput(mouseDelta.x, mouseDelta.y);
        }

        // Handle camera zoom
        if (wheelDelta !== 0) {
            this.camera.handleZoom(wheelDelta);
        }

        // Update camera to follow spaceship
        // Camera.update() handles game→Three.js conversion internally
        this.camera.update();
    }

    // Update spaceship model for rendering
    this.spaceshipModel.update(this.spaceship.getState());

    // ============================================
    // CHUNK LOADING
    // Pass spaceship position in GAME coordinates
    // ChunkManager will handle conversion internally
    // ============================================
    this.chunkManager.update(
        cameraGameX,   // Game X (east)
        cameraGameY,   // Game Y (north)
        cameraGameZ    // Game Z (altitude) ← UP!
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
    
    // Update environment state (time of day, weather, etc.)
    this.environmentState.update(this.gameState);

    // Update UI display
    this.updateUI();
}
// js/GameEngine.js

/**
 * Get terrain height at GAME coordinates
 * @param {number} gameX - Game X (horizontal east)
 * @param {number} gameY - Game Y (horizontal north)
 * @param {number} gameZ - Game Z (altitude) - used for spherical lookup
 * @returns {number} Height in game coords
 */
// js/GameEngine.js

getTerrainHeightAt(gameX, gameY, gameZ = null) {
   
    const chunkSize = this.worldGenerator.chunkSize;
    const chunkX = Math.floor(gameX / chunkSize);
    const chunkY = Math.floor(gameY / chunkSize);
    
    const chunkKey = `${chunkX},${chunkY}`;
    const chunk = this.chunkManager.getChunk(chunkX, chunkY);
    
    if (!chunk) {
        // Return safe default
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
            this.renderer.render(this.gameState, this.environmentState, deltaTime);
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
            // Update renderer viewport
            if (this.renderer && this.renderer.backend) {
                this.renderer.backend.setViewport(0, 0, result.width, result.height);
            }
            
            // Update camera aspect ratio
            if (this.camera) {
                this.camera.aspect = result.width / result.height;
                
                // Update camera matrices if using Frontend camera
                if (this.renderer && this.renderer.camera) {
                    this.renderer.camera.aspect = result.width / result.height;
                    this.renderer._updateCameraMatrices();
                }
            }
            
            console.log(' Resize handled: Camera aspect updated');
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