import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
export function simpleMergeGeometries(geometries) {
    // Assume all geometries have the same attributes/layout
    let totalVertices = 0;
    let totalIndices = 0;
    const attrNames = Object.keys(geometries[0].attributes);

    // First, count up totals
    for (const g of geometries) {
        totalVertices += g.attributes.position.count;
        if (g.index) totalIndices += g.index.count;
        else totalIndices += g.attributes.position.count;
    }

    // Create big attribute arrays
    const attrArrays = {};
    for (const name of attrNames) {
        const itemSize = geometries[0].attributes[name].itemSize;
        attrArrays[name] = new Float32Array(totalVertices * itemSize);
    }
    const indexArray = new Uint32Array(totalIndices);

    // Fill them
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const g of geometries) {
        const curVerts = g.attributes.position.count;
        // Copy attribute data
        for (const name of attrNames) {
            const itemSize = g.attributes[name].itemSize;
            attrArrays[name].set(g.attributes[name].array, vertexOffset * itemSize);
        }
        // Copy index data
        if (g.index) {
            for (let i = 0; i < g.index.count; ++i) {
                indexArray[indexOffset + i] = g.index.array[i] + vertexOffset;
            }
            indexOffset += g.index.count;
        } else {
            // No index: i = 0...curVerts, offset by vertexOffset
            for (let i = 0; i < curVerts; ++i) {
                indexArray[indexOffset + i] = vertexOffset + i;
            }
            indexOffset += curVerts;
        }
        vertexOffset += curVerts;
    }

    // Build merged geometry
    const merged = new THREE.BufferGeometry();
    for (const name of attrNames) {
        merged.setAttribute(name, new THREE.BufferAttribute(attrArrays[name], geometries[0].attributes[name].itemSize));
    }
    merged.setIndex(new THREE.BufferAttribute(indexArray, 1));
    return merged;
}

export function bendGeometry(geometry, bendAngle) {
    const simplex = new SimplexNoise();
    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;
    const tempPos = new THREE.Vector3();
    const tempNorm = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        tempPos.fromBufferAttribute(pos, i);
        tempNorm.fromBufferAttribute(norm, i);

        let n = simplex.noise3D(tempPos.x * freq, tempPos.y * freq, tempPos.z * freq);
        tempPos.addScaledVector(tempNorm, n * strength);

        pos.setXYZ(i, tempPos.x, tempPos.y, tempPos.z);
    }
}