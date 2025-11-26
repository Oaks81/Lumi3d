import { getClusteredLightingModule } from './clusteredLighting.js';

export function getTerrainUtilityFunctions() {
    return `
fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn fade(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn perlin2D(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let n00 = hash12(i);
    let n01 = hash12(i + vec2<f32>(0.0, 1.0));
    let n10 = hash12(i + vec2<f32>(1.0, 0.0));
    let n11 = hash12(i + vec2<f32>(1.0, 1.0));
    let u = vec2<f32>(fade(f.x), fade(f.y));
    return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 2.0 - 1.0;
}

fn octaveNoise(p: vec2<f32>, octaves: i32) -> f32 {
    var v = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        v += perlin2D(p * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return v / norm;
}

fn rotateUV(uv: vec2<f32>, rotation: f32) -> vec2<f32> {
    let r = i32(rotation + 0.5);
    if (r == 0) { return uv; }
    if (r == 1) { return vec2<f32>(1.0 - uv.y, uv.x); }
    if (r == 2) { return vec2<f32>(1.0 - uv.x, 1.0 - uv.y); }
    return vec2<f32>(uv.y, 1.0 - uv.x);
}

fn calculateRotation(worldPos: vec2<f32>, tileId: f32, season: i32, rotSeed: f32) -> f32 {
    let r = hash12(worldPos + vec2<f32>(tileId, rotSeed + f32(season) * 19.0));
    return floor(r * 4.0);
}

fn goodTileHash(pos: vec2<f32>, tileType: f32, season: f32) -> f32 {
    let s1 = sin(dot(pos, vec2<f32>(127.1 + tileType * 31.7, 311.7 + season * 181.3)));
    let s2 = sin(dot(pos, vec2<f32>(269.5 + season * 19.17, 183.3 + tileType * 47.21)));
    let s3 = sin(dot(pos, vec2<f32>(tileType * 101.9, season * 233.7)));
    return fract(43758.5453123 * (s1 + s2 + s3));
}
`;
}

export function getTileSamplingFunctions() {
    return `
fn getNumVariants(tileType: i32, season: i32) -> i32 {
    let tx = clamp(tileType, 0, 255);
    let ty = clamp(season, 0, 3);
    let sample = textureLoad(numVariantsTex, vec2<i32>(tx, ty), 0);
    return i32(255.0 * sample.r + 0.5);
}

fn pickTileVariant(worldPos: vec2<f32>, tileType: f32, season: i32) -> i32 {
    let intType = i32(tileType + 0.5);
    let varCount = getNumVariants(intType, season);
    if (varCount <= 1) { return 0; }
    let h = goodTileHash(worldPos, tileType, f32(season));
    return clamp(i32(floor(h * f32(varCount))), 0, varCount - 1);
}

fn lookupTileTypeUVs(tileType: f32, season: i32, variantIdx: i32) -> vec4<f32> {
    let columnIndex = season * 8 + variantIdx;
    let row = i32(tileType + 0.5);
    return textureLoad(tileTypeLookup, vec2<i32>(columnIndex, row), 0);
}

fn lookupMacroTileTypeUVs(tileType: f32, season: i32, variantIdx: i32) -> vec4<f32> {
    let columnIndex = season * 8 + variantIdx;
    let row = i32(tileType + 0.5);
    return textureLoad(macroTileTypeLookup, vec2<i32>(columnIndex, row), 0);
}

fn sampleAtlasTexture(uvMin: vec2<f32>, uvMax: vec2<f32>, localUv: vec2<f32>, atlasSize: vec2<f32>) -> vec4<f32> {
    let epsilon = 0.5 / atlasSize;
    let safeMin = uvMin + epsilon;
    let safeMax = uvMax - epsilon;
    let atlasUv = mix(safeMin, safeMax, localUv);
    return textureSampleLevel(atlasTexture, textureSampler, atlasUv, 0.0);
}

fn sampleMacroAtlasTexture(uvMin: vec2<f32>, uvMax: vec2<f32>, localUv: vec2<f32>, atlasSize: vec2<f32>) -> vec4<f32> {
    let epsilon = 0.5 / atlasSize;
    let safeMin = uvMin + epsilon;
    let safeMax = uvMax - epsilon;
    let atlasUv = mix(safeMin, safeMax, localUv);
    return textureSampleLevel(level2AtlasTexture, textureSampler, atlasUv, 0.0);
}
`;
}

