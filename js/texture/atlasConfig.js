// js/texture/atlasConfig.js
import { TEXTURE_LEVELS, SEASONS } from "./TileConfig.js";
import { TILE_TYPES } from "../types.js";


// Grass and vegetation texture definitions
export const GRASS_TEXTURES = {
  // Meadow grass - medium height, vibrant green
  GRASS_MEADOW_GRASS_DIFFUSE: [
    // Base grass color
    { type: "fill", color: "#4a7c2a", opacity: 1 },
    
    // Natural color variation
    { type: "fbm", octaves: 4, frequency: 0.8, color: "#5a8c3a", opacity: 0.6, blendMode: "multiply", seed: 50001 },
    
    // Highlight streaks (simulate light through blades)
    { type: "perlin", octaves: 2, frequency: 2.0, color: "#6fa040", opacity: 0.4, blendMode: "overlay", seed: 50002 },
    
    // Subtle brown tips (aging)
    { type: "turbulence", octaves: 2, frequency: 1.5, color: "#8b6914", turbulencePower: 0.8, opacity: 0.2, blendMode: "multiply", seed: 50003 }
  ],
  
  GRASS_TALL_GRASS_DIFFUSE: [
    // Darker base for tall grass
    { type: "fill", color: "#3d6b25", opacity: 1 },
    
    // Vertical streaks
    { type: "ridged", octaves: 3, frequency: 0.5, color: "#2d5b15", ridgeOffset: 0.4, opacity: 0.7, blendMode: "multiply", rotation: 90, seed: 50101 },
    
    // Light variation
    { type: "fbm", octaves: 3, frequency: 1.2, color: "#5d8b35", opacity: 0.5, blendMode: "overlay", seed: 50102 }
  ],
  
  GRASS_SHORT_GRASS_DIFFUSE: [
    // Brighter, more uniform color for short grass
    { type: "fill", color: "#4f7d30", opacity: 1 },
    
    // Fine texture
    { type: "fbm", octaves: 5, frequency: 2.0, color: "#6f9d50", opacity: 0.4, blendMode: "multiply", seed: 50201 },
    
    // Slight yellowish tint
    { type: "perlin", octaves: 2, frequency: 1.0, color: "#7fa055", opacity: 0.3, blendMode: "overlay", seed: 50202 }
  ],
  
  GRASS_WILD_GRASS_DIFFUSE: [
    // More varied wild grass
    { type: "fill", color: "#456728", opacity: 1 },
    
    // Random color patches
    { type: "turbulence", octaves: 4, frequency: 0.6, color: "#65873a", turbulencePower: 1.2, opacity: 0.8, blendMode: "multiply", seed: 50301 },
    
    // Brownish streaks
    { type: "perlin", octaves: 2, frequency: 1.8, color: "#6b4423", opacity: 0.3, blendMode: "multiply", seed: 50302 }
  ],
  
  // Billboard textures (simplified for distance rendering)
  GRASS_MEADOW_GRASS_BILLBOARD: [
    { type: "grass_billboard", grassType: "meadow", height: 0.6, density: "medium", seed: 51001 }
  ],
  
  GRASS_TALL_GRASS_BILLBOARD: [
    { type: "grass_billboard", grassType: "tall", height: 1.2, density: "low", seed: 51101 }
  ],
  
  GRASS_SHORT_GRASS_BILLBOARD: [
    { type: "grass_billboard", grassType: "short", height: 0.25, density: "high", seed: 51201 }
  ],
  
  GRASS_WILD_GRASS_BILLBOARD: [
    { type: "grass_billboard", grassType: "wild", height: 0.8, density: "medium", seed: 51301 }
  ]
};

