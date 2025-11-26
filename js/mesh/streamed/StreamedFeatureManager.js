// StreamedFeatureManager.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { StreamedMaterialFactory } from './StreamedMaterialFactory.js';
import { StreamedGeometryCache } from './streamedGeometryCache.js'; // Assuming you moved the cache class here
import { StreamedAssetConfig } from './streamedAssetConfig.js';     // ✅ NEW IMPORT
/**
 * Manages GPU-driven procedurally placed features
 * (grass, flowers, ground clutter, tree leaves)
 * 
 * Unlike FeatureMeshManager which handles explicit placements,
 * this generates dense grids and lets GPU cull based on terrain data
 */
export class StreamedFeatureManager {
  /**
     * Creates a new StreamedFeatureManager
     * @param {THREE.Scene} scene - The Three.js scene
     * @param {Object} terrainMeshManager - The terrain mesh manager
     * @param {Object} textureManager - The texture manager
     * @param {Object} uniformManager - The uniform manager for lighting
     * @param {Object} options - Configuration options
     */
  constructor(scene, terrainMeshManager, textureManager, uniformManager, lodManager, options = {}) {
    this.scene = scene;
    this.spatialIndex = new Map(); // chunkKey -> feature state
    this.lastUpdateFrame = 0;
    this.updateFrameInterval = 10; // Update every 10 frames (~166ms at 60fps)
    this.lodManager = lodManager;
    this.terrainMeshManager = terrainMeshManager;
    this.textureManager = textureManager;
    this.uniformManager = uniformManager;
    this.materialFactory = new StreamedMaterialFactory(uniformManager);
    this.updateInterval = options.updateInterval || 200; // Run every 200ms
    this.timeSinceLastUpdate = 0;
    // Configuration
    this.streamRadius = options.streamRadius || 80;
    this.lodDistances = options.lodDistances ;
    this.chunkSize = options.chunkSize || 64;

    // Streamed feature types (not in world generator!)
    this.streamedTypes = new Map(); // typeName -> StreamedFeatureType

    // Active chunks: chunkKey -> Map<typeName, InstancedMesh>
    this.activeChunks = new Map();


    // ✅ NEW: Internal Geometry Cache initialized here
    this.geometryCache = new StreamedGeometryCache(); 
    this.materials = new Map(); // Shared materials (still needed)

    // Update tracking
    this.lastCameraPos = new THREE.Vector3();
    this.lastUpdateTime = 0;
    this.windTime = 0;

    console.log('StreamedFeatureManager initialized');
}

updateCameraUniforms(cameraPosition) {
    for (const chunkMeshes of this.activeChunks.values()) {
        for (const data of chunkMeshes.values()) {
            if (data.mesh.material.uniforms.u_cameraPosition) {
                data.mesh.material.uniforms.u_cameraPosition.value.copy(cameraPosition);
            }
        }
    }
}


async initialize() {
    console.log('🌱 Initializing streamed features...');
    
    // 1. Load config and register generators
    this.registerStreamedFeatures(); 

    for (const [typeName, config] of this.streamedTypes.entries()) {
        console.log(`  Creating ${typeName} geometry and material...`);

        // 2. Create geometry (and cache it)
        // The generator returns a GeometryLodMap. We only need LOD 0 for instancing.
        const geometry = await this.geometryCache.getGeometry(typeName, config, 0); 

        // 3. Create base material (no change here)
        const material = await this.createMaterial(typeName, config);
        this.materials.set(typeName, material);
        
        console.log(`    ✅ ${typeName} ready (Geom from cache: ${geometry.attributes.position.count} vertices)`);
    }

    console.log('✅ Streamed features initialized');
}
// StreamedFeatureManager.js

/**
 * Main update loop for the StreamedFeatureManager.
 * @param {THREE.Vector3} cameraPosition - Current camera world position.
 * @param {Map} terrain - The map of all loaded terrain data.
 * @param {number} deltaTime - Time passed since the last frame (in seconds).
 */

