// WaterMeshManager.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { WaterMaterialFactory } from './WaterMaterialFactory.js';
import { WaterGeometryGenerator } from './waterGeometryGenerator.js';

export class WaterMeshManager {
    constructor(terrainMeshManager, textureManager, uniformManager, chunkSize) {
        this.terrainMeshManager = terrainMeshManager;
        this.materialFactory = new WaterMaterialFactory(textureManager, uniformManager);
        this.waterGeometryGenerator = new WaterGeometryGenerator();
        this.waterMeshes = new Map();

        this.chunkSize = chunkSize;
        
        this.sharedGeometries = [];
        this.geometryInitialized = false;
    }

    initializeSharedGeometries() {
        if (this.geometryInitialized) return;
        
        const sizes = [
            { segments: 32, lod: 0 },
            { segments: 16, lod: 1 },
            { segments: 8, lod: 2 },
            { segments: 4, lod: 3 }
        ];
        
        for (const { segments, lod } of sizes) {
            const geometry = new THREE.PlaneGeometry(
                this.chunkSize, 
                this.chunkSize, 
                segments, 
                segments
            );
            geometry.rotateX(-Math.PI / 2);
            
            geometry.translate(this.chunkSize / 2, 0, this.chunkSize / 2);
            
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            
            this.sharedGeometries[lod] = geometry;
        }
        
        this.geometryInitialized = true;
        console.log(`✓ Water shared geometries initialized (${this.chunkSize}×${this.chunkSize})`);
    }
    // Synchronous water mesh creation
    createWaterMeshSync(feature, chunkKey, chunkData, globalSeaLevel, environmentState) {
        // Skip if chunk is fully above water
        if (chunkData.isFullyAboveWater) return null;
        
        // Ensure shared geometries are initialized
        this.initializeSharedGeometries();
        
        // Setup feature properties
        feature.type = 'water';
        feature.chunkX = chunkData.chunkX;
        feature.chunkY = chunkData.chunkY;
        feature.waterLevel = globalSeaLevel;
        feature.chunkSize = chunkData.size;
        
        // Get LOD level and use shared geometry
        const lodLevel = chunkData.lodLevel || 0;
        const geometry = this.sharedGeometries[Math.min(lodLevel, this.sharedGeometries.length - 1)];
        
        if (!geometry) {
            console.warn(`No shared geometry for water LOD ${lodLevel}`);
            return null;
        }
        
        // Get height texture for this chunk
        const heightTexture = this.terrainMeshManager.getHeightTexture(chunkData.chunkX, chunkData.chunkY);
        if (!heightTexture) {
            console.warn(`No height texture for water chunk ${chunkKey}`);
            return null;
        }
        
        // ✅ FIXED: Use getMaterialForWater (original method)
        const material = this.materialFactory.getMaterialForWater(
            feature,
            heightTexture,
            environmentState
        );
        
        if (!material) {
            console.error('Failed to create water material');
            return null;
        }
        
        // Create mesh using shared geometry and per-chunk material
        const mesh = new THREE.Mesh(geometry, material);
        
        const chunkWorldX = chunkData.chunkX * chunkData.size;
        const chunkWorldZ = chunkData.chunkY * chunkData.size;
        mesh.position.set(chunkWorldX, globalSeaLevel, chunkWorldZ);
        
        mesh.renderOrder = 20;
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = `Water_${chunkKey}`;
        mesh.userData = {
            type: 'water',
            chunkKey,
            lodLevel,
            isFullySubmerged: chunkData.isFullySubmerged,
            hasWater: chunkData.hasWater
        };
        
        return mesh;
    }

    // Keep async version for compatibility
    async loadWaterFeatures(chunkKey, waterFeatures, chunkData, environmentState) {
        return;
        if (!waterFeatures || waterFeatures.length === 0) return [];
        if (chunkData.isFullyAboveWater) return [];

        const terrainMesh = this.terrainMeshManager.chunkMeshes.get(chunkKey);
        if (!terrainMesh) {
            console.warn(`No terrain mesh for water chunk ${chunkKey}`);
            return [];
        }

        const waterMeshes = [];
        const globalSeaLevel = 8.0;

        for (const feature of waterFeatures) {
            try {
                const mesh = this.createWaterMeshSync(
                    feature,
                    chunkKey,
                    chunkData,
                    globalSeaLevel,
                    environmentState
                );

                if (mesh) {
                    this.scene.add(mesh);
                    waterMeshes.push(mesh);
                }
            } catch (err) {
                console.error('Error creating water mesh:', err);
            }
        }

        this.waterMeshes.set(chunkKey, waterMeshes);
        return waterMeshes;
    }

    unloadChunk(chunkKey) {
        const meshes = this.waterMeshes.get(chunkKey);
        if (meshes) {
            for (const mesh of meshes) {
                this.scene.remove(mesh);
                
                // Remove material from cache
                if (mesh.userData.chunkKey) {
                    const [cx, cy] = mesh.userData.chunkKey.split(',').map(Number);
                    this.materialFactory.removeMaterial(cx, cy);
                }
                
                // Don't dispose shared geometry!
                // Material is disposed by materialFactory.removeMaterial()
            }
            this.waterMeshes.delete(chunkKey);
        }
    }

    dispose() {
        // Unload all chunks
        for (const chunkKey of this.waterMeshes.keys()) {
            this.unloadChunk(chunkKey);
        }
        
        // Dispose shared geometries
        for (const geometry of this.sharedGeometries) {
            if (geometry) geometry.dispose();
        }
        this.sharedGeometries = [];
        this.geometryInitialized = false;
        
        // Dispose material factory
        this.materialFactory.dispose();
    }
}