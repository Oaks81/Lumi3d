import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

// Tile type constants
const TILE_TYPES = {
    DEEP_WATER: 1,
    WATER: 2,
    GRASS: 3,
    SAND: 4,
    STONE: 5,
    FOREST_FLOOR: 6,
    ROCK: 7,
    TUNDRA: 8
};

/**
 * Get height from chunk data (used during spawning)
 */
export function getHeightFromChunk(localX, localZ, chunk) {
    const x = Math.floor(localX);
    const z = Math.floor(localZ);

    if (x < 0 || x > chunk.size || z < 0 || z > chunk.size) {
        return 0;
    }

    const index = z * (chunk.size + 1) + x;
    return chunk.heights[index] || 0;
}

/**
 * Get slope from chunk data (used during spawning)
 */
export function getSlopeFromChunk(localX, localZ, chunk) {
    const x = Math.floor(localX);
    const z = Math.floor(localZ);

    // ✅ FIXED: Call getHeightFromChunk directly (not this.getHeightFromChunk)
    const h0 = getHeightFromChunk(x, z, chunk);
    const h1 = getHeightFromChunk(x + 1, z, chunk);
    const h2 = getHeightFromChunk(x, z + 1, chunk);

    const dx = Math.abs(h1 - h0);
    const dz = Math.abs(h2 - h0);

    return Math.max(dx, dz);
}

/**
 * Define all plant types and their configurations
 */
export const PLANT_CONFIGS = {
    // === GRASS TYPES ===
    GRASS_SHORT: {
        variants: 2,
        spawnRules: {
            [TILE_TYPES.GRASS]: 0.85,
            [TILE_TYPES.FOREST_FLOOR]: 0.30
        },
        // ✅ FIXED: Call functions directly (not this.function)
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.5 && slope < 0.6;
        },
        scaleRange: { min: 0.8, max: 1.2 },
        lodDistribution: [0.5, 0.3, 0.2],
        castShadow: false,
        receiveShadow: true,
        category: 'grass'
    },

    GRASS_MEDIUM: {
        variants: 2,
        spawnRules: {
            [TILE_TYPES.GRASS]: 0.60,
            [TILE_TYPES.FOREST_FLOOR]: 0.25
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.5 && slope < 0.5;
        },
        scaleRange: { min: 0.9, max: 1.4 },
        lodDistribution: [0.5, 0.3, 0.2],
        castShadow: false,
        receiveShadow: true,
        category: 'grass'
    },

    GRASS_TALL: {
        variants: 2,
        spawnRules: {
            [TILE_TYPES.GRASS]: 0.30,
            [TILE_TYPES.FOREST_FLOOR]: 0.15
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.5 && slope < 0.4;
        },
        scaleRange: { min: 1.0, max: 1.6 },
        lodDistribution: [0.5, 0.3, 0.2],
        castShadow: false,
        receiveShadow: true,
        category: 'grass'
    },

    // === FLOWERS ===
    FLOWER_DAISY: {
        variants: 3,
        spawnRules: {
            [TILE_TYPES.GRASS]: 0.25
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 9.0 && slope < 0.4;
        },
        scaleRange: { min: 0.7, max: 1.1 },
        lodDistribution: [0.6, 0.3, 0.1],
        castShadow: false,
        receiveShadow: true,
        category: 'flower'
    },

    FLOWER_WILDFLOWER: {
        variants: 3,
        spawnRules: {
            [TILE_TYPES.GRASS]: 0.20,
            [TILE_TYPES.FOREST_FLOOR]: 0.10
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.5 && slope < 0.5;
        },
        scaleRange: { min: 0.8, max: 1.3 },
        lodDistribution: [0.6, 0.3, 0.1],
        castShadow: false,
        receiveShadow: true,
        category: 'flower'
    },

    // === FERNS ===
    FERN: {
        variants: 2,
        spawnRules: {
            [TILE_TYPES.FOREST_FLOOR]: 0.35
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.5 && slope < 0.5;
        },
        scaleRange: { min: 0.9, max: 1.5 },
        lodDistribution: [0.5, 0.3, 0.2],
        castShadow: false,
        receiveShadow: true,
        category: 'fern'
    },

    // === MUSHROOMS ===
    MUSHROOM_BROWN: {
        variants: 3,
        spawnRules: {
            [TILE_TYPES.FOREST_FLOOR]: 0.20
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.0 && height < 12.0 && slope < 0.3;
        },
        scaleRange: { min: 0.6, max: 1.2 },
        lodDistribution: [0.6, 0.3, 0.1],
        castShadow: false,
        receiveShadow: true,
        category: 'mushroom'
    },

    MUSHROOM_RED: {
        variants: 2,
        spawnRules: {
            [TILE_TYPES.FOREST_FLOOR]: 0.10
        },
        shouldSpawn: (x, z, chunk) => {
            const height = getHeightFromChunk(x, z, chunk);
            const slope = getSlopeFromChunk(x, z, chunk);
            return height > 8.0 && height < 12.0 && slope < 0.3;
        },
        scaleRange: { min: 0.5, max: 1.0 },
        lodDistribution: [0.6, 0.3, 0.1],
        castShadow: false,
        receiveShadow: true,
        category: 'mushroom'
    }
};

/**
 * Get flower color based on type and variant
 */
export function getFlowerColor(typeName, variant) {
    const colors = {
        FLOWER_DAISY: [
            new THREE.Color(1.0, 1.0, 0.9),
            new THREE.Color(1.0, 0.95, 0.8),
            new THREE.Color(0.95, 0.9, 1.0)
        ],
        FLOWER_WILDFLOWER: [
            new THREE.Color(1.0, 0.8, 0.2),
            new THREE.Color(1.0, 0.4, 0.5),
            new THREE.Color(0.7, 0.3, 1.0)
        ]
    };

    const colorSet = colors[typeName] || colors.FLOWER_DAISY;
    return colorSet[variant % colorSet.length];
}

/**
 * Get mushroom color based on type and variant
 */
export function getMushroomColor(typeName, variant) {
    const colors = {
        MUSHROOM_BROWN: [
            new THREE.Color(0.6, 0.4, 0.3),
            new THREE.Color(0.7, 0.5, 0.4),
            new THREE.Color(0.5, 0.3, 0.2)
        ],
        MUSHROOM_RED: [
            new THREE.Color(0.9, 0.2, 0.2),
            new THREE.Color(0.8, 0.3, 0.2)
        ]
    };

    const colorSet = colors[typeName] || colors.MUSHROOM_BROWN;
    return colorSet[variant % colorSet.length];
}