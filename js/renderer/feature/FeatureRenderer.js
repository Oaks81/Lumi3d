import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { BaseRenderer } from '../BaseRenderer.js';

export class FeatureRenderer extends BaseRenderer {
    constructor(environmentState) {
        super();
        this.environmentState = environmentState;
        this._lastSeasonUpdateTime = 0;
    }

    /**
     * If you want to update any environmental uniforms on feature materials,
     * do it here (stub for future extension).
     */
    updateEnvUniforms(loadedChunks) {
        // (Optional) Example: update all static features/materials if needed
    }

// Update your FeatureRenderer.js render() method:

render(loadedChunks, gameState, camera, environmentState) {
    this.updateEnvUniforms(loadedChunks);

    // Update grass LODs based on camera distance (happens every frame)
    if (gameState.grassStreamer) {
        // Grass streamer already handles its own LOD updates in update()
    }

    // Update feature batch LODs based on camera distance
    for (const chunk of loadedChunks) {
        const batch = chunk.featureBatch;
        if (!batch || !chunk.chunkData || batch.batches == null) continue;
        
        // Calculate distance-based LOD for this chunk
        const chunkCenterX = (chunk.chunkData.chunkX + 0.5) * chunk.chunkData.size;
        const chunkCenterZ = (chunk.chunkData.chunkY + 0.5) * chunk.chunkData.size;
        const dx = camera.position.x - chunkCenterX;
        const dz = camera.position.z - chunkCenterZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Determine LOD (same thresholds as grass for consistency)
        let lod = 0;
        if (distance > 40) lod = 2;
        else if (distance > 20) lod = 1;
        
        // Apply LOD to all feature types in this chunk
        for (const featureType of Object.keys(batch.batches)) {
            batch.setLod(featureType, lod);
        }
    }
}
    resize(width, height) {
        // No-op unless needed
    }

    cleanup() {
        // No-op unless you add helpers/lights manually
    }
}