// Tree texture definitions
export const TREE_TEXTURES = {


  LEAF_CLUSTER_BIRCH: [
    // Colorized leaf texture
    { type: "fbm", octaves: 6, frequency: 0.08, color: "#7fc94a", opacity: 1 },
  
    // Veins and tones
    { type: "ridged", octaves: 4, frequency: 1.6, color: "#406b2c", ridgeOffset: 0.5, opacity: 0.45, blendMode: "multiply" },
    { type: "turbulence", octaves: 3, frequency: 1.2, color: "#3a5a22", turbulencePower: 1.3, opacity: 0.3, blendMode: "multiply" },
  
    // Mask (draw last, cuts alpha)
    { type: "leaf_cluster_mask", shape: "birch", clusterCount: 10, minScale: 0.4, maxScale: 0.7, opacity: 1, blendMode: "destination-in" },
  ],
  
 BARK_BIRCH: [
  // Pure white base
  { 
    seed: 101,
    type: "fill", 
    color: "#ffffff", 
    opacity: 1 
  },
  
  // Cream/grey undertone with vertical stretch to simulate bark grain
  { 

    type: "fbm", 
    octaves: 6, 
    frequency: 0.01, 
    color: "#e8dcc8", 
    opacity: 0.3, 
    blendMode: "multiply",
    seed: 42,
    // Stretch the noise vertically
    cellStretch: [0.5, 3.0], // This isn't a feature of FBM in your code, but adding vertical grain helps
    // A vertical "cells" layer or a domain-warped FBM would be better.
    // Let's use domain warp for vertical streaks.
    domainWarp: true,
    warpStrength: 10.0, // High strength
    warpFrequency: 0.005, // Low frequency
  },

  // Layer 1: Large, dark, primary lenticels
  {
    type: "horizontal_dashes",
    color: "#2a2a2a", // Very dark
    density: 0.75,     // Fairly sparse
    minWidth: 0.02,
    maxWidth: 0.08,    // Wider
    minHeight: 0.002,
    maxHeight: 0.004,
    irregularity: 0.5, // More irregular
    opacity: 0.8,
    blendMode: "multiply",
    seed: 426
  },
  
  // Layer 2: Medium, grey, secondary lenticels
  // Use a different seed to get a different distribution
  {
    type: "horizontal_dashes",
    color: "#555555", // Mid-grey
    density: 0.75,     // A bit denser
    minWidth: 0.01,
    maxWidth: 0.05,
    minHeight: 0.002,
    maxHeight: 0.003,
    irregularity: 0.4,
    opacity: 0.6,
    blendMode: "multiply",
    seed: 881
  },
  
  // Layer 3: Small, light grey "pecks" and details
  // Use another seed
  {
    type: "horizontal_dashes",
    color: "#888888", // Light grey
    density: 0.8,      // Much denser
    minWidth: 0.005,   // Very small
    maxWidth: 0.02,
    minHeight: 0.001,
    maxHeight: 0.002,
    irregularity: 0.3,
    opacity: 0.4,
    blendMode: "multiply",
    seed: 102
  },
],

/*
NEEDLES_PINE: [
  // Pine needle base
  { type: "perlin", octaves: 8, frequency: 0.8, color: "#1a3d0c", opacity: 1 },
  // Needle clusters
  { type: "ridged", octaves: 4, frequency: 2.0, color: "#0d1f06", ridgeOffset: 0.3, opacity: 0.6, blendMode: "multiply" },
  // Highlights
  { type: "fbm", octaves: 2, frequency: 1.2, color: "#2a5a10", opacity: 0.2, blendMode: "screen" }
],

NEEDLES_SPRUCE: [
  // Darker spruce needles
  { type: "perlin", octaves: 7, frequency: 0.7, color: "#0f2a08", opacity: 1 },
  { type: "ridged", octaves: 5, frequency: 1.8, color: "#061003", ridgeOffset: 0.4, opacity: 0.7, blendMode: "multiply" },
  { type: "fbm", octaves: 2, frequency: 0.9, color: "#1a4010", opacity: 0.15, blendMode: "screen" }
],
LEAF_CLUSTER_OAK: [
  // Base leaf shape using radial gradient for alpha
  { type: "custom_leaf_shape", shape: "oak", opacity: 1 },
  // Leaf color with variation
  { type: "fbm", octaves: 4, frequency: 0.4, color: "#3d6018", opacity: 1 },
  // Veining pattern
  { type: "ridged", octaves: 5, frequency: 2.5, color: "#2a4510", ridgeOffset: 0.6, opacity: 0.6, blendMode: "multiply" },
  // Edge darkening
  { type: "turbulence", octaves: 3, frequency: 1.2, color: "#1a2508", turbulencePower: 1.5, opacity: 0.4, blendMode: "multiply" },
  // Highlights
  { type: "perlin", octaves: 2, frequency: 0.8, color: "#5a8025", opacity: 0.3, blendMode: "overlay" }
],

LEAF_BIRCH_SINGLE: [
  { type: "fbm", octaves: 6, frequency: 0.039, color: "#4e9622", opacity: 1, seed: 10101 },
  { type: "perlin", octaves: 2, frequency: 0.12, amplitude: 0.18, color: "#7ad235", opacity: 0.6, blendMode: "multiply", filter: "blur", filterStrength: 1.4, seed: 10111 }


],
*/
};


