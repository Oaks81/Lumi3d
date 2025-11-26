export class WorldGeneratorFactory {
    static async create(type, renderer, chunkSize, seed) {
        switch (type) {
            case 'webgl2':
                const { WebGL2WorldGenerator } = await import('./webgl2WorldGenerator.js');
                return new WebGL2WorldGenerator(renderer, chunkSize, seed);
            
            case 'webgpu':
                const { WebGPUWorldGenerator } = await import('./webgpuWorldGenerator.js');
                return new WebGPUWorldGenerator(renderer, chunkSize, seed);
            
            default:
                throw new Error(`Unknown world generator type: ${type}`);
        }
    }

    static async detectBestType() {
        if (navigator.gpu && await navigator.gpu.requestAdapter()) {
            return 'webgpu';
        }
        return 'webgl2';
    }
}