    // FIXED: Optimized update with proper throttling
    update(cameraPosition, terrain, deltaTime) {
        // Always update per-frame uniforms (cheap)
        this.windTime += deltaTime;
        this.lastCameraPos.copy(cameraPosition);
        // Update uniforms on all active meshes
        for (const chunkMeshes of this.activeChunks.values()) {
            for (const meshData of chunkMeshes.values()) {
                if (meshData && meshData.mesh && meshData.mesh.material.uniforms) {
                    meshData.mesh.material.uniforms.u_time.value = this.windTime;
                    meshData.mesh.material.uniforms.u_cameraPosition.value.copy(cameraPosition);
                }
            }
        }

        // Throttle heavy operations
        this.lastUpdateFrame++;
        if (this.lastUpdateFrame >= this.updateFrameInterval) {
            this.loadNewChunksOptimized(cameraPosition, terrain);
            this.updateLODs(cameraPosition);
            this.lastUpdateFrame = 0;
        }
    }
async createMaterial(typeName, config) {
    return await this.materialFactory.createMaterial(typeName, config, this.chunkSize);
}
updateWind(deltaTime) {
    this.windTime += deltaTime * 0.001;

    for (const chunkMeshes of this.activeChunks.values()) {
        for (const data of chunkMeshes.values()) {
            if (data.mesh.material.uniforms.time) {
                data.mesh.material.uniforms.time.value = this.windTime;
            }
        }
    }
}
 getRotation(x, z) {
        const seed = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        return (seed - Math.floor(seed)) * Math.PI * 2;
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        // Unload all chunks
        for (const chunkKey of this.activeChunks.keys()) {
            this.unloadChunk(chunkKey);
        }
        
        for (const material of this.materials.values()) {
            material.dispose();
        }
        this.geometryCache.cleanup(); // ✅ Use the dedicated cleanup method
        this.materials.clear();
        this.activeChunks.clear();
    }
getLODForDistance(distance) {
    for (let i = 0; i < this.lodDistances.length; i++) {
        if (distance <= this.lodDistances[i]) return i;
    }
    return this.lodDistances.length;
}
// Update updateLODs with detailed logging
updateLODs(cameraPosition) {
//console.log(`  📊 updateLODs: Checking ${this.activeChunks.size} active chunks`);

let lodChangeCount = 0;

for (const [chunkKey, chunkMeshes] of this.activeChunks.entries()) {
    const [chunkX, chunkY] = chunkKey.split(',').map(Number);

    const chunkCenter = new THREE.Vector3(
        (chunkX + 0.5) * this.chunkSize,
        0,
        (chunkY + 0.5) * this.chunkSize
    );

    // Calculate distance (use horizontal distance only)
    const dx = chunkCenter.x - cameraPosition.x;
    const dz = chunkCenter.z - cameraPosition.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    const newLod = this.lodManager ?
        this.lodManager.getLODForDistance(distance) : 0;

    //console.log(`    Chunk ${chunkKey}: center=(${chunkCenter.x}, ${chunkCenter.z}), dist=${distance.toFixed(1)}u, LOD=${newLod}`);

    // Update each feature type in this chunk
    for (const [typeName, data] of chunkMeshes.entries()) {
        const oldLod = data.lodLevel;

        // Only update if LOD changed
        if (oldLod !== newLod) {
            console.log(`      🔄 ${typeName}: LOD ${oldLod} → ${newLod}`);
            lodChangeCount++;

            data.lodLevel = newLod;

            // Update shader uniform
            if (data.mesh.material.uniforms.u_lodLevel) {
                data.mesh.material.uniforms.u_lodLevel.value = newLod;
                console.log(`        ✅ Updated u_lodLevel uniform`);
            } else {
                console.warn(`        ⚠️ No u_lodLevel uniform found!`);
            }

            // Update culling distances
            const config = data.config;
            if (data.mesh.material.uniforms.u_maxDistance) {
                const oldMaxDist = data.mesh.material.uniforms.u_maxDistance.value;
                const baseDist = config.maxRenderDistance || config.streamRadius * 0.9;
                const lodMultiplier = [1.0, 0.8, 0.6, 0.4, 0.2][Math.min(newLod, 4)];
                const newMaxDist = baseDist * lodMultiplier;

                data.mesh.material.uniforms.u_maxDistance.value = newMaxDist;
            } else {
                console.warn(`        ⚠️ No u_maxDistance uniform found!`);
            }
        }
    }
}

//console.log(`  📊 updateLODs complete: ${lodChangeCount} LOD changes`);
}
// Update loadNewChunks with detailed logging
loadNewChunks(cameraPosition, terrain) {
    console.log(`  📦 loadNewChunks: Checking terrain meshes...`);

    // 🛑 We no longer calculate maxStreamRadius here.
    // We must check ALL loaded terrain chunks.
    
    console.log(`     Terrain chunks: ${this.terrainMeshManager.chunkMeshes.size}`);
    console.log(`     Active streamed chunks: ${this.activeChunks.size}`);

    let checkedCount = 0;
    let skippedCount = 0;
    let loadedCount = 0;

    // Iterate over all *terrain* chunks that are loaded
    for (const [chunkKey, terrainChunk] of this.terrainMeshManager.chunkMeshes.entries()) {
        checkedCount++;

        // Check if we have *already* loaded streamed features for this chunk
        if (this.activeChunks.has(chunkKey)) {
            skippedCount++;
            continue; // Yes, skip it.
        }

        // --- This is the fix ---
        // If we are here, a terrain chunk exists but its streamed features do not.
        // We MUST attempt to load them, regardless of distance.
        // The per-type distance culling will happen inside onTerrainChunkLoaded.

        const [cx, cy] = chunkKey.split(',').map(Number);
        
        // Get the terrain chunkData (for biome info, etc.)
        const chunkData = terrain.get(chunkKey);
        
        if (chunkData) {
   
            // This call will correctly use cameraPosition to cull per-type
            this.onTerrainChunkLoaded(cx, cy, chunkKey, chunkData, cameraPosition);
            loadedCount++;
        } else {
            // This can happen if terrain data is not ready, it will be loaded next frame
            console.warn(`       ⚠️ No terrain data for ${chunkKey}, cannot load streamed features yet.`);
        }
    }

    console.log(`  📦 loadNewChunks complete: checked=${checkedCount}, skipped=${skippedCount} (already active), loaded=${loadedCount} (new)`);
}