// Define reusable texture definitions - CORRECTED COUNTS
const REUSABLE_TEXTURES = {
  // GRASS textures (6 unique)
  DEBUG_1: [
    { type: "perlin", octaves: 3, frequency: 0.09, amplitude: 0.17, color: "#7bb22c", opacity: 0.6, blendMode: "screen", filter: "blur", filterStrength: 1.2, seed: 10011 }
  ],
  DEBUG_2: [
    { type: "fbm", octaves: 6, frequency: 0.035, color: "#49731a", opacity: 1, seed: 10001 },
  ],
  DEBUG_3: [
    { type: "turbulence", octaves: 5, frequency: 0.06, color: "#b8b8b8", turbulencePower: 1.18, opacity: 1, seed: 20101 }
  ],
  DEBUG_4: [
    { type: "ridged", octaves: 3, frequency: 0.15, color: "#4a8c91", ridgeOffset: 0.5, opacity: 0.8, blendMode: "screen", seed: 40002 },
  ],
  GRASS_SPRING_0: [
    { type: "fbm", octaves: 6, frequency: 0.035, color: "#49731a", opacity: 1, seed: 10001 },
    { type: "perlin", octaves: 2, frequency: 0.09, amplitude: 0.17, color: "#7bb22c", opacity: 0.6, blendMode: "multiply", filter: "blur", filterStrength: 1.2, seed: 10011 }
  ],
  GRASS_SPRING_1: [
    { type: "fbm", octaves: 6, frequency: 0.03, color: "#406522", opacity: 1, seed: 10002 },
    { type: "perlin", octaves: 2, frequency: 0.07, amplitude: 0.13, color: "#68aa2a", opacity: 0.51, blendMode: "overlay", filter: "blur", filterStrength: 0.8, seed: 10012 }
  ],
  GRASS_SUMMER_0: [
    { type: "fbm", octaves: 6, frequency: 0.039, color: "#4e9622", opacity: 1, seed: 10101 },
    { type: "perlin", octaves: 2, frequency: 0.12, amplitude: 0.18, color: "#7ad235", opacity: 0.6, blendMode: "multiply", filter: "blur", filterStrength: 1.4, seed: 10111 }
  ],
  GRASS_SUMMER_1: [
    { type: "fbm", octaves: 6, frequency: 0.041, color: "#5ea028", opacity: 1, seed: 10102 },
    { type: "perlin", octaves: 2, frequency: 0.10, amplitude: 0.20, color: "#85d540", opacity: 0.55, blendMode: "multiply", filter: "blur", filterStrength: 1.3, seed: 10112 }
  ],
  GRASS_AUTUMN: [ // Reused for both autumn variants
    { type: "fbm", octaves: 6, frequency: 0.037, color: "#a8851e", opacity: 1, seed: 10201 },
    { type: "perlin", octaves: 2, frequency: 0.09, amplitude: 0.24, color: "#d4be6a", opacity: 0.45, blendMode: "multiply", filter: "blur", filterStrength: 1.2, seed: 10211 }
  ],
  GRASS_WINTER: [ // Reused for both winter variants
    { type: "fbm", octaves: 6, frequency: 0.03, color: "#b7d0db", opacity: 1, seed: 10301 },
    { type: "perlin", octaves: 2, frequency: 0.07, amplitude: 0.12, color: "#e4eef2", opacity: 0.37, blendMode: "lighter", filter: "blur", filterStrength: 1, seed: 10311 }
  ],
  
  // TUNDRA texture (1 unique, reused across all seasons)
  TUNDRA_ALL: [
    { type: "fbm", octaves: 6, frequency: 0.033, color: "#b49e5a", opacity: 1, seed: 30101 }
  ],
  
  // STONE/ROCK texture (1 unique, reused for STONE, ROCK, and all seasons)
  // This matches rock1.png being used for both STONE and ROCK in file-based
  ROCK_ALL: [
    { type: "turbulence", octaves: 5, frequency: 0.06, color: "#b8b8b8", turbulencePower: 1.18, opacity: 1, seed: 20101 }
  ],
  
  // MACRO shared texture (1 unique for all tiles)
  MACRO_SHARED: [
    { type: "fbm", octaves: 7, frequency: 0.006, color: "#44731a", opacity: 1, seed: 14001 }
  ],
    // WATER textures
    WATER_SHALLOW: [
      // Light blue-green base
      { type: "fbm", octaves: 4, frequency: 0.08, color: "#5ba3a8", opacity: 1, seed: 40001 },
      // Wave patterns
      { type: "ridged", octaves: 3, frequency: 0.15, color: "#4a8c91", ridgeOffset: 0.5, opacity: 0.4, blendMode: "multiply", seed: 40002 },
      // Foam/highlights
      { type: "perlin", octaves: 2, frequency: 0.12, color: "#7dc4c9", opacity: 0.3, blendMode: "screen", seed: 40003 }
    ],
    
    WATER_DEEP: [
      // Dark blue base
      { type: "fbm", octaves: 5, frequency: 0.06, color: "#1a4d5c", opacity: 1, seed: 40101 },
      // Depth variation
      { type: "turbulence", octaves: 4, frequency: 0.1, color: "#0d2c37", turbulencePower: 1.5, opacity: 0.6, blendMode: "multiply", seed: 40102 },
      // Subtle highlights
      { type: "perlin", octaves: 2, frequency: 0.08, color: "#2d6d7f", opacity: 0.2, blendMode: "screen", seed: 40103 }
    ],
    
    WATER_RIVER: [
      // Clear, light blue
      { type: "fbm", octaves: 3, frequency: 0.1, color: "#6bb5ba", opacity: 1, seed: 40201 },
      // Flow lines
      { type: "ridged", octaves: 2, frequency: 0.2, color: "#5a9ca1", ridgeOffset: 0.4, opacity: 0.3, blendMode: "multiply", rotation: 45, seed: 40202 },
      // Ripples
      { type: "perlin", octaves: 2, frequency: 0.15, color: "#8fd4d9", opacity: 0.25, blendMode: "overlay", seed: 40203 }
    ],
    
    // MACRO water (larger scale, used for all water types)
    WATER_MACRO: [
      { type: "fbm", octaves: 6, frequency: 0.01, color: "#3a7d87", opacity: 1, seed: 40301 },
      { type: "perlin", octaves: 3, frequency: 0.015, color: "#2a5d67", opacity: 0.5, blendMode: "multiply", seed: 40302 }
    ]
};

