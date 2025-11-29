// js/mesh/terrain/shaders/webgpu/terrainChunkVertexShaderBuilder.js
// FIXED VERSION - Spherical Planet Terrain
// Changes:
// 1. Increased height multiplier from 6.0 to 50.0 (configurable via uniform)
// 2. Better height sampling with proper bilinear interpolation
// 3. Added heightScale uniform for runtime adjustment

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

    // Planet Projection
    planetRadius: f32,
    planetOrigin: vec3<f32>,
    chunkFace: i32,           
    chunkLocation: vec2<f32>, // UV of the chunk on the face (0..1)
    chunkSizeUV: f32,         // Size of chunk in face UV space
    
    // Atlas / Height settings
    useAtlasMode: f32,
    atlasUVOffset: vec2<f32>,
    atlasUVScale: f32,
    
    // NEW: Height scale uniform (default 50.0)
    heightScale: f32,
    // Nominal atlas size (e.g., 2048) for UV correction
    atlasTextureSize: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>, 
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
    @location(7) vSphereDir: vec3<f32>,  // NEW: Pass sphere direction for TBN
}

@group(0) @binding(0) var<uniform> uniforms: VertexUniforms;
@group(1) @binding(0) var heightTexture: texture_2d<f32>;
@group(2) @binding(5) var textureSampler: sampler;

// Helper: Convert Face + UV to a point on a Unit Cube
fn getCubePoint(face: i32, uv: vec2<f32>) -> vec3<f32> {
    let xy = uv * 2.0 - 1.0; // Map [0,1] to [-1,1]
    
    // Standard Cube Map convention (Right-handed, Y-up)
    // 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
    if (face == 0) { return vec3<f32>(1.0, xy.y, -xy.x); } // +X 
    if (face == 1) { return vec3<f32>(-1.0, xy.y, xy.x); } // -X 
    if (face == 2) { return vec3<f32>(xy.x, 1.0, -xy.y); } // +Y 
    if (face == 3) { return vec3<f32>(xy.x, -1.0, xy.y); } // -Y 
    if (face == 4) { return vec3<f32>(xy.x, xy.y, 1.0); }  // +Z 
    return vec3<f32>(-xy.x, xy.y, -1.0);                   // -Z 
}

// NEW: Proper bilinear height sampling
fn sampleHeightBilinear(uv: vec2<f32>) -> f32 {
    let texSize = vec2<f32>(textureDimensions(heightTexture));
    
    // Transform UV if using atlas mode (correct for 2049px height atlases)
    var sampleUV = uv;
    if (uniforms.useAtlasMode > 0.5) {
        let halfPix = 0.5 / texSize;
        let scaleFix = uniforms.atlasTextureSize / texSize.x; // assume square atlases
        let offset = uniforms.atlasUVOffset * scaleFix;
        let scale = uniforms.atlasUVScale * scaleFix;
        sampleUV = offset + clamp(uv, halfPix, vec2<f32>(1.0) - halfPix) * scale;
    }
    
    // Bilinear interpolation
    let coord = sampleUV * texSize - 0.5;
    let baseCoord = floor(coord);
    let f = fract(coord);
    
    let c00 = vec2<i32>(baseCoord);
    let c10 = c00 + vec2<i32>(1, 0);
    let c01 = c00 + vec2<i32>(0, 1);
    let c11 = c00 + vec2<i32>(1, 1);
    
    let maxCoord = vec2<i32>(texSize) - vec2<i32>(1);
    
    let h00 = textureLoad(heightTexture, clamp(c00, vec2<i32>(0), maxCoord), 0).r;
    let h10 = textureLoad(heightTexture, clamp(c10, vec2<i32>(0), maxCoord), 0).r;
    let h01 = textureLoad(heightTexture, clamp(c01, vec2<i32>(0), maxCoord), 0).r;
    let h11 = textureLoad(heightTexture, clamp(c11, vec2<i32>(0), maxCoord), 0).r;
    
    let h0 = mix(h00, h10, f.x);
    let h1 = mix(h01, h11, f.x);
    
    return mix(h0, h1, f.y);
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // 1. Calculate Face UV
    let faceUV = uniforms.chunkLocation + input.uv * uniforms.chunkSizeUV;
    
    // 2. Project to Unit Sphere
    let cubePoint = getCubePoint(uniforms.chunkFace, faceUV);
    let sphereDir = normalize(cubePoint);
    
    // 3. Sample Height with proper bilinear interpolation
    let height = sampleHeightBilinear(input.uv);

    // 4. Calculate Final World Position
    // FIX: Use heightScale uniform instead of hardcoded 6.0
    var heightMultiplier = uniforms.heightScale;
    if (heightMultiplier < 0.0001) {
        heightMultiplier = 1.0; // Fallback if not set
    }
    
    let radius = uniforms.planetRadius + (height * heightMultiplier);
    let worldPosition = uniforms.planetOrigin + sphereDir * radius;

    output.vWorldPosition = worldPosition;
    output.vSphereDir = sphereDir; // Pass for TBN calculation in fragment shader

    // 5. Standard Matrices
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPosition, 1.0);
    output.vViewPosition = viewPos.xyz;
    output.vDistanceToCamera = length(viewPos.xyz);
    output.clipPosition = uniforms.projectionMatrix * viewPos;

    // 6. Passthrough
    output.vUv = input.uv;
    output.vTileUv = input.uv * uniforms.chunkSize;
    output.vWorldPos = vec2<f32>(faceUV.x * uniforms.planetRadius, faceUV.y * uniforms.planetRadius);

    // 7. Normal - sphere direction is the base "up" for this vertex
    output.vNormal = sphereDir;

    return output;
}
`;
}
