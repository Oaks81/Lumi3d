// js/mesh/terrain/quadTerrainGeometryBuilder.js
import { Geometry } from '../../renderer/resources/geometry.js';

/**
 * Creates ultra-simplified terrain geometry for high-altitude rendering
 * Each chunk is represented as a single quad (4 vertices, 2 triangles)
 */
export class QuadTerrainGeometryBuilder {
    /**
     * Build a single quad for a terrain chunk
     * @param {Object} chunk - Chunk data with heightData
     * @param {number} offsetX - World X offset
     * @param {number} offsetZ - World Z offset
     * @returns {Geometry}
     */
    static buildQuad(chunk, offsetX, offsetZ) {
        const size = chunk.size;
        
        // Sample height at 4 corners of the chunk
        const h00 = this._sampleHeight(chunk, 0, 0);
        const h10 = this._sampleHeight(chunk, chunk.width - 1, 0);
        const h01 = this._sampleHeight(chunk, 0, chunk.height - 1);
        const h11 = this._sampleHeight(chunk, chunk.width - 1, chunk.height - 1);
        
        // Average height for the quad (could also use max/min for better visibility)
        const avgHeight = (h00 + h10 + h01 + h11) / 4;
        
        // 4 vertices at corners
        const positions = new Float32Array([
            offsetX,        avgHeight, offsetZ,        // 0: Bottom-left
            offsetX + size, avgHeight, offsetZ,        // 1: Bottom-right
            offsetX,        avgHeight, offsetZ + size, // 2: Top-left
            offsetX + size, avgHeight, offsetZ + size  // 3: Top-right
        ]);
        
        // Simple upward-facing normals (could compute from corner heights)
        const normals = new Float32Array([
            0, 1, 0,  // 0
            0, 1, 0,  // 1
            0, 1, 0,  // 2
            0, 1, 0   // 3
        ]);
        
        // UVs map to chunk space (for texture sampling)
        const uvs = new Float32Array([
            0, 0,  // 0
            1, 0,  // 1
            0, 1,  // 2
            1, 1   // 3
        ]);
        
        // Two triangles forming the quad
        const indices = new Uint32Array([
            0, 2, 1,  // First triangle
            1, 2, 3   // Second triangle
        ]);
        
        const geometry = new Geometry();
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        // Store metadata
        geometry.userData = {
            isQuadOnly: true,
            vertexCount: 4,
            triangleCount: 2,
            chunkSize: size
        };
        
        return geometry;
    }
    
    /**
     * Build a quad with slightly more detail (4x4 subdivisions = 16 vertices)
     * Still much cheaper than full detail, but smooths out large height variations
     */
    static buildSubdividedQuad(chunk, offsetX, offsetZ, subdivisions = 4) {
        const size = chunk.size;
        const step = size / subdivisions;
        
        const vertCount = (subdivisions + 1) * (subdivisions + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        let vertIndex = 0;
        
        for (let y = 0; y <= subdivisions; y++) {
            for (let x = 0; x <= subdivisions; x++) {
                const worldX = offsetX + x * step;
                const worldZ = offsetZ + y * step;
                
                // Sample height at this subdivision point
                const u = x / subdivisions;
                const v = y / subdivisions;
                const chunkX = Math.floor(u * (chunk.width - 1));
                const chunkY = Math.floor(v * (chunk.height - 1));
                const height = this._sampleHeight(chunk, chunkX, chunkY);
                
                positions[vertIndex * 3 + 0] = worldX;
                positions[vertIndex * 3 + 1] = height;
                positions[vertIndex * 3 + 2] = worldZ;
                
                // Simple upward normal (could compute from neighbors)
                normals[vertIndex * 3 + 0] = 0;
                normals[vertIndex * 3 + 1] = 1;
                normals[vertIndex * 3 + 2] = 0;
                
                uvs[vertIndex * 2 + 0] = u;
                uvs[vertIndex * 2 + 1] = v;
                
                vertIndex++;
            }
        }
        
        // Generate indices
        const triCount = subdivisions * subdivisions * 2;
        const indices = new Uint32Array(triCount * 3);
        let indexOffset = 0;
        
        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                const v00 = y * (subdivisions + 1) + x;
                const v10 = v00 + 1;
                const v01 = (y + 1) * (subdivisions + 1) + x;
                const v11 = v01 + 1;
                
                indices[indexOffset++] = v00;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v10;
                
                indices[indexOffset++] = v10;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v11;
            }
        }
        
        const geometry = new Geometry();
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        geometry.userData = {
            isQuadOnly: false,
            isSimplified: true,
            subdivisions: subdivisions,
            vertexCount: vertCount,
            triangleCount: triCount,
            chunkSize: size
        };
        
        return geometry;
    }
    
    static _sampleHeight(chunk, x, y) {
        if (!chunk.heightData) return 0;
        
        const width = chunk.width;
        const height = chunk.height;
        
        // Clamp to valid range
        x = Math.max(0, Math.min(width - 1, Math.floor(x)));
        y = Math.max(0, Math.min(height - 1, Math.floor(y)));
        
        const index = y * width + x;
        return chunk.heightData[index] || 0;
    }
}