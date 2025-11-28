import { Geometry } from '../../renderer/resources/geometry.js';

export class TerrainGeometryBuilder {
    /**
     * Build terrain geometry using a consistent grid approach.
     * simplified quads have been removed to ensure proper spherical curvature.
     */
    static build(chunkData, offsetX, offsetZ, lodLevel = 0, useHeightTexture = false) {
        
        // 1. Determine Grid Resolution based on LOD
        // We ensure even the lowest LOD has enough segments to curve around the sphere.
        const subdivisionMap = {
            0: 64, // High detail
            1: 32,
            2: 16,
            3: 16,
            4: 8,  // Low detail, but still a grid
            5: 8,
            6: 8
        };
        
        // Default to 8 if undefined
        const segments = subdivisionMap[lodLevel] || 8;
        
        // 2. Build the geometry
        // We ignore the QuadTerrainGeometryBuilder and always use the grid.
        if (useHeightTexture) {
            // Case A: Displacement Mapping (Atlas Mode)
            // Return a FLAT grid. The Vertex Shader will read the texture and move the vertices up.
            return this.buildFlatGrid(chunkData, segments, lodLevel);
        } else {
            // Case B: CPU Baking
            // Bake the height array directly into the vertex Y positions.
            return this.buildFromHeightmap(chunkData, segments, lodLevel);
        }
    }
    
    /**
     * Builds a flat mesh (y=0).
     * Expected: Vertex Shader applies displacement using 'heightTexture'.
     */
    static buildFlatGrid(chunkData, segments, lodLevel) {
        const geometry = new Geometry();
        const chunkSize = chunkData.size;
        
        const vertCount = (segments + 1) * (segments + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        let vertIndex = 0;
        
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const v = y / segments;
                
                // LOCAL Coordinates (0 to chunkSize)
                // We do NOT add offsetX/offsetZ here. The Uniform 'chunkOffset' handles that.
                positions[vertIndex * 3 + 0] = u * chunkSize;
                positions[vertIndex * 3 + 1] = 0; // Flat
                positions[vertIndex * 3 + 2] = v * chunkSize;
                
                // Default Up Normal
                // The spherical vertex shader must rotate this based on position
                normals[vertIndex * 3 + 0] = 0;
                normals[vertIndex * 3 + 1] = 1;
                normals[vertIndex * 3 + 2] = 0;
                
                uvs[vertIndex * 2 + 0] = u;
                uvs[vertIndex * 2 + 1] = v;
                
                vertIndex++;
            }
        }
        
        const indices = this._buildGridIndices(segments);
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        geometry.userData = {
            lodLevel: lodLevel,
            segments: segments,
            vertexCount: vertCount,
            source: 'flat_texture'
        };
        
        return geometry;
    }
    
    /**
     * Builds a mesh with heights baked in from CPU data.
     */
    static buildFromHeightmap(chunkData, segments, lodLevel) {
        const geometry = new Geometry();
        const chunkSize = chunkData.size;
        
        // Support both naming conventions from your logs
        const heightData = chunkData.heightData || chunkData.heights;
        const dataWidth = chunkData.width || (chunkSize + 1);
        const dataHeight = chunkData.height || (chunkSize + 1);

        const vertCount = (segments + 1) * (segments + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        let vertIndex = 0;
        
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const v = y / segments;
                
                // Sample height from CPU array
                // Map 0..1 UV to 0..ArraySize
                const sampleX = Math.floor(u * (dataWidth - 1));
                const sampleY = Math.floor(v * (dataHeight - 1));
                const h = this._sampleHeight(heightData, dataWidth, dataHeight, sampleX, sampleY);

                // LOCAL Coordinates
                positions[vertIndex * 3 + 0] = u * chunkSize;
                positions[vertIndex * 3 + 1] = h;
                positions[vertIndex * 3 + 2] = v * chunkSize;
                
                // Calculate Approx Normal from Neighbors
                const n = this._calculateNormal(heightData, dataWidth, dataHeight, chunkSize, sampleX, sampleY);
                normals[vertIndex * 3 + 0] = n.x;
                normals[vertIndex * 3 + 1] = n.y;
                normals[vertIndex * 3 + 2] = n.z;
                
                uvs[vertIndex * 2 + 0] = u;
                uvs[vertIndex * 2 + 1] = v;
                
                vertIndex++;
            }
        }
        
        const indices = this._buildGridIndices(segments);
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        
        geometry.userData = {
            lodLevel: lodLevel,
            segments: segments,
            vertexCount: vertCount,
            source: 'cpu_baked'
        };
        
        return geometry;
    }
    
    static _sampleHeight(data, width, height, x, y) {
        if (!data) return 0;
        // Clamp
        if (x < 0) x = 0; if (x >= width) x = width - 1;
        if (y < 0) y = 0; if (y >= height) y = height - 1;
        return data[y * width + x];
    }

    static _calculateNormal(data, width, height, chunkSize, x, y) {
        if (!data) return {x:0, y:1, z:0};
        
        const hL = this._sampleHeight(data, width, height, x - 1, y);
        const hR = this._sampleHeight(data, width, height, x + 1, y);
        const hD = this._sampleHeight(data, width, height, x, y - 1);
        const hU = this._sampleHeight(data, width, height, x, y + 1);
        
        // Scale factor assuming 1 unit distance in array map
        const scale = chunkSize / width; 
        
        const nx = (hL - hR) / (2.0 * scale);
        const ny = 1.0;
        const nz = (hD - hU) / (2.0 * scale);
        
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        return { x: nx/len, y: ny/len, z: nz/len };
    }
    
    static _buildGridIndices(segments) {
        const triCount = segments * segments * 2;
        const indices = new Uint32Array(triCount * 3);
        let indexOffset = 0;
        
        for (let y = 0; y < segments; y++) {
            for (let x = 0; x < segments; x++) {
                const v00 = y * (segments + 1) + x;
                const v10 = v00 + 1;
                const v01 = (y + 1) * (segments + 1) + x;
                const v11 = v01 + 1;
                
                // Tri 1
                indices[indexOffset++] = v00;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v10;
                
                // Tri 2
                indices[indexOffset++] = v10;
                indices[indexOffset++] = v01;
                indices[indexOffset++] = v11;
            }
        }
        
        return indices;
    }
}