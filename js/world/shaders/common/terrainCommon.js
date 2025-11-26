export const SHADER_CONSTANTS = {
    TILE_TYPES: {
        GRASS: 3,
        STONE: 5,
        ROCK: 7,
        TUNDRA: 8
    },
    OUTPUT_TYPES: {
        HEIGHT: 0,
        NORMAL: 1,
        TILE: 2,
        MACRO: 3
    }
};

// WGSL version (for WebGPU)
export const NOISE_FUNCTIONS_WGSL = `
fn hash2d(p: vec2<i32>, seed: i32) -> u32 {
    var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(seed) * 982451653u;
    h ^= (h >> 13u);
    h *= 1274126177u;
    h ^= (h >> 16u);
    return h;
}

fn fade(t: f32) -> f32 { 
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); 
}

fn grad(h: u32, x: f32, y: f32) -> f32 {
    let g = h & 7u;
    let u = select(y, x, g < 4u);
    let v = select(x, y, g < 4u);
    return select(-u, u, (g & 1u) == 0u) + select(-v, v, (g & 2u) == 0u);
}

fn perlin2D(x: f32, y: f32, seed: i32) -> f32 {
    let ix = i32(floor(x));
    let iy = i32(floor(y));
    let fx = x - f32(ix);
    let fy = y - f32(iy);
    let u = fade(fx);
    let v = fade(fy);

    let a = hash2d(vec2<i32>(ix, iy), seed);
    let b = hash2d(vec2<i32>(ix + 1, iy), seed);
    let c = hash2d(vec2<i32>(ix, iy + 1), seed);
    let d = hash2d(vec2<i32>(ix + 1, iy + 1), seed);

    let x1 = mix(grad(a, fx, fy), grad(b, fx - 1.0, fy), u);
    let x2 = mix(grad(c, fx, fy - 1.0), grad(d, fx - 1.0, fy - 1.0), u);
    return mix(x1, x2, v);
}

fn octaveNoise(x: f32, y: f32, oct: i32, seed: i32) -> f32 {
    var val = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var maxv = 0.0;
    
    for (var i = 0; i < 16; i++) {
        if (i >= oct) { break; }
        val += perlin2D(x * freq, y * freq, seed) * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxv;
}

fn ridgedNoise(x: f32, y: f32, oct: i32, seed: i32) -> f32 {
    var val = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var maxv = 0.0;
    
    for (var i = 0; i < 16; i++) {
        if (i >= oct) { break; }
        let n = 1.0 - abs(perlin2D(x * freq, y * freq, seed));
        val += n * n * amp;
        maxv += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return val / maxv;
}

fn biomeMask(wx: f32, wy: f32, seed: i32) -> f32 {
    let b = octaveNoise(wx * 0.004, wy * 0.004, 3, seed);
    return (b + 1.0) * 0.5;
}

fn rotate45(v: vec2<f32>) -> vec2<f32> {
    let s = 0.70710678;
    return vec2<f32>(v.x * s - v.y * s, v.x * s + v.y * s);
}

fn warp(p: vec2<f32>, seed: i32) -> vec2<f32> {
    let w0 = octaveNoise(p.x * 0.001, p.y * 0.001, 2, seed) * 15.0;
    let w1 = octaveNoise((p.x + 39784.0) * 0.001, (p.y - 9083.0) * 0.001, 2, seed) * 15.0;
    return p + vec2<f32>(w0, w1);
}

fn regionRoughness(wx: f32, wy: f32, seed: i32) -> f32 {
    let noise = octaveNoise(wx * 0.00007, wy * 0.00007, 2, seed);
    return clamp(0.25 + 0.75 * noise, 0.0, 1.0);
}

fn terrainHeight(wx: f32, wy: f32, seed: i32, elevationScale: f32, heightScale: f32) -> f32 {
    let macro = biomeMask(wx, wy, seed);
    let plainsZone = 0.4;
    let mountZone = 0.6;
    let blend = smoothstep(plainsZone, mountZone, macro);

    let plainsBase = octaveNoise(wx * 0.005, wy * 0.005, 2, seed) * 0.10;
    let plainsDetail = octaveNoise(wx * 0.03, wy * 0.03, 2, seed) * 0.07;
    let plains = clamp(plainsBase + plainsDetail, -1.0, 1.0);

    let warped = warp(vec2<f32>(wx, wy), seed);
    let rot = rotate45(warped);
    let rough = regionRoughness(wx, wy, seed);

    let baseScale = elevationScale * mix(1.0, 0.36, rough);
    let amp = mix(0.8, 1.6, rough);
    let mtBase = octaveNoise(rot.x * baseScale, rot.y * baseScale, 6, seed) * amp;
    let mtRidge = ridgedNoise(rot.x * 0.004, rot.y * 0.004, 2, seed);
    let mountains = mix(mtBase, mtRidge, rough);
    let elevation = mix(plains, pow((mountains + 1.0) * 0.5, 1.25), blend);

    return elevation * heightScale;
}

fn determineTerrain(h: f32, wx: f32, wy: f32, seed: i32) -> u32 {
    let t = clamp((h - 0.0) / 22.0, 0.0, 1.0);
    let rockmask = pow(0.5 + 0.5 * octaveNoise(wx * 0.009, wy * 0.009, 3, seed), 2.0);
    let tundramask = pow(0.5 + 0.5 * octaveNoise(wx * 0.006, wy * 0.006, 3, seed), 2.0);
    let grassmask = pow(0.5 + 0.5 * octaveNoise(wx * 0.007, wy * 0.007, 3, seed), 1.2);

    let wGrass = (1.0 - t) * grassmask;
    let wRock = t * rockmask;
    let wTundra = t * tundramask;

    if (wGrass > wRock && wGrass > wTundra) { return 3u; }
    if (wRock > wTundra) { return 7u; }
    return 8u;
}
`;

