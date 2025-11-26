import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TreeGeometryGenerator } from './treeGenerator.js';
import { GrassGeometryGenerator } from './grassGenerator.js';
import { ShrubGeometryGenerator } from './shrubGenerator.js';

// In constructor, add:
function meshKey(type, shapeSeed, additionalShapeParams = {}) {
    const parts = [type, shapeSeed];
    if (additionalShapeParams.complexity !== undefined) parts.push(`c${additionalShapeParams.complexity}`);
    if (additionalShapeParams.variant !== undefined)    parts.push(`v${additionalShapeParams.variant}`);
    return parts.join('|');
}

export class FeatureMeshManager {
    constructor(materialFactory, cacheSize = 200) {
        this.materialFactory = materialFactory;
        this.cacheSize = cacheSize;
        this.generatorMap = new Map();
        this.geometryCache = new Map();        // [key|lodN] => { geometry, ... }
        this.pendingOperations = new Map();
        this.singletonTracker = new Map();     // globalId => Mesh
        this.progressCallbacks = new Set();
        this.usageStats = new Map();

   /*     this.registerGenerator('tree', new TreeGeometryGenerator());
        this.registerGenerator('grass', new GrassGeometryGenerator());
        this.registerGenerator('shrub', new ShrubGeometryGenerator());
*/
    }

    registerGenerator(type, generator) {
        this.generatorMap.set(type, generator);
    }
    _lodMeshKey(meshType, shapeSeed, params, lod) {
        return meshKey(meshType, shapeSeed, params) + `|lod${lod}`;
    }


    async _getLodInfo(feature, lod = 0) {
        const meshType = feature.getType();
        const shapeSeed = feature.getShapeSeed();
        const params = this._extractShapeParams(feature);
        const baseKey = meshKey(meshType, shapeSeed, params);
    
        let actualLodMap;  // This will be the GeometryLodMap object
        
        if (this.geometryCache.has(baseKey) && this.geometryCache.get(baseKey).lodMap) {
            // Cache hit - get the stored GeometryLodMap
            actualLodMap = this.geometryCache.get(baseKey).lodMap;
        } else {
            // Cache miss - generate new
            const generator = this.generatorMap.get(meshType);
            if (!generator) {
                console.error(`No generator registered for type '${meshType}'`);
                console.log('Available generators:', Array.from(this.generatorMap.keys()));
                throw new Error(`No generator for type '${meshType}'`);
            }
            
            const result = await generator.buildGeometry(feature);
            
            if (!result || !result.lodMap) {
                console.error(`Generator for ${meshType} returned invalid result:`, result);
                throw new Error(`Feature generator for ${meshType} did not return a GeometryLodMap!`);
            }
            
            // Extract the actual GeometryLodMap from the result
            actualLodMap = result.lodMap;
            
            // Cache it
            this.geometryCache.set(baseKey, { lodMap: actualLodMap });
            
            console.log(`Generated and cached geometry for ${meshType}, LODs available:`, 
                        Array.from(actualLodMap.lodMap.keys()));
        }
        
        // Now get the specific LOD info
        const info = actualLodMap.getLodInfo ? actualLodMap.getLodInfo(lod) : undefined;
        
        if (!info) {
            console.warn(`No LOD info found for ${meshType} at LOD ${lod}`);
            console.log('Available LODs:', Array.from(actualLodMap.lodMap.keys()));
        }
        
        return { lodMap: actualLodMap, info, meshType, shapeSeed, params };
    }

