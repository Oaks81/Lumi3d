// js/mesh/terrain/terrainGeometryBuilder.js
import { Geometry } from '../../renderer/resources/geometry.js';

export class TerrainGeometryBuilder {
    
    static DEFAULT_SUBDIVISIONS = {
        0: 128,  // 16,641 vertices (was 64 = 4,225)
        1: 64,   // 4,225 vertices
        2: 32,   // 1,089 vertices
        3: 16,   // 289 vertices
        4: 8,    // 81 vertices
        5: 4,    // 25 vertices (WAS QUAD = 4 VERTICES!)
        6: 2,    // 9 vertices minimum
    };
    
    static build(chunkData, offsetX, offsetZ, lodLevel = 0, useHeightTexture = false, options = {}) {
        const subdivisionMap = options.subdivisions || this.DEFAULT_SUBDIVISIONS;
        const clampedLOD = Math.min(Math.max(lodLevel, 0), 6);
        const segments = subdivisionMap[clampedLOD] || 4;
        const edgeMask = options.edgeMask || 0;
        const addSkirt = options.addSkirt === true; // default OFF; skirts opt-in
        const skirtDepth = options.skirtDepth || chunkData.size * 0.05;
        
        if (useHeightTexture) {
            return this.buildFlatGrid(chunkData, segments, lodLevel, { addSkirt, skirtDepth, edgeMask });
        }
        return this.buildFromHeightmap(chunkData, segments, lodLevel, { addSkirt, skirtDepth, edgeMask });
    }

