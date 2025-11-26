export const terrainVertexShader = `precision highp float;

in vec2 a_position;
out vec2 v_texCoord;

void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const terrainFragmentShader = `precision highp float;
precision highp int;
precision highp sampler2D;

// Output textures
layout(location = 0) out vec4 o_heights;
layout(location = 1) out vec4 o_normals;
layout(location = 2) out uvec4 o_tiles;
layout(location = 3) out vec4 o_macro;

in vec2 v_texCoord;

// Uniforms
uniform ivec2 u_chunkCoord;
uniform int u_chunkSize;
uniform uint u_seed;
uniform float u_elevationScale;
uniform float u_heightScale;
uniform float u_biomeScale;
uniform float u_regionScale;
uniform float u_detailScale;
uniform float u_ridgeScale;
uniform float u_valleyScale;
uniform float u_plateauScale;
uniform float u_worldScale;
uniform int u_outputType;

const uint GRASS = 3u;
const uint SAND = 4u;
const uint STONE = 5u;
const uint FOREST_FLOOR = 6u;
const uint ROCK = 7u;
const uint TUNDRA = 8u;

float hash2D(vec2 p, uint seed) {
    uint h = uint(p.x * 374761393.0) + uint(p.y * 668265263.0);
    h ^= (h >> 13u);
    h += seed * 374761393u;
    h ^= (h >> 17u);
    h *= 668265263u;
    h ^= (h >> 15u);
    float s = sin(float(h) * 0.0001) * 43758.5453;
    return fract(s);
}

