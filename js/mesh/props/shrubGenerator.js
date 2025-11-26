/**
 * Shrub geometry generator for creating procedural shrub and bush meshes
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { GeometryGeneratorBase } from '../geometryGeneratorBase.js';
import { GeometryLodMap } from '../GeometryLodMap.js';

export class ShrubGeometryGenerator extends GeometryGeneratorBase {
    constructor() {
        super();
    }
    
    /**
     * Build geometry LOD map for a shrub feature
     * @param {ShrubFeature} feature - The shrub feature to generate geometry for
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
     * Generate 3D mesh geometry for shrub
     * @param {ShrubFeature} feature - Shrub feature
     * @param {number} lodLevel - Level of detail (0 = highest)
     * @returns {Promise<THREE.BufferGeometry>} Generated geometry
     * @private
     */
    async _generateMeshGeometry(feature, lodLevel) {
        const geometry = new THREE.BufferGeometry();
        
        if (feature.subtype === 'FERN') {
            return this._generateFernGeometry(feature, lodLevel);
        } else {
            return this._generateBushGeometry(feature, lodLevel);
        }
    }
    
    /**
     * Generate bush geometry (rounded, leafy shrub)
     * @param {ShrubFeature} feature - Shrub feature
     * @param {number} lodLevel - LOD level
     * @returns {THREE.BufferGeometry} Bush geometry
     * @private
     */
    _generateBushGeometry(feature, lodLevel) {
        const rng = this._createSeededRandom(feature.shapeSeed);
        const leafletCount = this._getLeafletCount(lodLevel);
        
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        
        // Bush parameters
        const bushHeight = 0.8 + rng() * 0.6; // 0.8-1.4 units
        const bushRadius = 0.6 + rng() * 0.4; // 0.6-1.0 units
        
        let vertexIndex = 0;
        
        // Generate leaf clusters in bush volume
        for (let i = 0; i < leafletCount; i++) {
            // Random position in bush (spherical)
            const phi = rng() * Math.PI * 2;
            const cosTheta = rng() * 2 - 1;
            const u = rng();
            
            const theta = Math.acos(cosTheta);
            const r = bushRadius * Math.pow(u, 1/3);
            
            const x = r * Math.sin(theta) * Math.cos(phi);
            const y = bushHeight * (0.2 + rng() * 0.8); // Bias towards middle-top
            const z = r * Math.sin(theta) * Math.sin(phi);
            
            const leafletData = this._createLeaflet(x, y, z, 0.08 + rng() * 0.06, rng() * Math.PI * 2, y / bushHeight, vertexIndex);
            
            positions.push(...leafletData.positions);
            normals.push(...leafletData.normals);
            uvs.push(...leafletData.uvs);
            colors.push(...leafletData.colors);
            indices.push(...leafletData.indices);
            
            vertexIndex += 4;
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
    }
    
    /**
     * Generate fern geometry (fronds with detailed leaves)
     * @param {ShrubFeature} feature - Shrub feature
     * @param {number} lodLevel - LOD level
     * @returns {THREE.BufferGeometry} Fern geometry
     * @private
     */
    _generateFernGeometry(feature, lodLevel) {
        const rng = this._createSeededRandom(feature.shapeSeed);
        const frondCount = this._getFrondCount(lodLevel);
        
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        
        const fernHeight = 0.5 + rng() * 0.4; // 0.5-0.9 units
        
        let vertexIndex = 0;
        
        // Generate fern fronds
        for (let i = 0; i < frondCount; i++) {
            const frondAngle = (i / frondCount) * Math.PI * 2 + rng() * 0.5;
            const frondLength = fernHeight * (0.7 + rng() * 0.3);
            const leafletCount = Math.floor(8 + rng() * 6); // 8-13 leaflets per frond
            
            // Generate frond spine with leaflets
            for (let j = 0; j < leafletCount; j++) {
                const t = j / (leafletCount - 1);
                const spineHeight = t * frondLength;
                const leafletSize = 0.06 * (1.0 - t * 0.3); // Smaller towards tip
                
                const spineX = Math.cos(frondAngle) * fernHeight * 0.3 * (1.0 - t);
                const spineZ = Math.sin(frondAngle) * fernHeight * 0.3 * (1.0 - t);
                
                // Create leaflet pair (left and right)
                for (let side = -1; side <= 1; side += 2) {
                    if (leafletSize > 0.02) {
                        const leafletX = spineX + Math.cos(frondAngle + Math.PI * 0.5) * side * leafletSize * 2;
                        const leafletZ = spineZ + Math.sin(frondAngle + Math.PI * 0.5) * side * leafletSize * 2;
                        
                        const leafletData = this._createLeaflet(
                            leafletX, spineHeight, leafletZ,
                            leafletSize, frondAngle + side * 0.2,
                            spineHeight / fernHeight, vertexIndex
                        );
                        
                        positions.push(...leafletData.positions);
                        normals.push(...leafletData.normals);
                        uvs.push(...leafletData.uvs);
                        colors.push(...leafletData.colors);
                        indices.push(...leafletData.indices);
                        
                        vertexIndex += 4;
                    }
                }
            }
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
    }
    
    /**
     * Create a single leaflet quad
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} z - Z position
     * @param {number} size - Leaflet size
     * @param {number} rotation - Leaflet rotation
     * @param {number} heightNorm - Normalized height (0-1) for wind animation
     * @param {number} baseIndex - Base vertex index
     * @returns {Object} Leaflet geometry data
     * @private
     */
    _createLeaflet(x, y, z, size, rotation, heightNorm, baseIndex) {
        const positions = [];
        const normals = [];
        const uvs = [];
        const colors = [];
        const indices = [];
        
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        
        // Create quad vertices
        const vertices = [
            [-size, -size], [size, -size], [size, size], [-size, size]
        ];
        
        for (const [dx, dy] of vertices) {
            const rotX = dx * cos - dy * sin;
            const rotY = dx * sin + dy * cos;
            
            positions.push(x + rotX, y + rotY, z);
            normals.push(0, 0, 1);
            uvs.push((dx + size) / (2 * size), (dy + size) / (2 * size));
            colors.push(heightNorm, 0, 0); // Height for wind animation
        }
        
        // Create triangles
        indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex, baseIndex + 2, baseIndex + 3
        );
        
        return { positions, normals, uvs, colors, indices };
    }
    
    /**
     * Generate billboard geometry for distant shrub rendering
     * @param {ShrubFeature} feature - Shrub feature
     * @returns {THREE.BufferGeometry} Billboard geometry
     * @private
     */
    _generateBillboardGeometry(feature) {
        const height = feature.subtype === 'FERN' ? 0.7 : 1.0;
        const width = height * 0.8;
        
        const geometry = new THREE.PlaneGeometry(width, height, 1, 1);
        geometry.translate(0, height * 0.5, 0);
        
        // Add vertex colors for wind animation support
        const colors = [];
        const positions = geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const normalizedHeight = y / height;
            colors.push(0.0, normalizedHeight, 0.0);
        }
        
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        return geometry;
    }
    
    /**
     * Get leaflet count based on LOD level for bushes
     * @param {number} lodLevel - LOD level
     * @returns {number} Number of leaflets
     * @private
     */
    _getLeafletCount(lodLevel) {
        const leafletCounts = [80, 40, 20, 10]; // Leaflets per LOD level
        return leafletCounts[lodLevel] || 10;
    }
    
    /**
     * Get frond count based on LOD level for ferns
     * @param {number} lodLevel - LOD level
     * @returns {number} Number of fronds
     * @private
     */
    _getFrondCount(lodLevel) {
        const frondCounts = [8, 6, 4, 2]; // Fronds per LOD level
        return frondCounts[lodLevel] || 2;
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
     * Get material profile for shrub rendering
     * @param {ShrubFeature} feature - Shrub feature
     * @returns {Object} Material profile
     */
    getMaterialProfile(feature) {
        return {
            materialType: 'shrub',
            options: {
                subtype: feature.subtype,
                transparent: true,
                alphaTest: 0.3,
                side: THREE.DoubleSide
            }
        };
    }
}
