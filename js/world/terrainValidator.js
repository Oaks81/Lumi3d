export class TerrainValidator {
    constructor(webgl2Generator, webgpuGenerator) {
        this.webgl2 = webgl2Generator;
        this.webgpu = webgpuGenerator;
    }

    async validateChunk(chunkX, chunkY, tolerance = 0.001) {
        console.log(`🔍 Validating chunk ${chunkX},${chunkY}...`);
        console.log("a", this.webgl2, this.webgpu);
        // Generate using WebGL2
        const gl2ChunkData = { tiles: null, heights: null };
        await this.webgl2.generateTerrain(gl2ChunkData, chunkX, chunkY);
        
        // Generate using WebGPU  
        const gpuChunkData = { tiles: null, heights: null };
        await this.webgpu.generateTerrain(gpuChunkData, chunkX, chunkY);
        
        // Compare heights
        const heightErrors = [];
        const size = this.webgl2.chunkSize + 1;
        
        for (let i = 0; i < size * size; i++) {
            const diff = Math.abs(gl2ChunkData.heights[i] - gpuChunkData.heights[i]);
            if (diff > tolerance) {
                const x = i % size;
                const y = Math.floor(i / size);
                heightErrors.push({ x, y, gl2: gl2ChunkData.heights[i], gpu: gpuChunkData.heights[i], diff });
            }
        }
        
        // Compare tiles
        const tileErrors = [];
        const tileSize = this.webgl2.chunkSize;
        
        for (let i = 0; i < tileSize * tileSize; i++) {
            if (gl2ChunkData.tiles[i] !== gpuChunkData.tiles[i]) {
                const x = i % tileSize;
                const y = Math.floor(i / tileSize);
                tileErrors.push({ x, y, gl2: gl2ChunkData.tiles[i], gpu: gpuChunkData.tiles[i] });
            }
        }
        
        // Report results
        if (heightErrors.length === 0 && tileErrors.length === 0) {
            console.log(`✅ Chunk ${chunkX},${chunkY} validated successfully!`);
            return true;
        } else {
            console.error(`❌ Chunk ${chunkX},${chunkY} validation failed!`);
            console.error(`   Height errors: ${heightErrors.length}`);
            if (heightErrors.length > 0 && heightErrors.length <= 10) {
                heightErrors.forEach(e => {
                    console.error(`     (${e.x},${e.y}): GL2=${e.gl2.toFixed(4)} GPU=${e.gpu.toFixed(4)} diff=${e.diff.toFixed(6)}`);
                });
            }
            console.error(`   Tile errors: ${tileErrors.length}`);
            if (tileErrors.length > 0 && tileErrors.length <= 10) {
                tileErrors.forEach(e => {
                    console.error(`     (${e.x},${e.y}): GL2=${e.gl2} GPU=${e.gpu}`);
                });
            }
            return false;
        }
    }

    async validateMultipleChunks(count = 9) {
        const results = [];
        for (let y = 0; y < Math.sqrt(count); y++) {
            for (let x = 0; x < Math.sqrt(count); x++) {
                const valid = await this.validateChunk(x, y);
                results.push({ x, y, valid });
            }
        }
        
        const passed = results.filter(r => r.valid).length;
        console.log(`\n📊 Validation complete: ${passed}/${results.length} chunks passed`);
        return passed === results.length;
    }
}