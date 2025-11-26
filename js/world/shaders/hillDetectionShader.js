export const hillShader = `
struct HillParams {
    chunkSize: u32,
    radius: u32,
    marginWidth: u32,
    heightThreshold: f32,
};

@group(0) @binding(0) var<storage, read> heightData: array<f32>;
@group(0) @binding(1) var<storage, read_write> hillCandidateData: array<u32>;
@group(0) @binding(2) var<uniform> params: HillParams;

// Helper: get local (chunk) height, with bounds check
fn getHeight(x: i32, y: i32, chunkSize: u32) -> f32 {
    if (x < 0 || x >= i32(chunkSize) || y < 0 || y >= i32(chunkSize)) {
        return -1e6; // force out of bounds to very low (won't be max)
    }
    let idx = y * i32(chunkSize) + x;
    return heightData[u32(idx)];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let chunkSize = params.chunkSize;
    let radius = params.radius;
    let marginWidth = params.marginWidth;
    let hThresh = params.heightThreshold;

    let x = i32(global_id.x);
    let y = i32(global_id.y);

    if (u32(x) >= chunkSize || u32(y) >= chunkSize) { return; }

    let centerH = getHeight(x, y, chunkSize);
    var isLocalMax = true;

    // 1. Find local max in neighborhood radius
    for (var dy = -i32(radius); dy <= i32(radius); dy++) {
      for (var dx = -i32(radius); dx <= i32(radius); dx++) {
        if (dx == 0 && dy == 0) { continue; }
        let nx = x + dx;
        let ny = y + dy;
        let dist2 = dx * dx + dy * dy;
        if (dist2 > i32(radius * radius)) { continue; }
        let nH = getHeight(nx, ny, chunkSize);
        if (nH >= centerH) {
            isLocalMax = false;
            break;
        }
      }
      if (!isLocalMax) { break; }
    }

    var isHillCenter = false;
    var isHillArea = false;
    // 2. If local max candidate, check margin ring
    if (isLocalMax) {
        var passMargin = true;
        var minMarginH = 1e6;
        var maxMarginH = -1e6;

        // (Margin ring check: ring outside hill)
        for (var a = 0.0; a < 6.2832; a += 0.39) { // ~16 samples around ring
            let rx = x + i32(f32(radius + marginWidth) * cos(a));
            let ry = y + i32(f32(radius + marginWidth) * sin(a));
            let h = getHeight(rx, ry, chunkSize);
            if (h > centerH - hThresh) { passMargin = false; }
            if (h < minMarginH) { minMarginH = h; }
            if (h > maxMarginH) { maxMarginH = h; }
        }
        if (passMargin && (centerH - maxMarginH) > hThresh) {
            isHillCenter = true;
        }
    }

    // 3. (Optional) Mark area inside hill region
    //    (Could be done in a separate pass if needed)
    //    E.g., tag all tiles within radius of detected center during postprocess

    // Write to output, encode
    // Bit 0: isCenter
    // Bit 1: isHillArea (not set here)
    hillCandidateData[u32(y * i32(chunkSize) + x)] =
      (u32(isHillCenter) & 1u); // | ((u32(isHillArea) & 1u) << 1)
}`;