// ./generators/GrassGeometryGenerator.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
// Assume GeometryLodMap is correctly imported relative to your structure
import { GeometryLodMap } from '../../GeometryLodMap.js'; 
import { GeometryGeneratorBase } from '../../geometryGeneratorBase.js';
export class GrassGeometryGenerator extends GeometryGeneratorBase {
    /**
     * Builds the GeometryLodMap for the base instanced mesh.
     * @param {Object} config - The feature configuration (from StreamedAssetConfig).
     * @returns {Promise<GeometryLodMap>}
     */
    async buildGeometry(config) {
        const lodMap = new GeometryLodMap();
        
        // Configuration parameters from StreamedAssetConfig.js
        const radius = config.geometryParams?.radius || 0.05; // Base radius
        const height = config.geometryParams?.height || 0.8;
        const radialSegments = 4; // Low poly count for performance
        
        // --- LOD 0: Cone Geometry (Pointy Cylinder) ---
        
        // Create a cone geometry: (radius, height, radialSegments, heightSegments, openEnded)
        const geometry = new THREE.ConeGeometry(
            radius, 
            height, 
            radialSegments, 
            1,      // Only 1 height segment for simplicity
            true    // Open ended (don't need the bottom cap)
        );
        
        // Translate to pivot at the base of the cone (y = 0), since ConeGeometry is centered.
        geometry.translate(0, height / 2, 0);

        // Set the mesh for LOD 0, which is used for instancing
        lodMap.setMeshLod(0, geometry); 
        
        return lodMap;
    }
}