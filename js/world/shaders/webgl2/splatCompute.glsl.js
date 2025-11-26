
import { TERRAIN_NOISE_GLSL } from './terrainNoise.glsl.js';

export const splatVertexShader = `#version 300 es
precision highp float;

in vec3 position;
in vec2 uv;

out vec2 v_texCoord;

void main() {
    v_texCoord = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const splatFragmentShader = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) out vec4 o_blendWeights;
layout(location = 1) out vec4 o_blendTypes;

in vec2 v_texCoord;

uniform sampler2D u_heightMap;
uniform sampler2D u_tileMap;

uniform ivec2 u_chunkCoord;
uniform int u_chunkSize;
uniform int u_seed;
uniform int u_splatDensity;
uniform int u_kernelSize;

${TERRAIN_NOISE_GLSL}

const uint GRASS = 3u;
const uint STONE = 5u;
const uint ROCK = 7u;
const uint TUNDRA = 8u;

bool validTile(uint t) {
    return (t >= 1u && t <= 8u);
}

void main() {
    vec2 chunkOrigin = vec2(float(u_chunkCoord.x * u_chunkSize),
                            float(u_chunkCoord.y * u_chunkSize));

    float splatRes = float(u_chunkSize * u_splatDensity);
    vec2 splatPixel = v_texCoord * splatRes;
    vec2 tileCoord = splatPixel / float(u_splatDensity);

    int N = max(1, u_kernelSize);
    int halfN = N / 2;

    float weightedCounts[9];
    for (int k = 0; k < 9; k++) {
        weightedCounts[k] = 0.0;
    }

    float totalWeight = 0.0;

    for (int dy = -halfN; dy <= halfN; dy++) {
        for (int dx = -halfN; dx <= halfN; dx++) {
            vec2 sampleTile = tileCoord + vec2(float(dx), float(dy));
            vec2 sampleUV = sampleTile / float(u_chunkSize);
            sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));

            float dist = sqrt(float(dx * dx + dy * dy)) / float(halfN);
            float weight = exp(-2.0 * dist * dist);

            uint t = uint(texture(u_tileMap, sampleUV).r * 255.0 + 0.5);

            if (t < 9u && validTile(t)) {
                weightedCounts[t] += weight;
                totalWeight += weight;
            }
        }
    }

    uint bestTypes[4];
    float bestWeights[4];
    for (int i = 0; i < 4; i++) {
        bestTypes[i] = 0u;
        bestWeights[i] = 0.0;
    }

    for (uint t = 1u; t <= 8u; t++) {
        float w = weightedCounts[t];
        if (w <= 0.0) continue;

        for (int j = 0; j < 4; j++) {
            if (w > bestWeights[j]) {
                for (int k = 3; k > j; k--) {
                    bestWeights[k] = bestWeights[k - 1];
                    bestTypes[k] = bestTypes[k - 1];
                }
                bestWeights[j] = w;
                bestTypes[j] = t;
                break;
            }
        }
    }

    if (bestTypes[0] == 0u) {
        bestTypes[0] = GRASS;
        bestWeights[0] = 1.0;
    }

    vec4 weights = vec4(bestWeights[0], bestWeights[1], bestWeights[2], bestWeights[3]);
    float sum = weights.r + weights.g + weights.b + weights.a;

    if (sum > 0.0) {
        weights /= sum;
    } else {
        weights = vec4(1.0, 0.0, 0.0, 0.0);
    }

    o_blendWeights = weights;
    o_blendTypes = vec4(
        float(bestTypes[0]) / 255.0,
        float(bestTypes[1]) / 255.0,
        float(bestTypes[2]) / 255.0,
        float(bestTypes[3]) / 255.0
    );
}
`;
