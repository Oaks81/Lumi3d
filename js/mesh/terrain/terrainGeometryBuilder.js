// js/mesh/terrain/terrainGeometryBuilder.js
import { Geometry } from '../../renderer/resources/geometry.js';
import { QuadTerrainGeometryBuilder } from './quadTerrainGeometryBuilder.js';

export class TerrainGeometryBuilder {
    /**
     * Build terrain geometry with LOD and altitude awareness
     * @param {Object} chunkData - Chunk data with heightData/heights
     * @param {number} offsetX - World X offset
     * @param {number} offsetZ - World Z offset
     * @param {number} lodLevel - LOD level (0-5+)
     * @param {boolean} useHeightTexture - If true, geometry is flat and heights come from shader
     * @returns {Geometry}
     */
    static build(chunkData, offsetX, offsetZ, lodLevel = 0, useHeightTexture = false) {
        // LOD 5+: Always use single quad
        if (lodLevel >= 5) {
            return QuadTerrainGeometryBuilder.buildQuad(chunkData, offsetX, offsetZ);
        }
        
        // LOD 3-4: Use subdivided quad (regardless of height source)
        if (lodLevel >= 3) {
            const subdivisions = lodLevel === 3 ? 8 : 4;
            return QuadTerrainGeometryBuilder.buildSubdividedQuad(
                chunkData, offsetX, offsetZ, subdivisions
            );
        }
        
        // LOD 0-2: Detailed geometry
        if (useHeightTexture) {
            // Heights will be sampled from texture in shader
            return this.buildFlatGrid(chunkData, offsetX, offsetZ, lodLevel);
        } else {
            // Heights baked into vertices from CPU data
            return this.buildFromHeightmap(chunkData, offsetX, offsetZ, lodLevel);
        }
    }
    