    // NEW: Optimized chunk loading with spatial queries
    loadNewChunksOptimized(cameraPosition, terrain) {
        const chunkSize = this.chunkSize;
        const maxRadius = Math.max(...Array.from(this.streamedTypes.values()).map(t => t.streamRadius || 100));
        
        // Calculate bounds for spatial query
        const minCX = Math.floor((cameraPosition.x - maxRadius * 1.2) / chunkSize);
        const maxCX = Math.ceil((cameraPosition.x + maxRadius * 1.2) / chunkSize);
        const minCZ = Math.floor((cameraPosition.z - maxRadius * 1.2) / chunkSize);
        const maxCZ = Math.ceil((cameraPosition.z + maxRadius * 1.2) / chunkSize);
        
        const nearbyChunks = new Set();
        
        // Build set of nearby chunks
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const chunkKey = `${cx},${cz}`;
                nearbyChunks.add(chunkKey);
            }
        }
        
        let processedCount = 0;
        const maxProcessPerUpdate = 5; // Process at most 5 chunks per update
        
        // Process nearby chunks only
        for (const chunkKey of nearbyChunks) {
            // Skip if terrain not loaded
            if (!this.terrainMeshManager.chunkMeshes.has(chunkKey)) continue;
            
            // Skip if we've hit our processing limit
            if (processedCount >= maxProcessPerUpdate) break;
            
            // Process this chunk's features
            if (this.processChunkFeatures(chunkKey, cameraPosition, terrain)) {
                processedCount++;
            }
        }
        
        // Unload distant chunks
        this.unloadDistantChunksOptimized(nearbyChunks);
    }

    // NEW: Process a single chunk's features
    processChunkFeatures(chunkKey, cameraPosition, terrain) {
        const [cx, cy] = chunkKey.split(',').map(Number);
        
        // Get or create chunk entry
        if (!this.activeChunks.has(chunkKey)) {
            this.activeChunks.set(chunkKey, new Map());
        }
        const chunkMeshes = this.activeChunks.get(chunkKey);
        
        // Calculate chunk distance once
        const chunkCenter = new THREE.Vector3(
            (cx + 0.5) * this.chunkSize,
            0,
            (cy + 0.5) * this.chunkSize
        );
        const dx = chunkCenter.x - cameraPosition.x;
        const dz = chunkCenter.z - cameraPosition.z;
        const distanceToChunk = Math.sqrt(dx * dx + dz * dz);
        
        // Get terrain data
        const terrainChunkData = terrain.get(chunkKey);
        if (!terrainChunkData) return false;
        
        const featureDist = terrainChunkData.featureDistribution?.featureMix || {};
        
        let changedCount = 0;
        
        // Check each feature type
        for (const [typeName, config] of this.streamedTypes.entries()) {
            const isLoaded = chunkMeshes.has(typeName);
            const isInRange = distanceToChunk <= config.streamRadius;
            
            // Load if needed
            if (!isLoaded && isInRange) {
                const weight = featureDist[typeName.toLowerCase()] ?? 1.0;
                if (weight <= 0.01) {
                    chunkMeshes.set(typeName, null);
                    continue;
                }
                
                const textures = this.getChunkTextures(cx, cy, chunkKey);
                if (!textures) continue;
                
                const chunkData = this.calculateChunkData(cx, cy, cameraPosition);
                chunkData.featureDistribution = terrainChunkData.featureDistribution;
                
                const meshData = this.createTypeMesh(
                    typeName,
                    { ...config, biomeWeight: weight },
                    textures,
                    chunkData
                );
                
                if (meshData) {
                    chunkMeshes.set(typeName, meshData);
                    changedCount++;
                } else {
                    chunkMeshes.set(typeName, null);
                }
            }
            
            // Unload if needed
            if (isLoaded && !isInRange) {
                const meshData = chunkMeshes.get(typeName);
                if (meshData && meshData.mesh) {
                    this.scene.remove(meshData.mesh);
                    meshData.mesh.material.dispose();
                }
                chunkMeshes.delete(typeName);
                changedCount++;
            }
        }
        
        return changedCount > 0;
    }

    // NEW: Optimized distant chunk unloading
    unloadDistantChunksOptimized(nearbyChunks) {
        const chunksToUnload = [];
        
        for (const chunkKey of this.activeChunks.keys()) {
            if (!nearbyChunks.has(chunkKey)) {
                chunksToUnload.push(chunkKey);
            }
        }
        
        for (const chunkKey of chunksToUnload) {
            this.unloadChunk(chunkKey);
        }
    }
