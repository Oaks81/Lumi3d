// plantStreamer.js - PURE GPU APPROACH
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { PLANT_CONFIGS } from './plantConfig.js';
import { buildVertexShader, buildFragmentShader } from './plantShaders.js';

/**
 * Manages GPU-accelerated streaming of plant instances
 */
export class PlantStreamer {
    /**
     * Creates a new PlantStreamer
     * @param {THREE.Scene} scene - The Three.js scene
     * @param {Object} terrainMeshManager - The terrain mesh manager
     * @param {Object} textureManager - The texture manager
     * @param {Object} uniformManager - The uniform manager for lighting
     * @param {Object} options - Configuration options
     */
    constructor(scene, terrainMeshManager, textureManager, uniformManager, options = {}) {
        this.scene = scene;
        this.terrainMeshManager = terrainMeshManager;
        this.textureManager = textureManager;
        this.uniformManager = uniformManager;
        
        this.streamRadius = options.streamRadius || 60;
        this.updateInterval = options.updateInterval || 400;
        this.lodDistances = options.lodDistances || [15, 40, 80];
        this.gridSpacing = options.gridSpacing || 0.35;
        this.chunkSize = options.chunkSize || 64;
        
        // Simple chunk tracking
        this.chunkMeshes = new Map(); // chunkKey -> { grass: Mesh, flowers: Mesh, ... }
        
        // Shared resources
        this.geometries = new Map();
        this.materials = new Map();
        
        this.lastCameraPos = new THREE.Vector3();
        this.lastUpdateTime = 0;
        this.windTime = 0;
    }
    
    /**
     * Initialize geometries and materials for all plant types
     * @returns {Promise<void>}
     */
    async initialize() {
        console.log('Initializing GPU-driven PlantStreamer...');
        
        // Create ONE geometry + material per plant type
        for (const [typeName, config] of Object.entries(PLANT_CONFIGS)) {
            const geometry = await this.createGrassGeometry(typeName, 0, 0);
            this.geometries.set(typeName, geometry);
            
            const material = await this.createMaterial(typeName, config);
            this.materials.set(typeName, material);
        }
        
        console.log('PlantStreamer ready');
    }
    
    /**
     * Update the plant streaming system
     * @param {THREE.Vector3} cameraPosition - The current camera position
     * @param {Map} terrain - The terrain chunk map
     * @param {number} deltaTime - Time since last update in milliseconds
     * @returns {Promise<void>}
     */
    async update(cameraPosition, terrain, deltaTime) {
        const now = Date.now();
        
        // Update wind
        this.updateWind(deltaTime);
        
        // Update LODs (cheap)
        this.updateLODs(cameraPosition);
        
        // Throttle chunk streaming
        if (now - this.lastUpdateTime < this.updateInterval) return;
        this.lastUpdateTime = now;
        
        const distanceMoved = cameraPosition.distanceTo(this.lastCameraPos);
        if (distanceMoved < this.chunkSize * 0.25) return;
        
        this.lastCameraPos.copy(cameraPosition);
        await this.streamChunks(cameraPosition, terrain);
    }
    
    /**
     * Stream chunks based on camera position
     * @param {THREE.Vector3} cameraPosition - The current camera position
     * @param {Map} terrain - The terrain chunk map
     * @returns {Promise<void>}
     */
    async streamChunks(cameraPosition, terrain) {
        const visibleChunks = this.getVisibleChunkKeys(cameraPosition);
        this.loadVisibleChunks(visibleChunks, terrain, cameraPosition);
        this.unloadInvisibleChunks(visibleChunks);
    }
    
