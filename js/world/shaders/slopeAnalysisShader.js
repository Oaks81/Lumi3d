export const slopeShader = `
@group(0) @binding(0) var<storage, read> heightData: array<f32>;
@group(0) @binding(1) var<storage, read_write> slopeData: array<f32>;
@group(0) @binding(2) var<uniform> params: vec2<u32>; // chunkSize, unused
fn clampCoord(x: i32, N: u32) -> u32 {
    return u32(max(0, min(i32(N), x)));
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let chunkSize = params.x;
    let N = chunkSize;
    let x = i32(global_id.x);
    let y = i32(global_id.y);
    if (u32(x) >= chunkSize || u32(y) >= chunkSize) { return; }
    let stride = chunkSize + 1u;
    let xm1 = clampCoord(x - 1, chunkSize);
    let xp1 = clampCoord(x + 1, chunkSize);
    let ym1 = clampCoord(y - 1, chunkSize);
    let yp1 = clampCoord(y + 1, chunkSize);
    let h00 = heightData[ym1 * stride + xm1];
    let h01 = heightData[ym1 * stride + u32(x)];
    let h02 = heightData[ym1 * stride + xp1];
    let h10 = heightData[u32(y) * stride + xm1];
    let h12 = heightData[u32(y) * stride + xp1];
    let h20 = heightData[yp1 * stride + xm1];
    let h21 = heightData[yp1 * stride + u32(x)];
    let h22 = heightData[yp1 * stride + xp1];
    let gx = -h00 - 2.0 * h10 - h20 + h02 + 2.0 * h12 + h22;
    let gy = -h00 - 2.0 * h01 - h02 + h20 + 2.0 * h21 + h22;
    let slope = sqrt(gx * gx + gy * gy);
    let outputIndex = u32(y) * chunkSize + u32(x);
    slopeData[outputIndex] = slope;
}
`;