    async getInstancedMeshLOD(featureGroup, heightTexture, normalTexture, chunkBounds, environmentState = null, lod = 0) {
        if (!Array.isArray(featureGroup) || featureGroup.length === 0) {
            console.warn('getInstancedMeshLOD: empty or invalid feature group');
            return null;
        }
        
        const firstFeature = featureGroup[0];
        console.log(`🔧 Creating instanced mesh for ${featureGroup.length} x ${firstFeature.type}/${firstFeature.subtype} at LOD ${lod}`);
        console.log(`🔧 First feature position:`, firstFeature.position);
        
        try {
            // Get LOD info using existing cache system
            const { info, meshType, shapeSeed, params, lodMap } = await this._getLodInfo(firstFeature, lod);
            
            if (!info) {
                console.error(`No LOD info returned for ${firstFeature.type}/${firstFeature.subtype} at LOD ${lod}`);
                return null;
            }
            
            if (info.type === 'remove') {
                console.log(`LOD ${lod} is set to remove for ${meshType}`);
                return null;
            }
            
            if (info.type !== 'mesh' && info.type !== 'sprite') {
                console.error(`Unsupported LOD type: ${info.type}`);
                return null;
            }
            
            // Get material
            const material = this.materialFactory.getMaterialForFeature(
                firstFeature, 
                heightTexture, 
                normalTexture, 
                chunkBounds, 
                environmentState
            );
            
            if (!material) {
                console.error(`Failed to create material for ${firstFeature.type}/${firstFeature.subtype}`);
                return null;
            }
            
            if (info.type === 'mesh') {
                const geometry = info.geometry;
                if (!geometry) {
                    console.error(`No geometry in LOD info for ${meshType} at LOD ${lod}`);
                    return null;
                }
                
                const instancedMesh = new THREE.InstancedMesh(geometry, material, featureGroup.length);
                
                // Set transforms for each instance
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                
                for (let i = 0; i < featureGroup.length; i++) {
                    const feature = featureGroup[i];
                    
                    // Get position (handle both formats)
                    position.set(
                        feature.position?.x ?? feature.x ?? 0,
                        feature.position?.y ?? feature.y ?? 0,
                        feature.position?.z ?? feature.z ?? 0
                    );
                    
                    // Get rotation (handle both formats)
                    quaternion.setFromEuler(new THREE.Euler(
                        feature.rotation?.x ?? 0,
                        feature.rotation?.y ?? feature.rotation ?? 0,
                        feature.rotation?.z ?? 0
                    ));
                    
                    // Get scale (handle both formats)
                    const scaleValue = feature.scale?.x ?? feature.scale ?? 1;
                    scale.set(scaleValue, scaleValue, scaleValue);
                    
                    matrix.compose(position, quaternion, scale);
                    instancedMesh.setMatrixAt(i, matrix);
                }
                
                instancedMesh.instanceMatrix.needsUpdate = true;
                instancedMesh.frustumCulled = true;
                instancedMesh.userData.featureGroup = featureGroup;
                
                console.log(`✅ Successfully created instanced mesh with ${featureGroup.length} instances`);
                console.log(`✅ Geometry vertices: ${geometry.attributes.position.count}, triangles: ${geometry.index.count / 3}`);
                console.log(`✅ Material:`, instancedMesh.material.type);

                console.log(`LOD ${lod} geometry vertices:`, info.geometry?.attributes?.position?.count ?? 0);
                return instancedMesh;
                
            } else if (info.type === 'sprite') {
                // Handle sprite/billboard
                console.log(`Creating sprite batch for ${meshType} at LOD ${lod}`);
                // Sprite handling would go here
                return null;
            }
            
        } catch (error) {
            console.error(`Error creating instanced mesh for ${firstFeature.type}/${firstFeature.subtype}:`, error);
            console.error(error.stack);
            return null;
        }
        
        return null;
    }

    async getGeometryForLod(feature, lod = 0) {
        const { info } = await this._getLodInfo(feature, lod);
        return info && info.geometry;
    }

    async getSingletonMesh(feature, environmentState = null) {
        const globalId = feature.getGlobalId();
        if (this.singletonTracker.has(globalId)) {
            return this.singletonTracker.get(globalId);
        }
        const { info } = await this._getLodInfo(feature, 0);
        if (!info || !info.geometry) return null;
        const material = this.materialFactory.getMaterialForFeature(feature, environmentState);
        const mesh = new THREE.Mesh(info.geometry, material);
        this._applyFeatureTransforms(mesh, feature);
        this.singletonTracker.set(globalId, mesh);
        if (typeof material.updateEnvironmentalUniforms === "function") {
            material.updateEnvironmentalUniforms();
        }
        return mesh;
    }

    removeFeature(globalId) {
        const mesh = this.singletonTracker.get(globalId);
        if (!mesh) return false;
        this.singletonTracker.delete(globalId);

        if (mesh.material && mesh.material.dispose) mesh.material.dispose();
        // Optionally: you can decrement reference counts or usage stats here if you want.
        return true;
    }

