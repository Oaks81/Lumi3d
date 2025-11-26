/**
 * Configuration for grass and shrub rendering system
 * Defines quality levels, feature types, and rendering parameters
 */

/**
 * Graphics quality levels that determine grass/shrub detail and density
 */
export const GRASS_QUALITY_LEVELS = {
    LOW: {
        name: 'Low Detail',
        maxInstancesPerChunk: 50,
        maxViewDistance: 32,
        lodDistances: [16, 32], // Switch to billboard at 16, remove at 32
        lodLevels: [1, 3], // Medium detail meshes, then removal
        enableWind: false,
        textureResolution: 64,
        instanceCullingDistance: 24
    },
    MEDIUM: {
        name: 'Medium Detail', 
        maxInstancesPerChunk: 200,
        maxViewDistance: 48,
        lodDistances: [12, 24, 48], // High detail -> billboards -> removal
        lodLevels: [0, 2, 3], 
        enableWind: true,
        textureResolution: 128,
        instanceCullingDistance: 36
    },
    HIGH: {
        name: 'High Detail',
        maxInstancesPerChunk: 500,
        maxViewDistance: 64,
        lodDistances: [8, 16, 32, 64], // Multiple mesh details
        lodLevels: [0, 1, 2, 3],
        enableWind: true,
        textureResolution: 256,
        instanceCullingDistance: 48
    }
};

/**
 * Grass type definitions with visual and behavioral characteristics
 */
export const GRASS_TYPES = {
    MEADOW_GRASS: {
        name: 'Meadow Grass',
        height: { min: 0.3, max: 0.8 },
        width: { min: 0.02, max: 0.04 },
        density: 'high', // Affects spawn probability
        clumpiness: 0.7, // How much grass clusters together
        windResponse: 'medium', // How much it sways in wind
        bladeCount: { min: 3, max: 7 }, // Blades per clump
        color: {
            base: '#4a7c2a',
            tip: '#6fa040', 
            seasonal: true
        },
        biomes: ['grassland', 'plains'], // Where it spawns
        slopeLimit: 0.4, // Max slope steepness
        waterDistance: 1.0 // Min distance from water
    },
    TALL_GRASS: {
        name: 'Tall Prairie Grass',
        height: { min: 0.8, max: 1.5 },
        width: { min: 0.03, max: 0.06 },
        density: 'medium',
        clumpiness: 0.5,
        windResponse: 'high',
        bladeCount: { min: 2, max: 5 },
        color: {
            base: '#3d6b25',
            tip: '#5d8b35',
            seasonal: true
        },
        biomes: ['grassland', 'savanna'],
        slopeLimit: 0.3,
        waterDistance: 1.5
    },
    SHORT_GRASS: {
        name: 'Short Turf Grass',
        height: { min: 0.1, max: 0.3 },
        width: { min: 0.015, max: 0.025 },
        density: 'very_high',
        clumpiness: 0.8,
        windResponse: 'low',
        bladeCount: { min: 4, max: 9 },
        color: {
            base: '#4f7d30',
            tip: '#6f9d50',
            seasonal: true
        },
        biomes: ['grassland', 'tundra'],
        slopeLimit: 0.6,
        waterDistance: 0.5
    },
    WILD_GRASS: {
        name: 'Wild Grass',
        height: { min: 0.4, max: 1.2 },
        width: { min: 0.025, max: 0.05 },
        density: 'medium',
        clumpiness: 0.6,
        windResponse: 'high',
        bladeCount: { min: 2, max: 6 },
        color: {
            base: '#456728',
            tip: '#65873a',
            seasonal: true
        },
        biomes: ['forest', 'woodland'],
        slopeLimit: 0.5,
        waterDistance: 1.0
    }
};

/**
 * Shrub type definitions
 */
export const SHRUB_TYPES = {
    BUSH: {
        name: 'Bush',
        height: { min: 0.5, max: 1.2 },
        width: { min: 0.8, max: 1.5 },
        density: 'low',
        clumpiness: 0.3,
        windResponse: 'low',
        leafCount: { min: 100, max: 300 },
        color: {
            base: '#3a5a25',
            highlight: '#5a7a40',
            seasonal: true
        },
        biomes: ['forest', 'woodland', 'savanna'],
        slopeLimit: 0.6,
        waterDistance: 2.0
    },
    FERN: {
        name: 'Fern',
        height: { min: 0.3, max: 0.9 },
        width: { min: 0.6, max: 1.0 },
        density: 'medium',
        clumpiness: 0.5,
        windResponse: 'medium',
        leafCount: { min: 50, max: 150 },
        color: {
            base: '#2d5020',
            highlight: '#4d7040',
            seasonal: false // Evergreen
        },
        biomes: ['forest', 'swamp'],
        slopeLimit: 0.7,
        waterDistance: 0.5 // Likes water
    },
    HEATHER: {
        name: 'Heather',
        height: { min: 0.2, max: 0.6 },
        width: { min: 0.4, max: 0.8 },
        density: 'high',
        clumpiness: 0.7,
        windResponse: 'low',
        leafCount: { min: 80, max: 200 },
        color: {
            base: '#4a3d5a',
            highlight: '#6a5d7a',
            seasonal: true
        },
        biomes: ['tundra', 'mountain'],
        slopeLimit: 0.8,
        waterDistance: 1.0
    }
};