    /**
     * Build flat grid geometry (heights from texture in shader)
     * Used for LOD 0-2 at high altitude
     */
    static buildFlatGrid(chunkData, offsetX, offsetZ, lodLevel) {
        const chunkSize = chunkData.size;
        
        // Determine subdivisions based on LOD
        const subdivisionMap = {
            0: 64,  // Match heightmap detail
            1: 32,
            2: 16
        };
        const subdivisions = subdivisionMap[lodLevel] || 16;
        
        const geometry = new Geometry();
        
        const vertCount = (subdivisions + 1) * (subdivisions + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        let vertIndex = 0;
        for (let y = 0; y <= subdivisions; y++) {
            for (let x = 0; x <= subdivisions; x++) {
                const u = x / subdivisions;
                const v = y / subdivisions;
                
                // Flat geometry - shader will displace using height texture
                positions[vertIndex * 3 + 0] = offsetX + u * chunkSize;
                positions[vertIndex * 3 + 1] = 0; // Flat base
                positions[vertIndex * 3 + 2] = offsetZ + v * chunkSize;
                
                // Up-facing normals - shader will use normal texture
                normals[vertIndex * 3 + 0] = 0;
                normals[vertIndex * 3 + 1] = 1;
                normals[vertIndex * 3 + 2] = 0;
                
                uvs[vertIndex * 2 + 0] = u;
                uvs[vertIndex * 2 + 1] = v;
                
                vertIndex++;
            }
        }
        
        const indices = this._buildGridIndices(subdivisions);
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        geometry.userData = {
            lodLevel: lodLevel,
            subdivisions: subdivisions,
            vertexCount: vertCount,
            triangleCount: indices.length / 3,
            heightSource: 'texture', // Heights from texture
            normalSource: 'texture'  // Normals from texture
        };
        
        return geometry;
    }
    
    /**
     * Build geometry from CPU heightmap data
     * Used for LOD 0-2 at low altitude (close-up detail)
     */
    static buildFromHeightmap(chunkData, offsetX, offsetZ, lodLevel = 0) {
        // Validate height data exists
        const heightData = chunkData.heightData || chunkData.heights;
        if (!heightData) {
            console.error(' No heightData available for heightmap geometry');
            console.warn(' Falling back to flat grid');
            return this.buildFlatGrid(chunkData, offsetX, offsetZ, lodLevel);
        }
        
        const width = chunkData.width || (chunkData.size + 1);
        const height = chunkData.height || (chunkData.size + 1);
        const size = chunkData.size;
        
        // Calculate grid density based on LOD
        const densityMap = {
            0: 1,   // Full resolution (129x129)
            1: 2,   // Half resolution (65x65)
            2: 4    // Quarter resolution (33x33)
        };
        
        const skipFactor = densityMap[lodLevel] || 1;
        const gridWidth = Math.floor(width / skipFactor);
        const gridHeight = Math.floor(height / skipFactor);
        
        const geometry = new Geometry();
        
        const vertCount = gridWidth * gridHeight;
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        // Build vertices with heights from CPU data
        let vertIndex = 0;
        for (let y = 0; y < gridHeight; y++) {
            for (let x = 0; x < gridWidth; x++) {
                const srcX = x * skipFactor;
                const srcY = y * skipFactor;
                
                const u = srcX / width;
                const v = srcY / height;
                
                const worldX = offsetX + u * size;
                const worldZ = offsetZ + v * size;
                
                // Sample height from CPU data
                const h = this._sampleHeight(heightData, width, height, srcX, srcY);
                
                positions[vertIndex * 3 + 0] = worldX;
                positions[vertIndex * 3 + 1] = h; // Height from CPU data
                positions[vertIndex * 3 + 2] = worldZ;
                
                // Calculate normal from heightmap
                const normal = this._calculateNormal(heightData, width, height, size, srcX, srcY, skipFactor);
                normals[vertIndex * 3 + 0] = normal.x;
                normals[vertIndex * 3 + 1] = normal.y;
                normals[vertIndex * 3 + 2] = normal.z;
                
                uvs[vertIndex * 2 + 0] = u;
                uvs[vertIndex * 2 + 1] = v;
                
                vertIndex++;
            }
        }
        
        const indices = this._buildGridIndices(gridWidth - 1);
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        geometry.userData = {
            lodLevel: lodLevel,
            gridSize: { width: gridWidth, height: gridHeight },
            vertexCount: vertCount,
            triangleCount: indices.length / 3,
            skipFactor: skipFactor,
            heightSource: 'cpu',   // Heights baked into vertices
            normalSource: 'cpu'    // Normals calculated from heightmap
        };
        
        return geometry;
    }
    
    static _sampleHeight(heightData, width, height, x, y) {
        x = Math.max(0, Math.min(width - 1, Math.floor(x)));
        y = Math.max(0, Math.min(height - 1, Math.floor(y)));
        
        const index = y * width + x;
        return heightData[index] || 0;
    }
    
    static _calculateNormal(heightData, width, height, chunkSize, x, y, step = 1) {
        const hL = this._sampleHeight(heightData, width, height, x - step, y);
        const hR = this._sampleHeight(heightData, width, height, x + step, y);
        const hD = this._sampleHeight(heightData, width, height, x, y - step);
        const hU = this._sampleHeight(heightData, width, height, x, y + step);
        
        const scale = (chunkSize / width) * step;
        
        const nx = (hL - hR) / (2 * scale);
        const ny = 1.0;
        const nz = (hD - hU) / (2 * scale);
        
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        
        return {
            x: nx / len,
            y: ny / len,
            z: nz / len
        };
    }
    
    static _buildGridIndices(subdivisions) {
        const triCount = subdivisions * subdivisions * 2;
        const indices = new Uint32Array(triCount * 3);
        let indexOffset = 0;
        
        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                const v00 = y * (subdivisions + 1) + x;
                const v10 = v00 + 1;
                const v01 = (y + 1) * (subdivisions + 1) + x;
                const v11 = v01 + 1;
                
                // Triangle 1
                indices[indexOffset++] = v00;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v10;
                
                // Triangle 2
                indices[indexOffset++] = v10;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v11;
            }
        }
        
        return indices;
    }
}