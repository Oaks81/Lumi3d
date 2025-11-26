

// ./js/mesh/props/treeGenerator.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
// Assuming GeometryLodMap is in the same directory or correctly imported
import { GeometryLodMap } from '../GeometryLodMap.js'; 

// Function to generate the trunk geometry (from your snippet, simplified)
function generateTrunk(config) {
    const radius = config.trunkRadius || 0.8;
    const height = config.trunkHeight || 8;
    const segments = 8;
    // Generate a simple cylinder with top/bottom
    const geometry = new THREE.CylinderGeometry(
        radius * config.trunkTaper, // Top radius (tapered)
        radius,                     // Bottom radius
        height,                     // Height
        segments,                   // Radial segments
        1                           // Height segments
    );
    geometry.translate(0, height / 2, 0); // Center pivot at base
    return geometry;
}

// Function to generate a simple canopy cone (from your snippet, simplified)
function generateCanopyCone(config, trunkHeight) {
    const canopyRadius = config.canopyRadius || 6;
    const canopyHeight = config.canopyHeight || 10;
    const canopyY = trunkHeight * (config.canopyBottom || 0.4);

    const geometry = new THREE.ConeGeometry(
        canopyRadius, 
        canopyHeight, 
        16 // radial segments
    );
    geometry.translate(0, canopyY + canopyHeight / 2, 0);
    return geometry;
}


export class TreeGeometryGenerator {
    constructor() {
        this.treeConfigs = {
            OAK: {
                trunkRadius: 0.8,
                trunkHeight: 8,
                trunkTaper: 0.7,
                trunkSplits: [0.3, 0.5, 0.7],
                splitProbability: 0.7,
                branchingLevels: 5,
                branchesPerLevel: [6, 5, 4, 3, 2],
                branchStartHeight: 0.2,
                branchAngleVariance: 0.6,
                branchSpreadFactor: 1.8,
                branchThicknessRatio: 0.65,
                minBranchThickness: 0.01,
                // Twig settings
                twigLevels: 2, // How many levels of twigs to generate
                primaryTwigCount: 5, // Primary twigs per branch
                secondaryTwigCount: 3, // Secondary twigs per primary twig
                primaryTwigLength: 1.2,
                secondaryTwigLength: 0.6,
                twigThickness: 0.02,
                // Leaf settings
                totalLeafCount: 2000,
                leafSize: 0.20,
                canopyRadius: 6,
                canopyHeight: 10,
                canopyBottom: 0.4,
                barkTexture: 'BARK_OAK',
                leafTexture: 'LEAF_CLUSTER_BIRCH'
            },
            BIRCH: {
                trunkRadius: 0.5,
                trunkHeight: 10,
                trunkTaper: 0.85,
                trunkSplits: [0.6, 0.8],
                splitProbability: 0.5,
                branchingLevels: 5,
                branchesPerLevel: [5, 4, 4, 3, 2],
                branchStartHeight: 0.35,
                branchAngleVariance: 0.4,
                branchSpreadFactor: 1.6,
                branchThicknessRatio: 0.55,
                minBranchThickness: 0.008,
                twigLevels: 2,
                primaryTwigCount: 3,
                secondaryTwigCount: 2,
                primaryTwigLength: 1.0,
                secondaryTwigLength: 0.5,
                twigThickness: 0.015,
                totalLeafCount: 100,
                leafSize: 0.810,
                canopyRadius: 4.5,
                canopyHeight: 10,
                canopyBottom: 0.45,
                barkTexture: 'BARK_BIRCH',
                leafTexture: 'LEAF_CLUSTER_BIRCH'
            },
            PINE: {
                trunkRadius: 0.6,
                trunkHeight: 12,
                trunkTaper: 0.8,
                trunkSplits: [],
                splitProbability: 0,
                branchingLevels: 4,
                branchesPerLevel: [8, 6, 5, 4],
                branchStartHeight: 0.15,
                branchAngleVariance: 0.25,
                branchSpreadFactor: 1.0,
                branchThicknessRatio: 0.4,
                minBranchThickness: 0.015,
                twigLevels: 1,
                primaryTwigCount: 8,
                secondaryTwigCount: 0,
                primaryTwigLength: 0.8,
                secondaryTwigLength: 0.3,
                twigThickness: 0.01,
                totalLeafCount: 4000,
                leafSize: 0.1,
                canopyRadius: 3,
                canopyHeight: 10,
                canopyBottom: 0.2,
                barkTexture: 'BARK_PINE',
                leafTexture: 'NEEDLES_PINE'
            },
            SPRUCE: {
                trunkRadius: 0.5,
                trunkHeight: 14,
                trunkTaper: 0.85,
                trunkSplits: [],
                splitProbability: 0,
                branchingLevels: 4,
                branchesPerLevel: [10, 8, 6, 4],
                branchStartHeight: 0.1,
                branchAngleVariance: 0.15,
                branchSpreadFactor: 0.8,
                branchThicknessRatio: 0.35,
                minBranchThickness: 0.012,
                twigLevels: 1,
                primaryTwigCount: 10,
                secondaryTwigCount: 0,
                primaryTwigLength: 0.6,
                secondaryTwigLength: 0.2,
                twigThickness: 0.008,
                totalLeafCount: 5000,
                leafSize: 0.08,
                canopyRadius: 2.5,
                canopyHeight: 12,
                canopyBottom: 0.15,
                layerDroop: 0.3,
                barkTexture: 'BARK_SPRUCE',
                leafTexture: 'NEEDLES_SPRUCE'
            }
        };
    }

