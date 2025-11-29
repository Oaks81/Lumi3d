// =============================================================================
// LOD MANAGER FIX - js/renderer/lodManager.js
// =============================================================================
// 
// TWO CRITICAL ISSUES:
// 1. getLODForDistance returns indices 0-10, but only 0-6 are valid
// 2. LOD distances are too small for spherical terrain at altitude
//
// =============================================================================

// Replace the entire LODManager class with this fixed version:

export class LODManager {
    constructor(config = {}) {
        this.chunkSize = config.chunkSize || 128;
        this.isSphericalMode = true;//config.isSphericalMode || false;
        this.planetConfig = config.planetConfig || null;
        this.sphericalMapper = config.sphericalMapper || null;
        
        // FIXED: Use appropriate distances based on mode
        this.lodDistances = config.lodDistances || this.getDefaultDistances();
        this.lodSettings = this.initializeLODSettings();
        this.altitudeLODOverrides = this.initializeAltitudeOverrides();
        this.chunkLODCache = new Map();
        this.cacheValidUntil = 0;
        this.cacheDuration = 100;
        
        // Maximum valid LOD level (must match TerrainGeometryBuilder.DEFAULT_SUBDIVISIONS)
        this.MAX_LOD = 6;
        
        console.log('LODManager initialized (spherical=' + this.isSphericalMode + ')');
        console.log('  LOD distances:', this.lodDistances);
        console.log('  Max LOD:', this.MAX_LOD);
    }
    
    /**
     * Set planetary configuration for spherical LOD calculations
     */
    setPlanetaryConfig(planetConfig, sphericalMapper) {
        this.planetConfig = planetConfig;
        this.sphericalMapper = sphericalMapper;
        this.isSphericalMode = !!(planetConfig && sphericalMapper);
        
        if (this.isSphericalMode) {
            // Recalculate distances for spherical mode
            this.lodDistances = this.getSphericalDistances();
            console.log('[LODManager] Planetary config set, new distances:', this.lodDistances);
        }
    }
    
    /**
     * Get LOD distances appropriate for flat terrain
     */
    getDefaultDistances() {
        const multipliers = [1.5, 2.5, 4, 6, 9, 13, 20];
        return multipliers.map(m => Math.round(m * this.chunkSize));
    }
    
    /**
     * Get LOD distances appropriate for spherical terrain
     * These are much larger because camera is typically at altitude
     */
    getSphericalDistances() {
        const chunksPerFace = this.sphericalMapper?.chunksPerFace || 16;
        const planetRadius = this.planetConfig?.radius || 50000;

        // Each chunk spans roughly (2 * radius / chunksPerFace) meters on a cube face.
        const chunkWorldSize = (2 * planetRadius) / chunksPerFace;

        // Wider near-field bubble so chunks under the camera can reach LOD 0/1.
        const multipliers = [0.8, 1.6, 2.5, 4, 6, 9, 13];
        return multipliers.map(m => Math.round(m * chunkWorldSize));
    }
    
    initializeLODSettings() {
        return [
            { geometryLOD: 0, geometryDetail: 'full', useQuadOnly: false },      // 128 segments = 16641 verts
            { geometryLOD: 1, geometryDetail: 'high', useQuadOnly: false },      // 64 segments = 4225 verts
            { geometryLOD: 2, geometryDetail: 'medium', useQuadOnly: false },    // 32 segments = 1089 verts
            { geometryLOD: 3, geometryDetail: 'low', useQuadOnly: false },       // 16 segments = 289 verts
            { geometryLOD: 4, geometryDetail: 'verylow', useQuadOnly: false },   // 8 segments = 81 verts
            { geometryLOD: 5, geometryDetail: 'minimal', useQuadOnly: false },   // 4 segments = 25 verts
            { geometryLOD: 6, geometryDetail: 'ultra', useQuadOnly: false }      // 2 segments = 9 verts
        ];
    }
    
    initializeAltitudeOverrides() {
        return {
            surface:        { minLOD: 0, maxLOD: 2, forceQuadOnly: false },
            low_altitude:   { minLOD: 0, maxLOD: 3, forceQuadOnly: false },
            lowAltitude:    { minLOD: 0, maxLOD: 3, forceQuadOnly: false },
            medium_altitude:{ minLOD: 1, maxLOD: 4, forceQuadOnly: false },
            mediumAltitude: { minLOD: 1, maxLOD: 4, forceQuadOnly: false },
            high_altitude:  { minLOD: 2, maxLOD: 5, forceQuadOnly: false },
            highAltitude:   { minLOD: 2, maxLOD: 5, forceQuadOnly: false },
            orbital:        { minLOD: 3, maxLOD: 6, forceQuadOnly: false }
        };
    }
    
