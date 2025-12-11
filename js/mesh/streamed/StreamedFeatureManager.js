import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { StreamedMaterialFactory } from './StreamedMaterialFactory.js';
import { StreamedGeometryCache } from './streamedGeometryCache.js';
import { StreamedAssetConfig } from './streamedAssetConfig.js';

/**
 * Manages GPU-driven procedurally placed features using the custom backends.
 */
export class StreamedFeatureManager {
    /**
     * @param {import('../../renderer/backend/backend.js').Backend} backend
     * @param {Object} terrainMeshManager
     * @param {Object} textureManager
     * @param {Object} uniformManager
     * @param {Object} lodManager
     * @param {Object} options
     */
    constructor(backend, terrainMeshManager, textureManager, uniformManager, lodManager, options = {}) {
        this.backend = backend;
        this.apiName = backend?.getAPIName?.() || 'webgl2';
        this.terrainMeshManager = terrainMeshManager;
        this.textureManager = textureManager;
        this.uniformManager = uniformManager;
        this.lodManager = lodManager;

        this.materialFactory = new StreamedMaterialFactory(backend, uniformManager);
        this.geometryCache = new StreamedGeometryCache();

        this.streamedTypes = new Map();
        this.materials = new Map();
        this.activeChunks = new Map(); // Map<chunkKey, Map<typeName, meshData>>

        this.streamRadius = options.streamRadius || 80;
        this.chunkSize = options.chunkSize || 64;
        this.lodDistances = options.lodDistances || [];

        this.lastCameraPos = new THREE.Vector3();
        this.windTime = 0;
        this.lastUpdateFrame = 0;
        this.updateFrameInterval = options.updateIntervalFrames || 10;
    }

    async initialize() {
        this.registerStreamedFeatures();

        for (const [typeName, config] of this.streamedTypes.entries()) {
            const geometry = await this.geometryCache.getGeometry(typeName, config, 0);
            if (!geometry) {
                console.warn(`StreamedFeatureManager: missing geometry for ${typeName}`);
                continue;
            }

            const material = await this.materialFactory.createMaterial(typeName, config, this.chunkSize);
            this.materials.set(typeName, material);
            console.log(`StreamedFeatureManager: ${typeName} ready (verts: ${geometry.attributes.get('position')?.count || 0})`);
        }
    }

    update(cameraPosition, terrain, deltaTime) {
        const dt = deltaTime || 0;
        this.windTime += dt;
        this.lastCameraPos.copy(cameraPosition);

        for (const chunkMeshes of this.activeChunks.values()) {
            for (const meshData of chunkMeshes.values()) {
                if (!meshData || !meshData.uniforms) continue;
                if (meshData.uniforms.u_time) meshData.uniforms.u_time.value = this.windTime;
                if (meshData.uniforms.u_cameraPosition) meshData.uniforms.u_cameraPosition.value.copy(cameraPosition);
                this._updateFeatureParams(meshData);
            }
        }

        this.lastUpdateFrame++;
        if (this.lastUpdateFrame >= this.updateFrameInterval) {
            this.loadNewChunksOptimized(cameraPosition, terrain);
            this.updateLODs(cameraPosition);
            this.lastUpdateFrame = 0;
        }
    }

    render(camera) {
        if (!this.backend) return;

        for (const chunkMeshes of this.activeChunks.values()) {
            for (const meshData of chunkMeshes.values()) {
                if (!meshData) continue;
                this._updateCameraUniforms(meshData, camera);
                meshData.geometry.instanceCount = meshData.instanceCount || 1;
                try {
                    this.backend.draw(meshData.geometry, meshData.material, meshData.uniforms);
                } catch (err) {
                    console.error('StreamedFeatureManager draw error', err);
                }
            }
        }
    }

    updateCameraUniforms(cameraPosition) {
        for (const chunkMeshes of this.activeChunks.values()) {
            for (const data of chunkMeshes.values()) {
                if (data?.uniforms?.u_cameraPosition) {
                    data.uniforms.u_cameraPosition.value.copy(cameraPosition);
                    this._updateFeatureParams(data);
                }
            }
        }
    }

    async createMaterial(typeName, config) {
        return await this.materialFactory.createMaterial(typeName, config, this.chunkSize);
    }

