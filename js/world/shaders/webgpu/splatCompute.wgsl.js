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

    // Determine which chunk this texel belongs to (supports atlas textures)
    let perChunkDim = uniforms.chunkSize * uniforms.splatDensity;
    let chunkIdx = vec2<i32>(global_id.xy) / perChunkDim;
    let localSplatPixel = vec2<f32>(vec2<i32>(global_id.xy) - chunkIdx * perChunkDim);
    let tileCoord = localSplatPixel / f32(uniforms.splatDensity);
    let tileMapSize = textureDimensions(tileMap);
    let useAtlas = (tileMapSize.x > u32(uniforms.chunkSize) || tileMapSize.y > u32(uniforms.chunkSize));
    let chunkOriginTiles = (uniforms.chunkCoord + chunkIdx) * uniforms.chunkSize;

    let N = max(1, uniforms.kernelSize);
    let halfN = N / 2;

    // Weighted counts for each tile type (0-8)
    var weightedCounts: array<f32, 9>;
    for (var k = 0; k < 9; k++) {
        weightedCounts[k] = 0.0;
    }

    var totalWeight = 0.0;

    for (var dy = -halfN; dy <= halfN; dy++) {
        for (var dx = -halfN; dx <= halfN; dx++) {
            let sampleTile = tileCoord + vec2<f32>(f32(dx), f32(dy));
            var sampleUV = sampleTile / f32(uniforms.chunkSize);
            sampleUV = clamp(sampleUV, vec2<f32>(0.0), vec2<f32>(1.0));

            let dist = sqrt(f32(dx * dx + dy * dy)) / f32(halfN);
            let weight = exp(-2.0 * dist * dist);
            
            var sampleCoord = vec2<i32>(
                i32(sampleUV.x * f32(tileMapSize.x)),
                i32(sampleUV.y * f32(tileMapSize.y))
            );
            if (useAtlas) {
                sampleCoord = chunkOriginTiles + vec2<i32>(clamp(sampleTile, vec2<f32>(0.0), vec2<f32>(f32(uniforms.chunkSize) - 1.0)));
            }
            let clampedCoord = clamp(sampleCoord, vec2<i32>(0), vec2<i32>(tileMapSize) - vec2<i32>(1));
            
            let tileSample = textureLoad(tileMap, clampedCoord, 0);
            let t = u32(tileSample.r * 255.0 + 0.5);

            if (t < 9u && validTile(t)) {
                weightedCounts[t] += weight;
                totalWeight += weight;
            }
        }
    }

    // Find top 2 tile types
    var top1Type: u32 = 0u;
    var top1Weight: f32 = 0.0;
    var top2Type: u32 = 0u;
    var top2Weight: f32 = 0.0;

    for (var k = 0u; k < 9u; k++) {
        let w = weightedCounts[k];
        if (w > top1Weight) {
            top2Type = top1Type;
            top2Weight = top1Weight;
            top1Type = k;
            top1Weight = w;
        } else if (w > top2Weight) {
            top2Type = k;
            top2Weight = w;
        }
    }

    // Normalize weights
    var w1: f32 = 0.0;
    var w2: f32 = 0.0;
    if (totalWeight > 0.001) {
        w1 = top1Weight / totalWeight;
        w2 = top2Weight / totalWeight;
    }

    // Pack: [weight1, type1/255, weight2, type2/255]
    let output = vec4<f32>(
        w1,
        f32(top1Type) / 255.0,
        w2,
        f32(top2Type) / 255.0
    );

    textureStore(splatDataTexture, vec2<i32>(global_id.xy), output);
}
`;
}