// Total MICRO unique textures: 6 (grass) + 1 (tundra) + 1 (rock) = 8 unique
// But file-based has only 7! Let me recount the file-based:
// transparent128.png (index 0)
// okko1.png (index 1) - GRASS Spring 0
// okko2.png (index 2) - GRASS Spring 1  
// okkoa.png (index 3) - GRASS Summer 0
// okkob.png (index 4) - GRASS Summer 1
// grass1.png (index 5) - GRASS Autumn/Winter (reused)
// tundra1.jpg (index 6) - TUNDRA all seasons
// rock1.png (index 7) - STONE and ROCK all seasons

// So file-based has: 1 transparent + 5 grass + 1 tundra + 1 rock = 8 total, 7 unique images
// We need: 5 unique grass textures, not 6!

export const TEXTURE_CONFIG = [
  
  {
    id: TILE_TYPES.GRASS,
    name: 'GRASS',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.GRASS_SPRING_1,  // okko2.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.GRASS_SUMMER_0,  // okkoa.png
            REUSABLE_TEXTURES.GRASS_SUMMER_1,  // okkob.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.GRASS_AUTUMN,    // grass1.png
            REUSABLE_TEXTURES.GRASS_AUTUMN,    // grass1.png (SAME, reused)
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.GRASS_AUTUMN,    // grass1.png (SAME AS AUTUMN!)
            REUSABLE_TEXTURES.GRASS_AUTUMN,    // grass1.png (SAME AS AUTUMN!)
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        }
      }
    }
  },
  
  {
    id: TILE_TYPES.STONE,
    name: 'STONE',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        }
      }
    }
  },
  {
    id: TILE_TYPES.TUNDRA,
    name: 'Tundra',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.TUNDRA_ALL       // tundra1.jpg
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.TUNDRA_ALL       // tundra1.jpg
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.TUNDRA_ALL       // tundra1.jpg
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.TUNDRA_ALL       // tundra1.jpg
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        }
      }
    }
  },
  {
    id: TILE_TYPES.ROCK,
    name: 'Rock',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.ROCK_ALL         // rock1.png
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.MACRO_SHARED
          ]
        }
      }
    }
  },
  {
    id: TILE_TYPES.WATER,
    name: 'WATER',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_SHALLOW,
            REUSABLE_TEXTURES.WATER_RIVER
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_SHALLOW,
            REUSABLE_TEXTURES.WATER_RIVER
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_SHALLOW,
            REUSABLE_TEXTURES.WATER_RIVER
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_SHALLOW,
            REUSABLE_TEXTURES.WATER_RIVER
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        }
      }
    }
  },
  {
    id: TILE_TYPES.DEEP_WATER,
    name: 'DEEP_WATER',
    textures: {
      base: {
        [SEASONS.SPRING]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_DEEP
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.SUMMER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_DEEP
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.AUTUMN]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_DEEP
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        },
        [SEASONS.WINTER]: {
          [TEXTURE_LEVELS.MICRO]: [
            REUSABLE_TEXTURES.WATER_DEEP
          ],
          [TEXTURE_LEVELS.MACRO_1024]: [
            REUSABLE_TEXTURES.WATER_MACRO
          ]
        }
      }
    }
  }
];

