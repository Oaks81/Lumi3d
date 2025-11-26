export function createTerrainComputeShader() {
    return `
struct Uniforms {
    chunkCoord: vec2<i32>,
    chunkSize: i32,
    seed: i32,
    elevationScale: f32,
    heightScale: f32,
    biomeScale: f32,
    regionScale: f32,
    detailScale: f32,
    ridgeScale: f32,
    valleyScale: f32,
    plateauScale: f32,
    worldScale: f32,
    outputType: i32,
    _padding: i32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba32float, write>;

// ==================== NOISE FUNCTIONS ====================

fn hash2d(p: vec2<i32>, seed: i32) -> u32 {
    var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(seed) * 982451653u;
    h = h ^ (h >> 13u);
    h = h * 1274126177u;
    h = h ^ (h >> 16u);
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

fn octaveNoise(x: f32, y: f32, octaves: i32, seed: i32) -> f32 {
    var value = 0.0;
    var amplitude = 1.0;
    var frequency = 1.0;
    var maxValue = 0.0;

    for (var i = 0; i < 16; i++) {
        if (i >= octaves) { break; }
        value += perlin2D(x * frequency, y * frequency, seed) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value / maxValue;
}

fn ridgedNoise(x: f32, y: f32, octaves: i32, seed: i32) -> f32 {
    var value = 0.0;
    var amplitude = 1.0;
    var frequency = 1.0;
    var maxValue = 0.0;

    for (var i = 0; i < 16; i++) {
        if (i >= octaves) { break; }
        let n = 1.0 - abs(perlin2D(x * frequency, y * frequency, seed));
        value += n * n * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    return value / maxValue;
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
    let biome = biomeMask(wx, wy, seed);
    let plainsZone = 0.4;
    let mountainZone = 0.6;
    let blend = smoothstep(plainsZone, mountainZone, biome);

    // Plains generation
    let plainsBase = octaveNoise(wx * 0.005, wy * 0.005, 2, seed) * 0.10;
    let plainsDetail = octaveNoise(wx * 0.03, wy * 0.03, 2, seed) * 0.07;
    let plains = clamp(plainsBase + plainsDetail, -1.0, 1.0);

    // Mountain generation with domain warping
    let warped = warp(vec2<f32>(wx, wy), seed);
    let rotated = rotate45(warped);
    let roughness = regionRoughness(wx, wy, seed);

    let baseScale = elevationScale * mix(1.0, 0.36, roughness);
    let amplitude = mix(0.8, 1.6, roughness);
    let mountainBase = octaveNoise(rotated.x * baseScale, rotated.y * baseScale, 6, seed) * amplitude;
    let mountainRidge = ridgedNoise(rotated.x * 0.004, rotated.y * 0.004, 2, seed);
    let mountains = mix(mountainBase, mountainRidge, roughness);

    let elevation = mix(plains, pow((mountains + 1.0) * 0.5, 1.25), blend);

    return elevation * heightScale;
}

fn determineTerrain(h: f32, wx: f32, wy: f32, seed: i32) -> u32 {
    let t = clamp((h - 0.0) / 22.0, 0.0, 1.0);
    let rockMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.009, wy * 0.009, 3, seed), 2.0);
    let tundraMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.006, wy * 0.006, 3, seed), 2.0);
    let grassMask = pow(0.5 + 0.5 * octaveNoise(wx * 0.007, wy * 0.007, 3, seed), 1.2);

    let wGrass = (1.0 - t) * grassMask;
    let wRock = t * rockMask;
    let wTundra = t * tundraMask;

    if (wGrass > wRock && wGrass > wTundra) { return 3u; } // GRASS
    if (wRock > wTundra) { return 7u; } // ROCK
    return 8u; // TUNDRA
}

// ==================== MAIN COMPUTE SHADER ====================

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let texSize = textureDimensions(outputTexture);
    
    if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
        return;
    }

    let pixelCoord = vec2<f32>(f32(global_id.x), f32(global_id.y));
    let chunkOrigin = vec2<f32>(
        f32(uniforms.chunkCoord.x * uniforms.chunkSize),
        f32(uniforms.chunkCoord.y * uniforms.chunkSize)
    );

    var output = vec4<f32>(0.0, 0.0, 0.0, 1.0);

    if (uniforms.outputType == 0) {
        // HEIGHT MAP
        let worldTile = chunkOrigin + pixelCoord;
        let wx = worldTile.x;
        let wy = worldTile.y;

        let h = terrainHeight(wx, wy, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);
        output = vec4<f32>(h, 0.0, 0.0, 1.0);

    } else if (uniforms.outputType == 1) {
        // NORMAL MAP
        let worldTile = chunkOrigin + pixelCoord;
        let wx = worldTile.x;
        let wy = worldTile.y;

        let e = 0.1;
        let hL = terrainHeight(wx - e, wy, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);
        let hR = terrainHeight(wx + e, wy, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);
        let hD = terrainHeight(wx, wy - e, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);
        let hU = terrainHeight(wx, wy + e, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);

        let normal = normalize(vec3<f32>(hL - hR, 2.0 * e, hD - hU));
        output = vec4<f32>(normal * 0.5 + 0.5, 1.0);

    } else if (uniforms.outputType == 2) {
        // TILE ID MAP
        let tileSize = f32(uniforms.chunkSize);
        let clampedCoord = clamp(pixelCoord, vec2<f32>(0.0), vec2<f32>(tileSize - 1.0));
        let worldTileCenter = chunkOrigin + clampedCoord + vec2<f32>(0.5);
        let wx = worldTileCenter.x;
        let wy = worldTileCenter.y;

        let h0 = terrainHeight(wx, wy, uniforms.seed, uniforms.elevationScale, uniforms.heightScale);
        let t = determineTerrain(h0, wx, wy, uniforms.seed);

        let tileNormalized = f32(t) / 255.0;
        output = vec4<f32>(tileNormalized, 0.0, 0.0, 1.0);

    } else if (uniforms.outputType == 3) {
        // BIOME/MACRO MASK
        let worldTile = chunkOrigin + pixelCoord;
        let wx = worldTile.x;
        let wy = worldTile.y;

        let m = biomeMask(wx, wy, uniforms.seed);
        output = vec4<f32>(m, 0.0, 0.0, 1.0);
    }

    textureStore(outputTexture, vec2<i32>(global_id.xy), output);
}
`;
}