/**
 * Density modifiers based on environmental factors
 */
export const DENSITY_MODIFIERS = {
    biome: {
        grassland: 1.0,
        plains: 0.9,
        forest: 0.6,
        woodland: 0.7,
        savanna: 0.8,
        tundra: 0.4,
        mountain: 0.3,
        swamp: 0.5
    },
    slope: {
        // Multiplier based on terrain slope (0 = flat, 1 = vertical)
        0.0: 1.0,
        0.2: 0.9,
        0.4: 0.7,
        0.6: 0.4,
        0.8: 0.1,
        1.0: 0.0
    },
    waterDistance: {
        // Multiplier based on distance to water
        0.5: 1.2,  // Near water
        1.0: 1.0,
        2.0: 0.8,
        5.0: 0.6,
        10.0: 0.4
    }
};

/**
 * Wind animation parameters
 */
export const WIND_CONFIG = {
    baseSpeed: 1.0,
    gustFrequency: 0.3,
    gustStrength: 2.0,
    directionVariation: 0.2, // How much wind direction can vary
    heightMultiplier: 1.5, // Taller grass moves more
    
    // Different response curves for grass types
    responseProfiles: {
        low: {
            strength: 0.3,
            frequency: 0.5,
            damping: 0.8
        },
        medium: {
            strength: 0.6,
            frequency: 1.0,
            damping: 0.6
        },
        high: {
            strength: 1.0,
            frequency: 1.5,
            damping: 0.4
        }
    }
};

/**
 * LOD (Level of Detail) configuration
 */
export const LOD_CONFIG = {
    // LOD 0: Highest detail 3D mesh
    0: {
        type: 'mesh',
        name: 'High Detail',
        triangleCount: { grass: 24, shrub: 80 },
        vertexAnimation: true,
        shadowCasting: true
    },
    // LOD 1: Medium detail 3D mesh  
    1: {
        type: 'mesh',
        name: 'Medium Detail',
        triangleCount: { grass: 12, shrub: 40 },
        vertexAnimation: true,
        shadowCasting: false
    },
    // LOD 2: Low detail billboard
    2: {
        type: 'sprite',
        name: 'Billboard',
        triangleCount: { grass: 2, shrub: 2 },
        vertexAnimation: false,
        shadowCasting: false
    },
    // LOD 3: Remove from scene
    3: {
        type: 'remove',
        name: 'Hidden'
    }
};

/**
 * Get configuration for a specific quality level
 * @param {string} qualityLevel - 'LOW', 'MEDIUM', or 'HIGH'
 * @returns {Object} Quality configuration
 */
export function getQualityConfig(qualityLevel) {
    return GRASS_QUALITY_LEVELS[qualityLevel] || GRASS_QUALITY_LEVELS.MEDIUM;
}

/**
 * Get grass type configuration
 * @param {string} grassType - Type key from GRASS_TYPES
 * @returns {Object} Grass type configuration
 */
export function getGrassConfig(grassType) {
    return GRASS_TYPES[grassType] || GRASS_TYPES.MEADOW_GRASS;
}

/**
 * Get shrub type configuration
 * @param {string} shrubType - Type key from SHRUB_TYPES
 * @returns {Object} Shrub type configuration
 */
export function getShrubConfig(shrubType) {
    return SHRUB_TYPES[shrubType] || SHRUB_TYPES.BUSH;
}

/**
 * Calculate density multiplier based on environmental factors
 * @param {string} biome - Biome type
 * @param {number} slope - Terrain slope (0-1)
 * @param {number} waterDistance - Distance to nearest water
 * @returns {number} Density multiplier
 */
export function calculateDensityMultiplier(biome, slope, waterDistance) {
    const biomeMod = DENSITY_MODIFIERS.biome[biome] || 0.5;
    
    // Find closest slope key
    let slopeMod = 1.0;
    for (const [threshold, modifier] of Object.entries(DENSITY_MODIFIERS.slope)) {
        if (slope <= parseFloat(threshold)) {
            slopeMod = modifier;
            break;
        }
    }
    
    // Find closest water distance key
    let waterMod = 1.0;
    for (const [threshold, modifier] of Object.entries(DENSITY_MODIFIERS.waterDistance)) {
        if (waterDistance <= parseFloat(threshold)) {
            waterMod = modifier;
            break;
        }
    }
    
    return biomeMod * slopeMod * waterMod;
}
