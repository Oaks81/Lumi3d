import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class GeometryGeneratorBase {

    /**
     *  Must return a GeometryLodMap with at least one LOD level.
     * The first LOD (0) is the highest detail, subsequent levels are lower detail.
     * Example:
     *        const lodMap = new GeometryLodMap();
     *        lodMap.setMeshLod(0, highGeom);
     *        lodMap.setMeshLod(1, lowGeom);
     *        lodMap.setRemoveLod(2);
     */
    async buildGeometry(feature) {
        // This method should be overridden by subclasses
        throw new Error("buildGeometry must be implemented by subclasses");
    }

    getMaterialProfile(feature) {
        return {
          materialType: null,
          options: { }
        };
    }
}
