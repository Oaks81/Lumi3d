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
    
    getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager = null) {
        const dx = (chunkX + 0.5) * this.chunkSize - cameraPosition.x;
        const dz = (chunkY + 0.5) * this.chunkSize - cameraPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        let lod = this.getLODForDistance(distance);
        
        if (altitudeZoneManager) {
            const zone = altitudeZoneManager.currentZone;
            let override = this.altitudeLODOverrides[zone];
            if (override) {
                lod = Math.max(override.minLOD, Math.min(override.maxLOD, lod));
                // REMOVED: forceQuadOnly check that was breaking everything!
            }
        }
        return lod;
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