onTerrainChunkUnloaded(chunkX, chunkY, chunkKey) {
    if (this.activeChunks.has(chunkKey)) {
        this.unloadChunk(chunkKey);
    }
}


getChunkTextures(chunkX, chunkY, chunkKey) {
    const heightTexture = this.terrainMeshManager.getHeightTexture(chunkX, chunkY);
    const normalTexture = this.terrainMeshManager.getNormalTexture(chunkX, chunkY);
    const tileTypeTexture = this.terrainMeshManager.getTileTypeTexture(chunkX, chunkY);

    if (!heightTexture || !tileTypeTexture) {
        console.warn(`StreamedFeatureManager: Missing textures for chunk ${chunkKey}`);
        return null;
    }

    return { heightTexture, normalTexture, tileTypeTexture };
}

/**
* Calculate chunk data including offset, center, and LOD
*/
calculateChunkData(chunkX, chunkY, cameraPosition) {
const chunkOffset = new THREE.Vector2(
    chunkX * this.chunkSize,
    chunkY * this.chunkSize
);

const chunkCenter = new THREE.Vector3(
    (chunkX + 0.5) * this.chunkSize,
    0,
    (chunkY + 0.5) * this.chunkSize
);

const distance = cameraPosition.distanceTo(chunkCenter);

// ✅ FIX: Use LODManager instead of non-existent method
const lodLevel = this.lodManager ?
    this.lodManager.getLODForDistance(distance) : 0;

return {
    chunkOffset,
    chunkCenter,
    lodLevel,
    chunkSize: this.chunkSize,
    distance // ✅ Store distance for debugging
};
}


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
 * Stream chunks around camera
 * @param {THREE.Vector3} cameraPosition - The current camera position
 * @param {Object} terrain - The terrain data
 * @returns {Promise<void>}
 */
