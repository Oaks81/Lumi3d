// FeatureChunkBatch.js
export class FeatureChunkBatch {
    constructor(scene) {
        this.scene = scene;
        this.batches = {}; // { featureType: { lod: THREE.InstancedMesh|Group } }
        this.currentLods = {}; // {featureType: lod}
    }

    /**
     * Add an InstancedMesh or Sprite Group for a given type and lod.
     * Only added to scene once!
     */
    addBatch(featureType, lod, meshOrGroup) {
        if (!this.batches[featureType]) this.batches[featureType] = {};
        this.batches[featureType][lod] = meshOrGroup;
        meshOrGroup.visible = false;
        if (!this.scene.children.includes(meshOrGroup)) this.scene.add(meshOrGroup);
    }

    /**
     * Switches mesh/group for this feature type to the specified LOD.
     * Hides all others. Returns true if any visible states changed.
     */
    setLod(featureType, lod) {
        if (!this.batches[featureType]) return false;
        let changed = false;
        for (const [theLod, mesh] of Object.entries(this.batches[featureType])) {
            const shouldBeVisible = (parseInt(theLod) === lod);
            if (mesh.visible !== shouldBeVisible) {
                mesh.visible = shouldBeVisible;
                changed = true;
            }
        }
        this.currentLods[featureType] = lod;
        return changed;
    }

    /**
     * Update time-based uniforms for animation
     * @param {number} time - Current time in seconds
     */
    updateTime(time) {
        for (const batchesOfType of Object.values(this.batches)) {
            for (const meshOrGroup of Object.values(batchesOfType)) {
                if (meshOrGroup.material && meshOrGroup.material.uniforms) {
                    if (meshOrGroup.material.uniforms.time) {
                        meshOrGroup.material.uniforms.time.value = time;
                    }
                }
            }
        }
    }

    /**
     * Remove all batches for this chunk from the scene and dispose geometry.
     */
    disposeAll() {
        for (const batchesOfType of Object.values(this.batches)) {
            for (const meshOrGroup of Object.values(batchesOfType)) {
                this.scene.remove(meshOrGroup);
                if (meshOrGroup.geometry) meshOrGroup.geometry.dispose?.();
                if (meshOrGroup.material) meshOrGroup.material.dispose?.();
            }
        }
        this.batches = {};
        this.currentLods = {};
    }
}