    /**
     * Builds LODs for a single tree, including its leaf stream definition.
     * @param {Object} config - The tree type configuration.
     * @returns {GeometryLodMap} - The map of LOD geometries.
     */
    async buildGeometry(config) {
        const lodMap = new GeometryLodMap();
        const trunkHeight = config.trunkHeight || 8;
        
        // --- LOD 0: Full Geometry (Trunk + Instanced Leaf Definition) ---
        // This mesh is the highest detail trunk/branch structure.
        const trunkGeometry = generateTrunk(config);
        
        // Combine trunk and branch stubs for max LOD mesh (if detailed branches exist)
        // For simplicity here, we only use the trunk.
        lodMap.setMeshLod(0, trunkGeometry);
        
        // Attach the leaf definition to LOD 0's entry for the streaming system
        // We'll create a dedicated leaf feature for streaming later.
        lodMap.getLod(0).leafFeature = {
            typeName: config.leafType || 'OAK_LEAF', // e.g., 'BIRCH_LEAF'
            // We pass parameters needed for the streamed leaf placement
            height: config.canopyHeight || 10,
            radius: config.canopyRadius || 6,
            center: new THREE.Vector3(0, (trunkHeight * 0.4) + (config.canopyHeight || 10) / 2, 0),
            // The StreamedFeatureManager will use this to find the instanced leaves
        };


        // --- LOD 1: Simple Trunk + Textured Canopy Polygon ---
        // Mid-distance: Less trunk detail, one simple poly for canopy (e.g., green hexagon)
        const simpleTrunk = new THREE.CylinderGeometry(0.3, 0.4, trunkHeight, 5, 1);
        simpleTrunk.translate(0, trunkHeight / 2, 0);
        
        const canopyMesh = generateCanopyCone(config, trunkHeight);
        
        // Merged geometry for LOD 1
        const combinedGeometry = THREE.BufferGeometryUtils.mergeGeometries([simpleTrunk, canopyMesh]);
        lodMap.setMeshLod(1, combinedGeometry);


        // --- LOD 2: Billboard Sprite (furthest visible range) ---
        // Far distance: A 2D texture (pre-rendered from the tree)
        const spriteFactory = (position, scale) => {
            // This function would return a configured THREE.Sprite
            const sprite = new THREE.Sprite(/* material with tree image */);
            sprite.scale.set(scale, scale, 1);
            return sprite;
        };
        lodMap.setSpriteLod(2, spriteFactory);


        // --- LOD 3: Remove from scene (or simple sphere) ---
        // Beyond render distance, but still within streaming range.
        lodMap.setRemoveLod(3); 
        
        return lodMap;
    }

}