async streamChunks(cameraPosition, terrain) {
    const visibleChunks = this.getVisibleChunkKeys(cameraPosition);

    // Load visible chunks
 //   this.loadVisibleChunks(visibleChunks, terrain, cameraPosition);

    // Unload far chunks
    this.unloadInvisibleChunks(visibleChunks);
}
    unloadInvisibleChunks(visibleChunks) {
        for (const chunkKey of this.activeChunks.keys()) {
            if (!visibleChunks.has(chunkKey)) {
                this.unloadChunk(chunkKey);
            }
        }
    }

// Update unloadDistantChunks with detailed logging
unloadDistantChunks(cameraPosition) {
console.log(`  🗑️ unloadDistantChunks: Checking active chunks...`);

let maxStreamRadius = 0;
for (const [typeName, config] of this.streamedTypes.entries()) {
    maxStreamRadius = Math.max(maxStreamRadius, config.streamRadius || 100);
}

const unloadRadius = maxStreamRadius * 1.2;
console.log(`     Unload radius: ${unloadRadius}u (${maxStreamRadius}u * 1.2)`);

const chunksToUnload = [];

for (const [chunkKey, chunkMeshes] of this.activeChunks.entries()) {
    const first = chunkMeshes.values().next().value;
    if (!first || !first.chunkCenter) {
        console.warn(`     ⚠️ Chunk ${chunkKey} has no chunkCenter!`);
        continue;
    }

    // Use horizontal distance only
    const dx = first.chunkCenter.x - cameraPosition.x;
    const dz = first.chunkCenter.z - cameraPosition.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    console.log(`     Chunk ${chunkKey}: dist=${distance.toFixed(1)}u`);

    if (distance > unloadRadius) {
        console.log(`       🗑️ UNLOADING (dist > ${unloadRadius}u)`);
        chunksToUnload.push(chunkKey);
    } else {
        console.log(`       ✅ KEEPING`);
    }
}

for (const chunkKey of chunksToUnload) {
    this.unloadChunk(chunkKey);
}

console.log(`  🗑️ unloadDistantChunks complete: unloaded ${chunksToUnload.length} chunks`);
}

// StreamedFeatureManager.js

