// StreamedGeometryCache.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Geometry } from '../../renderer/resources/geometry.js';

/**
 * Dedicated cache for the base geometries of highly instanced features.
 * This prevents regeneration of base geometry (like a single grass quad)
 * every time a StreamedFeatureManager chunk is loaded.
 */
export class StreamedGeometryCache {
    constructor() {
        this.generatorMap = new Map();
        this.geometryCache = new Map(); // Key: typeName|seed|lod -> Geometry
        console.log('StreamedGeometryCache initialized.');
    }

    registerGenerator(typeName, generatorInstance) {
        this.generatorMap.set(typeName, generatorInstance);
    }

    /**
     * Gets the base geometry for an instanced feature from the cache,
     * generating it if necessary. Returned geometry is converted to the
     * custom Geometry class so it can be consumed by our backends.
     * @param {string} typeName - The registered feature type (e.g., 'grass_short', 'BIRCH_LEAF')
     * @param {Object} config - The feature configuration (passed to the generator)
     * @param {number} lod - The LOD level (usually 0 for base instancing geometry)
     * @returns {Promise<Geometry>} The base geometry for the instanced mesh.
     */
    async getGeometry(typeName, config, lod = 0) {
        // Use typeName and noiseSeed for unique cache key
        const shapeSeed = config.noiseSeed || 0;
        const cacheKey = `${typeName}|${shapeSeed}|lod${lod}`;

        if (this.geometryCache.has(cacheKey)) {
            return this.geometryCache.get(cacheKey);
        }

        const generator = this.generatorMap.get(typeName);
        if (!generator) {
            console.error(`Generator not registered for type: ${typeName}`);
            return null;
        }

        console.log(`Generating base geometry for ${typeName} (LOD ${lod})...`);
        
        // Generators now return a GeometryLodMap, we extract the base geometry
        const lodMapResult = await generator.buildGeometry(config);

        if (!lodMapResult || !lodMapResult.hasLod(lod)) {
            console.error(`Generator for ${typeName} did not return LOD ${lod} geometry.`);
            return null;
        }
        
        const lodInfo = lodMapResult.getLodInfo(lod);
        if (lodInfo.type !== 'mesh' || !lodInfo.geometry) {
             console.error(`LOD ${lod} for ${typeName} is not a valid 'mesh' geometry.`);
             return null;
        }

        const converted = this._convertToGeometry(lodInfo.geometry);
        if (!converted) {
            console.error(`Failed to convert geometry for ${typeName} LOD ${lod}`);
            return null;
        }

        // Cache the result and return
        this.geometryCache.set(cacheKey, converted);
        return converted;
    }

    cleanup() {
        for (const geometry of this.geometryCache.values()) {
            if (geometry && typeof geometry.dispose === 'function') {
                geometry.dispose();
            }
        }
        this.geometryCache.clear();
        console.log('StreamedGeometryCache cleaned up.');
    }

    _convertToGeometry(sourceGeometry) {
        if (!sourceGeometry) return null;
        if (sourceGeometry instanceof Geometry) return sourceGeometry;

        const geometry = new Geometry();

        if (sourceGeometry.attributes) {
            for (const [name, attr] of Object.entries(sourceGeometry.attributes)) {
                const data = attr.array ? attr.array.slice(0) : attr.data?.slice(0);
                if (!data) continue;
                geometry.setAttribute(
                    name,
                    data instanceof Float32Array ? data : new Float32Array(data),
                    attr.itemSize || 3,
                    attr.normalized || false,
                    {
                        stepMode: attr.divisor > 0 ? 'instance' : 'vertex',
                        slot: attr.slot
                    }
                );
            }
        }

        if (sourceGeometry.index) {
            const idx = sourceGeometry.index.array || sourceGeometry.index;
            const IndexArray = idx instanceof Uint32Array ? Uint32Array : Uint16Array;
            geometry.setIndex(new IndexArray(idx));
        }

        geometry.computeBoundingSphere();
        return geometry;
    }
}
