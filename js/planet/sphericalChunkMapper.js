// js/planet/sphericalChunkMapper.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { CubeSphereCoords } from './cubeSphereCoords.js';
import { PlanetaryChunkAddress } from './planetaryChunkAddress.js';

export class SphericalChunkMapper {
    constructor(planetConfig, chunksPerFace = 16) {
        this.config = planetConfig;
        this.chunksPerFace = chunksPerFace;
        this.origin = planetConfig.origin;
        this.radius = planetConfig.radius;
        this.chunkSize = planetConfig.surfaceChunkSize;
    }

    worldPositionToChunkKey(position) {
        const address = this.worldPositionToChunkAddress(position);
        return address.key;
    }

    worldPositionToChunkAddress(position) {
        const relativePos = position.clone().sub(this.origin);
        
        // This calculates which Cube Face and X,Y coords the position belongs to
        const addressData = CubeSphereCoords.getChunkAddress(
            relativePos,
            this.radius,
            this.chunkSize, // Use actual chunk size in meters
            this.chunksPerFace 
        );
        
        return new PlanetaryChunkAddress(
            addressData.face,
            addressData.chunkX,
            addressData.chunkY,
            0 
        );
    }

    getChunksInRadius(cameraPosition, radius) {
        const centerAddress = this.worldPositionToChunkAddress(cameraPosition);
        const radiusInChunks = Math.ceil(radius / this.chunkSize);
        
        const visited = new Set();
        const results = [];
        const queue = [{ address: centerAddress, distance: 0 }];
        
        visited.add(centerAddress.key);
        results.push(centerAddress.key);
        
        // BFS to find neighbors across cube edges
        let head = 0;
        while (head < queue.length) {
            const current = queue[head++];
            if (current.distance >= radiusInChunks) continue;
            
            const neighbors = current.address.getNeighbors(this.chunksPerFace);
            
            for (const neighbor of neighbors) {
                const key = neighbor.key;
                if (!visited.has(key)) {
                    visited.add(key);
                    results.push(key);
                    queue.push({ address: neighbor, distance: current.distance + 1 });
                }
            }
        }
        return results;
    }

   
    getFaceAndLocalCoords(input) {
        // Handle Vector3 Input (Precise)
        if (input instanceof THREE.Vector3) {
            const relativePos = new THREE.Vector3().subVectors(input, this.origin);
            const { face, u, v } = CubeSphereCoords.worldPositionToFaceUV(relativePos, this.radius);
            
            // Convert -1..1 UV to 0..chunksPerFace
            const globalU = (u + 1) * 0.5 * this.chunksPerFace;
            const globalV = (v + 1) * 0.5 * this.chunksPerFace;
            
            return {
                face: face,
                u: globalU - Math.floor(globalU),
                v: globalV - Math.floor(globalV)
            };
        }
        
        // Handle String Key Input (Approximate center)
        const address = PlanetaryChunkAddress.fromKey(input);
        return {
            face: address.face,
            u: 0.5,
            v: 0.5,
            uMin: address.x / this.chunksPerFace,
            uMax: (address.x + 1) / this.chunksPerFace,
            vMin: address.y / this.chunksPerFace,
            vMax: (address.y + 1) / this.chunksPerFace
        };
    }
}