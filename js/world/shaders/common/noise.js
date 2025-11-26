export const NOISE_COMMON = `uint hash2d(ivec2 p, int seed) {
    uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(seed) * 982451653u;
    h ^= (h >> 13u);
    h *= 1274126177u;
    h ^= (h >> 16u);
    return h;
}

float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float grad(uint h, float x, float y) {
    uint g = h & 7u;
    float u = (g < 4u) ? x : y;
    float v = (g < 4u) ? y : x;
    return ((g & 1u) == 0u ? u : -u) + ((g & 2u) == 0u ? v : -v);
}

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

float octaveNoise(float x, float y, int oct, int seed) {
    float val = 0.0, amp = 1.0, freq = 1.0, maxv = 0.0;
    for (int i = 0; i < 16; i++) {
        if (i >= oct) break;
        val += perlin2D(x * freq, y * freq, seed) * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxv;
}

float ridgedNoise(float x, float y, int oct, int seed) {
    float val = 0.0, amp = 1.0, freq = 1.0, maxv = 0.0;
    for (int i = 0; i < 16; i++) {
        if (i >= oct) break;
        float n = 1.0 - abs(perlin2D(x * freq, y * freq, seed));
        val += n * n * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxv;
}

float biomeMask(float wx, float wy, int seed) {
    float b = octaveNoise(wx * 0.004, wy * 0.004, 3, seed);
    return (b + 1.0) * 0.5;
}

vec2 rotate45(vec2 v) {
    float s = 0.70710678;
    return vec2(v.x * s - v.y * s, v.x * s + v.y * s);
}

vec2 warp(vec2 p, int seed) {
    float w0 = octaveNoise(p.x * 0.001, p.y * 0.001, 2, seed) * 15.0;
    float w1 = octaveNoise((p.x + 39784.0) * 0.001, (p.y - 9083.0) * 0.001, 2, seed) * 15.0;
    return p + vec2(w0, w1);
}

float regionRoughness(float wx, float wy, int seed) {
    float noise = octaveNoise(wx * 0.00007, wy * 0.00007, 2, seed);
    return clamp(0.25 + 0.75 * noise, 0.0, 1.0);
}`;