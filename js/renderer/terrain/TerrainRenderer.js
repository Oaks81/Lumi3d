import { BaseRenderer } from '../BaseRenderer.js';

export class TerrainRenderer extends BaseRenderer {
    constructor() {
        super();
        console.log('TerrainRenderer initialized (chunk mesh edition)');
    }

    _addHelpers(scene) {
        // Optional: lights, debugging helpers, etc.
    }

    /**
     * @param {Array} loadedChunks - Each: { terrainMesh, loadedFeatures }
     * @param {*} gameState 
     * @param {THREE.Camera} camera 
     */
      render(loadedChunks, gameState, camera, environmentState) {
        // Fix 1: Correct the condition check (was using bitwise & instead of &&)
     /*   if (environmentState && environmentState.gameTime) {
            for (const { terrainMesh } of loadedChunks) {
                if (!terrainMesh) continue;
                const material = terrainMesh.material;
                
                // Fix 2: Update ALL environmental uniforms, not just seasonal ones
                if (material.updateEnvironmentalUniforms) {
                    material.updateEnvironmentalUniforms();
                }
                
                // Fix 3: Also update seasonal uniforms explicitly
                if (material.uniforms) {
                    const seasonInfo = environmentState.gameTime.getSeasonInfo();
                    if (material.uniforms.currentSeason)
                        material.uniforms.currentSeason.value = seasonInfo.currentSeason;
                    if (material.uniforms.nextSeason)
                        material.uniforms.nextSeason.value = seasonInfo.nextSeason;
                    if (material.uniforms.seasonTransition)
                        material.uniforms.seasonTransition.value = seasonInfo.transitionProgress;
                    
                    material.needsUpdate = true;
                }
            }
        }**/
    }

    resize(width, height) {
        // Optional—handle viewport-dependent things, like shadow maps or fog distance
    }

    cleanup() {
        // Remove any helpers or lights you added in _addHelpers, if any
    }
}
