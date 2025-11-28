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
    atlasUVScale: f32
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
}

@group(0) @binding(0) var<uniform> uniforms: VertexUniforms;
@group(1) @binding(0) var heightTexture: texture_2d<f32>; // Bind Group 1, Binding 0
@group(2) @binding(5) var textureSampler: sampler;        // Bind Group 2, Binding 5 (Shared sampler)

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

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // 1. Calculate Face UV
    // input.uv is [0,1] for the local chunk.
    // We map this to the global 0..1 UV space of the entire Cube Face.
    let faceUV = uniforms.chunkLocation + input.uv * uniforms.chunkSizeUV;
    
    // 2. Project to Unit Sphere
    // Get point on cube surface, then normalize it to get sphere direction
    let cubePoint = getCubePoint(uniforms.chunkFace, faceUV);
    let sphereDir = normalize(cubePoint);
    
    // 3. Sample Height (Displacement) with mild box filter to tame moire
    var height = 0.0;
    var baseUV = input.uv;
    if (uniforms.useAtlasMode > 0.5) {
        let texSize = vec2<f32>(textureDimensions(heightTexture));
        let halfPix = 0.5 / texSize;
        // Stay inside the atlas slice
        baseUV = uniforms.atlasUVOffset + clamp(input.uv, halfPix, vec2<f32>(1.0) - halfPix) * uniforms.atlasUVScale;
    }
    let texel = 0.5 / vec2<f32>(textureDimensions(heightTexture));
    let offsets = array<vec2<f32>,4>(
        vec2<f32>(-texel.x, -texel.y),
        vec2<f32>( texel.x, -texel.y),
        vec2<f32>(-texel.x,  texel.y),
        vec2<f32>( texel.x,  texel.y)
    );
    for (var i = 0; i < 4; i = i + 1) {
        height = height + textureSampleLevel(heightTexture, textureSampler, baseUV + offsets[i], 0.0).r;
    }
    height = height * 0.25;

    // 4. Calculate Final World Position
    // Radius = PlanetRadius + Height * Scale (e.g., 50000 + h * 50)
    // Moderate multiplier for visible relief without exaggeration
    let heightMultiplier = 6.0; 
    let radius = uniforms.planetRadius + (height * heightMultiplier);
    
    let worldPosition = uniforms.planetOrigin + sphereDir * radius;

    output.vWorldPosition = worldPosition;

    // 5. Standard Matrices
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPosition, 1.0);
    output.vViewPosition = viewPos.xyz;
    output.vDistanceToCamera = length(viewPos.xyz);
    output.clipPosition = uniforms.projectionMatrix * viewPos;

    // 6. Passthrough
    output.vUv = input.uv;
    output.vTileUv = input.uv * uniforms.chunkSize;
    output.vWorldPos = vec2<f32>(faceUV.x * uniforms.planetRadius, faceUV.y * uniforms.planetRadius);

    // 7. Normal
    // For a planet, the "Up" direction is the Sphere Direction.
    // The Fragment shader can perturb this with Normal Maps later.
    output.vNormal = sphereDir;

    return output;
}
`;
}
