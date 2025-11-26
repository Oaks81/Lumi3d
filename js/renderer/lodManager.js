// js/renderer/lodManager.js
/**
 * Enhanced LOD management with altitude-aware detail levels
 * Integrates with AltitudeZoneManager for orbital transitions
 */
export class LODManager {
    constructor(config = {}) {
        this.chunkSize = config.chunkSize || 64;
        
        // Extended LOD system with altitude-based overrides
        this.lodDistances = config.lodDistances || this.getDefaultDistances();
        this.lodSettings = this.initializeLODSettings();
        
        // Altitude-based LOD overrides
        this.altitudeLODOverrides = this.initializeAltitudeOverrides();
        
        // Cache
        this.chunkLODCache = new Map();
        this.cacheValidUntil = 0;
        this.cacheDuration = 100;
        
        console.log('📊 Enhanced LODManager initialized');
        this.debugDistances();
    }
    
    getDefaultDistances() {
        // Extended with more distant LOD levels for high altitude
        const multipliers = [
            1.5,   // LOD 0: Very close
            2.5,   // LOD 1: Close
            4,     // LOD 2: Medium-close
            6,     // LOD 3: Medium
            9,     // LOD 4: Medium-far
            13,    // LOD 5: Far
            19,    // LOD 6: Very far
            28,    // LOD 7: Distant
            40,    // LOD 8: Very distant
            60,    // LOD 9: Ultra distant (for high altitude)
            Infinity
        ];
        return multipliers.map(m => 
            m === Infinity ? Infinity : Math.round(m * this.chunkSize)
        );
    }
    
    initializeLODSettings() {
        return [
            { // LOD 0: Full detail - Surface only
                geometryLOD: 0,
                geometryDetail: 'full',        // Full 128x128 grid
                terrainMeshDensity: 1.0,
                splatLODBias: 0.0,
                macroLODBias: 0.0,
                detailFade: 1.0,
                enableSplatLayer: true,
                enableMacroLayer: true,
                enableClusteredLights: true,
                shadowCasting: true,
                shadowReceiving: true,
                maxVerticesPerChunk: 16384,
                useQuadOnly: false
            },
            { // LOD 1: High detail
                geometryLOD: 1,
                geometryDetail: 'high',        // 64x64 grid
                terrainMeshDensity: 0.75,
                splatLODBias: 0.5,
                macroLODBias: 0.5,
                detailFade: 0.9,
                enableSplatLayer: true,
                enableMacroLayer: true,
                enableClusteredLights: true,
                shadowCasting: false,
                shadowReceiving: true,
                maxVerticesPerChunk: 4096,
                useQuadOnly: false
            },
            { // LOD 2: Medium detail
                geometryLOD: 2,
                geometryDetail: 'medium',      // 32x32 grid
                terrainMeshDensity: 0.5,
                splatLODBias: 1.0,
                macroLODBias: 1.0,
                detailFade: 0.6,
                enableSplatLayer: false,
                enableMacroLayer: true,
                enableClusteredLights: true,
                shadowCasting: false,
                shadowReceiving: true,
                maxVerticesPerChunk: 1024,
                useQuadOnly: false
            },
            { // LOD 3: Low detail
                geometryLOD: 3,
                geometryDetail: 'low',         // 16x16 grid
                terrainMeshDensity: 0.25,
                splatLODBias: 2.0,
                macroLODBias: 2.0,
                detailFade: 0.3,
                enableSplatLayer: false,
                enableMacroLayer: true,
                enableClusteredLights: false,
                shadowCasting: false,
                shadowReceiving: false,
                maxVerticesPerChunk: 256,
                useQuadOnly: false
            },
            { // LOD 4: Very low detail
                geometryLOD: 4,
                geometryDetail: 'verylow',     // 8x8 grid
                terrainMeshDensity: 0.125,
                splatLODBias: 3.0,
                macroLODBias: 3.0,
                detailFade: 0.1,
                enableSplatLayer: false,
                enableMacroLayer: false,
                enableClusteredLights: false,
                shadowCasting: false,
                shadowReceiving: false,
                maxVerticesPerChunk: 64,
                useQuadOnly: false
            },
            { // LOD 5: Minimal detail - START USING QUADS
                geometryLOD: 5,
                geometryDetail: 'quad',        // Single quad (4 vertices)
                terrainMeshDensity: 0.0,
                splatLODBias: 4.0,
                macroLODBias: 4.0,
                detailFade: 0.0,
                enableSplatLayer: false,
                enableMacroLayer: false,
                enableClusteredLights: false,
                shadowCasting: false,
                shadowReceiving: false,
                maxVerticesPerChunk: 4,
                useQuadOnly: true
            },
            { // LOD 6-9: All use quads, just different distance thresholds
                geometryLOD: 5,
                geometryDetail: 'quad',
                terrainMeshDensity: 0.0,
                splatLODBias: 4.0,
                macroLODBias: 4.0,
                detailFade: 0.0,
                enableSplatLayer: false,
                enableMacroLayer: false,
                enableClusteredLights: false,
                shadowCasting: false,
                shadowReceiving: false,
                maxVerticesPerChunk: 4,
                useQuadOnly: true
            }
        ];
    }
    