    // --- Extraction, transforms, cache utilities as in your draft ---
    _extractShapeParams(feature) {
        const params = {};
        if (feature.parameters) {
            if (feature.parameters.complexity !== undefined)
                params.complexity = Math.floor(feature.parameters.complexity * 10);
            if (feature.parameters.variant !== undefined)
                params.variant = feature.parameters.variant;
        }
        return params;
    }

    _applyFeatureTransforms(mesh, feature) {
        if (feature.position)
            mesh.position.set(feature.position.x, feature.position.y, feature.position.z);
        if (feature.rotation)
            mesh.rotation.set(feature.rotation.x, feature.rotation.y, feature.rotation.z);
        if (feature.scale)
            mesh.scale.set(feature.scale.x, feature.scale.y, feature.scale.z);
   //     console.log('Final mesh transform:', mesh.position, mesh.scale);
    }

    cleanup() {
        for (const mesh of this.singletonTracker.values()) {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        this.singletonTracker.clear();
        for (const key of this.geometryCache.keys()) {
            const entry = this.geometryCache.get(key);
            if (entry && entry.geometry) entry.geometry.dispose();
        }
        this.geometryCache.clear();
        this.pendingOperations.clear();
    }

    // ---------- Cache eviction and stats -----------
    tick(evictThresholdMs = 100000) {
        const now = Date.now();
        const keysToEvict = [];
        for (const [key, usage] of this.usageStats.entries()) {
            const cacheEntry = this.geometryCache.get(key);
            if (
                now - usage.lastUsed > evictThresholdMs &&
                (!cacheEntry || cacheEntry.refCount === 0)
            ) {
                keysToEvict.push(key);
            }
        }
        for (const key of keysToEvict) {
            const entry = this.geometryCache.get(key);
            if (entry && entry.geometry) entry.geometry.dispose();
            this.geometryCache.delete(key);
            this.usageStats.delete(key);
        }
        this._notifyProgress();
    }

    onProgress(callback)   { this.progressCallbacks.add(callback); }
    offProgress(callback)  { this.progressCallbacks.delete(callback); }
    _notifyProgress()      { this.progressCallbacks.forEach(cb => cb(this.getProgressStats())); }
    getProgressStats()     { 
        return { 
            cachedGeometries: this.geometryCache.size, 
            activeSingletons: this.singletonTracker.size, 
            pendingOperations: this.pendingOperations.size 
        }; 
    }

    // ---------- Seasonal/material uniform support ----------
    _initSeasonalUniforms(material) {
        if (!material.uniforms) return;
        if (!material.uniforms.currentSeason)      material.uniforms.currentSeason = { value: 0 };
        if (!material.uniforms.nextSeason)         material.uniforms.nextSeason = { value: 1 };
        if (!material.uniforms.seasonTransition)   material.uniforms.seasonTransition = { value: 0.0 };
        if (!material.uniforms.numSeasons)         material.uniforms.numSeasons = { value: 4 };
    }

    updateAllSeasonData(gameTime) {
        if (!gameTime) return;
        for (const mesh of this.singletonTracker.values()) {
            this._setSeasonUniforms(mesh.material, gameTime);
        }
    }
    _setSeasonUniforms(material, gameTime) {
        if (!material || !material.uniforms) return;
        const season = gameTime.getSeasonInfo();
        if (material.uniforms.currentSeason)      material.uniforms.currentSeason.value = season.currentSeason;
        if (material.uniforms.nextSeason)         material.uniforms.nextSeason.value = season.nextSeason;
        if (material.uniforms.seasonTransition)   material.uniforms.seasonTransition.value = season.transitionProgress;
        material.needsUpdate = true;
    }

    getStats() {
        return {
            cacheSize: this.geometryCache.size,
            activeSingletons: this.singletonTracker.size,
            memoryEstimate: this._estimateMemoryUsage()
        };
    }

    _estimateMemoryUsage() {
        let total = 0;
        for (const { geometry } of this.geometryCache.values()) {
            if (geometry && geometry.attributes) {
                if (geometry.attributes.position) total += geometry.attributes.position.count * 12; // 3 floats
                if (geometry.attributes.normal)   total += geometry.attributes.normal.count * 12;
                if (geometry.attributes.uv)       total += geometry.attributes.uv.count * 8; // 2 floats
            }
        }
        return total;
    }
}