export function buildTerrainChunkVertexShader() {
    return `
struct VertexUniforms {
    modelMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    
    // Chunk Layout
    chunkOffset: vec2<f32>,
    chunkSize: f32,
    macroScale: f32,

    // Planet Projection (New)
    planetRadius: f32,
    planetOrigin: vec3<f32>,
    chunkFace: i32,           // 0-5 Cube Face
    chunkLocation: vec2<f32>, // Bottom-left UV of chunk on face (0.0 to 1.0)
    chunkSizeUV: f32          // Size of chunk in UV space (e.g. 0.25 for 4x4)
}

struct VertexInput {
    @location(0) position: vec3<f32>, // Local x, height, z
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) vUv: vec2<f32>,
    @location(1) vNormal: vec3<f32>,
    @location(2) vWorldPosition: vec3<f32>,
    @location(3) vViewPosition: vec3<f32>,
    @location(4) vDistanceToCamera: f32,
    @location(5) vTileUv: vec2<f32>,
    @location(6) vWorldPos: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: VertexUniforms;

// Helper: Get point on Unit Cube from Face + UV
fn getCubePoint(face: i32, uv: vec2<f32>) -> vec3<f32> {
    let xy = uv * 2.0 - 1.0; // Map [0,1] to [-1,1]
    
    // Standard Cube Map convention (Right-handed, Y-up)
    if (face == 0) { return vec3<f32>(1.0, xy.y, -xy.x); } // +X (Right)
    if (face == 1) { return vec3<f32>(-1.0, xy.y, xy.x); } // -X (Left)
    if (face == 2) { return vec3<f32>(xy.x, 1.0, -xy.y); } // +Y (Top)
    if (face == 3) { return vec3<f32>(xy.x, -1.0, xy.y); } // -Y (Bottom)
    if (face == 4) { return vec3<f32>(xy.x, xy.y, 1.0); }  // +Z (Front)
    return vec3<f32>(-xy.x, xy.y, -1.0);                   // -Z (Back)
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // 1. Calculate Face UV
    // input.uv is [0,1] for the specific chunk
    // Map this to the global Face UV space (0..1 for the whole face)
    let faceUV = uniforms.chunkLocation + input.uv * uniforms.chunkSizeUV;
    
    // 2. Get Point on Unit Cube
    let cubePoint = getCubePoint(uniforms.chunkFace, faceUV);
    
    // 3. Project to Unit Sphere (The "Angle")
    // Normalizing a point on a cube creates a sphere!
    let sphereDir = normalize(cubePoint);
    
    // 4. Apply Radius + Altitude Displacement
    // input.position.y contains the terrain height (from CPU or Texture)
    let radius = uniforms.planetRadius + input.position.y;
    let worldPosition = uniforms.planetOrigin + sphereDir * radius;

    output.vWorldPosition = worldPosition;

    // 5. Calculate Standard View/Projection
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPosition, 1.0);
    output.vViewPosition = viewPos.xyz;
    output.vDistanceToCamera = length(viewPos.xyz);
    output.clipPosition = uniforms.projectionMatrix * viewPos;

    // 6. Pass-throughs
    output.vUv = input.uv;
    output.vTileUv = input.uv * uniforms.chunkSize;
    
    // Generate pseudo-world coords for noise generation in Fragment shader
    // We scale it so noise continuity is somewhat preserved
    output.vWorldPos = vec2<f32>(faceUV.x * uniforms.planetRadius * 4.0, faceUV.y * uniforms.planetRadius * 4.0); 

    // 7. Normal (Approximation: Sphere Normal is "Up")
    // Ideally we would rotate the input.normal by a TBN matrix derived from sphereDir
    // For now, using sphereDir is a safe baseline for a planet.
    output.vNormal = sphereDir;

    return output;
}
`;
}