    /**
     * Get the keys of chunks visible from the camera
     * @param {THREE.Vector3} cameraPosition - The current camera position
     * @returns {Set<string>} Set of visible chunk keys
     */
    getVisibleChunkKeys(cameraPosition) {
        const minChunkX = Math.floor((cameraPosition.x - this.streamRadius) / this.chunkSize);
        const maxChunkX = Math.ceil((cameraPosition.x + this.streamRadius) / this.chunkSize);
        const minChunkZ = Math.floor((cameraPosition.z - this.streamRadius) / this.chunkSize);
        const maxChunkZ = Math.ceil((cameraPosition.z + this.streamRadius) / this.chunkSize);
        
        const visibleChunks = new Set();
        
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                const chunkKey = `${cx},${cz}`;
                visibleChunks.add(chunkKey);
            }
        }
        
        return visibleChunks;
    }
    
    /**
     * Load chunks that are visible
     * @param {Set<string>} visibleChunks - Set of visible chunk keys
     * @param {Map} terrain - The terrain chunk map
     * @param {THREE.Vector3} cameraPosition - The current camera position
     */
    loadVisibleChunks(visibleChunks, terrain, cameraPosition) {
        for (const chunkKey of visibleChunks) {
            if (!this.chunkMeshes.has(chunkKey)) {
                const terrainChunk = terrain.get(chunkKey);
                if (terrainChunk) {
                    const [cx, cz] = chunkKey.split(',').map(Number);
                    this.loadChunk(cx, cz, chunkKey, cameraPosition);
                }
            }
        }
    }
    
    /**
     * Unload chunks that are not visible
     * @param {Set<string>} visibleChunks - Set of visible chunk keys
     */
    unloadInvisibleChunks(visibleChunks) {
        for (const chunkKey of this.chunkMeshes.keys()) {
            if (!visibleChunks.has(chunkKey)) {
                this.unloadChunk(chunkKey);
            }
        }
    }
    
    /**
     * Load chunk - Create ONE instanced mesh per plant type
     * @param {number} chunkX - The chunk X coordinate
     * @param {number} chunkZ - The chunk Z coordinate
     * @param {string} chunkKey - The chunk key string
     * @param {THREE.Vector3} cameraPosition - The current camera position
     */
    loadChunk(chunkX, chunkZ, chunkKey, cameraPosition) {
        const textures = this.getChunkTextures(chunkX, chunkZ, chunkKey);
        if (!textures) return;
        
        const chunkData = this.calculateChunkData(chunkX, chunkZ, cameraPosition);
        const chunkMeshes = this.createChunkMeshes(textures, chunkData);
        
        this.chunkMeshes.set(chunkKey, chunkMeshes);
        console.log(`Loaded plant chunk ${chunkKey} with ${Object.keys(chunkMeshes).length} types`);
    }
    
    /**
     * Get textures for a chunk
     * @param {number} chunkX - The chunk X coordinate
     * @param {number} chunkZ - The chunk Z coordinate
     * @param {string} chunkKey - The chunk key string
     * @returns {Object|null} Object with height, normal, and tile textures
     */
    getChunkTextures(chunkX, chunkZ, chunkKey) {
        const heightTexture = this.terrainMeshManager.getHeightTexture(chunkX, chunkZ);
        const normalTexture = this.terrainMeshManager.getNormalTexture(chunkX, chunkZ);
        const tileTexture = this.terrainMeshManager.getTileTexture(chunkX, chunkZ);
        
        if (!heightTexture || !tileTexture) {
            console.warn(`Missing textures for chunk ${chunkKey}`);
            return null;
        }
        
        return { heightTexture, normalTexture, tileTexture };
    }
    
    /**
     * Calculate chunk data including offset, center, and LOD
     * @param {number} chunkX - The chunk X coordinate
     * @param {number} chunkZ - The chunk Z coordinate
     * @param {THREE.Vector3} cameraPosition - The current camera position
     * @returns {Object} Chunk data object
     */
    calculateChunkData(chunkX, chunkZ, cameraPosition) {
        const chunkOffset = new THREE.Vector2(
            chunkX * this.chunkSize,
            chunkZ * this.chunkSize
        );
        
        const chunkCenter = new THREE.Vector3(
            (chunkX + 0.5) * this.chunkSize,
            0,
            (chunkZ + 0.5) * this.chunkSize
        );
        
        const distance = cameraPosition.distanceTo(chunkCenter);
        const lodLevel = this.getLODForDistance(distance);
        
        return { chunkOffset, chunkCenter, lodLevel };
    }
    
    /**
     * Create instanced meshes for all plant types in a chunk
     * @param {Object} textures - The chunk textures
     * @param {Object} chunkData - The chunk data
     * @returns {Object} Map of plant type to mesh data
     */
    createChunkMeshes(textures, chunkData) {
        const chunkMeshes = {};
        
        for (const [typeName, config] of Object.entries(PLANT_CONFIGS)) {
            const meshData = this.createPlantMesh(
                typeName,
                config,
                textures,
                chunkData
            );
            
            if (meshData) {
                chunkMeshes[typeName] = meshData;
            }
        }
        
        return chunkMeshes;
    }
    
    /**
     * Create an instanced mesh for a specific plant type
     * @param {string} typeName - The plant type name
     * @param {Object} config - The type configuration
     * @param {Object} textures - The chunk textures
     * @param {Object} chunkData - The chunk data
     * @returns {Object|null} Mesh data object or null if creation failed
     */
    createPlantMesh(typeName, config, textures, chunkData) {
        const geometry = this.geometries.get(typeName);
        const baseMaterial = this.materials.get(typeName);
        
        if (!geometry || !baseMaterial) {
            console.error(`Missing geometry or material for ${typeName}`);
            return null;
        }
        
        // Clone material for per-chunk uniforms
        const material = baseMaterial.clone();
        this.setMaterialUniforms(material, textures, chunkData);
        
        const mesh = this.createInstancedMesh(geometry, material, chunkData.chunkOffset);
        
        this.scene.add(mesh);
        
        return {
            mesh,
            lodLevel: chunkData.lodLevel,
            chunkCenter: chunkData.chunkCenter
        };
    }
    
    /**
     * Set uniforms for a chunk material
     * @param {THREE.ShaderMaterial} material - The material to update
     * @param {Object} textures - The chunk textures
     * @param {Object} chunkData - The chunk data
     */
    setMaterialUniforms(material, textures, chunkData) {
        material.uniforms.u_heightTexture.value = textures.heightTexture;
        material.uniforms.u_normalTexture.value = textures.normalTexture;
        material.uniforms.u_tileTexture.value = textures.tileTexture;
        material.uniforms.u_chunkOffset.value.copy(chunkData.chunkOffset);
        material.uniforms.u_chunkSize.value = this.chunkSize;
        material.uniforms.u_lodLevel.value = chunkData.lodLevel;
        material.uniforms.u_gridSpacing.value = this.gridSpacing;
    }
    
    /**
     * Create an instanced mesh with positioned instances
     * @param {THREE.BufferGeometry} geometry - The geometry to use
     * @param {THREE.Material} material - The material to use
     * @param {THREE.Vector2} chunkOffset - The chunk offset in world space
     * @returns {THREE.InstancedMesh} The created instanced mesh
     */
    createInstancedMesh(geometry, material, chunkOffset) {
        const gridSize = Math.ceil(this.chunkSize / this.gridSpacing);
        const maxInstances = gridSize * gridSize;
        
        const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
        
        this.positionInstances(mesh, gridSize, chunkOffset);
        
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        
        return mesh;
    }
    
    /**
     * Position instances in a grid pattern
     * @param {THREE.InstancedMesh} mesh - The mesh to position instances for
     * @param {number} gridSize - The size of the grid
     * @param {THREE.Vector2} chunkOffset - The chunk offset in world space
     */
    positionInstances(mesh, gridSize, chunkOffset) {
        let instanceIndex = 0;
        
        for (let lz = 0; lz < gridSize; lz++) {
            for (let lx = 0; lx < gridSize; lx++) {
                const worldX = chunkOffset.x + lx * this.gridSpacing;
                const worldZ = chunkOffset.y + lz * this.gridSpacing;
                
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3(worldX, 0, worldZ);
                const rotation = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(0, this.getRotation(worldX, worldZ), 0)
                );
                const scale = new THREE.Vector3(1, 1, 1);
                
                matrix.compose(position, rotation, scale);
                mesh.setMatrixAt(instanceIndex++, matrix);
            }
        }
    }
    
    /**
     * Update LODs based on camera distance
     * @param {THREE.Vector3} cameraPosition - The current camera position
     */
    updateLODs(cameraPosition) {
        for (const [chunkKey, chunkMeshes] of this.chunkMeshes.entries()) {
            for (const [typeName, data] of Object.entries(chunkMeshes)) {
                const distance = cameraPosition.distanceTo(data.chunkCenter);
                const newLod = this.getLODForDistance(distance);
                
                if (newLod !== data.lodLevel) {
                    data.lodLevel = newLod;
                    data.mesh.material.uniforms.u_lodLevel.value = newLod;
                }
            }
        }
    }
    
    /**
     * Unload a chunk and dispose of its resources
     * @param {string} chunkKey - The chunk key to unload
     */
    unloadChunk(chunkKey) {
        const chunkMeshes = this.chunkMeshes.get(chunkKey);
        if (!chunkMeshes) return;
        
        for (const [typeName, data] of Object.entries(chunkMeshes)) {
            this.scene.remove(data.mesh);
            data.mesh.material.dispose(); // Cloned material
            // Don't dispose geometry - it's shared
        }
        
        this.chunkMeshes.delete(chunkKey);
    }
    
    /**
     * Update wind animation for all chunks
     * @param {number} deltaTime - Time since last update in milliseconds
     */
    updateWind(deltaTime) {
        this.windTime += deltaTime * 0.001;
        
        for (const chunkMeshes of this.chunkMeshes.values()) {
            for (const data of Object.values(chunkMeshes)) {
                if (data.mesh.material.uniforms.time) {
                    data.mesh.material.uniforms.time.value = this.windTime;
                }
            }
        }
    }
    
    /**
     * Get LOD level for a given distance
     * @param {number} distance - Distance from camera
     * @returns {number} LOD level (0 = highest detail)
     */
    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) return i;
        }
        return this.lodDistances.length;
    }
    
    /**
     * Get pseudo-random rotation for a position
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {number} Rotation in radians
     */
    getRotation(x, z) {
        const seed = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        return (seed - Math.floor(seed)) * Math.PI * 2;
    }
    
    /**
     * Create a material for plant rendering
     * @param {string} typeName - The plant type name
     * @param {Object} config - The plant configuration
     * @returns {Promise<THREE.ShaderMaterial>} The created material
     */
    async createMaterial(typeName, config) {
        const uniforms = this.createPlantUniforms(config);
        
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: buildVertexShader(config.category),
            fragmentShader: buildFragmentShader(config.category),
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.3
        });
        
        if (this.uniformManager) {
            this.uniformManager.registerMaterial(material);
        }
        
        return material;
    }
    
    /**
     * Create uniforms for plant shader
     * @param {Object} config - The plant configuration
     * @returns {Object} Uniforms object
     */
    createPlantUniforms(config) {
        const lightingUniforms = this.uniformManager?.getLightingUniforms() || {};
        
        return {
            ...lightingUniforms,
            
            // Textures (GPU sampling)
            u_heightTexture: { value: null },
            u_normalTexture: { value: null },
            u_tileTexture: { value: null },
            
            // Chunk data
            u_chunkOffset: { value: new THREE.Vector2(0, 0) },
            u_chunkSize: { value: this.chunkSize },
            u_gridSpacing: { value: this.gridSpacing },
            
            // LOD & animation
            u_lodLevel: { value: 0 },
            time: { value: 0.0 },
            windStrength: { value: 1.0 },
            windDirection: { value: new THREE.Vector2(1.0, 0.5).normalize() },
            
            // Plant properties
            plantColor: { value: new THREE.Color(0.4, 0.7, 0.3) },
            
            // Placement rules (passed to shader)
            u_validTiles: { value: new THREE.Vector4(
                config.validTiles[0] || 0,
                config.validTiles[1] || 0,
                config.validTiles[2] || 0,
                config.validTiles[3] || 0
            )},
            u_density: { value: config.density }
        };
    }
    
   
    
    /**
     * Create geometry for grass/plant instances
     * @param {string} typeName - The plant type name
     * @param {number} lod - The LOD level
     * @param {number} variant - The variant index
     * @returns {THREE.BufferGeometry} The created geometry
     */
    createGrassGeometry(typeName, lod, variant) {
        // Your existing grass blade geometry
        const geometry = new THREE.PlaneGeometry(0.15, 0.8, 1, 3);
        geometry.translate(0, 0.4, 0);
        return geometry;
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        for (const chunkKey of this.chunkMeshes.keys()) {
            this.unloadChunk(chunkKey);
        }
        
        for (const geometry of this.geometries.values()) {
            geometry.dispose();
        }
        for (const material of this.materials.values()) {
            material.dispose();
        }
    }
}