export function getShadowSamplingFunctions() {
    return `
fn sampleShadowCascade(shadowMap: texture_2d<f32>, shadowMatrix: mat4x4<f32>, worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
    let biasedPos = worldPos + normal * fragUniforms.shadowNormalBias;
    let shadowCoord4 = shadowMatrix * vec4<f32>(biasedPos, 1.0);
    let shadowCoord = shadowCoord4.xyz / shadowCoord4.w;

    if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
        shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
        shadowCoord.z < 0.0 || shadowCoord.z > 1.0) {
        return 1.0;
    }

    let shadowDepth = textureSampleLevel(shadowMap, shadowSampler, shadowCoord.xy, 0.0).r;
    let bias = fragUniforms.shadowBias;
    let currentDepth = shadowCoord.z;

    if (currentDepth - bias > shadowDepth) {
        return 0.3;
    }

    return 1.0;
}

fn sampleShadowMap(worldPos: vec3<f32>, normal: vec3<f32>, distanceToCamera: f32) -> f32 {
    if (fragUniforms.receiveShadow < 0.5 || fragUniforms.geometryLOD >= 2) {
        return 1.0;
    }

    var shadow = 1.0;
    if (fragUniforms.numCascades >= 3) {
        if (distanceToCamera < fragUniforms.cascadeSplits.x) {
            shadow = sampleShadowCascade(shadowMapCascade0, fragUniforms.shadowMatrixCascade0, worldPos, normal);
        } else if (distanceToCamera < fragUniforms.cascadeSplits.y) {
            shadow = sampleShadowCascade(shadowMapCascade1, fragUniforms.shadowMatrixCascade1, worldPos, normal);
        } else if (distanceToCamera < fragUniforms.cascadeSplits.z) {
            shadow = sampleShadowCascade(shadowMapCascade2, fragUniforms.shadowMatrixCascade2, worldPos, normal);
        }
    } else {
        shadow = sampleShadowCascade(shadowMapCascade0, fragUniforms.shadowMatrixCascade0, worldPos, normal);
    }
    return shadow;
}
`;
}

