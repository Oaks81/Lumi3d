export const pathShader = `
// Remove the unused heightData binding entirely
@group(0) @binding(0) var<storage, read_write> pathData: array<f32>;
@group(0) @binding(1) var<uniform> params: vec4<f32>;
@group(0) @binding(2) var<uniform> chunkParams: vec4<u32>;

fn hash(p: vec2<u32>) -> u32 {
    var h = p.x ^ (p.y << 16u);
    h = h ^ (h >> 13u);
    h = h * 1664525u + 1013904223u;
    return h;
}

fn noise(x: f32, y: f32, seed: u32) -> f32 {
    let ix = u32(floor(x)) ^ seed;
    let iy = u32(floor(y)) ^ seed;
    let h = hash(vec2(ix, iy));
    return f32(h & 0xFFu) / 255.0 - 0.5;
}

@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let pathLength = u32(params.z);
    let index = global_id.x;
    if (index >= pathLength) { return; }
    
    let t = f32(index) / f32(pathLength - 1u);
    let startX = params.x;
    let startY = params.y;
    let smoothness = params.w;
    let seed = chunkParams.y;
    
    let baseX = startX + t * 8.0;
    let baseY = startY;
    let noiseScale = 0.5;
    let noiseX = noise(baseX * 2.0, baseY * 2.0, seed) * noiseScale;
    let noiseY = noise(baseX * 2.0 + 100.0, baseY * 2.0 + 100.0, seed + 1u) * noiseScale;
    
    let finalX = baseX + noiseX * smoothness;
    let finalY = baseY + noiseY * smoothness;
    
    pathData[index * 2u] = finalX;
    pathData[index * 2u + 1u] = finalY;
}
`;