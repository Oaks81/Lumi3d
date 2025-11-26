import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

// --- Placeholder Generator Imports ---
// (You must ensure these files exist and contain the corresponding generator classes)
import { GrassGeometryGenerator } from './generators/grassGeometryGenerator.js';
//import { FlowerGeometryGenerator } from './generators/FlowerGeometryGenerator.js';
//import { PebbleGeometryGenerator } from './generators/PebbleGeometryGenerator.js';
//import { BushGeometryGenerator } from './generators/BushGeometryGenerator.js';
//import { TreeBillboardGenerator } from './generators/TreeBillboardGenerator.js'; 

// --- Seed Definitions (Must be consistent) ---
const GRASS_SHORT_SEED = 1000.0;
const GRASS_TALL_SEED = 2000.0;
const FLOWER_SEED = 3000.0;
const PEBBLES_SEED = 4000.0;
const BUSHES_SEED = 5000.0;
const TREES_SEED = 6000.0;

/**
 * Defines all streamable features, their configuration, and the generators
 * for their base instanced geometry.
 * * NOTE: For Tree/Bush, this defines the FAR distance billboard/mesh, 
 * not the high-detail singleton mesh.
 */
export const StreamedAssetConfig = [
    {
        typeName: 'grass_short',
        generatorClass: GrassGeometryGenerator,
        config: {
            gridSpacing: 0.35,
            density: 0.85,
            validTiles: [3, 6], // GRASS, FOREST_FLOOR
            color: new THREE.Color(0.4, 0.7, 0.3),
            noiseSeed: GRASS_SHORT_SEED,
            streamRadius: 80,
            maxRenderDistance: 70,
            taperStartDistance: 40,
            taperEndDistance: 65,
            minCullDistance: 2,
            geometryParams: { width: 0.15, height: 0.8 } 
        }
    },
    {
        typeName: 'grass_tall',
        generatorClass: GrassGeometryGenerator,
        config: {
            gridSpacing: 0.5,
            density: 0.4,
            validTiles: [3, 6],
            color: new THREE.Color(0.35, 0.65, 0.25),
            noiseSeed: GRASS_TALL_SEED,
            streamRadius: 100,
            maxRenderDistance: 90,
            taperStartDistance: 50,
            taperEndDistance: 85,
            minCullDistance: 2,
            geometryParams: { width: 0.2, height: 1.2 }
        }
    },
    /*
    {
        typeName: 'flowers',
        generatorClass: FlowerGeometryGenerator,
        config: {
            gridSpacing: 1.0,
            density: 0.15,
            validTiles: [3],
            color: new THREE.Color(0.9, 0.7, 0.3),
            noiseSeed: FLOWER_SEED,
            streamRadius: 60,
            maxRenderDistance: 50,
            taperStartDistance: 25,
            taperEndDistance: 45,
            minCullDistance: 2,
        }
    },
    {
        typeName: 'pebbles',
        generatorClass: PebbleGeometryGenerator,
        config: {
            gridSpacing: 2.0,
            density: 0.2,
            validTiles: [3, 4, 7], // GRASS, SAND, ROCK
            color: new THREE.Color(0.5, 0.5, 0.5),
            noiseSeed: PEBBLES_SEED,
            streamRadius: 120,
            maxRenderDistance: 100,
            taperStartDistance: 60,
            taperEndDistance: 95,
            minCullDistance: 2,
        }
    },
    {
        typeName: 'bushes',
        generatorClass: BushGeometryGenerator,
        config: {
            gridSpacing: 4.0,
            density: 0.3,
            validTiles: [3, 6],
            color: new THREE.Color(0.3, 0.6, 0.3),
            noiseSeed: BUSHES_SEED,
            streamRadius: 200,
            maxRenderDistance: 180,
            taperStartDistance: 120,
            taperEndDistance: 175,
            minCullDistance: 3,
        }
    },
    {
        typeName: 'trees', // Far-distance billboard/low-poly stand-in
        generatorClass: TreeBillboardGenerator,
        config: {
            gridSpacing: 8.0,
            density: 0.1,
            validTiles: [3, 6],
            color: new THREE.Color(0.2, 0.5, 0.2),
            noiseSeed: TREES_SEED,
            streamRadius: 400,
            maxRenderDistance: 380,
            taperStartDistance: 300,
            taperEndDistance: 370,
            minCullDistance: 5,
        }
    }*/
];