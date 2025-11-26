export const SHADER_CONFIG = {
    TILE_TYPES: {
        NONE: 0,
        WATER: 1,
        SAND: 2,
        GRASS: 3,
        FOREST_FLOOR: 4,
        STONE: 5,
        TUNDRA: 6,
        ROCK: 7,
        SNOW: 8
    },
    
    OUTPUT_TYPES: {
        HEIGHT: 0,
        NORMAL: 1,
        TILE: 2,
        MACRO: 3
    },
    
    NOISE_PARAMS: {
        BIOME_SCALE: 0.004,
        BIOME_OCTAVES: 3,
        
        PLAINS_BASE_SCALE: 0.005,
        PLAINS_BASE_OCTAVES: 2,
        PLAINS_BASE_AMPLITUDE: 0.10,
        
        PLAINS_DETAIL_SCALE: 0.03,
        PLAINS_DETAIL_OCTAVES: 2,
        PLAINS_DETAIL_AMPLITUDE: 0.07,
        
        MOUNTAIN_ELEVATION_OCTAVES: 6,
        MOUNTAIN_RIDGE_SCALE: 0.004,
        MOUNTAIN_RIDGE_OCTAVES: 2,
        
        REGION_ROUGHNESS_SCALE: 0.00007,
        REGION_ROUGHNESS_OCTAVES: 2,
        
        TERRAIN_ROCK_SCALE: 0.009,
        TERRAIN_ROCK_OCTAVES: 3,
        TERRAIN_TUNDRA_SCALE: 0.006,
        TERRAIN_TUNDRA_OCTAVES: 3,
        TERRAIN_GRASS_SCALE: 0.007,
        TERRAIN_GRASS_OCTAVES: 3,
        
        WARP_SCALE: 0.001,
        WARP_OCTAVES: 2,
        WARP_AMPLITUDE: 15.0,
        
        ROTATE_45_SIN_COS: 0.70710678
    },
    
    TERRAIN_PARAMS: {
        PLAINS_ZONE: 0.4,
        MOUNTAIN_ZONE: 0.6,
        TERRAIN_HEIGHT_DIVISOR: 22.0,
        ROUGHNESS_MIN_SCALE: 0.36,
        ROUGHNESS_MIN_AMP: 0.8,
        ROUGHNESS_MAX_AMP: 1.6,
        ROUGHNESS_BASE: 0.25,
        ROUGHNESS_SCALE: 0.75,
        MOUNTAIN_POWER: 1.25
    }
};

/**
 * Validates that shader output matches expected behavior.
 * This can be used to test both implementations produce identical results.
 */
export class ShaderValidator {
    static validateTerrainHeight(height, wx, wy) {
        // Height should be a finite number
        if (!isFinite(height)) {
            throw new Error(`Invalid height ${height} at ${wx},${wy}`);
        }
        return true;
    }
    
    static validateTileType(tileType) {
        const validTypes = Object.values(SHADER_CONFIG.TILE_TYPES);
        if (!validTypes.includes(tileType)) {
            throw new Error(`Invalid tile type: ${tileType}`);
        }
        return true;
    }
    
    static validateNormal(normal) {
        // Normal should be unit length (approximately)
        const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
        if (Math.abs(length - 1.0) > 0.01) {
            throw new Error(`Invalid normal length: ${length}`);
        }
        return true;
    }
}