// js/mesh/terrain/shaders/webgpu/terrainChunkFragmentShaderBuilder.js
// FIXED VERSION - Spherical Planet Terrain
// Changes:
// 1. Proper TBN matrix for spherical surfaces using sphereDir
// 2. Debug modes: 0=Full, 1=Normals, 2=Heights, 3=TileIDs, 4=UVs, 5=SphereDir
// 3. Fixed tile ID sampling with proper format detection
// 4. Added vSphereDir input for correct tangent space

// js/mesh/terrain/shaders/webgpu/terrainChunkFragmentShaderBuilder.js
// FIXED VERSION - Corrected Group 2 bindings to match backend
//
// CRITICAL FIX: The backend binds textures in this order for Group 2:
//   binding 0 = atlasTexture
//   binding 1 = level2AtlasTexture      <-- WAS WRONG (shader had tileTypeLookup here)
//   binding 2 = tileTypeLookup          <-- MOVED HERE
//   binding 3 = macroTileTypeLookup
//   binding 4 = numVariantsTex
//   binding 5 = linear sampler
//   binding 6 = nearest sampler

export function buildTerrainChunkFragmentShader(options = {}) {
    const maxLightIndices = options.maxLightIndices || 8192;
    
    return `
// ============================================================================
// DEBUG MODE: Change this value to visualize different data
// 0 = Full rendering (normal mode)
// 1 = Visualize normals (RGB = normal direction)
// 2 = Visualize heights (grayscale)
// 3 = Visualize tile IDs (color coded)
// 4 = Visualize UVs (RG = UV coordinates)
// 5 = Visualize sphere direction (RGB = sphereDir)
// 6 = Visualize raw tile texture (no processing)
// 7 = Visualize lookup texture (verify binding is correct)
// ============================================================================
const DEBUG_MODE: i32 =0;

struct FragmentUniforms {
    cameraPosition: vec3<f32>,
    time: f32,
    chunkOffset: vec2<f32>,
    chunkWidth: f32,
    chunkHeight: f32,
    lightDirection: vec3<f32>,
    lightColor: vec3<f32>,
    ambientColor: vec3<f32>,
    enableSplatLayer: f32,
    enableMacroLayer: f32,
    geometryLOD: i32,
    currentSeason: i32,
    nextSeason: i32,
    seasonTransition: f32,
    atlasTextureSize: f32,
    atlasUVOffset: vec2<f32>,
    atlasUVScale: f32,
    useAtlasMode: i32,
    isFeature: f32,
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
}

// Group 0: Uniform Buffers
@group(0) @binding(1) var<uniform> fragUniforms: FragmentUniforms;

// Group 1: Per-Chunk Textures
@group(1) @binding(0) var heightTexture: texture_2d<f32>;
@group(1) @binding(1) var normalTexture: texture_2d<f32>;
@group(1) @binding(2) var tileTexture: texture_2d<f32>;
@group(1) @binding(3) var splatDataMap: texture_2d<f32>;

// =============================================================================
// Group 2: Atlas Textures & Lookups - FIXED to match backend binding order!
// =============================================================================


@group(2) @binding(0) var atlasTexture: texture_2d<f32>;
@group(2) @binding(1) var level2AtlasTexture: texture_2d<f32>;
@group(2) @binding(2) var tileTypeLookup: texture_2d<f32>;
@group(2) @binding(3) var macroTileTypeLookup: texture_2d<f32>;
@group(2) @binding(4) var numVariantsTex: texture_2d<f32>;
@group(2) @binding(5) var textureSampler: sampler;
@group(2) @binding(6) var nearestSampler: sampler;
// =============================================================================
// Helper Functions
// =============================================================================

fn sampleRGBA32FBilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(tex, textureSampler, uv, 0.0);
}

fn sampleRGBA32FNearest(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(tex));
    let coord = vec2<i32>(floor(uv * texSize));
    let maxCoord = vec2<i32>(texSize) - vec2<i32>(1);
    return textureLoad(tex, clamp(coord, vec2<i32>(0), maxCoord), 0);
}

// Apply per-chunk atlas transform when sampling data atlases
fn applyChunkAtlasUV(uv: vec2<f32>, tex: texture_2d<f32>) -> vec2<f32> {
    if (fragUniforms.useAtlasMode == 0) {
        return uv;
    }
    let texSize = vec2<f32>(textureDimensions(tex));
    let halfPix = 0.5 / texSize;
    // uvTransform is authored for the nominal atlas size (config.textureSize); adjust for real texture dims.
    let nominalSize = fragUniforms.atlasTextureSize;
    let scaleFix = nominalSize / texSize.x; // assume square atlases
    let offset = fragUniforms.atlasUVOffset * scaleFix;
    let scale = fragUniforms.atlasUVScale * scaleFix;
    return offset + clamp(uv, halfPix, vec2<f32>(1.0) - halfPix) * scale;
}

// SPHERICAL TBN MATRIX
fn buildSphericalTBN(sphereDir: vec3<f32>) -> mat3x3<f32> {
    let up = normalize(sphereDir);
    var reference = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(dot(up, reference)) > 0.99) {
        reference = vec3<f32>(1.0, 0.0, 0.0);
    }
    let tangent = normalize(cross(up, reference));
    let bitangent = normalize(cross(up, tangent));
    return mat3x3<f32>(tangent, bitangent, up);
}

fn calculateNormal(input: VertexOutput) -> vec3<f32> {
    let uv = applyChunkAtlasUV(input.vUv, normalTexture);
    let normalSample = sampleRGBA32FBilinear(normalTexture, uv).xyz;
    let tangentNormal = normalize(normalSample * 2.0 - 1.0);
    let TBN = buildSphericalTBN(input.vSphereDir);
    let worldNormal = normalize(TBN * tangentNormal);
    if (dot(worldNormal, worldNormal) < 0.01) {
        return normalize(input.vSphereDir);
    }
    return worldNormal;
}

fn lookupTileTypeUVs(tileId: f32, season: i32, variantIdx: i32) -> vec4<f32> {
    let lookupSize = vec2<f32>(textureDimensions(tileTypeLookup));
    let x = i32(tileId) % i32(lookupSize.x);
    let y = (season * 4 + variantIdx) % i32(lookupSize.y);
    return textureLoad(tileTypeLookup, vec2<i32>(x, y), 0);
}

fn pickTileVariant(worldTileCoord: vec2<f32>, tileId: f32, season: i32) -> i32 {
    let hash = fract(sin(dot(worldTileCoord + vec2<f32>(tileId * 17.3, f32(season) * 7.1), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    return i32(hash * 4.0) % 4;
}

fn calculateRotation(worldTileCoord: vec2<f32>, tileId: f32, season: i32, seed: f32) -> f32 {
    let hash = fract(sin(dot(worldTileCoord + vec2<f32>(tileId * 11.7, seed), vec2<f32>(127.1, 311.7))) * 43758.5453);
    return floor(hash * 4.0) * 1.5707963;
}

fn rotateUV(uv: vec2<f32>, angle: f32) -> vec2<f32> {
    let centered = uv - 0.5;
    let c = cos(angle);
    let s = sin(angle);
    let rotated = vec2<f32>(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
    return rotated + 0.5;
}

fn sampleAtlasTexture(uvOffset: vec2<f32>, uvScale: vec2<f32>, localUV: vec2<f32>, atlasSize: f32) -> vec4<f32> {
    let atlasUV = uvOffset + clamp(localUV, vec2<f32>(0.001), vec2<f32>(0.999)) * uvScale;
    return textureSampleLevel(atlasTexture, textureSampler, atlasUV, 0.0);
}

fn sampleMicroTexture(input: VertexOutput, activeSeason: i32) -> vec4<f32> {
    let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let tIdx = floor(tCoord);
    let local = fract(tCoord);
    let worldTileCoord = fragUniforms.chunkOffset + tIdx;
    let tileUV = (tIdx + 0.5) / vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let atlasTileUV = applyChunkAtlasUV(clamp(tileUV, vec2<f32>(0.0), vec2<f32>(1.0)), tileTexture);
    let tileSample = sampleRGBA32FNearest(tileTexture, atlasTileUV);
    var tileId: f32;
    if (tileSample.r > 1.0) { tileId = tileSample.r; } 
    else { tileId = tileSample.r * 255.0; }
    if (fragUniforms.isFeature < 0.5 && tileId >= 100.0) {
        return vec4<f32>(0.0, 0.0, 0.0, -1.0);
    }
    let r = calculateRotation(worldTileCoord, tileId, activeSeason, 9547.0);
    let tileVariantIdx = pickTileVariant(worldTileCoord, tileId, activeSeason);
    let d = lookupTileTypeUVs(tileId, activeSeason, tileVariantIdx);
    let rotatedLocal = clamp(rotateUV(local, r), vec2<f32>(0.0), vec2<f32>(1.0));
    return sampleAtlasTexture(d.xy, d.zw, rotatedLocal, fragUniforms.atlasTextureSize);
}

fn debugTileIdColor(tileId: f32) -> vec3<f32> {
    let id = i32(tileId + 0.5);
    if (id == 0) { return vec3<f32>(0.0, 0.0, 0.0); }
    if (id == 1) { return vec3<f32>(0.0, 0.0, 1.0); }
    if (id == 2) { return vec3<f32>(0.9, 0.8, 0.5); }
    if (id == 3) { return vec3<f32>(0.2, 0.7, 0.2); }
    if (id == 4) { return vec3<f32>(0.4, 0.3, 0.2); }
    if (id == 5) { return vec3<f32>(0.6, 0.6, 0.6); }
    if (id == 6) { return vec3<f32>(0.1, 0.4, 0.1); }
    if (id == 7) { return vec3<f32>(0.95, 0.95, 1.0); }
    if (id == 8) { return vec3<f32>(0.5, 0.4, 0.3); }
    if (id == 9) { return vec3<f32>(0.3, 0.3, 0.35); }
    if (id == 10) { return vec3<f32>(0.6, 0.5, 0.3); }
    let h = fract(sin(f32(id) * 12.9898) * 43758.5453);
    return vec3<f32>(h, fract(h * 2.3), fract(h * 3.7));
}

// =============================================================================
// Main Fragment Function
// =============================================================================

@fragment
fn main(input: VertexOutput) -> @location(0) vec4<f32> {
    let activeSeason = select(fragUniforms.nextSeason, fragUniforms.currentSeason, fragUniforms.seasonTransition < 0.5);

    // DEBUG MODES
    if (DEBUG_MODE == 1) {
        let normal = calculateNormal(input);
        return vec4<f32>(normal * 0.5 + 0.5, 1.0);
    }
    
    if (DEBUG_MODE == 2) {
        let uv = applyChunkAtlasUV(input.vUv, heightTexture);
        let height = sampleRGBA32FBilinear(heightTexture, uv).r;
        let normalized = clamp(height / 120.0, 0.0, 1.0);
        return vec4<f32>(vec3<f32>(normalized), 1.0);
    }
    
    if (DEBUG_MODE == 3) {
        let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
        let tIdx = floor(tCoord);
        let tileUV = (tIdx + 0.5) / vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
        let atlasTileUV = applyChunkAtlasUV(clamp(tileUV, vec2<f32>(0.0), vec2<f32>(1.0)), tileTexture);
        let tileSample = sampleRGBA32FNearest(tileTexture, atlasTileUV);
        var tileId: f32;
        if (tileSample.r > 1.0) { tileId = tileSample.r; }
        else { tileId = tileSample.r * 255.0; }
        return vec4<f32>(debugTileIdColor(tileId), 1.0);
    }
    
    if (DEBUG_MODE == 4) {
        return vec4<f32>(input.vUv.x, input.vUv.y, 0.0, 1.0);
    }
    
    if (DEBUG_MODE == 5) {
        return vec4<f32>(input.vSphereDir * 0.5 + 0.5, 1.0);
    }
    
    if (DEBUG_MODE == 6) {
        let uv = applyChunkAtlasUV(input.vUv, tileTexture);
        let tileSample = sampleRGBA32FBilinear(tileTexture, uv);
        return vec4<f32>(tileSample.rgb, 1.0);
    }
    
    if (DEBUG_MODE == 7) {
        let lookupSize = vec2<f32>(textureDimensions(tileTypeLookup));
        let coord = vec2<i32>(input.vUv * lookupSize);
        let lookupSample = textureLoad(tileTypeLookup, coord, 0);
        return vec4<f32>(lookupSample.rgb * 10.0, 1.0);
    }

    // NORMAL RENDERING
    let microSample = sampleMicroTexture(input, activeSeason);
    
    if (microSample.a < 0.0) {
        discard;
    }
    
    var baseColor = microSample.rgb;
    let worldNormal = calculateNormal(input);
    let lightDir = normalize(fragUniforms.lightDirection);
    let NdotL = max(dot(worldNormal, lightDir), 0.0);
    let ambient = fragUniforms.ambientColor * 0.3;
    let diffuse = fragUniforms.lightColor * NdotL * 0.7;
    var finalColor = baseColor * (ambient + diffuse);
    let fogFactor = 1.0 - exp(-input.vDistanceToCamera * 0.00005);
    let fogColor = vec3<f32>(0.6, 0.7, 0.8);
    finalColor = mix(finalColor, fogColor, clamp(fogFactor, 0.0, 0.5));
    
    return vec4<f32>(finalColor, 1.0);
}
`;
}