// ✅ REPLACE with this new version
loadNewChunks(cameraPosition, terrain) {
    console.log(`  📦 loadNewChunks: Checking terrain meshes...`);

    let newFeaturesLoaded = 0;
    let featuresUnloaded = 0;

    // Iterate over ALL loaded terrain chunks
    for (const [chunkKey, terrainChunk] of this.terrainMeshManager.chunkMeshes.entries()) {
        
        const [cx, cy] = chunkKey.split(',').map(Number);
        
        // 1. Get or create the chunk entry for streamed features
        if (!this.activeChunks.has(chunkKey)) {
            this.activeChunks.set(chunkKey, new Map());
        }
        // This is a Map<typeName, meshData>
        const chunkMeshes = this.activeChunks.get(chunkKey); 

        // 2. Calculate chunk distance (once per chunk)
        const chunkCenter = new THREE.Vector3(
            (cx + 0.5) * this.chunkSize,
            0,
            (cy + 0.5) * this.chunkSize
        );
        const dx = chunkCenter.x - cameraPosition.x;
        const dz = chunkCenter.z - cameraPosition.z;
        const distanceToChunk = Math.sqrt(dx * dx + dz * dz);

        // 3. Get terrain data (for biome info)
        const terrainChunkData = terrain.get(chunkKey);
        if (!terrainChunkData) {
            continue; // Terrain data not ready, skip for now
        }
        const featureDist = terrainChunkData.featureDistribution?.featureMix || {};

        // 4. Now, check ALL feature types against this chunk
        for (const [typeName, config] of this.streamedTypes.entries()) {
            
            const isLoaded = chunkMeshes.has(typeName);
            const isInRange = distanceToChunk <= config.streamRadius;

            // --- 4a. LOAD NEW FEATURES ---
            // If it's NOT loaded, but IS in range, load it.
            if (!isLoaded && isInRange) {
                console.log(`       ✅ Loading ${typeName} for ${chunkKey} (dist: ${distanceToChunk.toFixed(1)}u)`);

                // Check biome weight
                const weight = featureDist[typeName.toLowerCase()] ?? 1.0;
                if (weight <= 0.01) {
                    console.log(`         ⏭️ SKIP ${typeName} (biome weight: ${weight})`);
                    chunkMeshes.set(typeName, null); // Set 'null' to prevent re-checking
                    continue;
                }

                // Get textures (needed for createTypeMesh)
                const textures = this.getChunkTextures(cx, cy, chunkKey);
                if (!textures) {
                    console.warn(`         ⚠️ Missing textures for ${chunkKey}, will try again next frame.`);
                    break; // Stop processing this chunk, wait for textures
                }

                // Get chunk data (needed for createTypeMesh)
                const chunkData = this.calculateChunkData(cx, cy, cameraPosition);
                chunkData.featureDistribution = terrainChunkData.featureDistribution;
                
                // Create the mesh
                const meshData = this.createTypeMesh(
                    typeName,
                    { ...config, biomeWeight: weight },
                    textures,
                    chunkData
                );

                if (meshData) {
                    chunkMeshes.set(typeName, meshData);
                    newFeaturesLoaded++;
                } else {
                    console.warn(`         ⚠️ Failed to create mesh for ${typeName}`);
                    chunkMeshes.set(typeName, null); // Set 'null' to prevent re-trying
                }
            }

            // --- 4b. UNLOAD OLD FEATURES ---
            // If it IS loaded, but is NO LONGER in range, unload it.
            if (isLoaded && !isInRange) {
                const meshData = chunkMeshes.get(typeName);
                if (meshData) { // 'meshData' might be 'null' if skipped
                     console.log(`       🗑️ Unloading ${typeName} for ${chunkKey} (dist: ${distanceToChunk.toFixed(1)}u)`);
                     this.scene.remove(meshData.mesh);
                     meshData.mesh.material.dispose();
                     // Note: We don't dispose geometry, it's shared
                }
                chunkMeshes.delete(typeName);
                featuresUnloaded++;
            }
        }
    }

    if (newFeaturesLoaded > 0 || featuresUnloaded > 0) {
         console.log(`  📦 loadNewChunks complete: ${newFeaturesLoaded} loaded, ${featuresUnloaded} unloaded`);
    }
}

// ✅ REPLACE with this new version
unloadChunk(chunkKey) {
    const chunkMeshes = this.activeChunks.get(chunkKey);
    if (!chunkMeshes) return;

    // Unload all individual feature types this chunk contains
    for (const [typeName, data] of chunkMeshes.entries()) {
        if (data && data.mesh) { // Check if data is not 'null'
            this.scene.remove(data.mesh);
            data.mesh.material.dispose();
        }
    }

    this.activeChunks.delete(chunkKey);
    console.log(`  🗑️ Unloaded all streamed features for chunk ${chunkKey}`);
}


    createChunkMaterial(config, typeName, baseMaterial) {
        return this.materialFactory.createChunkMaterial(
            config,
            typeName,
            baseMaterial,
            this.chunkSize,
            this.windTime
        );
    }