    /**
     * Simple heightmap builder: displaces Y using chunkData.heights if present,
     * otherwise falls back to flat grid.
     */
    static buildFromHeightmap(chunkData, segments, lodLevel, options = {}) {
        if (!chunkData?.heights) {
            return this.buildFlatGrid(chunkData, segments, lodLevel);
        }
        const addSkirt = options.addSkirt === true;
        const skirtDepth = options.skirtDepth || chunkData.size * 0.05;
        const edgeMask = options.edgeMask || 0;

        const geometry = new Geometry();
        const size = chunkData.size;
        const vertCount = (segments + 1) * (segments + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);

        let i = 0;
        const stride = this._safeStride(chunkData);
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const v = y / segments;
                const hx = Math.floor(u * (stride - 1));
                const hz = Math.floor(v * (stride - 1));
                const h = chunkData.heights[hz * stride + hx] || 0;

                positions[i * 3] = u * size;
                positions[i * 3 + 1] = h;
                positions[i * 3 + 2] = v * size;
                normals[i * 3] = 0;
                normals[i * 3 + 1] = 1;
                normals[i * 3 + 2] = 0;
                uvs[i * 2] = u;
                uvs[i * 2 + 1] = v;
                i++;
            }
        }

        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        let indices = edgeMask ? this._buildStitchedIndices(segments, edgeMask) : this._buildGridIndices(segments);

        if (addSkirt) {
            const skirt = this._buildSkirt(positions, normals, uvs, segments, size, skirtDepth);
            // merge skirt attributes
            geometry.setAttribute('position', skirt.positions, 3);
            geometry.setAttribute('normal', skirt.normals, 3);
            geometry.setAttribute('uv', skirt.uvs, 2);
            indices = this._mergeIndices(indices, skirt.indices);
        }

        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        geometry.userData = { lodLevel, segments, vertexCount: geometry.attributes.get('position').count, edgeMask };
        return geometry;
    }

    static _safeStride(chunkData) {
        const stride = Math.sqrt(chunkData.heights.length);
        return Number.isFinite(stride) && stride > 0 ? Math.floor(stride) : chunkData.size + 1;
    }
    
    static buildFlatGrid(chunkData, segments, lodLevel, options = {}) {
        const geometry = new Geometry();
        const chunkSize = chunkData.size;
        const addSkirt = options.addSkirt === true;
        const skirtDepth = options.skirtDepth || chunkSize * 0.05;
        const edgeMask = options.edgeMask || 0;
        const vertCount = (segments + 1) * (segments + 1);
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        
        let i = 0;
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const u = x / segments;
                const v = y / segments;
                positions[i * 3] = u * chunkSize;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = v * chunkSize;
                normals[i * 3] = 0;
                normals[i * 3 + 1] = 1;
                normals[i * 3 + 2] = 0;
                uvs[i * 2] = u;
                uvs[i * 2 + 1] = v;
                i++;
            }
        }
        
        geometry.setAttribute('position', positions, 3);
        geometry.setAttribute('normal', normals, 3);
        geometry.setAttribute('uv', uvs, 2);
        let indices = edgeMask ? this._buildStitchedIndices(segments, edgeMask) : this._buildGridIndices(segments);

        if (addSkirt) {
            const skirt = this._buildSkirt(positions, normals, uvs, segments, chunkSize, skirtDepth);
            geometry.setAttribute('position', skirt.positions, 3);
            geometry.setAttribute('normal', skirt.normals, 3);
            geometry.setAttribute('uv', skirt.uvs, 2);
            indices = this._mergeIndices(indices, skirt.indices);
        }

        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        geometry.userData = { lodLevel, segments, vertexCount: geometry.attributes.get('position').count, edgeMask };
        return geometry;
    }
    
    static _buildGridIndices(segments) {
        const indices = new Uint32Array(segments * segments * 6);
        let idx = 0;
        for (let y = 0; y < segments; y++) {
            for (let x = 0; x < segments; x++) {
                const v00 = y * (segments + 1) + x;
                indices[idx++] = v00;
                indices[idx++] = v00 + segments + 1;
                indices[idx++] = v00 + 1;
                indices[idx++] = v00 + 1;
                indices[idx++] = v00 + segments + 1;
                indices[idx++] = v00 + segments + 2;
            }
        }
        return indices;
    }

    // edgeMask bits: 1=top, 2=right, 4=bottom, 8=left (neighbor is coarser)
    static _buildStitchedIndices(segments, edgeMask) {
        const indices = [];
        const idx = (x, y) => y * (segments + 1) + x;
        const addTri = (a, b, c) => { indices.push(a, b, c); };

        const stitchTop = (edgeMask & 1) !== 0;
        const stitchRight = (edgeMask & 2) !== 0;
        const stitchBottom = (edgeMask & 4) !== 0;
        const stitchLeft = (edgeMask & 8) !== 0;

        // Interior quads (skip stitched edges)
        const yStart = stitchTop ? 1 : 0;
        const yEnd = stitchBottom ? segments - 1 : segments - 1;
        for (let y = yStart; y <= yEnd; y++) {
            if (stitchBottom && y === segments - 1) continue;
            if (stitchTop && y === 0) continue;
            for (let x = 0; x < segments; x++) {
                if (stitchRight && x === segments - 1) continue;
                if (stitchLeft && x === 0) continue;
                const v00 = idx(x, y);
                const v10 = idx(x + 1, y);
                const v01 = idx(x, y + 1);
                const v11 = idx(x + 1, y + 1);
                addTri(v00, v01, v11);
                addTri(v00, v11, v10);
            }
        }

        // Top stitch (connect edge row y=0 to row y=1 with step=2)
        if (stitchTop) {
            const yEdge = 0, yInner = 1;
            for (let x = 0; x <= segments - 1; x += 2) {
                const x0 = x;
                const x2 = Math.min(x + 2, segments);
                const v0 = idx(x0, yEdge);
                const v2 = idx(x2, yEdge);
                const i0 = idx(x0, yInner);
                const i2 = idx(x2, yInner);
                addTri(v0, v2, i2);
                addTri(v0, i2, i0);
            }
        } else {
            // Regular top row if not stitched
            if (!stitchBottom) {
                for (let x = 0; x < segments; x++) {
                    const v00 = idx(x, 0);
                    const v10 = idx(x + 1, 0);
                    const v01 = idx(x, 1);
                    const v11 = idx(x + 1, 1);
                    addTri(v00, v01, v11);
                    addTri(v00, v11, v10);
                }
            }
        }

        // Bottom stitch
        if (stitchBottom) {
            const yEdge = segments;
            const yInner = segments - 1;
            for (let x = 0; x <= segments - 1; x += 2) {
                const x0 = x;
                const x2 = Math.min(x + 2, segments);
                const v0 = idx(x0, yEdge);
                const v2 = idx(x2, yEdge);
                const i0 = idx(x0, yInner);
                const i2 = idx(x2, yInner);
                addTri(v0, i2, v2);
                addTri(v0, i0, i2);
            }
        } else {
            if (!stitchTop) {
                for (let x = 0; x < segments; x++) {
                    const v00 = idx(x, segments - 1);
                    const v10 = idx(x + 1, segments - 1);
                    const v01 = idx(x, segments);
                    const v11 = idx(x + 1, segments);
                    addTri(v00, v01, v11);
                    addTri(v00, v11, v10);
                }
            }
        }

        // Left stitch
        if (stitchLeft) {
            const xEdge = 0;
            const xInner = 1;
            for (let y = 0; y <= segments - 1; y += 2) {
                const y0 = y;
                const y2 = Math.min(y + 2, segments);
                const v0 = idx(xEdge, y0);
                const v2 = idx(xEdge, y2);
                const i0 = idx(xInner, y0);
                const i2 = idx(xInner, y2);
                addTri(v0, i0, i2);
                addTri(v0, i2, v2);
            }
        }

        // Right stitch
        if (stitchRight) {
            const xEdge = segments;
            const xInner = segments - 1;
            for (let y = 0; y <= segments - 1; y += 2) {
                const y0 = y;
                const y2 = Math.min(y + 2, segments);
                const v0 = idx(xEdge, y0);
                const v2 = idx(xEdge, y2);
                const i0 = idx(xInner, y0);
                const i2 = idx(xInner, y2);
                addTri(v0, i2, i0);
                addTri(v0, v2, i2);
            }
        }

        return new Uint32Array(indices);
    }

    static _buildSkirt(basePositions, baseNormals, baseUVs, segments, chunkSize, skirtDepth) {
        const baseCount = basePositions.length / 3;
        const edgeCount = (segments + 1) * 4 - 4;

        const newPositions = new Float32Array((baseCount + edgeCount) * 3);
        const newNormals = new Float32Array((baseCount + edgeCount) * 3);
        const newUVs = new Float32Array((baseCount + edgeCount) * 2);

        newPositions.set(basePositions);
        newNormals.set(baseNormals);
        newUVs.set(baseUVs);

        const edgeIndices = [];
        // Top edge (y=0 row)
        for (let x = 0; x <= segments; x++) edgeIndices.push(x);
        // Right edge (x=segments, y=1..segments)
        for (let y = 1; y <= segments; y++) edgeIndices.push(y * (segments + 1) + segments);
        // Bottom edge (y=segments, x=segments-1..0)
        for (let x = segments - 1; x >= 0; x--) edgeIndices.push(segments * (segments + 1) + x);
        // Left edge (x=0, y=segments-1..1)
        for (let y = segments - 1; y >= 1; y--) edgeIndices.push(y * (segments + 1));

        const skirtStart = baseCount;
        const skirtIndices = new Uint32Array(edgeCount * 6);
        let idx = 0;

        for (let i = 0; i < edgeCount; i++) {
            const next = (i + 1) % edgeCount;
            const baseA = edgeIndices[i];
            const baseB = edgeIndices[next];
            const skirtA = skirtStart + i;
            const skirtB = skirtStart + next;

            // Copy vertex data with lowered Y and downward normal
            newPositions[skirtA * 3] = basePositions[baseA * 3];
            newPositions[skirtA * 3 + 1] = basePositions[baseA * 3 + 1] - skirtDepth;
            newPositions[skirtA * 3 + 2] = basePositions[baseA * 3 + 2];

            newNormals[skirtA * 3] = 0;
            newNormals[skirtA * 3 + 1] = -1;
            newNormals[skirtA * 3 + 2] = 0;

            newUVs[skirtA * 2] = baseUVs[baseA * 2];
            newUVs[skirtA * 2 + 1] = baseUVs[baseA * 2 + 1];

            // Triangles linking edge to skirt
            skirtIndices[idx++] = baseA;
            skirtIndices[idx++] = baseB;
            skirtIndices[idx++] = skirtB;

            skirtIndices[idx++] = baseA;
            skirtIndices[idx++] = skirtB;
            skirtIndices[idx++] = skirtA;
        }

        return {
            positions: newPositions,
            normals: newNormals,
            uvs: newUVs,
            indices: skirtIndices
        };
    }

    static _mergeIndices(baseIndices, extraIndices) {
        const merged = new Uint32Array(baseIndices.length + extraIndices.length);
        merged.set(baseIndices, 0);
        merged.set(extraIndices, baseIndices.length);
        return merged;
    }
}
