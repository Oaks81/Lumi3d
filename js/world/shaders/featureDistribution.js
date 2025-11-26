import { TILE_TYPES } from '../../types.js';

export const BASE_FEATURE_DISTRIBUTION = {
    GRASS: {
        grass: { prob: 0.8, maxDensity: 64 },
        rock: { prob: 0.05, maxDensity: 8 },
        flower: { prob: 0.15, maxDensity: 16 }
    },
    FOREST_FLOOR: {
        grass: { prob: 0.6, maxDensity: 48 },
        rock: { prob: 0.1, maxDensity: 12 },
        flower: { prob: 0.3, maxDensity: 24 }
    },
    SAND: {
        grass: { prob: 0.1, maxDensity: 8 },
        rock: { prob: 0.3, maxDensity: 16 },
        pebble: { prob: 0.6, maxDensity: 32 }
    },
    STONE: {
        grass: { prob: 0.05, maxDensity: 4 },
        rock: { prob: 0.9, maxDensity: 72 },
        pebble: { prob: 0.05, maxDensity: 8 }
    }
};