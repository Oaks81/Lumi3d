/**
 * BaseStreamer - Abstract base class for GPU-accelerated instance streaming
 * 
 * Uses pure instance pooling:
 * - Pre-allocates large InstancedMesh pools (never create/destroy during streaming)
 * - Recycles instances by hiding (scale to zero) and showing
 * - GPU-based height displacement via shaders
 * - Chunk-level organization with instance-level pooling
 * 
 * Subclasses must implement:
 * - createGeometry(typeName, lod, variant, config)
 * - createMaterial(typeName, variant, config)
 * - getTypeConfigs() - returns plant/object type configurations
 * - getName()
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class BaseStreamer {
    constructor(scene, terrainMeshManager, uniformManager, options = {}) {
        // Core references
        this.scene = scene;
        this.terrainMeshManager = terrainMeshManager;
        this.uniformManager = uniformManager;
        
        // Configuration
        this.poolSize = options.poolSize || 100000; // Total instances across all types
        this.streamRadius = options.streamRadius || 80;
        this.updateInterval = options.updateInterval || 500;
        this.lodDistances = options.lodDistances || [40, 80, 120];
        this.gridSpacing = options.gridSpacing || 1.0;
        this.chunkSize = options.chunkSize || 64;
        
        // Type configs (defined by subclass)
        this.typeConfigs = this.getTypeConfigs();
        
        // Instance pools: Map<"type-lod-variant", InstancedMesh>
        this.instancePools = new Map();
        
        // Free instance indices: Map<"type-lod-variant", [indices]>
        this.freeIndices = new Map();
        
        // Active instances: Map<instanceKey, InstanceMetadata>
        // instanceKey = "chunkKey:type:localIndex"
        this.activeInstances = new Map();
        
        // Chunk tracking: Map<chunkKey, ChunkData>
        this.chunks = new Map();
        
        // Geometries and materials cache
        this.geometryCache = new Map();
        this.materialCache = new Map();
        
        // Update tracking
        this.lastCameraPos = new THREE.Vector3();
        this.lastUpdateTime = 0;
        
        console.log(`${this.getName()} initialized with ${Object.keys(this.typeConfigs).length} types`);
    }
    
    /**
     * Initialize instance pools for all types and LODs
     */
    async initialize() {
        console.log(`Initializing ${this.getName()} pools...`);
        
        // Calculate pool distribution across types and LODs
        const totalTypes = Object.keys(this.typeConfigs).length;
        const totalLods = this.lodDistances.length + 1;
        const totalVariants = Object.values(this.typeConfigs).reduce((sum, c) => sum + c.variants, 0);
        
        // Simple distribution: divide pool size by total combinations
        const avgInstancesPerPool = Math.floor(this.poolSize / (totalTypes * totalLods));
        
        for (const [typeName, config] of Object.entries(this.typeConfigs)) {
            console.log(`  Creating pools for ${typeName}...`);
            
            // Apply LOD distribution (more instances in high detail LODs)
            const lodDistribution = config.lodDistribution || [0.5, 0.3, 0.2];
            
            for (let lod = 0; lod < totalLods; lod++) {
                const lodPoolSize = Math.floor(avgInstancesPerPool * lodDistribution[lod] * config.variants);
                const instancesPerVariant = Math.floor(lodPoolSize / config.variants);
                
                for (let variant = 0; variant < config.variants; variant++) {
                    const poolKey = this.makePoolKey(typeName, lod, variant);
                    
                    // Get or create geometry
                    const geomKey = `${typeName}-${lod}-${variant}`;
                    if (!this.geometryCache.has(geomKey)) {
                        const geometry = await this.createGeometry(typeName, lod, variant, config);
                        this.geometryCache.set(geomKey, geometry);
                    }
                    
                    // Get or create material (shared across variants of same type)
                    const matKey = `${typeName}-${variant}`;
                    if (!this.materialCache.has(matKey)) {
                        const material = await this.createMaterial(typeName, variant, config);
                        this.materialCache.set(matKey, material);
                    }
                    
                    const geometry = this.geometryCache.get(geomKey);
                    const material = this.materialCache.get(matKey);
                    
                    // Create instance pool
                    const instancedMesh = new THREE.InstancedMesh(
                        geometry,
                        material,
                        instancesPerVariant
                    );
                    
                    // Initialize all to invisible (scale zero)
                    const matrix = new THREE.Matrix4();
                    matrix.makeScale(0, 0, 0);
                    for (let i = 0; i < instancesPerVariant; i++) {
                        instancedMesh.setMatrixAt(i, matrix);
                    }
                    instancedMesh.instanceMatrix.needsUpdate = true;
                    
                    instancedMesh.frustumCulled = false;
                    instancedMesh.castShadow = config.castShadow || false;
                    instancedMesh.receiveShadow = config.receiveShadow !== false;
                    
                    // Add to scene and store
                    this.scene.add(instancedMesh);
                    this.instancePools.set(poolKey, instancedMesh);
                    
                    // Initialize free indices list
                    this.freeIndices.set(
                        poolKey,
                        Array.from({ length: instancesPerVariant }, (_, i) => i)
                    );
                    
                    console.log(`    ${poolKey}: ${instancesPerVariant} instances`);
                }
            }
        }
        
        console.log(`${this.getName()} initialization complete`);
    }
    
    /**
     * Main update loop
     */
    async update(cameraPosition, terrain, deltaTime) {
        const now = Date.now();
        
        // Always update time-based effects
        this.updateTimeUniforms(deltaTime);
        
        // Update chunk-level LODs (very cheap)
        this.updateChunkLODs(cameraPosition);
        
        // Throttle streaming updates
        if (now - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = now;
        
        // Check if camera moved significantly
        const distanceMoved = cameraPosition.distanceTo(this.lastCameraPos);
        if (distanceMoved < this.chunkSize * 0.25) {
            return;
        }
        
        this.lastCameraPos.copy(cameraPosition);
        
        // Stream chunks
        await this.streamChunks(cameraPosition, terrain);
    }
    
    /**
     * Stream chunks around camera
     */
    async streamChunks(cameraPosition, terrain) {
        const minChunkX = Math.floor((cameraPosition.x - this.streamRadius) / this.chunkSize);
        const maxChunkX = Math.ceil((cameraPosition.x + this.streamRadius) / this.chunkSize);
        const minChunkZ = Math.floor((cameraPosition.z - this.streamRadius) / this.chunkSize);
        const maxChunkZ = Math.ceil((cameraPosition.z + this.streamRadius) / this.chunkSize);
        
        const visibleChunks = new Set();
        const chunksToLoad = [];
        
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                const chunkKey = `${cx},${cz}`;
                visibleChunks.add(chunkKey);
                
                if (!this.chunks.has(chunkKey)) {
                    const terrainChunk = terrain.get(chunkKey);
                    if (terrainChunk) {
                        chunksToLoad.push({ cx, cz, chunkKey, terrainChunk });
                    }
                }
            }
        }
        
        // Unload chunks
        for (const chunkKey of this.chunks.keys()) {
            if (!visibleChunks.has(chunkKey)) {
                this.unloadChunk(chunkKey);
            }
        }
        
        // Load chunks
        for (const chunk of chunksToLoad) {
            await this.loadChunk(chunk.cx, chunk.cz, chunk.chunkKey, chunk.terrainChunk, cameraPosition);
        }
    }
    
    /**
     * Load chunk - allocate instances from pools
     */
    async loadChunk(chunkX, chunkZ, chunkKey, terrainChunk, cameraPosition) {
        const heightTexture = this.terrainMeshManager.getHeightTexture(chunkX, chunkZ);
        const normalTexture = this.terrainMeshManager.getNormalTexture(chunkX, chunkZ);
        
        if (!heightTexture || !normalTexture) {
            console.warn(`${this.getName()}: No textures for chunk ${chunkKey}`);
            return;
        }
        
        // Calculate initial LOD
        const chunkCenter = new THREE.Vector3(
            (chunkX + 0.5) * this.chunkSize,
            0,
            (chunkZ + 0.5) * this.chunkSize
        );
        const distance = cameraPosition.distanceTo(chunkCenter);
        const lodLevel = this.getLODForDistance(distance);
        
        // Generate spawn positions for each type
        const chunkData = {
            chunkX,
            chunkZ,
            chunkCenter,
            lodLevel,
            instances: [] // List of allocated instance keys
        };
        
        const worldOffsetX = chunkX * this.chunkSize;
        const worldOffsetZ = chunkZ * this.chunkSize;
        
        for (const [typeName, config] of Object.entries(this.typeConfigs)) {
            const positions = this.generateSpawnPositions(
                typeName,
                config,
                worldOffsetX,
                worldOffsetZ,
                terrainChunk
            );
            
            for (const pos of positions) {
                const instanceKey = `${chunkKey}:${typeName}:${pos.localIndex}`;
                
                const allocated = this.allocateInstance(
                    instanceKey,
                    typeName,
                    pos,
                    lodLevel,
                    heightTexture,
                    normalTexture,
                    chunkX,
                    chunkZ
                );
                
                if (allocated) {
                    chunkData.instances.push(instanceKey);
                }
            }
        }
        
        this.chunks.set(chunkKey, chunkData);
        
        console.log(`${this.getName()}: Loaded chunk ${chunkKey} with ${chunkData.instances.length} instances at LOD${lodLevel}`);
    }
    
    /**
     * Generate spawn positions for a type within a chunk
     */
    generateSpawnPositions(typeName, config, worldOffsetX, worldOffsetZ, terrainChunk) {
        const positions = [];
        let localIndex = 0;
        
        for (let x = 0; x < this.chunkSize; x += this.gridSpacing) {
            for (let z = 0; z < this.chunkSize; z += this.gridSpacing) {
                const worldX = worldOffsetX + x;
                const worldZ = worldOffsetZ + z;
                
                // Get tile type
                const tileType = terrainChunk.getTile(Math.floor(x), Math.floor(z));
                
                // Check spawn rules
                const spawnProbability = config.spawnRules[tileType] || 0;
                if (spawnProbability === 0) continue;
                
                // Deterministic random
                const seed = Math.sin(worldX * 12.9898 + worldZ * 78.233 + typeName.length * 43.21) * 43758.5453;
                const random = seed - Math.floor(seed);
                
                if (random >= spawnProbability) continue;
                
                // Additional checks
                if (config.shouldSpawn && !config.shouldSpawn(worldX, worldZ, terrainChunk)) {
                    continue;
                }
                
                // Add jitter
                const jitterSeedX = Math.sin(worldX * 93.9898 + worldZ * 67.345) * 43758.5453;
                const jitterSeedZ = Math.sin(worldX * 45.123 + worldZ * 91.456) * 43758.5453;
                const jitterX = (jitterSeedX - Math.floor(jitterSeedX) - 0.5) * this.gridSpacing * 0.8;
                const jitterZ = (jitterSeedZ - Math.floor(jitterSeedZ) - 0.5) * this.gridSpacing * 0.8;
                
                // Select variant
                const variantSeed = Math.sin(worldX * 54.321 + worldZ * 12.987 + typeName.length * 78.6) * 43758.5453;
                const variant = Math.floor((variantSeed - Math.floor(variantSeed)) * config.variants);
                
                positions.push({
                    localIndex: localIndex++,
                    localX: x + jitterX,
                    localZ: z + jitterZ,
                    worldX: worldX + jitterX,
                    worldZ: worldZ + jitterZ,
                    variant,
                    rotation: this.getRotation(worldX + jitterX, worldZ + jitterZ),
                    scale: this.getScale(worldX + jitterX, worldZ + jitterZ, config)
                });
            }
        }
        
        return positions;
    }
    
