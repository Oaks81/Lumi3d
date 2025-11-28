import { CubeSphereFace, getFaceName } from './cubeSphereFace.js';

export class PlanetaryChunkAddress {
    constructor(face, x, y, lod = 0) {
        this.face = face;
        this.x = x;
        this.y = y;
        this.lod = lod;
    }
    
    get key() {
        return `${this.face}:${this.x},${this.y}:${this.lod}`;
    }
    
    static fromKey(key) {
        const parts = key.split(':');
        const face = parseInt(parts[0]);
        const [x, y] = parts[1].split(',').map(Number);
        const lod = parseInt(parts[2]);
        return new PlanetaryChunkAddress(face, x, y, lod);
    }
    
    getNeighbors(chunksPerFace) {
        const neighbors = [];
        const directions = [
            { dx: -1, dy: 0 }, // Left
            { dx: 1, dy: 0 },  // Right
            { dx: 0, dy: -1 }, // Down
            { dx: 0, dy: 1 }   // Up
        ];
        
        for (const { dx, dy } of directions) {
            const nx = this.x + dx;
            const ny = this.y + dy;
            
            if (nx >= 0 && nx < chunksPerFace && ny >= 0 && ny < chunksPerFace) {
                // Standard neighbor on same face
                neighbors.push(new PlanetaryChunkAddress(this.face, nx, ny, this.lod));
            } else {
                // Edge crossing - wrap to neighbor face
                const wrapped = this._wrapToAdjacentFace(nx, ny, chunksPerFace);
                if (wrapped) {
                    neighbors.push(wrapped);
                }
            }
        }
        return neighbors;
    }
    
    _wrapToAdjacentFace(x, y, chunksPerFace) {
        const max = chunksPerFace - 1;
        
        // Definitions based on Standard Cube Map UV winding
        // 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
        const faceTransitions = {
            [CubeSphereFace.POSITIVE_X]: { // Right Face
                left:  { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [0, y] },
                up:    { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [max, max - x] }, // Rotated
                down:  { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [max, x] }        // Rotated
            },
            [CubeSphereFace.NEGATIVE_X]: { // Left Face
                left:  { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [0, y] },
                up:    { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [0, x] },         // Rotated
                down:  { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [0, max - x] }    // Rotated
            },
            [CubeSphereFace.POSITIVE_Y]: { // Top Face
                left:  { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [y, 0] },         // Rotated
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [max - y, max] }, // Rotated
                up:    { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max - x, 0] },   // Rotated
                down:  { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [x, max] }
            },
            [CubeSphereFace.NEGATIVE_Y]: { // Bottom Face
                left:  { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [max - y, max] }, // Rotated
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [y, 0] },         // Rotated
                up:    { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [x, 0] },
                down:  { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max - x, max] }  // Rotated
            },
            [CubeSphereFace.POSITIVE_Z]: { // Front Face
                left:  { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [0, y] },
                up:    { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [x, 0] },
                down:  { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [x, max] }
            },
            [CubeSphereFace.NEGATIVE_Z]: { // Back Face
                left:  { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [0, y] },
                up:    { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [max - x, 0] },   // Rotated
                down:  { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [max - x, max] }  // Rotated
            }
        };
        
        let direction = null;
        if (x < 0) direction = 'left';
        else if (x >= chunksPerFace) direction = 'right';
        else if (y < 0) direction = 'down';
        else if (y >= chunksPerFace) direction = 'up';
        
        if (!direction) return null;
        
        const transition = faceTransitions[this.face]?.[direction];
        if (!transition) return null;
        
        // Clamp for safety before transforming
        const cx = Math.max(0, Math.min(max, x));
        const cy = Math.max(0, Math.min(max, y));
        
        const [nx, ny] = transition.transform(cx, cy);
        return new PlanetaryChunkAddress(transition.face, nx, ny, this.lod);
    }
}