// js/mesh/terrain/shaders/webgpu/terrainChunkVertexShaderBuilder.js
export function buildTerrainChunkVertexShader() {
    return `
// Debug constants: set FORCE_HEIGHT_TEST to true to force obvious displacement
const FORCE_HEIGHT_TEST : bool = false;
const FORCE_HEIGHT_VALUE : f32 = 500.0;
const FORCE_HEIGHT_MULT : f32 = 1.0;

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
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
    
    planetOrigin: vec3<f32>,
    _pad3: f32,
    
    chunkFace: i32,
    _padFace: f32,
    chunkLocation: vec2<f32>,
    chunkSizeUV: f32,
    
    // Atlas UV transform
    useAtlasMode: f32,
    atlasUVOffset: vec2<f32>,
    atlasUVScale: f32,
    
    // Height settings
    heightScale: f32,
    atlasTextureSize: f32,
    _pad4: f32,
    _pad5: f32,
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
    @location(7) vSphereDir: vec3<f32>,
    @location(8) vHeight: f32,
    @location(9) vDisplacement: f32,
}

@group(0) @binding(0) var<uniform> uniforms: VertexUniforms;
@group(1) @binding(0) var heightTexture: texture_2d<f32>;

// Convert Face + UV to a point on a Unit Cube, then normalize to sphere
fn getCubePoint(face: i32, uv: vec2<f32>) -> vec3<f32> {
    let xy = uv * 2.0 - 1.0;
    
    // Standard Cube Map convention (Right-handed, Y-up)
    if (face == 0) { return vec3<f32>(1.0, xy.y, -xy.x); }  // +X 
    if (face == 1) { return vec3<f32>(-1.0, xy.y, xy.x); }  // -X 
    if (face == 2) { return vec3<f32>(xy.x, 1.0, -xy.y); }  // +Y 
    if (face == 3) { return vec3<f32>(xy.x, -1.0, xy.y); }  // -Y 
    if (face == 4) { return vec3<f32>(xy.x, xy.y, 1.0); }   // +Z 
    return vec3<f32>(-xy.x, xy.y, -1.0);                    // -Z 
}

// Sample height with proper atlas UV transform
fn sampleHeight(localUV: vec2<f32>) -> f32 {
    let texSize = vec2<f32>(textureDimensions(heightTexture));
    
    // Apply atlas UV transform if in atlas mode
    var sampleUV = localUV;
    if (uniforms.useAtlasMode > 0.5) {
        // Transform from chunk-local [0,1] to atlas subregion
        sampleUV = uniforms.atlasUVOffset + localUV * uniforms.atlasUVScale;
    }
    
    // Clamp to valid range with half-pixel border
    let halfPix = 0.5 / texSize;
    sampleUV = clamp(sampleUV, halfPix, vec2<f32>(1.0) - halfPix);
    
    // Bilinear interpolation using textureLoad (for unfilterable-float)
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

    // Height sampling (with optional hard override for debugging)
    var heightSample = sampleHeight(input.uv);
    // Height texture already encodes generator-scaled heights; heightScale is a render multiplier.
    var height = heightSample;
    var worldPosition: vec3<f32>;
    var normal: vec3<f32>;
    var sphereDirOut: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
    
    // Check if spherical mode (chunkFace >= 0)
    if (uniforms.chunkFace >= 0) {
        // =============================================
        // SPHERICAL MODE
        // =============================================
        
        // Calculate face UV from chunk location + local UV
        let faceUV = uniforms.chunkLocation + input.uv * uniforms.chunkSizeUV;
        
        // Project to unit sphere
        let cubePoint = getCubePoint(uniforms.chunkFace, faceUV);
        let sphereDir = normalize(cubePoint);
        sphereDirOut = sphereDir;
        
        // Apply render height scale
        var heightMultiplier = max(uniforms.heightScale, 0.0001);
        
        // Calculate final position on sphere with height displacement
        var radius = uniforms.planetRadius + (height * heightMultiplier);
        if (FORCE_HEIGHT_TEST) {
            // Force a large displacement to verify vertex sampling path
            height = FORCE_HEIGHT_VALUE;
            radius = uniforms.planetRadius + height * FORCE_HEIGHT_MULT;
        }
        worldPosition = uniforms.planetOrigin + sphereDir * radius;
        
        // Normal is the sphere direction (radial outward)
        normal = sphereDir;
        
    } else {
        // =============================================
        // FLAT MODE (legacy)
        // =============================================
        
        let localPos = input.position;
        
        // Apply render height scale
        var heightMultiplier = max(uniforms.heightScale, 0.0001);
        
        var yPos = height * heightMultiplier;
        if (FORCE_HEIGHT_TEST) {
            height = FORCE_HEIGHT_VALUE;
            yPos = height * FORCE_HEIGHT_MULT;
        }
        worldPosition = vec3<f32>(
            localPos.x + uniforms.chunkOffset.x,
            yPos,
            localPos.z + uniforms.chunkOffset.y
        );
        
        normal = input.normal;
        sphereDirOut = vec3<f32>(0.0, 1.0, 0.0);
    }

    output.vWorldPosition = worldPosition;

    // Transform through view/projection matrices
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPosition, 1.0);
    output.vViewPosition = viewPos.xyz;
    output.vDistanceToCamera = length(viewPos.xyz);
    output.clipPosition = uniforms.projectionMatrix * viewPos;

    // Pass through UV and computed values
    output.vUv = input.uv;
    output.vTileUv = input.uv * uniforms.chunkSize;
    output.vWorldPos = uniforms.chunkOffset + input.uv * uniforms.chunkSize;
    output.vNormal = normal;
    output.vSphereDir = sphereDirOut;
    output.vHeight = height;
    // Displacement applied (for debug)
    output.vDisplacement = worldPosition.y - uniforms.planetOrigin.y;

    return output;
}
`;
}
