export function createSplatComputeShader() {
    return `
struct Uniforms {
    chunkCoord: vec2<i32>,
    chunkSize: i32,
    seed: i32,
    splatDensity: i32,
    kernelSize: i32,
    _padding: vec2<i32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heightMap: texture_2d<f32>;
@group(0) @binding(2) var tileMap: texture_2d<f32>;
@group(0) @binding(3) var splatDataTexture: texture_storage_2d<rgba32float, write>;

const GRASS: u32 = 3u;
const STONE: u32 = 5u;
const ROCK: u32 = 7u;
const TUNDRA: u32 = 8u;

fn validTile(t: u32) -> bool {
    return (t >= 1u && t <= 8u);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let texSize = textureDimensions(splatDataTexture);
    
    if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
        return;
    }

    let splatRes = f32(uniforms.chunkSize * uniforms.splatDensity);
    let texCoord = vec2<f32>(f32(global_id.x), f32(global_id.y)) / splatRes;
    let splatPixel = texCoord * splatRes;
    let tileCoord = splatPixel / f32(uniforms.splatDensity);

    let N = max(1, uniforms.kernelSize);
    let halfN = N / 2;

    // Weighted counts for each tile type (0-8)
    var weightedCounts: array<f32, 9>;
    for (var k = 0; k < 9; k++) {
        weightedCounts[k] = 0.0;
    }

    var totalWeight = 0.0;
    let tileMapSize = textureDimensions(tileMap);

    for (var dy = -halfN; dy <= halfN; dy++) {
        for (var dx = -halfN; dx <= halfN; dx++) {
            let sampleTile = tileCoord + vec2<f32>(f32(dx), f32(dy));
            var sampleUV = sampleTile / f32(uniforms.chunkSize);
            sampleUV = clamp(sampleUV, vec2<f32>(0.0), vec2<f32>(1.0));

            let dist = sqrt(f32(dx * dx + dy * dy)) / f32(halfN);
            let weight = exp(-2.0 * dist * dist);

            let sampleCoord = vec2<i32>(
                i32(sampleUV.x * f32(tileMapSize.x)),
                i32(sampleUV.y * f32(tileMapSize.y))
            );
            let clampedCoord = clamp(sampleCoord, vec2<i32>(0), vec2<i32>(tileMapSize) - vec2<i32>(1));
            
            let tileSample = textureLoad(tileMap, clampedCoord, 0);
            let t = u32(tileSample.r * 255.0 + 0.5);

            if (t < 9u && validTile(t)) {
                weightedCounts[t] += weight;
                totalWeight += weight;
            }
        }
    }

    // Find top 2 tile types (reduced from 4)
    var bestType0: u32 = 0u;
    var bestWeight0: f32 = 0.0;
    var bestType1: u32 = 0u;
    var bestWeight1: f32 = 0.0;

    for (var t = 1u; t <= 8u; t++) {
        let w = weightedCounts[t];
        if (w <= 0.0) { continue; }

        if (w > bestWeight0) {
            bestWeight1 = bestWeight0;
            bestType1 = bestType0;
            bestWeight0 = w;
            bestType0 = t;
        } else if (w > bestWeight1) {
            bestWeight1 = w;
            bestType1 = t;
        }
    }

    // Default to grass if nothing found
    if (bestType0 == 0u) {
        bestType0 = GRASS;
        bestWeight0 = 1.0;
    }

    // Normalize weights to sum to 1.0
    let sum = bestWeight0 + bestWeight1;
    var w0 = 1.0;
    var w1 = 0.0;
    if (sum > 0.0) {
        w0 = bestWeight0 / sum;
        w1 = bestWeight1 / sum;
    }

    // Pack into single RGBA texture:
    // R = weight0
    // G = type0 / 255
    // B = weight1
    // A = type1 / 255
    let packedData = vec4<f32>(
        w0,
        f32(bestType0) / 255.0,
        w1,
        f32(bestType1) / 255.0
    );

    textureStore(splatDataTexture, vec2<i32>(global_id.xy), packedData);
}
`;
}