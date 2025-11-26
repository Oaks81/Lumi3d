/**
 * Grass geometry generator for creating procedural grass meshes and billboards
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { GeometryGeneratorBase } from '../geometryGeneratorBase.js';
import { GeometryLodMap } from '../GeometryLodMap.js';
import { getGrassConfig } from '../../config/grassConfig.js';

export class GrassGeometryGenerator extends GeometryGeneratorBase {
    constructor() {
        super();
    }
    
    /**
     * Build geometry LOD map for a grass feature
     * @param {GrassFeature} feature - The grass feature to generate geometry for
     * @returns {Promise<{lodMap: GeometryLodMap}>} Geometry with multiple LOD levels
     */
    async buildGeometry(feature) {
        const lodMap = new GeometryLodMap();
        
        // LOD 0: High detail mesh
        const highDetailGeometry = await this._generateMeshGeometry(feature, 0);
        lodMap.setMeshLod(0, highDetailGeometry);
        
        // LOD 1: Medium detail mesh
        const mediumDetailGeometry = await this._generateMeshGeometry(feature, 1);
        lodMap.setMeshLod(1, mediumDetailGeometry);
        
        // LOD 2: Billboard
        const billboardGeometry = this._generateBillboardGeometry(feature);
        lodMap.setMeshLod(2, billboardGeometry);
        
        // LOD 3: Remove
        lodMap.setRemoveLod(3);
        
        return { lodMap };
    }
    
    /**
     * Generate 3D mesh geometry for grass
     * @param {GrassFeature} feature - Grass feature
     * @param {number} lodLevel - Level of detail (0 = highest)
     * @returns {Promise<THREE.BufferGeometry>} Generated geometry
     * @private
     */
    async _generateMeshGeometry(feature, lodLevel) {
        // Calculate grass parameters based on LOD
        const bladeCount = this._getBladeCount(lodLevel);
        const segmentsPerBlade = this._getSegmentsPerBlade(lodLevel);
        
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        
        let vertexIndex = 0;
        
        // Create seeded random generator
        const rng = this._createSeededRandom(feature.shapeSeed);
        const config = getGrassConfig(feature.subtype);
        
        // Generate each grass blade
        for (let bladeIdx = 0; bladeIdx < bladeCount; bladeIdx++) {
            const bladeData = this._generateGrassBlade(
                config, bladeIdx, segmentsPerBlade, rng
            );
            
            // Add blade vertices to geometry arrays
            positions.push(...bladeData.positions);
            normals.push(...bladeData.normals);
            uvs.push(...bladeData.uvs);
            colors.push(...bladeData.colors);
            
            // Add blade indices (offset by current vertex index)
            for (const idx of bladeData.indices) {
                indices.push(idx + vertexIndex);
            }
            
            vertexIndex += bladeData.positions.length / 3;
        }
        
        // Set geometry attributes
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        
        // Calculate bounding box and sphere
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
    }
    
    /**
     * Generate billboard geometry for distant grass rendering
     * @param {GrassFeature} feature - Grass feature
     * @returns {THREE.BufferGeometry} Billboard geometry
     * @private
     */
    _generateBillboardGeometry(feature) {
        const config = getGrassConfig(feature.subtype);
        const height = (config.height.min + config.height.max) * 0.5;
        const width = height * 0.3; // Aspect ratio
        
        const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
        
        // Center the geometry vertically (grass grows from ground up)
        geometry.translate(0, height * 0.5, 0);
        
        // Add vertex colors for wind animation support
        const colors = [];
        const positions = geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const normalizedHeight = y / height; // 0 at base, 1 at top
            
            // Use green channel to encode height for wind animation
            colors.push(0.0, normalizedHeight, 0.0);
        }
        
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        return geometry;
    }
    
    /**
     * Generate a single grass blade geometry
     * @param {Object} config - Grass configuration
     * @param {number} bladeIndex - Index of this blade within the clump
     * @param {number} segments - Number of segments per blade
     * @param {Function} rng - Seeded random function
     * @returns {Object} Blade geometry data {positions, normals, uvs, colors, indices}
     * @private
     */
    _generateGrassBlade(config, bladeIndex, segments, rng) {
        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        
        // Blade parameters - INCREASED for visibility
        const heightRange = { min: 0.8, max: 1.5 }; // Much taller
        const widthRange = { min: 0.08, max: 0.15 }; // Much wider
        
        const bladeHeight = this._randomRange(heightRange.min, heightRange.max, rng);
        const bladeWidth = this._randomRange(widthRange.min, widthRange.max, rng);
        const bladeCurve = rng() * 0.3 - 0.15; // -0.15 to 0.15 curve
        const bladeRotation = rng() * Math.PI * 2;
        
        // Position blade within clump - INCREASED for visibility
        const clumpRadius = 0.8;
        const maxBlades = 7; // Maximum blades per clump
        const angle = (bladeIndex / maxBlades) * Math.PI * 2 + rng() * 0.5;
        const distance = rng() * clumpRadius;
        const bladeX = Math.cos(angle) * distance;
        const bladeZ = Math.sin(angle) * distance;
        
        // Generate blade vertices
        for (let seg = 0; seg <= segments; seg++) {
            const t = seg / segments; // 0 to 1 along blade height
            const y = t * bladeHeight;
            
            // Apply curve (bend towards top)
            const curveAmount = t * t * bladeCurve;
            const x = bladeX + curveAmount;
            const z = bladeZ;
            
            // Width tapers towards top
            const width = bladeWidth * (1.0 - t * 0.7);
            
            // Create two vertices per segment (left and right side of blade)
            const leftX = x - width * 0.5;
            const rightX = x + width * 0.5;
            
            // Left vertex
            positions.push(leftX, y, z);
            normals.push(0, 0, 1); // Will be recalculated
            uvs.push(0, t);
            colors.push(t, 0, 0); // Use red channel to encode height for wind
            
            // Right vertex
            positions.push(rightX, y, z);
            normals.push(0, 0, 1); // Will be recalculated
            uvs.push(1, t);
            colors.push(t, 0, 0); // Use red channel to encode height for wind
            
            // Create triangles (except for last segment)
            if (seg < segments) {
                const baseIdx = seg * 2;
                
                // First triangle
                indices.push(baseIdx, baseIdx + 2, baseIdx + 1);
                // Second triangle
                indices.push(baseIdx + 1, baseIdx + 2, baseIdx + 3);
            }
        }
        
        // Calculate proper normals
        this._calculateBladeNormals(positions, normals, indices);
        
        return {
            positions,
            normals,
            uvs,
            colors,
            indices
        };
    }
    
    /**
     * Calculate normals for a grass blade
     * @param {Array<number>} positions - Position array
     * @param {Array<number>} normals - Normals array (modified in place)
     * @param {Array<number>} indices - Index array
     * @private
     */
    _calculateBladeNormals(positions, normals, indices) {
        // Reset normals
        for (let i = 0; i < normals.length; i++) {
            normals[i] = 0;
        }
        
        // Calculate face normals and accumulate to vertex normals
        for (let i = 0; i < indices.length; i += 3) {
            const idx1 = indices[i] * 3;
            const idx2 = indices[i + 1] * 3;
            const idx3 = indices[i + 2] * 3;
            
            // Get triangle vertices
            const v1 = new THREE.Vector3(positions[idx1], positions[idx1 + 1], positions[idx1 + 2]);
            const v2 = new THREE.Vector3(positions[idx2], positions[idx2 + 1], positions[idx2 + 2]);
            const v3 = new THREE.Vector3(positions[idx3], positions[idx3 + 1], positions[idx3 + 2]);
            
            // Calculate face normal
            const edge1 = v2.clone().sub(v1);
            const edge2 = v3.clone().sub(v1);
            const faceNormal = edge1.cross(edge2).normalize();
            
            // Accumulate to vertex normals
            normals[idx1] += faceNormal.x;
            normals[idx1 + 1] += faceNormal.y;
            normals[idx1 + 2] += faceNormal.z;
            
            normals[idx2] += faceNormal.x;
            normals[idx2 + 1] += faceNormal.y;
            normals[idx2 + 2] += faceNormal.z;
            
            normals[idx3] += faceNormal.x;
            normals[idx3 + 1] += faceNormal.y;
            normals[idx3 + 2] += faceNormal.z;
        }
        
        // Normalize accumulated normals
        for (let i = 0; i < normals.length; i += 3) {
            const normal = new THREE.Vector3(normals[i], normals[i + 1], normals[i + 2]);
            normal.normalize();
            normals[i] = normal.x;
            normals[i + 1] = normal.y;
            normals[i + 2] = normal.z;
        }
    }
    
    /**
     * Get number of blades based on LOD level
     * @param {number} lodLevel - LOD level
     * @returns {number} Number of blades to generate
     * @private
     */
    _getBladeCount(lodLevel) {
        const bladeCounts = [7, 5, 3, 2]; // Blades per LOD level
        return bladeCounts[lodLevel] || 2;
    }
    
    /**
     * Get number of segments per blade based on LOD level
     * @param {number} lodLevel - LOD level
     * @returns {number} Number of segments per blade
     * @private
     */
    _getSegmentsPerBlade(lodLevel) {
        const segmentCounts = [6, 4, 3, 2]; // Segments per LOD level
        return segmentCounts[lodLevel] || 2;
    }
    
    /**
     * Create a seeded random number generator
     * @param {number} seed - Random seed
     * @returns {Function} Random function that returns 0-1
     * @private
     */
    _createSeededRandom(seed) {
        let currentSeed = seed;
        return () => {
            currentSeed = (currentSeed * 9301 + 49297) % 233280;
            return currentSeed / 233280;
        };
    }
    
    /**
     * Generate random number in range using seeded random
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {Function} rng - Seeded random function
     * @returns {number} Random number in range
     * @private
     */
    _randomRange(min, max, rng) {
        return min + (max - min) * rng();
    }
    
    /**
     * Get material profile for grass rendering
     * @param {GrassFeature} feature - Grass feature
     * @returns {Object} Material profile
     */
    getMaterialProfile(feature) {
        return {
            materialType: 'grass',
            options: {
                subtype: feature.subtype,
                windResponse: feature.getWindResponse(),
                color: feature.config.color,
                transparent: true,
                alphaTest: 0.3,
                side: THREE.DoubleSide
            }
        };
    }
    

}