// Helper functions unchanged
export function getAllVariantsForTileLevel(tileType, level) {
  const tile = TEXTURE_CONFIG.find(t => t.id === tileType);
  if (!tile || !tile.textures || !tile.textures.base) return [];
  const map = []; 
  for (const season of Object.keys(tile.textures.base)) {
      const variants = tile.textures.base[season][level] || [];
      for (let i = 0; i < variants.length; ++i) {
          map.push({
              season,
              variant: i,
              layers: variants[i]
          });
      }
  }
  return map;
}

export function getVariantsFromConfig(tileType, level, season) {
  const tile = TEXTURE_CONFIG.find(t => t.id === tileType);
  if (!tile) return [];
  return (
    tile.textures &&
    tile.textures.base &&
    tile.textures.base[season] &&
    tile.textures.base[season][level]
  ) ? tile.textures.base[season][level] : [];
}

const grassTextureEntries = Object.entries(GRASS_TEXTURES).map(([name, layers]) => ({
  id: name,
  name: name,
  textures: {
      base: {
          [SEASONS.SPRING]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.SUMMER]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.AUTUMN]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.WINTER]: { [TEXTURE_LEVELS.PROP]: [layers] }
      }
  }
}));

const treeTextureEntries = Object.entries(TREE_TEXTURES).map(([name, layers]) => ({
  id: name,
  name: name,
  textures: {
      base: {
          [SEASONS.SPRING]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.SUMMER]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.AUTUMN]: { [TEXTURE_LEVELS.PROP]: [layers] },
          [SEASONS.WINTER]: { [TEXTURE_LEVELS.PROP]: [layers] }
      }
  }
}));

// Make sure to export and add to TEXTURE_CONFIG
TEXTURE_CONFIG.push(...grassTextureEntries);
TEXTURE_CONFIG.push(...treeTextureEntries);