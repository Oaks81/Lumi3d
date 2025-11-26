// js/planet/PlanetaryChunkAddress.js
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
    
    equals(other) {
        return this.face === other.face && 
               this.x === other.x && 
               this.y === other.y && 
               this.lod === other.lod;
    }
    
    getNeighbors(chunksPerFace) {
        const neighbors = [];
        const directions = [
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 }
        ];
        
        for (const { dx, dy } of directions) {
            const nx = this.x + dx;
            const ny = this.y + dy;
            
            if (nx >= 0 && nx < chunksPerFace && ny >= 0 && ny < chunksPerFace) {
                neighbors.push(new PlanetaryChunkAddress(this.face, nx, ny, this.lod));
            } else {
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
        const faceTransitions = {
            [CubeSphereFace.POSITIVE_X]: {
                left: { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [0, y] },
                up: { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [max, max - x] },
                down: { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [max, x] }
            },
            [CubeSphereFace.NEGATIVE_X]: {
                left: { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [0, y] },
                up: { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [0, x] },
                down: { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [0, max - x] }
            },
            [CubeSphereFace.POSITIVE_Y]: {
                left: { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [y, 0] },
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [max - y, 0] },
                up: { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max - x, 0] },
                down: { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [x, 0] }
            },
            [CubeSphereFace.NEGATIVE_Y]: {
                left: { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [max - y, max] },
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [y, max] },
                up: { face: CubeSphereFace.POSITIVE_Z, transform: (x, y) => [x, max] },
                down: { face: CubeSphereFace.NEGATIVE_Z, transform: (x, y) => [max - x, max] }
            },
            [CubeSphereFace.POSITIVE_Z]: {
                left: { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [0, y] },
                up: { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [x, max] },
                down: { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [x, 0] }
            },
            [CubeSphereFace.NEGATIVE_Z]: {
                left: { face: CubeSphereFace.POSITIVE_X, transform: (x, y) => [max, y] },
                right: { face: CubeSphereFace.NEGATIVE_X, transform: (x, y) => [0, y] },
                up: { face: CubeSphereFace.POSITIVE_Y, transform: (x, y) => [max - x, 0] },
                down: { face: CubeSphereFace.NEGATIVE_Y, transform: (x, y) => [max - x, max] }
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
        
        const clampedX = Math.max(0, Math.min(max, x));
        const clampedY = Math.max(0, Math.min(max, y));
        const [newX, newY] = transition.transform(clampedX, clampedY);
        
        return new PlanetaryChunkAddress(transition.face, newX, newY, this.lod);
    }
    
    getParent() {
        if (this.lod <= 0) return null;
        return new PlanetaryChunkAddress(
            this.face,
            Math.floor(this.x / 2),
            Math.floor(this.y / 2),
            this.lod - 1
        );
    }
    
    getChildren() {
        const baseX = this.x * 2;
        const baseY = this.y * 2;
        const childLod = this.lod + 1;
        
        return [
            new PlanetaryChunkAddress(this.face, baseX, baseY, childLod),
            new PlanetaryChunkAddress(this.face, baseX + 1, baseY, childLod),
            new PlanetaryChunkAddress(this.face, baseX, baseY + 1, childLod),
            new PlanetaryChunkAddress(this.face, baseX + 1, baseY + 1, childLod)
        ];
    }
    
    toString() {
        return `Chunk[${getFaceName(this.face)} (${this.x},${this.y}) LOD${this.lod}]`;
    }
}