import { TILE_TYPES } from '../types.js';

// Texture level definitions
export const TEXTURE_LEVELS = {
    MICRO: 'micro',         // Per-tile textures
    MACRO_1024: 'macro1024',
    PROP: 'prop',
};

export const SEASONS = {
    SPRING: 'Spring',   
    SUMMER: 'Summer',  
    AUTUMN: 'Autumn',  
    WINTER: 'Winter'   
};
const PROP_TEXTURES = [
    // [type, file]
    ['rock',   '../textures/micro/rock1.png'],
    // ...etc
  ];

// Special transparent texture paths - always loaded first in atlas
export const TRANSPARENT_TEXTURES = {
    
};

// Special tile type for transparent tiles
export const TRANSPARENT_TILE_TYPE = TILE_TYPES.COMPLEX_TERRAIN;

// Main tile configuration
export const TILE_CONFIG = [

];

// Texture atlas configurations
export const ATLAS_CONFIG = {
    [TEXTURE_LEVELS.MICRO]: {
        atlasSize: 2048,
        textureSize: 128,
    },
    [TEXTURE_LEVELS.MACRO_1024]: {
        atlasSize: 4096,
        textureSize: 1024,
    },
    [TEXTURE_LEVELS.PROP]: {
        atlasSize: 8192,
        textureSize: 1024,
    },
};

export class TextureConfigHelper {
    static getTileConfig(tileType) {
        return TILE_CONFIG.find(config => config.id === tileType);
    }

    static getTexturesForSeason(tileType, season, level) {
        // Handle transparent tile type
        if (tileType === TRANSPARENT_TILE_TYPE) {
            return [TRANSPARENT_TEXTURES[level]];
        }

        const config = this.getTileConfig(tileType);
        if (!config) return [];

        // Get textures for the specific season and level
        return config.textures.base[season]?.[level] || [];
    }

    static getSeasonTint(tileType, season) {
        // Transparent tiles have no tint
        if (tileType === TRANSPARENT_TILE_TYPE) {
            return [1, 1, 1];
        }

        const config = this.getTileConfig(tileType);
        return config?.seasonTint?.[season] || [1, 1, 1];
    }

    static getTransitionFactor(currentSeason, nextSeason, daysUntilNextSeason) {
        // Transition starts 10 days before season change
        const transitionDays = 10;
        if (daysUntilNextSeason > transitionDays) return 0;
        return 1 - (daysUntilNextSeason / transitionDays);
    }

    static getAllTexturesForLevel(level) {
        const textures = new Set();
        if (level === TEXTURE_LEVELS.PROP) return TextureConfigHelper.getAllPropTextures();
        // Always add transparent texture first (it will be at index 0)
        textures.add(TRANSPARENT_TEXTURES[level]);
        // Add all tile textures for all seasons
        TILE_CONFIG.forEach(config => {
            Object.values(SEASONS).forEach(season => {
                const seasonTextures = config.textures.base[season]?.[level];
                if (seasonTextures) {
                    seasonTextures.forEach(tex => textures.add(tex));
                }
            });
        });
        return Array.from(textures);
    }

    static getTransparentTexturePath(level) {
        return TRANSPARENT_TEXTURES[level];
    }

    static isTransparentTile(tileType) {
        return tileType === TRANSPARENT_TILE_TYPE;
    }

    static getAllPropTextures()         { return PROP_TEXTURES.map(([_, path]) => path); }
    static getPropTexturePath(type)     { return PROP_TEXTURES.find(([t]) => t === type)?.[1]; }
    static getPropTypes()               { return PROP_TEXTURES.map(([t]) => t); }


}