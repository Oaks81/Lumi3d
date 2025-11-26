import { buildPlantChunkVertexShader } from '../../../../buildPlantChunkVertexShader.js';
import { buildPlantChunkFragmentShader } from '../../../../buildPlantChunkFragmentShader.js';

// Re-export the imported functions with the original names for backward compatibility
export const buildFragmentShader = buildPlantChunkFragmentShader;
export const buildVertexShader = buildPlantChunkVertexShader;
