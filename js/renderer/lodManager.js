// js/renderer/lodManager.js
// Key changes: 
// - forceQuadOnly: false EVERYWHERE
// - Higher minLOD at all altitudes
// - LOD 5-6 use grids not quads

export class LODManager {
    constructor(config = {}) {
        this.chunkSize = config.chunkSize || 128;
        this.isSphericalMode = config.isSphericalMode || false;
        this.lodDistances = config.lodDistances || this.getDefaultDistances();
        this.lodSettings = this.initializeLODSettings();
        this.altitudeLODOverrides = this.initializeAltitudeOverrides();
        this.chunkLODCache = new Map();
        this.cacheValidUntil = 0;
        this.cacheDuration = 100;
        console.log('LODManager initialized (spherical=' + this.isSphericalMode + ')');
    }
    
    getDefaultDistances() {
        const multipliers = [1.5, 2.5, 4, 6, 9, 13, 19, 28, 40, 60, Infinity];
        return multipliers.map(m => m === Infinity ? Infinity : Math.round(m * this.chunkSize));
    }
    
    initializeLODSettings() {
        return [
            { geometryLOD: 0, geometryDetail: 'full', useQuadOnly: false },
            { geometryLOD: 1, geometryDetail: 'high', useQuadOnly: false },
            { geometryLOD: 2, geometryDetail: 'medium', useQuadOnly: false },
            { geometryLOD: 3, geometryDetail: 'low', useQuadOnly: false },
            { geometryLOD: 4, geometryDetail: 'verylow', useQuadOnly: false },
            { geometryLOD: 5, geometryDetail: 'minimal', useQuadOnly: false }, // WAS true!
            { geometryLOD: 6, geometryDetail: 'ultra', useQuadOnly: false }
        ];
    }
    
    initializeAltitudeOverrides() {
        return {
            surface:        { minLOD: 0, maxLOD: 2, forceQuadOnly: false },
            lowAltitude:    { minLOD: 0, maxLOD: 3, forceQuadOnly: false },
            mediumAltitude: { minLOD: 1, maxLOD: 4, forceQuadOnly: false }, // WAS true!
            highAltitude:   { minLOD: 2, maxLOD: 5, forceQuadOnly: false }, // WAS true!
            orbital:        { minLOD: 3, maxLOD: 6, forceQuadOnly: false }  // WAS true!
        };
    }
    getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager = null, options = {}) {
        let distance;
        
        // SPHERICAL MODE: Calculate distance using actual world position
        if (options.sphericalMode && options.planetRadius && options.face !== undefined) {
            // Calculate the chunk center on the sphere
            const chunksPerFace = options.chunksPerFace || 16;
            const chunkSizeUV = 1.0 / chunksPerFace;
            
            // Get UV at chunk center
            const u = (chunkX + 0.5) / chunksPerFace;
            const v = (chunkY + 0.5) / chunksPerFace;
            
            // Convert to cube point
            const cubePoint = this._getCubePoint(options.face, u, v);
            
            // Normalize to sphere direction
            const len = Math.sqrt(cubePoint.x * cubePoint.x + cubePoint.y * cubePoint.y + cubePoint.z * cubePoint.z);
            const sphereDir = {
                x: cubePoint.x / len,
                y: cubePoint.y / len,
                z: cubePoint.z / len
            };
            
            // Get world position on sphere surface
            const origin = options.planetOrigin || { x: 0, y: 0, z: 0 };
            const worldPos = {
                x: origin.x + sphereDir.x * options.planetRadius,
                y: origin.y + sphereDir.y * options.planetRadius,
                z: origin.z + sphereDir.z * options.planetRadius
            };
            
            // Calculate actual 3D distance to camera
            const dx = worldPos.x - cameraPosition.x;
            const dy = worldPos.y - cameraPosition.y;
            const dz = worldPos.z - cameraPosition.z;
            distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        } else {
            // FLAT MODE: Original calculation
            const dx = (chunkX + 0.5) * this.chunkSize - cameraPosition.x;
            const dz = (chunkY + 0.5) * this.chunkSize - cameraPosition.z;
            distance = Math.sqrt(dx * dx + dz * dz);
        }
        
        let lod = this.getLODForDistance(distance);
        
        if (altitudeZoneManager) {
            const zone = altitudeZoneManager.currentZone;
            let override = this.altitudeLODOverrides[zone];
            if (override) {
                lod = Math.max(override.minLOD, Math.min(override.maxLOD, lod));
            }
        }
        
        return lod;
    }
    
    // Add this helper method to LODManager class:
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
        let chunkX, chunkY;
        if (chunkKey.includes(':')) {
            const parts = chunkKey.split(':');
            const coords = parts[1].split(',');
            chunkX = parseInt(coords[0], 10);
            chunkY = parseInt(coords[1], 10);
        } else {
            const coords = chunkKey.split(',');
            chunkX = parseInt(coords[0], 10);
            chunkY = parseInt(coords[1], 10);
        }
        return this.getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager);
    }
    
    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) return i;
        }
        return this.lodDistances.length - 1;
    }
    
    getSettingsForLOD(lodLevel) {
        return this.lodSettings[Math.min(lodLevel, this.lodSettings.length - 1)];
    }
    
    shouldUseQuadOnly(lodLevel) {
        if (this.isSphericalMode) return false;
        return this.getSettingsForLOD(lodLevel).useQuadOnly;
    }
}