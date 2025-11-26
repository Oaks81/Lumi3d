import { TERRAIN_NOISE_GLSL } from './terrainNoise.glsl.js';

export const terrainVertexShader = `#version 300 es
precision highp float;

in vec3 position;
in vec2 uv;

out vec2 v_texCoord;

void main() {
    v_texCoord = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const terrainFragmentShader = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) out vec4 o_output;
in vec2 v_texCoord;

uniform ivec2 u_chunkCoord;
uniform int u_chunkSize;
uniform int u_seed;
uniform float u_elevationScale;
uniform float u_heightScale;
uniform float u_worldScale;
uniform int u_outputType;

${TERRAIN_NOISE_GLSL}

void main() {
    vec2 chunkOrigin = vec2(float(u_chunkCoord.x * u_chunkSize),
                            float(u_chunkCoord.y * u_chunkSize));

    if (u_outputType == 0)  {
        // --- HEIGHT MAP ---
        vec2 pixelCoord = floor(v_texCoord * float(u_chunkSize + 1));
        vec2 worldTile = chunkOrigin + pixelCoord;
        float wx = worldTile.x;
        float wy = worldTile.y;

        float h = terrainHeight(wx, wy, u_seed, u_elevationScale, u_heightScale);
        o_output = vec4(h, 0.0, 0.0, 1.0);

    } else if (u_outputType == 1) {
        // --- NORMAL MAP (Fixed) ---
        vec2 pixelCoord = floor(v_texCoord * float(u_chunkSize + 1));
        vec2 worldTile = chunkOrigin + pixelCoord;
        float wx = worldTile.x;
        float wy = worldTile.y;

        // Sample neighboring heights to calculate slope
        float e = 0.1; // Epsilon
        float hL = terrainHeight(wx - e, wy, u_seed, u_elevationScale, u_heightScale);
        float hR = terrainHeight(wx + e, wy, u_seed, u_elevationScale, u_heightScale);
        float hD = terrainHeight(wx, wy - e, u_seed, u_elevationScale, u_heightScale);
        float hU = terrainHeight(wx, wy + e, u_seed, u_elevationScale, u_heightScale);

        // Calculate normal vector from slopes
        // Vector = ( height_Left - height_Right, 2.0 * epsilon, height_Down - height_Up )
        vec3 normal = normalize(vec3(hL - hR, 2.0 * e, hD - hU));

        // Pack normal from [-1, 1] range to [0, 1] range for texture storage
        o_output = vec4(normal * 0.5 + 0.5, 1.0);

    } else if (u_outputType == 2) {
        // --- TILE ID MAP ---
        vec2 pixelCoord = floor(v_texCoord * float(u_chunkSize));
        pixelCoord = clamp(pixelCoord, vec2(0.0), vec2(float(u_chunkSize - 1)));

        vec2 worldTileCenter = chunkOrigin + pixelCoord + vec2(0.5);
        float wx = worldTileCenter.x;
        float wy = worldTileCenter.y;

        float h0 = terrainHeight(wx, wy, u_seed, u_elevationScale, u_heightScale);
        uint t = determineTerrain(h0, wx, wy, u_seed);

        float tileNormalized = float(t) / 255.0;
        o_output = vec4(tileNormalized, 0.0, 0.0, 1.0);

    } else if (u_outputType == 3) {
        // --- BIOME/MACRO MASK ---
        vec2 pixelCoord = floor(v_texCoord * float(u_chunkSize));
        vec2 worldTile = chunkOrigin + pixelCoord;
        float wx = worldTile.x;
        float wy = worldTile.y;

        float m = biomeMask(wx, wy, u_seed);
        o_output = vec4(m, 0.0, 0.0, 1.0);
    } else {
        o_output = vec4(0.0);
    }
}
`;