/**
 * Allocate instance from pool
 */
allocateInstance(instanceKey, typeName, pos, lodLevel, heightTexture, normalTexture, chunkX, chunkZ) {
    const poolKey = this.makePoolKey(typeName, lodLevel, pos.variant);
    const freeList = this.freeIndices.get(poolKey);
    
    if (!freeList || freeList.length === 0) {
        console.warn(`${this.getName()}: Pool ${poolKey} exhausted`);
        return false;
    }
    
    const instanceIndex = freeList.pop();
    const instancedMesh = this.instancePools.get(poolKey);
    
    // Create transform matrix
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3(pos.worldX, 0, pos.worldZ);
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pos.rotation, 0));
    const scale = new THREE.Vector3(pos.scale, pos.scale, pos.scale);
    
    matrix.compose(position, quaternion, scale);
    instancedMesh.setMatrixAt(instanceIndex, matrix);
    instancedMesh.instanceMatrix.needsUpdate = true;
    
    // NEW: Update material uniforms for texture support
    const geometry = instancedMesh.geometry;
    const material = instancedMesh.material;
    
    if (geometry.userData.usesTexture && geometry.userData.textureUV) {
        // LOD0 with texture
        const { u1, v1, u2, v2 } = geometry.userData.textureUV;
        if (material.uniforms.u_useTexture) {
            material.uniforms.u_useTexture.value = 1.0;
            material.uniforms.u_plantUVBounds.value.set(u1, v1, u2, v2);
        }
    } else {
        // LOD1/2 procedural
        if (material.uniforms.u_useTexture) {
            material.uniforms.u_useTexture.value = 0.0;
        }
    }
    
    // Store metadata
    this.activeInstances.set(instanceKey, {
        poolKey,
        instanceIndex,
        typeName,
        lodLevel,
        position: pos,
        chunkX,
        chunkZ
    });
    
    return true;
}
    
    /**
     * Release instance back to pool
     */
    releaseInstance(instanceKey) {
        const metadata = this.activeInstances.get(instanceKey);
        if (!metadata) return;
        
        const { poolKey, instanceIndex } = metadata;
        const instancedMesh = this.instancePools.get(poolKey);
        
        // Hide instance (scale to zero)
        const matrix = new THREE.Matrix4();
        matrix.makeScale(0, 0, 0);
        instancedMesh.setMatrixAt(instanceIndex, matrix);
        instancedMesh.instanceMatrix.needsUpdate = true;
        
        // Return to free pool
        this.freeIndices.get(poolKey).push(instanceIndex);
        this.activeInstances.delete(instanceKey);
    }
    
    /**
     * Update chunk LODs
     */
    updateChunkLODs(cameraPosition) {
        for (const [chunkKey, chunkData] of this.chunks.entries()) {
            const distance = cameraPosition.distanceTo(chunkData.chunkCenter);
            const newLod = this.getLODForDistance(distance);
            
            if (newLod !== chunkData.lodLevel) {
                this.updateChunkLOD(chunkKey, chunkData, newLod);
            }
        }
    }
    
    /**
     * Update LOD for all instances in a chunk
     */
    updateChunkLOD(chunkKey, chunkData, newLod) {
        const oldLod = chunkData.lodLevel;
        const instancesToMove = [];
        
        // Find all instances that need LOD change
        for (const instanceKey of chunkData.instances) {
            const metadata = this.activeInstances.get(instanceKey);
            if (metadata && metadata.lodLevel === oldLod) {
                instancesToMove.push({ instanceKey, metadata });
            }
        }
        
        // Move instances to new LOD pools
        const newInstances = [];
        for (const { instanceKey, metadata } of instancesToMove) {
            // Release from old pool
            this.releaseInstance(instanceKey);
            
            // Get textures
            const heightTexture = this.terrainMeshManager.getHeightTexture(metadata.chunkX, metadata.chunkZ);
            const normalTexture = this.terrainMeshManager.getNormalTexture(metadata.chunkX, metadata.chunkZ);
            
            // Allocate in new pool
            const allocated = this.allocateInstance(
                instanceKey,
                metadata.typeName,
                metadata.position,
                newLod,
                heightTexture,
                normalTexture,
                metadata.chunkX,
                metadata.chunkZ
            );
            
            if (allocated) {
                newInstances.push(instanceKey);
            }
        }
        
        // Update chunk data
        chunkData.instances = newInstances;
        chunkData.lodLevel = newLod;
    }
    
    /**
     * Unload chunk - release all instances
     */
    unloadChunk(chunkKey) {
        const chunkData = this.chunks.get(chunkKey);
        if (!chunkData) return;
        
        for (const instanceKey of chunkData.instances) {
            this.releaseInstance(instanceKey);
        }
        
        this.chunks.delete(chunkKey);
    }
    
    /**
     * Get LOD for distance
     */
    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) {
                return i;
            }
        }
        return this.lodDistances.length;
    }
    
    /**
     * Helper functions
     */
    makePoolKey(typeName, lod, variant) {
        return `${typeName}-${lod}-${variant}`;
    }
    
    getRotation(x, z) {
        const seed = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        return (seed - Math.floor(seed)) * Math.PI * 2;
    }
    
    getScale(x, z, config) {
        const seed = Math.sin(x * 45.123 + z * 91.456) * 43758.5453;
        const random = seed - Math.floor(seed);
        const minScale = config.scaleRange?.min || 0.8;
        const maxScale = config.scaleRange?.max || 1.2;
        
        return minScale + random * (maxScale - minScale);
    }
    
    /**
     * Update time-based uniforms (override in subclass if needed)
     */
    updateTimeUniforms(deltaTime) {
        // Default: no-op, subclasses can override
    }
    
    /**
     * Cleanup
     */
    dispose() {
        // Unload all chunks
        for (const chunkKey of this.chunks.keys()) {
            this.unloadChunk(chunkKey);
        }
        
        // Remove all pools from scene
        for (const [poolKey, instancedMesh] of this.instancePools.entries()) {
            this.scene.remove(instancedMesh);
            // Don't dispose geometry/material - they're cached
        }
        
        // Dispose cached geometries
        for (const geometry of this.geometryCache.values()) {
            geometry.dispose();
        }
        
        // Dispose cached materials
        for (const material of this.materialCache.values()) {
            if (this.uniformManager) {
                this.uniformManager.unregisterMaterial(material);
            }
            material.dispose();
        }
        
        // Clear all maps
        this.instancePools.clear();
        this.freeIndices.clear();
        this.activeInstances.clear();
        this.chunks.clear();
        this.geometryCache.clear();
        this.materialCache.clear();
    }
    
    // ============================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // ============================================
    
    /**
     * Create geometry for specific type, LOD, and variant
     * @abstract
     * @param {string} typeName - Plant/object type name
     * @param {number} lod - LOD level (0 = highest detail)
     * @param {number} variant - Variant index
     * @param {Object} config - Type configuration
     * @returns {THREE.BufferGeometry}
     */
    async createGeometry(typeName, lod, variant, config) {
        throw new Error('createGeometry must be implemented by subclass');
    }
    
    /**
     * Create material for specific type and variant
     * @abstract
     * @param {string} typeName - Plant/object type name
     * @param {number} variant - Variant index
     * @param {Object} config - Type configuration
     * @returns {THREE.Material}
     */
    async createMaterial(typeName, variant, config) {
        throw new Error('createMaterial must be implemented by subclass');
    }
    
    /**
     * Get type configurations
     * @abstract
     * @returns {Object} Map of type names to configs
     * 
     * Example:
     * {
     *   GRASS_SHORT: {
     *     variants: 3,
     *     spawnRules: { 3: 0.8, 6: 0.3 }, // tileType -> probability
     *     shouldSpawn: (x, z, chunk) => height > 8 && slope < 0.6,
     *     scaleRange: { min: 0.8, max: 1.2 },
     *     lodDistribution: [0.5, 0.3, 0.2],
     *     castShadow: false,
     *     receiveShadow: true
     *   }
     * }
     */
    getTypeConfigs() {
        throw new Error('getTypeConfigs must be implemented by subclass');
    }
    
    /**
     * Get name for logging
     * @abstract
     * @returns {string}
     */
    getName() {
        throw new Error('getName must be implemented by subclass');
    }
}