    /**
     * Main LOD calculation for a chunk
     */
    getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager = null, options = {}) {
        let distance;
        
        // SPHERICAL MODE: Calculate distance using actual world position
        if (this.isSphericalMode && options.face !== undefined) {
            const chunksPerFace = this.sphericalMapper?.chunksPerFace || options.chunksPerFace || 16;
            const planetRadius = this.planetConfig?.radius || options.planetRadius || 50000;
            const origin = this.planetConfig?.origin || options.planetOrigin || { x: 0, y: 0, z: 0 };
            
            // Get UV at chunk center
            const u = (chunkX + 0.5) / chunksPerFace;
            const v = (chunkY + 0.5) / chunksPerFace;
            
            // Convert to cube point then sphere direction
            const cubePoint = this._getCubePoint(options.face, u, v);
            const len = Math.sqrt(cubePoint.x * cubePoint.x + cubePoint.y * cubePoint.y + cubePoint.z * cubePoint.z);
            const sphereDir = {
                x: cubePoint.x / len,
                y: cubePoint.y / len,
                z: cubePoint.z / len
            };
            
            // Get world position on sphere surface
            const worldPos = {
                x: origin.x + sphereDir.x * planetRadius,
                y: origin.y + sphereDir.y * planetRadius,
                z: origin.z + sphereDir.z * planetRadius
            };
            
            // Calculate actual 3D distance to camera
            const dx = worldPos.x - cameraPosition.x;
            const dy = worldPos.y - cameraPosition.y;
            const dz = worldPos.z - cameraPosition.z;
            distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        } else {
            // FLAT MODE: Original calculation (horizontal distance only)
            const dx = (chunkX + 0.5) * this.chunkSize - cameraPosition.x;
            const dz = (chunkY + 0.5) * this.chunkSize - cameraPosition.z;
            distance = Math.sqrt(dx * dx + dz * dz);
        }
        
        // Get base LOD from distance
        let lod = this.getLODForDistance(distance);
        
        // Apply altitude zone overrides if available
        if (altitudeZoneManager) {
            const zone = altitudeZoneManager.currentZone;
            const override = this.altitudeLODOverrides[zone];
            if (override) {
                lod = Math.max(override.minLOD, Math.min(override.maxLOD, lod));
            }
        }
        
        return lod;
    }
    
    /**
     * Helper: Convert Face + UV to a point on a Unit Cube
     */
    _getCubePoint(face, u, v) {
        const xy = { x: u * 2.0 - 1.0, y: v * 2.0 - 1.0 };
        
        switch (face) {
            case 0: return { x: 1.0, y: xy.y, z: -xy.x };  // +X
            case 1: return { x: -1.0, y: xy.y, z: xy.x };  // -X
            case 2: return { x: xy.x, y: 1.0, z: -xy.y };  // +Y
            case 3: return { x: xy.x, y: -1.0, z: xy.y };  // -Y
            case 4: return { x: xy.x, y: xy.y, z: 1.0 };   // +Z
            case 5: return { x: -xy.x, y: xy.y, z: -1.0 }; // -Z
            default: return { x: 0, y: 1, z: 0 };
        }
    }
    
    getLODForChunkKey(chunkKey, cameraPosition, altitudeZoneManager = null) {
        let chunkX, chunkY, face;
        
        if (chunkKey.includes(':')) {
            // Spherical format: "face:x,y:lod"
            const parts = chunkKey.split(':');
            face = parseInt(parts[0], 10);
            const coords = parts[1].split(',');
            chunkX = parseInt(coords[0], 10);
            chunkY = parseInt(coords[1], 10);
        } else {
            // Flat format: "x,y"
            const coords = chunkKey.split(',');
            chunkX = parseInt(coords[0], 10);
            chunkY = parseInt(coords[1], 10);
            face = undefined;
        }
        
        return this.getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager, { face });
    }
    
    /**
     * FIXED: Get LOD level for a distance, clamped to valid range
     */
    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) {
                // CRITICAL FIX: Clamp to valid LOD range
                return Math.min(i, this.MAX_LOD);
            }
        }
        // If beyond all distances, return max LOD
        return this.MAX_LOD;
    }
    
    getSettingsForLOD(lodLevel) {
        const clampedLOD = Math.min(lodLevel, this.lodSettings.length - 1);
        return this.lodSettings[clampedLOD];
    }
    
    shouldUseQuadOnly(lodLevel) {
        if (this.isSphericalMode) return false;
        return this.getSettingsForLOD(lodLevel).useQuadOnly;
    }
    
    /**
     * Debug: Get LOD info for logging
     */
    getDebugInfo(distance) {
        const lod = this.getLODForDistance(distance);
        const settings = this.getSettingsForLOD(lod);
        return {
            distance,
            lod,
            detail: settings.geometryDetail,
            isSpherical: this.isSphericalMode,
            lodDistances: this.lodDistances
        };
    }
}


// =============================================================================
// USAGE: In gameEngine.js or frontend.js, after creating LODManager:
// =============================================================================
/*
// When initializing the LODManager for spherical mode:
const lodManager = new LODManager({
    chunkSize: 128,
    isSphericalMode: true,
    planetConfig: this.planetConfig,
    sphericalMapper: this.sphericalMapper
});

// Or set it later:
lodManager.setPlanetaryConfig(this.planetConfig, this.sphericalMapper);
*/
