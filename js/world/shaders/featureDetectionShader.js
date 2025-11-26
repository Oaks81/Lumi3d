export const detectionShader = `
struct ChunkParams {
    chunkSize: u32,
    chunkX: u32,
    chunkY: u32,
    featureCount: u32
};

@group(0) @binding(0) var<storage, read> slopeData: array<f32>;
@group(0) @binding(1) var<storage, read> noiseData: array<f32>;
@group(0) @binding(2) var<storage, read_write> candidateData: array<u32>;
@group(0) @binding(3) var<storage, read> minSlopes: array<f32>;
@group(0) @binding(4) var<storage, read> maxSlopes: array<f32>;
@group(0) @binding(5) var<storage, read> noises: array<f32>;
@group(0) @binding(6) var<storage, read> rarities: array<f32>;
@group(0) @binding(7) var<storage, read> typeIds: array<u32>;
@group(0) @binding(8) var<uniform> chunkParams: ChunkParams;

fn hash(p: vec2<u32>) -> u32 {
    var h = p.x ^ (p.y << 16u);
    h = h ^ (h >> 13u);
    h = h * 1664525u + 1013904223u;
    return h;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let chunkSize = chunkParams.chunkSize;
    let x = global_id.x;
    let y = global_id.y;
    if (x >= chunkSize || y >= chunkSize) { return; }
    
    let idx = y * chunkSize + x;
    let slope = slopeData[idx];
    let noise = noiseData[idx];

    let worldX = chunkParams.chunkX * chunkSize + x;
    let worldY = chunkParams.chunkY * chunkSize + y;
    let posHash = hash(vec2(worldX, worldY));
    let hashNoise = f32(posHash & 0xFFu) / 255.0;

    var bestType: u32 = 0u;
    var bestScore: f32 = -1e10;

    for (var i: u32 = 0u; i < chunkParams.featureCount; i = i + 1u) {
        let minSlope = minSlopes[i];
        let maxSlope = maxSlopes[i];
        let nGate = noises[i];
        let rarity = rarities[i];
        let typeId = typeIds[i];

        // Slope must be within feature's min/max thresholds
        let slopeOk = (slope >= minSlope) && (slope <= maxSlope);
        let passes = slopeOk && (hashNoise > nGate) && (hashNoise > rarity);

        if (passes) {
            // Use slope for score: larger minSlope = steeper feature = higher priority
            let score = slope;
            if (score > bestScore) {
                bestScore = score;
                bestType = typeId;
            }
        }
    }
    
    let priority: u32 = u32(bestScore * 1000.0) + (posHash & 0xFFu);
    candidateData[idx] = (bestType << 24u) | (priority & 0xFFFFFFu);
}
`;
