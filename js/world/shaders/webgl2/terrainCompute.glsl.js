// js/world/shaders/webgl2/terrainCompute.glsl.js - FIXED with face support

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
uniform int u_face;
uniform int u_textureSize;

${TERRAIN_NOISE_GLSL}

// SPHERICAL: Convert face + UV to sphere point
vec3 getSpherePoint(int face, float u, float v) {
    vec3 cubePos;
    float x = u * 2.0 - 1.0;
    float y = v * 2.0 - 1.0;
    
    if (face == 0) { cubePos = vec3(1.0, y, -x); }       // +X
    else if (face == 1) { cubePos = vec3(-1.0, y, x); }  // -X
    else if (face == 2) { cubePos = vec3(x, 1.0, -y); }  // +Y
    else if (face == 3) { cubePos = vec3(x, -1.0, y); }  // -Y
    else if (face == 4) { cubePos = vec3(x, y, 1.0); }   // +Z
    else { cubePos = vec3(-x, y, -1.0); }                // -Z

    return normalize(cubePos);
}

void main() {
    vec2 pixelCoord = v_texCoord * float(u_textureSize);
    
    // Calculate world position
    float wx, wy;
    
    if (u_face >= 0) {
        // SPHERICAL MODE: Use face + UV to get 3D sphere position
        float totalChunks = 16.0; // chunksPerFace
        float normalizedU = (float(u_chunkCoord.x) + pixelCoord.x / float(u_textureSize)) / totalChunks;
        float normalizedV = (float(u_chunkCoord.y) + pixelCoord.y / float(u_textureSize)) / totalChunks;
        
        vec3 spherePos = getSpherePoint(u_face, normalizedU, normalizedV) * 50000.0;
        
        // Use spherical coordinates for noise sampling (consistent across faces)
        wx = spherePos.x + spherePos.z * 0.5;
        wy = spherePos.y + spherePos.z * 0.5;
    } else {
        // FLAT MODE: Direct world coordinates
        vec2 chunkOrigin = vec2(float(u_chunkCoord.x * u_chunkSize),
                                float(u_chunkCoord.y * u_chunkSize));
        vec2 worldTile = chunkOrigin + pixelCoord;
        wx = worldTile.x;
        wy = worldTile.y;
    }

    if (u_outputType == 0) {
        // --- HEIGHT MAP ---
        float h = terrainHeight(wx, wy, u_seed, u_elevationScale, u_heightScale);
        o_output = vec4(h, 0.0, 0.0, 1.0);

    } else if (u_outputType == 1) {
        // --- NORMAL MAP ---
        float e = 0.1;
        float hL = terrainHeight(wx - e, wy, u_seed, u_elevationScale, u_heightScale);
        float hR = terrainHeight(wx + e, wy, u_seed, u_elevationScale, u_heightScale);
        float hD = terrainHeight(wx, wy - e, u_seed, u_elevationScale, u_heightScale);
        float hU = terrainHeight(wx, wy + e, u_seed, u_elevationScale, u_heightScale);

        vec3 normal = normalize(vec3(hL - hR, 2.0 * e, hD - hU));
        o_output = vec4(normal * 0.5 + 0.5, 1.0);

    } else if (u_outputType == 2) {
        // --- TILE ID MAP ---
        float h0 = terrainHeight(wx, wy, u_seed, u_elevationScale, u_heightScale);
        uint t = determineTerrain(h0, wx, wy, u_seed);

        float tileNormalized = float(t) / 255.0;
        o_output = vec4(tileNormalized, 0.0, 0.0, 1.0);

    } else if (u_outputType == 3) {
        // --- BIOME/MACRO MASK ---
        float m = biomeMask(wx, wy, u_seed);
        o_output = vec4(m, 0.0, 0.0, 1.0);
    } else {
        o_output = vec4(0.0);
    }
}
`;