setMaterialUniforms(material, config, textures, chunkData) {
const uniforms = material.uniforms;
uniforms.u_noiseSeed = { value: config.noiseSeed || 0.0 };
// Chunk data
uniforms.u_chunkOffset.value.copy(chunkData.chunkOffset);
uniforms.u_chunkSize.value = chunkData.chunkSize;
uniforms.u_gridSpacing.value = config.gridSpacing;
uniforms.u_instancesPerRow.value = Math.ceil(chunkData.chunkSize / config.gridSpacing);

// ✅ Use per-feature streaming distances
uniforms.u_maxDistance.value = config.maxRenderDistance || config.streamRadius * 0.9;
uniforms.u_taperStartDistance.value = config.taperStartDistance || config.streamRadius * 0.5;
uniforms.u_taperEndDistance.value = config.taperEndDistance || config.streamRadius * 0.85;
uniforms.u_minCullDistance.value = config.minCullDistance || 2;

// Feature config
uniforms.u_density.value = config.density * (config.biomeWeight || 1.0);
uniforms.u_waterLevel.value = 8.0;
uniforms.u_cameraPosition.value.copy(this.lastCameraPos);

// Textures
uniforms.u_heightTexture.value = textures.heightTexture;
uniforms.u_tileTypeTexture.value = textures.tileTypeTexture;

// Wind
uniforms.u_time.value = this.windTime;
uniforms.u_windStrength.value = config.windStrength || 0.05;

// Visual
uniforms.u_color.value = config.color || new THREE.Color(0.4, 0.7, 0.3);

console.log(`  🎨 Set uniforms for ${config.name}: maxDist=${uniforms.u_maxDistance.value}u, taper=${uniforms.u_taperStartDistance.value}-${uniforms.u_taperEndDistance.value}u`);
}


createTypeMesh(typeName, config, textures, chunkData) {
    // 1. Get cached geometry and base material
    // Key used by StreamedGeometryCache: `${typeName}|${shapeSeed}|lod0`
    const geometryKey = `${typeName}|${config.noiseSeed || 0}|lod0`;
    const geometry = this.geometryCache.geometryCache.get(geometryKey); 
    const baseMaterial = this.materials.get(typeName);

    if (!geometry || !baseMaterial) {
        console.error(`Missing geometry (${!!geometry}) or material (${!!baseMaterial}) for ${typeName}. Has initialize() been called?`);
        return null;
    }

    const adjustedConfig = { ...config };

    // Apply biome-specific scaling
    if (config.biomeWeight !== undefined) {
        adjustedConfig.density *= config.biomeWeight;
    }

    // 2. Create chunk material (clones base material and sets chunk-specific uniforms)
    const material = this.createChunkMaterial(adjustedConfig, typeName, baseMaterial);
    this.setMaterialUniforms(material, adjustedConfig, textures, chunkData);

    // 3. Create Instanced Mesh
    // Calculate the max number of placement spots in this chunk grid
    const MAX_INSTANCES = Math.floor((this.chunkSize / config.gridSpacing) ** 2);
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);

    // 4. Set Identity Matrices for GPU Placement
    // We fill the InstancedMesh buffer with identity matrices. 
    // The vertex shader reads the instanceId and calculates the world position/rotation/scale.
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < MAX_INSTANCES; i++) {
        mesh.setMatrixAt(i, matrix); // matrix is identity
    }
    mesh.instanceMatrix.needsUpdate = true;

    // 5. Setup rendering properties
    mesh.frustumCulled = false; // Disable Three.js culling; GPU performs culling
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    this.scene.add(mesh);

    return {
        mesh,
        lodLevel: chunkData.lodLevel,
        chunkCenter: chunkData.chunkCenter,
        config: adjustedConfig
    };
}
registerStreamedFeatures() {
    console.log('📖 Registering features from StreamedAssetConfig.js...');
    
    for (const assetDef of StreamedAssetConfig) {
        const typeName = assetDef.typeName;
        const config = assetDef.config;

        // 1. Register the feature configuration
        this.streamedTypes.set(typeName, {
            name: typeName,
            gridSpacing: config.gridSpacing || 0.5,
            density: config.density || 0.8,
            validTiles: config.validTiles || [3, 6],
            ...config
        });

        // 2. Register the generator with the cache
        this.geometryCache.registerGenerator(typeName, new assetDef.generatorClass());
    }

    console.log(`✅ Registered ${this.streamedTypes.size} streamed types.`);
}

}