// GLSL version (for WebGL2) - keep as is
export const NOISE_FUNCTIONS_GLSL = `
uint hash2d(ivec2 p, int seed) {
    uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(seed) * 982451653u;
    h ^= (h >> 13u);
    h *= 1274126177u;
    h ^= (h >> 16u);
    return h;
}

float fade(float t) { 
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); 
}

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
}

float terrainHeight(float wx, float wy, int seed, float elevationScale, float heightScale) {
    float macro = biomeMask(wx, wy, seed);
    float plainsZone = 0.4;
    float mountZone = 0.6;
    float blend = smoothstep(plainsZone, mountZone, macro);

    float plainsBase = octaveNoise(wx * 0.005, wy * 0.005, 2, seed) * 0.10;
    float plainsDetail = octaveNoise(wx * 0.03, wy * 0.03, 2, seed) * 0.07;
    float plains = clamp(plainsBase + plainsDetail, -1.0, 1.0);

    vec2 warped = warp(vec2(wx, wy), seed);
    vec2 rot = rotate45(warped);
    float rough = regionRoughness(wx, wy, seed);

    float baseScale = elevationScale * mix(1.0, 0.36, rough);
    float amp = mix(0.8, 1.6, rough);
    float mtBase = octaveNoise(rot.x * baseScale, rot.y * baseScale, 6, seed) * amp;
    float mtRidge = ridgedNoise(rot.x * 0.004, rot.y * 0.004, 2, seed);
    float mountains = mix(mtBase, mtRidge, rough);
    float elevation = mix(plains, pow((mountains + 1.0) * 0.5, 1.25), blend);

    return elevation * heightScale;
}

uint determineTerrain(float h, float wx, float wy, int seed) {
    float t = clamp((h - 0.0) / 22.0, 0.0, 1.0);
    float rockmask = pow(0.5 + 0.5 * octaveNoise(wx * 0.009, wy * 0.009, 3, seed), 2.0);
    float tundramask = pow(0.5 + 0.5 * octaveNoise(wx * 0.006, wy * 0.006, 3, seed), 2.0);
    float grassmask = pow(0.5 + 0.5 * octaveNoise(wx * 0.007, wy * 0.007, 3, seed), 1.2);

    float wGrass = (1.0 - t) * grassmask;
    float wRock = t * rockmask;
    float wTundra = t * tundramask;

    if (wGrass > wRock && wGrass > wTundra) return 3u;
    if (wRock > wTundra) return 7u;
    return 8u;
}
`;

// Build complete shader source for different APIs
export function buildNoiseShaderSource(api) {
    if (api === 'webgl2') {
        return NOISE_FUNCTIONS_GLSL;
    } else if (api === 'webgpu') {
        return NOISE_FUNCTIONS_WGSL;
    }
    
    throw new Error(`Unknown API: ${api}`);
}