    updateWind(deltaTime) {
        this.windTime += deltaTime * 0.001;
        for (const chunkMeshes of this.activeChunks.values()) {
            for (const data of chunkMeshes.values()) {
                if (data?.uniforms?.u_time) {
                    data.uniforms.u_time.value = this.windTime;
                }
            }
        }
    }

    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) return i;
        }
        return this.lodDistances.length;
    }

    updateLODs(cameraPosition) {
        for (const [chunkKey, chunkMeshes] of this.activeChunks.entries()) {
            const parts = chunkKey.split(',');
            const chunkX = Number(parts[0].split(':').pop());
            const chunkY = Number((parts[1] || '0').split(':')[0]);
            const chunkCenter = new THREE.Vector3(
                (chunkX + 0.5) * this.chunkSize,
                0,
                (chunkY + 0.5) * this.chunkSize
            );

            const dx = chunkCenter.x - cameraPosition.x;
            const dz = chunkCenter.z - cameraPosition.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const newLod = this.lodManager ? this.lodManager.getLODForDistance(distance) : 0;

            for (const [typeName, data] of chunkMeshes.entries()) {
                if (!data) continue;
                const oldLod = data.lodLevel;
                if (oldLod === newLod) continue;

                data.lodLevel = newLod;
                if (data.uniforms.u_maxDistance) {
                    const baseDist = data.config.maxRenderDistance || data.config.streamRadius * 0.9;
                    const lodMultiplier = [1.0, 0.8, 0.6, 0.4, 0.2][Math.min(newLod, 4)];
                    const newMaxDist = baseDist * lodMultiplier;
                    data.uniforms.u_maxDistance.value = newMaxDist;
                    this._updateFeatureParams(data);
                }
            }
        }
    }

    loadNewChunksOptimized(cameraPosition, terrain) {
        const nearbyChunks = new Set(this.terrainMeshManager.chunkMeshes.keys());

        let processedCount = 0;
        const maxProcessPerUpdate = 8;

        for (const chunkKey of nearbyChunks) {
            if (processedCount >= maxProcessPerUpdate) break;
            const chunkData = terrain.get(chunkKey);
            if (this.processChunkFeatures(chunkKey, cameraPosition, terrain, chunkData)) {
                processedCount++;
            }
        }

        this.unloadDistantChunksOptimized(nearbyChunks);
    }

    processChunkFeatures(chunkKey, cameraPosition, terrain, chunkDataFromTerrain) {
        let cx = 0;
        let cy = 0;
        if (chunkDataFromTerrain) {
            cx = chunkDataFromTerrain.chunkX;
            cy = chunkDataFromTerrain.chunkY;
        } else {
            const parts = chunkKey.split(',');
            cx = Number(parts[0].split(':').pop());
            cy = Number((parts[1] || '0').split(':')[0]);
        }
        if (!this.activeChunks.has(chunkKey)) {
            this.activeChunks.set(chunkKey, new Map());
        }
        const chunkMeshes = this.activeChunks.get(chunkKey);

        const chunkCenter = new THREE.Vector3(
            (cx + 0.5) * this.chunkSize,
            0,
            (cy + 0.5) * this.chunkSize
        );
        const dx = chunkCenter.x - cameraPosition.x;
        const dz = chunkCenter.z - cameraPosition.z;
        const distanceToChunk = Math.sqrt(dx * dx + dz * dz);

        const terrainChunkData = chunkDataFromTerrain || terrain.get(chunkKey);
        if (!terrainChunkData) return false;
        const featureDist = terrainChunkData.featureDistribution?.featureMix || {};

        let changedCount = 0;

        for (const [typeName, config] of this.streamedTypes.entries()) {
            const isLoaded = chunkMeshes.has(typeName);
            const isInRange = distanceToChunk <= config.streamRadius;

            if (!isLoaded && isInRange) {
                const weight = featureDist[typeName.toLowerCase()] ?? 1.0;
                if (weight <= 0.01) {
                    chunkMeshes.set(typeName, null);
                    continue;
                }

                const textures = this.getChunkTextures(cx, cy, chunkKey);
                if (!textures) continue;

                const chunkData = this.calculateChunkData(cx, cy, cameraPosition, terrainChunkData);
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

            if (isLoaded && !isInRange) {
                chunkMeshes.delete(typeName);
                changedCount++;
            }
        }

        return changedCount > 0;
    }

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
        const directHeight = this.terrainMeshManager.chunkHeightTextures?.get(chunkKey);
        const directNormal = this.terrainMeshManager.chunkNormalTextures?.get(chunkKey);
        const directTile = this.terrainMeshManager.chunkTileTextures?.get(chunkKey);

        const heightTexture = directHeight || this.terrainMeshManager.getHeightTexture(chunkX, chunkY);
        const normalTexture = directNormal || this.terrainMeshManager.getNormalTexture(chunkX, chunkY);
        const tileTypeTexture = directTile || this.terrainMeshManager.getTileTypeTexture(chunkX, chunkY);

        if (!heightTexture || !tileTypeTexture) {
            console.warn(`StreamedFeatureManager: Missing textures for chunk ${chunkKey}`);
            return null;
        }

        return { heightTexture, normalTexture, tileTypeTexture };
    }

    calculateChunkData(chunkX, chunkY, cameraPosition, terrainChunkData = null) {
        const offsetX = terrainChunkData?.offsetX ?? chunkX * this.chunkSize;
        const offsetZ = terrainChunkData?.offsetZ ?? chunkY * this.chunkSize;
        const chunkOffset = new THREE.Vector2(offsetX, offsetZ);

        const chunkCenter = new THREE.Vector3(
            (chunkX + 0.5) * this.chunkSize,
            0,
            (chunkY + 0.5) * this.chunkSize
        );

        const distance = cameraPosition.distanceTo(chunkCenter);
        const lodLevel = this.lodManager ? this.lodManager.getLODForDistance(distance) : 0;

        return {
            chunkOffset,
            chunkCenter,
            lodLevel,
            chunkSize: this.chunkSize,
            distance
        };
    }

    createTypeMesh(typeName, config, textures, chunkData) {
        const geometryKey = `${typeName}|${config.noiseSeed || 0}|lod0`;
        const geometry = this.geometryCache.geometryCache.get(geometryKey);
        const baseMaterial = this.materials.get(typeName);

        if (!geometry || !baseMaterial) {
            console.error(`Missing geometry (${!!geometry}) or material (${!!baseMaterial}) for ${typeName}. Has initialize() been called?`);
            return null;
        }

        const adjustedConfig = { ...config };
        if (config.biomeWeight !== undefined) {
            adjustedConfig.density *= config.biomeWeight;
        }

        const uniforms = this.setMaterialUniforms(adjustedConfig, textures, chunkData);

        const MAX_INSTANCES = Math.floor((this.chunkSize / adjustedConfig.gridSpacing) ** 2);

        return {
            geometry,
            material: baseMaterial,
            uniforms,
            lodLevel: chunkData.lodLevel,
            chunkCenter: chunkData.chunkCenter,
            config: adjustedConfig,
            instanceCount: MAX_INSTANCES
        };
    }

    setMaterialUniforms(config, textures, chunkData) {
        const instancesPerRow = Math.ceil(chunkData.chunkSize / config.gridSpacing);
        const streamRadius = config.streamRadius || 100;
        const maxRenderDistance = config.maxRenderDistance || streamRadius * 0.9;
        const taperStartDistance = config.taperStartDistance || streamRadius * 0.5;
        const taperEndDistance = config.taperEndDistance || streamRadius * 0.85;

        const uniforms = {
            viewMatrix: { value: new THREE.Matrix4() },
            projectionMatrix: { value: new THREE.Matrix4() },
            u_noiseSeed: { value: config.noiseSeed || 0.0 },
            u_chunkOffset: { value: chunkData.chunkOffset.clone ? chunkData.chunkOffset.clone() : new THREE.Vector2(chunkData.chunkOffset.x, chunkData.chunkOffset.y) },
            u_chunkSize: { value: chunkData.chunkSize },
            u_gridSpacing: { value: config.gridSpacing },
            u_instancesPerRow: { value: instancesPerRow },
            u_maxDistance: { value: maxRenderDistance },
            u_taperStartDistance: { value: taperStartDistance },
            u_taperEndDistance: { value: taperEndDistance },
            u_minCullDistance: { value: config.minCullDistance || 2 },
            u_density: { value: config.density * (config.biomeWeight || 1.0) },
            u_waterLevel: { value: 8.0 },
            u_cameraPosition: { value: this.lastCameraPos.clone() },
            u_time: { value: this.windTime },
            u_windStrength: { value: config.windStrength || 0.05 },
            plantColor: { value: config.color || new THREE.Color(0.4, 0.7, 0.3) },
            u_heightTexture: { value: textures.heightTexture },
            u_tileTypeTexture: { value: textures.tileTypeTexture },
            cameraUniforms: { value: new Float32Array(36) },
            featureParams: { value: new Float32Array(16) }
        };

        this._updateFeatureParams({ uniforms });
        this._updateCameraUniforms({ uniforms }, { position: this.lastCameraPos, matrixWorldInverse: new THREE.Matrix4(), projectionMatrix: new THREE.Matrix4() });

        return uniforms;
    }

    _updateFeatureParams(meshData) {
        const uniforms = meshData.uniforms;
        const params = uniforms?.featureParams?.value;
        if (!params) return;

        params[0] = uniforms.u_chunkOffset.value.x;
        params[1] = uniforms.u_chunkOffset.value.y;
        params[2] = uniforms.u_chunkSize.value;
        params[3] = uniforms.u_gridSpacing.value;

        params[4] = uniforms.u_instancesPerRow.value;
        params[5] = uniforms.u_maxDistance.value;
        params[6] = uniforms.u_taperStartDistance.value;
        params[7] = uniforms.u_taperEndDistance.value;

        params[8] = uniforms.u_density.value;
        params[9] = uniforms.u_waterLevel.value;
        params[10] = uniforms.u_noiseSeed.value;
        params[11] = uniforms.u_time.value;

        params[12] = uniforms.u_windStrength.value;
        params[13] = uniforms.plantColor.value.r;
        params[14] = uniforms.plantColor.value.g;
        params[15] = uniforms.plantColor.value.b;
    }

    _updateCameraUniforms(meshData, camera) {
        const uniforms = meshData.uniforms || {};
        if (uniforms.u_cameraPosition?.value && camera?.position) {
            uniforms.u_cameraPosition.value.copy(camera.position);
        }
        if (uniforms.viewMatrix?.value && camera?.matrixWorldInverse) {
            uniforms.viewMatrix.value.copy(camera.matrixWorldInverse);
        }
        if (uniforms.projectionMatrix?.value && camera?.projectionMatrix) {
            uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
        }

        const cameraBuf = uniforms.cameraUniforms?.value;
        if (cameraBuf && camera?.matrixWorldInverse && camera?.projectionMatrix) {
            cameraBuf.set(camera.matrixWorldInverse.elements, 0);
            cameraBuf.set(camera.projectionMatrix.elements, 16);
            cameraBuf[32] = camera.position.x;
            cameraBuf[33] = camera.position.y;
            cameraBuf[34] = camera.position.z;
            cameraBuf[35] = 1.0;
        }
    }

    unloadChunk(chunkKey) {
        if (!this.activeChunks.has(chunkKey)) return;
        this.activeChunks.delete(chunkKey);
        console.log(`Unloaded streamed features for chunk ${chunkKey}`);
    }

    dispose() {
        for (const material of this.materials.values()) {
            if (this.backend && material) {
                this.backend.deleteShader(material);
            }
        }
        this.geometryCache.cleanup();
        this.materials.clear();
        this.activeChunks.clear();
    }

    registerStreamedFeatures() {
        console.log('Registering features from StreamedAssetConfig.js...');
        
        for (const assetDef of StreamedAssetConfig) {
            const typeName = assetDef.typeName;
            const config = assetDef.config;

            this.streamedTypes.set(typeName, {
                name: typeName,
                gridSpacing: config.gridSpacing || 0.5,
                density: config.density || 0.8,
                validTiles: config.validTiles || [3, 6],
                ...config
            });

            this.geometryCache.registerGenerator(typeName, new assetDef.generatorClass());
        }

        console.log(`Registered ${this.streamedTypes.size} streamed types.`);
    }
}