float fade(float t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float grad(uint h, float x, float y) {
    uint g = h & 7u;
    float u = (g & 1u) == 0u ? x : y;
    float v = (g & 1u) == 0u ? y : x;
    float uu = (g & 2u) == 0u ? u : -u;
    float vv = (g & 4u) == 0u ? v : -v;
    return uu + vv;
}

float perlin2D(float x, float y) {
    int ix = int(floor(x));
    int iy = int(floor(y));
    float fx = fract(x);
    float fy = fract(y);
    
    float u = fade(fx);
    float v = fade(fy);
    
    uint a = uint(hash2D(vec2(ix, iy), u_seed) * 4294967295.0);
    uint b = uint(hash2D(vec2(ix + 1, iy), u_seed) * 4294967295.0);
    uint c = uint(hash2D(vec2(ix, iy + 1), u_seed) * 4294967295.0);
    uint d = uint(hash2D(vec2(ix + 1, iy + 1), u_seed) * 4294967295.0);
    
    float n0 = grad(a, fx, fy);
    float n1 = grad(b, fx - 1.0, fy);
    float n2 = grad(c, fx, fy - 1.0);
    float n3 = grad(d, fx - 1.0, fy - 1.0);
    
    return mix(mix(n0, n1, u), mix(n2, n3, u), v);
}

float octaveNoise(float x, float y, int octaves) {
    float val = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float maxv = 0.0;
    
    for (int i = 0; i < octaves; i++) {
        val += perlin2D(x * freq, y * freq) * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    
    return maxv == 0.0 ? 0.0 : val / maxv;
}

float ridgedNoise(float x, float y, int octaves) {
    float val = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float maxv = 0.0;
    
    for (int i = 0; i < octaves; i++) {
        float n = 1.0 - abs(perlin2D(x * freq, y * freq));
        val += n * n * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    
    return maxv == 0.0 ? 0.0 : val / maxv;
}

vec2 rotate45(float x, float y) {
    float s = 0.70710678;
    return vec2(x * s - y * s, x * s + y * s);
}

float biomeMacroMask(float wx, float wy) {
    float biomeVal = octaveNoise(wx * 0.004, wy * 0.004, 3);
    return clamp((biomeVal + 1.0) * 0.5, 0.0, 1.0);
}

vec2 warpedWorld(float wx, float wy) {
    float warp0 = octaveNoise(wx * 0.001, wy * 0.001, 2) * 15.0;
    float warp1 = octaveNoise(
        (wx + 39784.0) * 0.001, 
        (wy - 9083.0) * 0.001, 
        2
    ) * 15.0;
    return vec2(wx + warp0, wy + warp1);
}

float roughnessMask(float wx, float wy) {
    float noise = octaveNoise(wx * 0.00007, wy * 0.00007, 2);
    return clamp(0.25 + 0.75 * noise, 0.0, 1.0);
}

float terrainHeight(float wx, float wy) {
    float macroMask = biomeMacroMask(wx, wy);
    float plainsZone = 0.4;
    float mountZone = 0.60;
    float blend = smoothstep(plainsZone, mountZone, macroMask);
    
    float plainsBase = octaveNoise(wx * 0.005, wy * 0.005, 2) * 0.10;
    float plainsDetail = octaveNoise(wx * 0.03, wy * 0.03, 2) * 0.07;
    float plains = clamp(plainsBase + plainsDetail, -1.0, 1.0);
    
    vec2 warped = warpedWorld(wx, wy);
    vec2 rotated = rotate45(warped.x, warped.y);
    
    float regionRoughness = roughnessMask(wx, wy);
    float baseScale = u_elevationScale * mix(1.0, 0.36, regionRoughness);
    float amp = mix(0.8, 1.6, regionRoughness);
    
    float mtBase = octaveNoise(
        rotated.x * baseScale, 
        rotated.y * baseScale, 
        6
    ) * amp;
    float mtRidge = ridgedNoise(rotated.x * 0.004, rotated.y * 0.004, 2);
    float mountainsRaw = mix(mtBase, mtRidge, regionRoughness);
    float mountain = clamp((mountainsRaw + 1.0) * 0.5, 0.0, 1.0);
    
    float elevation = mix(plains, pow(mountain, 1.25), blend);
    float result = elevation * u_heightScale;
    
    if (result > 1000000.0 || result < -1000000.0) {
        return 0.0;
    }
    
    return result;
}

float getHeight(float wx, float wy) {
    float result = terrainHeight(wx, wy);
    if (result != result || result > 1000000.0 || result < -1000000.0) {
        return 0.0;
    }
    return result;
}

float fbm(float x, float y, int octaves, float freq) {
    float val = 0.0;
    float amp = 1.0;
    float maxv = 0.0;
    float f = freq;
    
    for (int i = 0; i < octaves; i++) {
        val += octaveNoise(x * f, y * f, 2) * amp;
        maxv += amp;
        f *= 2.15;
        amp *= 0.53;
    }
    
    return val / maxv;
}

float sigmoid(float val, float ctr, float w) {
    return 1.0 / (1.0 + exp((val - ctr) / w));
}

uint determineTerrain(
    float elevation,
    float moisture,
    float temperature,
    float wx,
    float wy
) {
    float elev_min = 0.0;
    float elev_max = 22.0;
    float t = clamp(
        (elevation - elev_min) / (elev_max - elev_min), 
        0.0, 
        1.0
    );
    
    int chunk = 3;
    float rockmask1 = pow(
        0.5 + 0.5 * fbm(
            wx + 89021.0, 
            wy - 15481.0, 
            chunk, 
            mix(0.004, 0.0015, t)
        ), 
        mix(1.6, 1.05, t)
    );
    float rockmask2 = pow(
        0.5 + 0.5 * fbm(
            wx - 32091.0, 
            wy + 32718.0, 
            chunk, 
            mix(0.025, 0.0035, t)
        ), 
        mix(2.9, 1.22, t)
    );
    float rockmask = clamp(rockmask1 * rockmask2 * 1.34 + 0.03, 0.0, 1.0);
    
    float tundramask1 = pow(
        0.5 + 0.5 * fbm(
            wx - 93011.0, 
            wy + 14618.0, 
            chunk, 
            mix(0.006, 0.0017, t)
        ), 
        mix(1.35, 1.03, t)
    );
    float tundramask2 = pow(
        0.5 + 0.5 * fbm(
            wx + 29565.0, 
            wy + 27721.0, 
            chunk, 
            mix(0.031, 0.0019, t)
        ), 
        mix(2.0, 1.14, t)
    );
    float tundramask = clamp(
        tundramask1 * tundramask2 * 1.20 + 0.06, 
        0.0, 
        1.0
    );
    
    float stonemask = pow(
        0.5 + 0.5 * fbm(
            wx - 22343.0, 
            wy + 5511.0, 
            chunk, 
            mix(0.009, 0.002, t)
        ), 
        mix(2.0, 1.3, t)
    );
    float grassmask = pow(
        0.5 + 0.5 * fbm(wx + 11221.0, wy - 7777.0, chunk, 0.009), 
        1.15
    );
    
    float en_grass = sigmoid(t, 0.19, 0.085);
    float en_stone = sigmoid(
        t + stonemask * 0.13 - tundramask * 0.09, 
        0.43, 
        0.17
    ) - sigmoid(t, 0.74, 0.04);
    float en_tundra = sigmoid(
        t + tundramask * 0.11 - stonemask * 0.071, 
        0.54, 
        0.16
    );
    float en_rock = sigmoid(
        t + rockmask * 0.185 + tundramask * 0.018, 
        0.58, 
        0.12
    );
    
    float wGrass = max(
        0.06, 
        en_grass * grassmask * pow(1.0 - t, 0.30)
    );
    float wStone = max(
        0.012, 
        en_stone * stonemask * mix(1.2, 0.46, t)
    );
    float wRock = max(
        0.0132, 
        en_rock * rockmask * pow(t, 1.10)
    );
    float wTundra = max(
        0.07, 
        en_tundra * tundramask * mix(0.48, 1.13, t)
    );
    
    float total = wGrass + wStone + wRock + wTundra;
    float rand = (octaveNoise(wx * 0.012, wy * 0.0115, 2) + 1.0) * 0.5 * total;
    
    if (rand < wGrass) return GRASS;
    if (rand < wGrass + wStone) return STONE;
    if (rand < wGrass + wStone + wRock) return ROCK;
    return TUNDRA;
}
void main() {
    vec2 chunkOrigin = vec2(float(u_chunkCoord.x * u_chunkSize),
                            float(u_chunkCoord.y * u_chunkSize));
    // vec2 worldTile = chunkOrigin + v_texCoord * float(u_chunkSize);
    
    // ✅ WITH THIS:
    vec2 pixelCoord = floor(v_texCoord * float(u_chunkSize + 1));
    vec2 worldTile = chunkOrigin + pixelCoord;

    if (u_outputType == 0) {
        // Height map
        float h = terrainHeight(worldTile.x, worldTile.y, u_seed);
        o_output = vec4(h, 0.0, 0.0, 1.0);

    } else if (u_outputType == 1) {
        // Normal map
        float eps = 1.0;
        float hL = terrainHeight(worldTile.x - eps, worldTile.y, u_seed);
        float hR = terrainHeight(worldTile.x + eps, worldTile.y, u_seed);
        float hD = terrainHeight(worldTile.x, worldTile.y - eps, u_seed);
        float hU = terrainHeight(worldTile.x, worldTile.y + eps, u_seed);
        vec3 n = normalize(vec3(hL - hR, 2.0, hD - hU));
        o_output = vec4(n, 1.0);

    } else if (u_outputType == 2) {
        // Tile map - keep existing tile center logic
        float txf = v_texCoord.x * float(u_chunkSize);
        float tyf = v_texCoord.y * float(u_chunkSize);
        
        if (txf >= 0.0 && txf < float(u_chunkSize) && tyf >= 0.0 && tyf < float(u_chunkSize)) {
            float tileCenterX = chunkOrigin.x + floor(txf) + 0.5;
            float tileCenterY = chunkOrigin.y + floor(tyf) + 0.5;
            
            float h0 = terrainHeight(tileCenterX, tileCenterY, u_seed);
            uint t = determineTerrain(h0, tileCenterX, tileCenterY, u_seed);
            o_output = vec4(float(t), 0.0, 0.0, 1.0);
        } else {
            o_output = vec4(3.0, 0.0, 0.0, 1.0);
        }

    } else if (u_outputType == 3) {
        // Macro - use worldTile
        float m = biomeMask(worldTile.x, worldTile.y, u_seed);
        o_output = vec4(m, 0.0, 0.0, 1.0);
    } else {
        o_output = vec4(0.0);
    }
}
`;