export function buildTerrainChunkFragmentShader(options = {}) {
    const maxLightIndices = options.maxLightIndices || 8192;

    const utilFunctions = getTerrainUtilityFunctions();
    const tileFunctions = getTileSamplingFunctions();
    const shadowFunctions = getShadowSamplingFunctions();
    const clusteredModule = getClusteredLightingModule(maxLightIndices);

    return `
// ============================================
// DEBUG MODE
// 0 = Full rendering
// 1 = Normals only
// 2 = Height only
// 3 = Tile ID only
// ============================================
const DEBUG_MODE: i32 = 0;

const PI: f32 = 3.14159265359;
const MAX_TILE_TYPES: u32 = 256u;
const MAX_SEASONS: u32 = 4u;
const MAX_VARIANTS: u32 = 8u;
const MAX_LIGHTS_PER_CLUSTER: i32 = 32;

struct FragmentUniforms {
    chunkOffset: vec2<f32>,
    chunkSize: f32,
    chunkWidth: f32,

    chunkHeight: f32,
    tileScale: f32,
    level2Blend: f32,
    macroScale: f32,

    currentSeason: i32,
    nextSeason: i32,
    seasonTransition: f32,
    maxTileTypes: f32,

    lodLevel: i32,
    geometryLOD: i32,
    splatLODBias: f32,
    macroLODBias: f32,

    detailFade: f32,
    enableSplatLayer: f32,
    enableMacroLayer: f32,
    enableClusteredLights: f32,

    sunLightColor: vec3<f32>,
    sunLightIntensity: f32,

    sunLightDirection: vec3<f32>,
    _pad1: f32,

    moonLightColor: vec3<f32>,
    moonLightIntensity: f32,

    moonLightDirection: vec3<f32>,
    _pad2: f32,

    ambientLightColor: vec3<f32>,
    ambientLightIntensity: f32,

    skyAmbientColor: vec3<f32>,
    _pad3: f32,

    groundAmbientColor: vec3<f32>,
    _pad4: f32,

    fogColor: vec3<f32>,
    fogDensity: f32,

    cameraPosition: vec3<f32>,
    cameraNear: f32,

    cameraFar: f32,
    thunderLightIntensity: f32,
    weatherIntensity: f32,
    currentWeather: f32,

    thunderLightColor: vec3<f32>,
    _pad5: f32,

    playerLightColor: vec3<f32>,
    playerLightIntensity: f32,

    playerLightPosition: vec3<f32>,
    playerLightDistance: f32,

    receiveShadow: f32,
    isFeature: f32,
    numCascades: i32,
    shadowBias: f32,

    shadowNormalBias: f32,
    shadowMapSize: f32,
    _pad6: f32,
    _pad7: f32,

    cascadeSplits: vec3<f32>,
    _pad8: f32,

    clusterDimensions: vec3<f32>,
    numLights: f32,

    atlasTextureSize: vec2<f32>,
    level2AtlasTextureSize: vec2<f32>,

    shadowMatrixCascade0: mat4x4<f32>,
    shadowMatrixCascade1: mat4x4<f32>,
    shadowMatrixCascade2: mat4x4<f32>,
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

@group(0) @binding(1) var<uniform> fragUniforms: FragmentUniforms;

@group(1) @binding(0) var heightTexture: texture_2d<f32>;
@group(1) @binding(1) var normalTexture: texture_2d<f32>;
@group(1) @binding(2) var tileTexture: texture_2d<f32>;
@group(1) @binding(3) var splatDataMap: texture_2d<f32>; // Combined map
@group(1) @binding(4) var macroMaskTexture: texture_2d<f32>;

@group(2) @binding(0) var atlasTexture: texture_2d<f32>;
@group(2) @binding(1) var level2AtlasTexture: texture_2d<f32>;
@group(2) @binding(2) var tileTypeLookup: texture_2d<f32>;
@group(2) @binding(3) var macroTileTypeLookup: texture_2d<f32>;
@group(2) @binding(4) var numVariantsTex: texture_2d<f32>;
@group(2) @binding(5) var textureSampler: sampler;
@group(2) @binding(6) var nearestSampler: sampler;

@group(3) @binding(0) var shadowMapCascade0: texture_2d<f32>;
@group(3) @binding(1) var shadowMapCascade1: texture_2d<f32>;
@group(3) @binding(2) var shadowMapCascade2: texture_2d<f32>;
@group(3) @binding(3) var shadowSampler: sampler;
@group(3) @binding(4) var clusterDataTexture: texture_2d<f32>;
@group(3) @binding(5) var lightDataTexture: texture_2d<f32>;
@group(3) @binding(6) var lightIndicesTexture: texture_2d<f32>;

${utilFunctions}
${tileFunctions}
${shadowFunctions}
${clusteredModule}

// ============================================
// TEXTURE SAMPLING HELPERS
// ============================================
fn sampleRGBA32FBilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<f32>(textureDimensions(tex));
    let coord = uv * size - 0.5;
    let i = vec2<i32>(floor(coord));
    let f = fract(coord);

    let maxCoord = vec2<i32>(size) - vec2<i32>(1);

    let s00 = textureLoad(tex, clamp(i + vec2<i32>(0, 0), vec2<i32>(0), maxCoord), 0);
    let s10 = textureLoad(tex, clamp(i + vec2<i32>(1, 0), vec2<i32>(0), maxCoord), 0);
    let s01 = textureLoad(tex, clamp(i + vec2<i32>(0, 1), vec2<i32>(0), maxCoord), 0);
    let s11 = textureLoad(tex, clamp(i + vec2<i32>(1, 1), vec2<i32>(0), maxCoord), 0);

    return mix(
        mix(s00, s10, f.x),
        mix(s01, s11, f.x),
        f.y
    );
}

fn sampleRGBA32FNearest(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<f32>(textureDimensions(tex));
    let coord = vec2<i32>(uv * size);
    let maxCoord = vec2<i32>(size) - vec2<i32>(1);
    return textureLoad(tex, clamp(coord, vec2<i32>(0), maxCoord), 0);
}

// ============================================
// NORMAL CALCULATION
// ============================================
fn calculateNormal(input: VertexOutput) -> vec3<f32> {
    let normalSample = sampleRGBA32FBilinear(normalTexture, input.vUv).xyz;
    if (all(normalSample == vec3<f32>(0.0))) {
        return normalize(input.vNormal);
    }
    let tangentNormal = normalize(normalSample * 2.0 - 1.0);
    let worldUp = normalize(input.vNormal);
    var tangent = normalize(cross(worldUp, vec3<f32>(0.0, 0.0, 1.0)));
    if (length(tangent) < 0.1) {
        tangent = normalize(cross(worldUp, vec3<f32>(1.0, 0.0, 0.0)));
    }
    let bitangent = normalize(cross(worldUp, tangent));
    let TBN = mat3x3<f32>(tangent, bitangent, worldUp);
    var N = normalize(TBN * tangentNormal);
    if (dot(N, N) < 0.01) { N = worldUp; }
    return N;
}

// ============================================
// MICRO TEXTURE SAMPLING
// ============================================
fn sampleMicroTexture(input: VertexOutput, activeSeason: i32) -> vec4<f32> {
    let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let tIdx = floor(tCoord);
    let local = fract(tCoord);
    let worldTileCoord = fragUniforms.chunkOffset + tIdx;

    let tileUV = (tIdx + 0.5) / vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let tileSample = sampleRGBA32FNearest(tileTexture, clamp(tileUV, vec2<f32>(0.0), vec2<f32>(1.0)));

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

@fragment
fn main(input: VertexOutput) -> @location(0) vec4<f32> {
    let N = calculateNormal(input);
    
    // Debug modes
    if (DEBUG_MODE == 1) { return vec4<f32>(N * 0.5 + 0.5, 1.0); }
    if (DEBUG_MODE == 2) {
        let h = sampleRGBA32FBilinear(heightTexture, input.vUv).r;
        return vec4<f32>(vec3<f32>(h/50.0), 1.0);
    }
    
    var activeSeason = fragUniforms.currentSeason;
    if (fragUniforms.seasonTransition >= 0.5) { activeSeason = fragUniforms.nextSeason; }
    
    // Sample Micro Texture
    let microSample = sampleMicroTexture(input, activeSeason);
    if (microSample.a < 0.0) { discard; }
    
    var rgb = microSample.rgb;
    var a = microSample.a;
    
    // Retrieve Base Tile ID in MAIN scope
    let tCoordBase = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let tIdxBase = floor(tCoordBase);
    let tileUVBase = (tIdxBase + 0.5) / vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let tileSampleBase = sampleRGBA32FNearest(tileTexture, clamp(tileUVBase, vec2<f32>(0.0), vec2<f32>(1.0)));
    var tileId = tileSampleBase.r;
    if (tileId <= 1.0) { tileId = tileId * 255.0; }
    
    // ========== SPLAT LAYER (MANUAL 4-NEIGHBOR BLEND) ==========
    if ((DEBUG_MODE == 0 || DEBUG_MODE == 7 || DEBUG_MODE == 8) && 
        fragUniforms.enableSplatLayer > 0.5 && fragUniforms.geometryLOD < 2) {

        let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
        let tIdx = floor(tCoord);
        let local = fract(tCoord);
        
        // 1. Setup for Manual Bilinear Sampling
        // Note: splatDataMap dimension is expected to be chunkWidth * 4 if splatDensity=4
        // We need to sample 4 neighbors manually to prevent Type ID interpolation.
        
        let splatSize = vec2<f32>(textureDimensions(splatDataMap));
        let splatCoord = input.vUv * splatSize - 0.5; // Centers texels
        let baseSplIdx = vec2<i32>(floor(splatCoord));
        let fracSpl = fract(splatCoord);
        let maxSplCoord = vec2<i32>(splatSize) - vec2<i32>(1);

        var splatAccum = vec3<f32>(0.0);
        var totalSplatWeight = 0.0;
        
        // 2. Loop through 4 nearest neighbors (0,0), (1,0), (0,1), (1,1)
        for(var sy = 0; sy < 2; sy++) {
            for(var sx = 0; sx < 2; sx++) {
                let neighborCoord = clamp(baseSplIdx + vec2<i32>(sx, sy), vec2<i32>(0), maxSplCoord);
                
                // Fetch Exact Data (No Interpolation)
                let data = textureLoad(splatDataMap, neighborCoord, 0);
                
                // Calculate bilinear weight for this neighbor
                let bilinearW = (select(1.0 - fracSpl.x, fracSpl.x, sx == 1)) * (select(1.0 - fracSpl.y, fracSpl.y, sy == 1));
                
                // Process 2 Splats per Texel
                let w0 = data.r;
                let t0 = floor(data.g * 255.0 + 0.5);
                let w1 = data.b;
                let t1 = floor(data.a * 255.0 + 0.5);
                
                // Splat 1
                if (w0 > 0.001 && t0 > 0.5 && t0 != tileId) {
                    let varIdx = pickTileVariant(fragUniforms.chunkOffset + tIdx, t0, activeSeason);
                    let uvData = lookupTileTypeUVs(t0, activeSeason, varIdx);
                    let rot = calculateRotation(fragUniforms.chunkOffset + tIdx, t0, activeSeason, 9547.0);
                    let col = sampleAtlasTexture(uvData.xy, uvData.zw, rotateUV(local, rot), fragUniforms.atlasTextureSize);
                    
                    let finalW = w0 * bilinearW;
                    splatAccum += col.rgb * finalW;
                    totalSplatWeight += finalW;
                }
                
                // Splat 2
                if (w1 > 0.001 && t1 > 0.5 && t1 != tileId) {
                    let varIdx = pickTileVariant(fragUniforms.chunkOffset + tIdx, t1, activeSeason);
                    let uvData = lookupTileTypeUVs(t1, activeSeason, varIdx);
                    let rot = calculateRotation(fragUniforms.chunkOffset + tIdx, t1, activeSeason, 9600.0);
                    let col = sampleAtlasTexture(uvData.xy, uvData.zw, rotateUV(local, rot), fragUniforms.atlasTextureSize);
                    
                    let finalW = w1 * bilinearW;
                    splatAccum += col.rgb * finalW;
                    totalSplatWeight += finalW;
                }
            }
        }
        
        // 3. Blend Result
        if (totalSplatWeight > 0.0) {
            let splatColor = splatAccum / totalSplatWeight;
            let fadeFactor = fragUniforms.detailFade * (1.0 - f32(fragUniforms.geometryLOD) / 3.0);
            
            // Note: We clamp totalSplatWeight to max 1.0, otherwise we might over-brighten
            rgb = mix(rgb, splatColor, clamp(totalSplatWeight * fadeFactor, 0.0, 1.0));
            
            // Update alpha/roughness if needed
            a = max(a, totalSplatWeight);
        }
    }
    
    // ========== MACRO LAYER (FIXED PROCEDURAL MASKING) ==========
    if ((DEBUG_MODE == 0) && fragUniforms.enableMacroLayer > 0.5 && fragUniforms.geometryLOD == 0) {
        // 1. Calculate World Position for Procedural Noise
        let worldPos = fragUniforms.chunkOffset + input.vUv * fragUniforms.chunkWidth;
        
        // 2. Procedural Noise Mask Generation (Ported from WebGL2)
        let scale = 0.035;
        let patchNoise = octaveNoise(worldPos * scale, 4);
        
        let rot = mat2x2<f32>(0.866, -0.5, 0.5, 0.866);
        let streakNoise = octaveNoise((rot * worldPos) * (scale * 1.8), 2);
        
        let maskPatch = 1.0 - smoothstep(-0.28, 0.28, patchNoise);
        let maskStreak = 1.0 - smoothstep(-0.18, 0.18, streakNoise);
        let procMask = max(maskPatch, maskStreak);
        
        // 3. Sample Texture Mask (existing logic)
        let texMask = sampleRGBA32FBilinear(macroMaskTexture, input.vUv).r;
        
        // Combine Logic: In WebGL2, 'level2A' was multiplied by 'mask'. 
        // Here we use the texture mask as a base gate, but apply procedural noise to the result.
        
        if (texMask > 0.15) {
            let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
            let tIdx = floor(tCoord);
            let worldTileCoord = fragUniforms.chunkOffset + tIdx;
            let macroLocal = fract(tCoord) * fragUniforms.tileScale;
            
            var macroTileId = tileId; 
            if (macroTileId >= 100.0) { macroTileId = macroTileId - 100.0; }
            
            // Force Grass for macro (matching WebGL2 logic reference: macroTileId = 3.0)
            // But usually we want to respect the tile type if possible. 
            // The WebGL2 reference had "macroTileId = 3.0;" hardcoded near the end of that block.
            // You can uncomment the next line if you want strictly grass macro everywhere:
            // macroTileId = 3.0; 
            
            if (macroTileId >= 0.5) {
                let macroVarIdx = pickTileVariant(worldTileCoord, macroTileId, activeSeason);
                let macroUVs = lookupMacroTileTypeUVs(macroTileId, activeSeason, macroVarIdx);
                let macroRot = calculateRotation(worldTileCoord, macroTileId, activeSeason, 100.0);
                let rotatedMacroLocal = rotateUV(macroLocal, macroRot);
                
                var level2 = sampleMacroAtlasTexture(macroUVs.xy, macroUVs.zw, rotatedMacroLocal, fragUniforms.level2AtlasTextureSize);
                
                // 4. Apply Ditch Darkening (Procedural)
                let ditchScale = 1.2;
                let ditchRot = mat2x2<f32>(0.94, -0.34, 0.34, 0.94);
                let ditchDarken = 0.9;
                let ditchNoise = octaveNoise((ditchRot * worldPos) * ditchScale, 3);
                let ditchWidth = 0.015;
                let ditchMask = 1.0 - smoothstep(-ditchWidth, ditchWidth, ditchNoise);
                let luminanceMask = mix(1.0, ditchDarken, ditchMask);
                level2 = vec4<f32>(level2.rgb * luminanceMask, level2.a);

                // 5. Final Blend Calculation
                // Texture mask provides base transition
                // Procedural mask breaks it up naturally
                var level2A = fragUniforms.level2Blend * level2.a;
                
                // Apply procedural mask
                level2A = level2A * procMask;
                
                // Apply texture mask gate
                // Note: Removed the smoothstep(0.15, 0.82) clamping that might have hidden it too much
                // Use the texture mask primarily as an "area selector"
                if (texMask > 0.15) {
                    rgb = mix(rgb, level2.rgb, clamp(level2A, 0.0, 1.0));
                }
            }
        }
    }
    
    // Lighting & Final Output
    let sun = normalize(fragUniforms.sunLightDirection);
    let moon = normalize(fragUniforms.moonLightDirection);

    var shadow = 1.0;
    if (fragUniforms.geometryLOD < 2) {
        shadow = sampleShadowMap(input.vWorldPosition, N, input.vDistanceToCamera);
    }

    let NdLsun = max(dot(N, sun), 0.0) * shadow;
    let NdLmoon = max(dot(N, moon), 0.0);
    let hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    let ambient = mix(fragUniforms.groundAmbientColor, fragUniforms.skyAmbientColor, hemi) * fragUniforms.ambientLightIntensity;

    var directionalLight = fragUniforms.sunLightColor * fragUniforms.sunLightIntensity * NdLsun +
                           fragUniforms.moonLightColor * fragUniforms.moonLightIntensity * NdLmoon;

    var clusteredLight = vec3<f32>(0.0);
    if (fragUniforms.enableClusteredLights > 0.5 && fragUniforms.geometryLOD < 2) {
        clusteredLight = evaluateClusteredLights(input.vWorldPosition, input.vViewPosition, N, vec3<f32>(1.0));
    }

    var totalLight = directionalLight + ambient + clusteredLight;
    
    // Player/Thunder lights...
    if (fragUniforms.lodLevel < 2) {
         if (fragUniforms.thunderLightIntensity > 0.0) {
             totalLight += fragUniforms.thunderLightColor * fragUniforms.thunderLightIntensity * 0.5;
         }
         let toPlayer = fragUniforms.playerLightPosition - input.vWorldPosition;
         let distP = length(toPlayer);
         let attnP = clamp(1.0 - distP / fragUniforms.playerLightDistance, 0.0, 1.0);
         totalLight += fragUniforms.playerLightColor * fragUniforms.playerLightIntensity * attnP * max(dot(N, normalize(toPlayer)), 0.0);
    }
    
    if (fragUniforms.currentWeather >= 1.0) { totalLight *= mix(1.0, 0.6, fragUniforms.weatherIntensity); }
    if (fragUniforms.currentWeather >= 3.0) { totalLight *= mix(1.0, 0.8, fragUniforms.weatherIntensity); }

    var lit = rgb * totalLight;
    
    var fogF = 0.0;//1.0 - exp(-fragUniforms.fogDensity * input.vDistanceToCamera);
    if (fragUniforms.currentWeather >= 1.0) { fogF = mix(fogF, min(fogF * 1.5, 1.0), fragUniforms.weatherIntensity); }
    if (fragUniforms.currentWeather >= 3.0) { fogF = mix(fogF, min(fogF * 3.0, 1.0), fragUniforms.weatherIntensity); }

    return vec4<f32>(mix(lit, fragUniforms.fogColor, clamp(fogF, 0.0, 1.0)), a);
}
`;
}