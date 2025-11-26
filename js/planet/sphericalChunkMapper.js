// js/planet/sphericalChunkMapper.js

import { CubeSphereCoords } from './cubeSphereCoords.js';
import { PlanetaryChunkAddress } from './PlanetaryChunkAddress.js';

export class SphericalChunkMapper {
    constructor(planetConfig, chunksPerFace = 16) {
        this.config = planetConfig;
        this.chunksPerFace = chunksPerFace;
    }
    
    /**
     * ✅ NEW: Get PlanetaryChunkAddress from world position
     * Returns full address including face
     */
    worldPositionToChunkAddress(position) {
        const relativePos = position.clone().sub(this.config.origin);
        const address = CubeSphereCoords.getChunkAddress(
            relativePos,
            this.config.radius,
            this.config.surfaceChunkSize,
            this.chunksPerFace
        );
        
        return new PlanetaryChunkAddress(
            address.face,
            address.chunkX,
            address.chunkY,
            0  // LOD 0 for now
        );
    }
    
    /**
     * ✅ MODIFIED: Get chunk keys with face information
     * Returns keys like "0:5,3:0" (face:x,y:lod)
     */
    getChunksInRadius(cameraPosition, radius) {
        const relativePos = cameraPosition.clone().sub(this.config.origin);
        const distance = relativePos.length();
        
        const minDistance = this.config.radius * 0.5;
        if (distance < minDistance) {
            console.warn(`⚠️ Camera too far inside planet`);
            return [];
        }
        
        const centerAddress = this.worldPositionToChunkAddress(cameraPosition);
        
        const chunks = [];
        const chunkRadius = Math.ceil(radius / this.config.surfaceChunkSize) + 1;
        
        // Load chunks on same face
        for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
            for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
                const x = centerAddress.x + dx;
                const y = centerAddress.y + dy;
                
                // Bounds check
                if (x < 0 || x >= this.chunksPerFace || 
                    y < 0 || y >= this.chunksPerFace) {
                    continue;
                }
                
                const address = new PlanetaryChunkAddress(
                    centerAddress.face,
                    x,
                    y,
                    0
                );
                
                chunks.push(address.key);  // ✅ Returns "face:x,y:lod"
            }
        }
        
        return chunks;
    }
    

    getChunkWorldCenter(chunkKey) {
        const address = PlanetaryChunkAddress.fromKey(chunkKey);
        
        const bounds = CubeSphereCoords.getChunkWorldBounds(
            address.face,
            address.x,
            address.y,
            this.chunksPerFace,
            this.config.radius
        );
        
        return bounds.center.add(this.config.origin);
    }

    getFaceAndLocalCoords(chunkKey) {
        const address = PlanetaryChunkAddress.fromKey(chunkKey);
        
        const uMin = (address.x / this.chunksPerFace);
        const uMax = ((address.x + 1) / this.chunksPerFace);
        const vMin = (address.y / this.chunksPerFace);
        const vMax = ((address.y + 1) / this.chunksPerFace);
        
        return {
            face: address.face,
            u: (uMin + uMax) * 0.5,
            v: (vMin + vMax) * 0.5,
            uMin, uMax, vMin, vMax
        };
    }
}