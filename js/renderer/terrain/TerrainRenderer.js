import { BaseRenderer } from '../BaseRenderer.js';

export class TerrainRenderer extends BaseRenderer {
    constructor() {
        super();
        console.log('TerrainRenderer initialized (chunk mesh edition)');
    }

    _addHelpers(scene) {
    }

    /**
     * @param {Array} loadedChunks - Each: { terrainMesh, loadedFeatures }
     * @param {*} gameState 
     * @param {THREE.Camera} camera 
     */
      render(loadedChunks, gameState, camera, environmentState) {
    }

    resize(width, height) {
    }

    cleanup() {
    }
}