    initializeAltitudeOverrides() {
        // Force certain LOD levels at specific altitudes
        return {
            surface: {        // 0-500m
                minLOD: 0,
                maxLOD: 2,
                forceQuadOnly: false
            },
            lowAltitude: {    // 500-2000m
                minLOD: 1,
                maxLOD: 3,
                forceQuadOnly: false
            },
            mediumAltitude: { // 2000-5000m
                minLOD: 3,
                maxLOD: 5,
                forceQuadOnly: true  // Always use quads
            },
            highAltitude: {   // 5000-15000m
                minLOD: 5,
                maxLOD: 5,
                forceQuadOnly: true  // Always use quads
            },
            orbital: {        // 15000m+
                minLOD: 5,
                maxLOD: 5,
                forceQuadOnly: true,
                disableTerrain: true // Don't render terrain at all
            }
        };
    }
    
    /**
     * Get LOD level with altitude zone awareness
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {THREE.Vector3} cameraPosition
     * @param {AltitudeZoneManager} altitudeZoneManager - Optional
     * @returns {number} LOD level
     */
    getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager = null) {
        const chunkCenterX = (chunkX + 0.5) * this.chunkSize;
        const chunkCenterZ = (chunkY + 0.5) * this.chunkSize;
        
        const dx = chunkCenterX - cameraPosition.x;
        const dz = chunkCenterZ - cameraPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Base LOD from distance
        let lod = this.getLODForDistance(distance);
        
        // Apply altitude-based overrides if manager is available
        if (altitudeZoneManager) {
            const altitudeDetailLevel = altitudeZoneManager.getTerrainDetailLevel();
            const zone = altitudeZoneManager.currentZone;
            
            let override = null;
            if (zone === 'surface') override = this.altitudeLODOverrides.surface;
            else if (zone === 'low_altitude') override = this.altitudeLODOverrides.lowAltitude;
            else if (zone === 'medium') override = this.altitudeLODOverrides.mediumAltitude;
            else if (zone === 'high') override = this.altitudeLODOverrides.highAltitude;
            else if (zone === 'orbital') override = this.altitudeLODOverrides.orbital;
            
            if (override) {
                // Clamp LOD to altitude-appropriate range
                lod = Math.max(override.minLOD, Math.min(override.maxLOD, lod));
                
                // Force quad-only rendering if specified
                if (override.forceQuadOnly && lod < 5) {
                    lod = 5;
                }
            }
        }
        
        return lod;
    }
    
    getLODForChunkKey(chunkKey, cameraPosition, altitudeZoneManager = null) {
        const [chunkX, chunkY] = chunkKey.split(',').map(Number);
        return this.getLODForChunk(chunkX, chunkY, cameraPosition, altitudeZoneManager);
    }
    
    getLODForDistance(distance) {
        for (let i = 0; i < this.lodDistances.length; i++) {
            if (distance <= this.lodDistances[i]) {
                return i;
            }
        }
        return this.lodDistances.length - 1;
    }
    
    getSettingsForLOD(lodLevel) {
        const clampedLOD = Math.min(lodLevel, this.lodSettings.length - 1);
        return this.lodSettings[clampedLOD];
    }
    
    shouldUseQuadOnly(lodLevel) {
        return this.getSettingsForLOD(lodLevel).useQuadOnly;
    }
    
    getMaxDistanceForLOD(lodLevel) {
        return this.lodDistances[Math.min(lodLevel, this.lodDistances.length - 1)];
    }
    
    invalidateCache() {
        this.chunkLODCache.clear();
        this.cacheValidUntil = 0;
    }
    
    debugDistances() {
        console.log('📊 LOD Distance Configuration (Altitude-Aware):');
        for (let i = 0; i < Math.min(this.lodDistances.length, 10); i++) {
            const dist = this.lodDistances[i];
            const chunks = (dist / this.chunkSize).toFixed(1);
            const settings = this.getSettingsForLOD(i);
            const detail = settings.geometryDetail || 'unknown';
            const quadOnly = settings.useQuadOnly ? ' [QUAD ONLY]' : '';
            console.log(`  LOD ${i}: ${dist === Infinity ? '∞' : dist}m (${chunks} chunks) - ${detail}${quadOnly}`);
        }
    }
    
    getStatistics(chunks, cameraPosition, altitudeZoneManager = null) {
        const stats = {
            total: chunks.size,
            byLOD: {},
            quadChunks: 0,
            detailedChunks: 0
        };
        
        for (let i = 0; i <= 9; i++) {
            stats.byLOD[i] = 0;
        }
        
        for (const chunkKey of chunks.keys()) {
            const lod = this.getLODForChunkKey(chunkKey, cameraPosition, altitudeZoneManager);
            stats.byLOD[lod]++;
            
            if (this.shouldUseQuadOnly(lod)) {
                stats.quadChunks++;
            } else {
                stats.detailedChunks++;
            }
        }
        
        return stats;
    }
}