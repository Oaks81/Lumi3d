export const TERRAIN_NOISE_GLSL = `
// Hash function for procedural generation
uint hash2d(ivec2 p, int seed) {
    uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(seed) * 982451653u;
    h ^= (h >> 13u);
    h *= 1274126177u;
    h ^= (h >> 16u);
    return h;
}

// Fade function for smooth interpolation
float fade(float t) { 
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); 
}

// Gradient function for Perlin noise
float grad(uint h, float x, float y) {
    uint g = h & 7u;
    float u = (g < 4u) ? x : y;
    float v = (g < 4u) ? y : x;
    return ((g & 1u) == 0u ? u : -u) + ((g & 2u) == 0u ? v : -v);
}

// 2D Perlin noise
float perlin2D(float x, float y, int seed) {
    int ix = int(floor(x));
    int iy = int(floor(y));
    float fx = x - float(ix);
    float fy = y - float(iy);
    float u = fade(fx);
    float v = fade(fy);

    uint a = hash2d(ivec2(ix, iy), seed);
    uint b = hash2d(ivec2(ix + 1, iy), seed);
    uint c = hash2d(ivec2(ix, iy + 1), seed);
    uint d = hash2d(ivec2(ix + 1, iy + 1), seed);

    float x1 = mix(grad(a, fx, fy), grad(b, fx - 1.0, fy), u);
    float x2 = mix(grad(c, fx, fy - 1.0), grad(d, fx - 1.0, fy - 1.0), u);
    return mix(x1, x2, v);
}

// Octave noise (fractal Brownian motion)
float octaveNoise(float x, float y, int octaves, int seed) {
    float value = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    float maxValue = 0.0;
    
    for (int i = 0; i < 16; i++) {
        if (i >= octaves) break;
        value += perlin2D(x * frequency, y * frequency, seed) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    
    return value / maxValue;
}

// Ridged noise for mountain features
float ridgedNoise(float x, float y, int octaves, int seed) {
    float value = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    float maxValue = 0.0;
    
    for (int i = 0; i < 16; i++) {
        if (i >= octaves) break;
        float n = 1.0 - abs(perlin2D(x * frequency, y * frequency, seed));
        value += n * n * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    
    return value / maxValue;
}

// Biome mask for terrain blending
float biomeMask(float wx, float wy, int seed) {
    float b = octaveNoise(wx * 0.004, wy * 0.004, 3, seed);
    return (b + 1.0) * 0.5;
}

// 45-degree rotation helper
vec2 rotate45(vec2 v) {
    float s = 0.70710678;
    return vec2(v.x * s - v.y * s, v.x * s + v.y * s);
}

// Domain warping for natural-looking terrain
vec2 warp(vec2 p, int seed) {
    float w0 = octaveNoise(p.x * 0.001, p.y * 0.001, 2, seed) * 15.0;
    float w1 = octaveNoise((p.x + 39784.0) * 0.001, (p.y - 9083.0) * 0.001, 2, seed) * 15.0;
    return p + vec2(w0, w1);
}

// Regional roughness for terrain variation
float regionRoughness(float wx, float wy, int seed) {
    float noise = octaveNoise(wx * 0.00007, wy * 0.00007, 2, seed);
    return clamp(0.25 + 0.75 * noise, 0.0, 1.0);
}

// Main terrain height function
float terrainHeight(float wx, float wy, int seed, float elevationScale, float heightScale) {
    float biome = biomeMask(wx, wy, seed);
    float plainsZone = 0.4;
    float mountainZone = 0.6;
    float blend = smoothstep(plainsZone, mountainZone, biome);

    // Plains generation
    float plainsBase = octaveNoise(wx * 0.005, wy * 0.005, 2, seed) * 0.10;
    float plainsDetail = octaveNoise(wx * 0.03, wy * 0.03, 2, seed) * 0.07;
    float plains = clamp(plainsBase + plainsDetail, -1.0, 1.0);

    // Mountain generation with domain warping
    vec2 warped = warp(vec2(wx, wy), seed);
    vec2 rotated = rotate45(warped);
    float roughness = regionRoughness(wx, wy, seed);

    float baseScale = elevationScale * mix(1.0, 0.36, roughness);
    float amplitude = mix(0.8, 1.6, roughness);
    float mountainBase = octaveNoise(rotated.x * baseScale, rotated.y * baseScale, 6, seed) * amplitude;
    float mountainRidge = ridgedNoise(rotated.x * 0.004, rotated.y * 0.004, 2, seed);
    float mountains = mix(mountainBase, mountainRidge, roughness);
    
    float elevation = mix(plains, pow((mountains + 1.0) * 0.5, 1.25), blend);

    return elevation * heightScale;
}

// Determine tile type based on height and noise
uint determineTerrain(float h, float wx, float wy, int seed) {
    float t = clamp((h - 0.0) / 22.0, 0.0, 1.0);
    float rockMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.009, wy * 0.009, 3, seed), 2.0);
    float tundraMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.006, wy * 0.006, 3, seed), 2.0);
    float grassMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.007, wy * 0.007, 3, seed), 1.2);

    float wGrass = (1.0 - t) * grassMask;
    float wRock = t * rockMask;
    float wTundra = t * tundraMask;

    if (wGrass > wRock && wGrass > wTundra) return 3u; // GRASS
    if (wRock > wTundra) return 7u; // ROCK
    return 8u; // TUNDRA
}
`;