
import { getAerialPerspectiveWGSL } from '../../../../atmosphere/shaders/aerialPerspective.js';

export function buildTerrainChunkFragmentShader(options = {}) {
    const maxLightIndices = options.maxLightIndices || 8192;
    const aerialPerspectiveCode = getAerialPerspectiveWGSL();

    return `
// ============================================================================
// DEBUG MODE CONSTANTS
// ============================================================================
const DEBUG_MODE: i32 = 0;

// ============================================================================
// UNIFORM STRUCTURES
// ============================================================================

struct FragmentUniforms {
    cameraPosition: vec3<f32>,
    time: f32,

    chunkOffset: vec2<f32>,
    chunkWidth: f32,
    chunkHeight: f32,

    lightDirection: vec3<f32>,
    _pad0: f32,

    lightColor: vec3<f32>,
    _pad1: f32,

    ambientColor: vec3<f32>,
    enableSplatLayer: f32,

    enableMacroLayer: f32,
    geometryLOD: i32,
    currentSeason: i32,
    nextSeason: i32,

    seasonTransition: f32,
    atlasTextureSize: f32,
    _padAtlas: f32,
    _pad2: f32,

    atlasUVOffset: vec2<f32>,
    atlasUVScale: f32,
    useAtlasMode: i32,

    isFeature: f32,
    aerialPerspectiveEnabled: f32,
    _pad3: f32,
    _pad4: f32,

    planetCenter: vec3<f32>,
    atmospherePlanetRadius: f32,

    atmosphereRadius: f32,
    atmosphereScaleHeightRayleigh: f32,
    atmosphereScaleHeightMie: f32,
    atmosphereMieAnisotropy: f32,

    atmosphereRayleighScattering: vec3<f32>,
    atmosphereMieScattering: f32,

    atmosphereSunIntensity: f32,
    fogDensity: f32,
    fogScaleHeight: f32,
    _pad5: f32,

    fogColor: vec3<f32>,
    _pad6: f32,
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

// ============================================================================
// BIND GROUPS
// ============================================================================

// Group 0: Uniform Buffers
@group(0) @binding(1) var<uniform> fragUniforms: FragmentUniforms;

// Group 1: Per-Chunk Textures
@group(1) @binding(0) var heightTexture: texture_2d<f32>;
@group(1) @binding(1) var normalTexture: texture_2d<f32>;
@group(1) @binding(2) var tileTexture: texture_2d<f32>;
@group(1) @binding(3) var splatDataMap: texture_2d<f32>;
@group(1) @binding(4) var macroMaskTexture: texture_2d<f32>;

// Group 2: Atlas Textures & Lookups
@group(2) @binding(0) var atlasTexture: texture_2d<f32>;
@group(2) @binding(1) var level2AtlasTexture: texture_2d<f32>;
@group(2) @binding(2) var tileTypeLookup: texture_2d<f32>;
@group(2) @binding(3) var macroTileTypeLookup: texture_2d<f32>;
@group(2) @binding(4) var numVariantsTex: texture_2d<f32>;
@group(2) @binding(5) var textureSampler: sampler;
@group(2) @binding(6) var nearestSampler: sampler;

// Group 3: Shadows, Clusters, and Atmosphere
@group(3) @binding(7) var transmittanceLUT: texture_2d<f32>;
@group(3) @binding(8) var transmittanceSampler: sampler;

// ============================================================================
// AERIAL PERSPECTIVE FUNCTIONS
// ============================================================================

${aerialPerspectiveCode}

// ============================================================================
// ALTITUDE-BASED FOG
// ============================================================================

fn computeAltitudeFog(
    color: vec3<f32>,
    distance: f32,
    viewerAltitude: f32,
    targetAltitude: f32,
    fogDensity: f32,
    scaleHeight: f32,
    fogColor: vec3<f32>
) -> vec3<f32> {
    let avgAltitude = (viewerAltitude + targetAltitude) * 0.5;
    let density = fogDensity * exp(-avgAltitude / scaleHeight);
    let opticalDepth = density * distance;
    let transmittance = exp(-opticalDepth);
    return mix(fogColor, color, transmittance);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn sampleRGBA32FBilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<f32>(textureDimensions(tex));
    let coord = uv * size - 0.5;
    let base = floor(coord);
    let f = fract(coord);
    let maxCoord = vec2<i32>(textureDimensions(tex)) - vec2<i32>(1);
    let c00 = textureLoad(tex, clamp(vec2<i32>(base), vec2<i32>(0), maxCoord), 0);
    let c10 = textureLoad(tex, clamp(vec2<i32>(base) + vec2<i32>(1,0), vec2<i32>(0), maxCoord), 0);
    let c01 = textureLoad(tex, clamp(vec2<i32>(base) + vec2<i32>(0,1), vec2<i32>(0), maxCoord), 0);
    let c11 = textureLoad(tex, clamp(vec2<i32>(base) + vec2<i32>(1,1), vec2<i32>(0), maxCoord), 0);
    return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

fn sampleRGBA32FNearest(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(tex));
    let coord = vec2<i32>(floor(uv * texSize));
    let maxCoord = vec2<i32>(texSize) - vec2<i32>(1);
    return textureLoad(tex, clamp(coord, vec2<i32>(0), maxCoord), 0);
}

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

fn applyChunkAtlasUV(uv: vec2<f32>, tex: texture_2d<f32>) -> vec2<f32> {
    if (fragUniforms.useAtlasMode == 0) {
        return uv;
    }
    let texSize = vec2<f32>(textureDimensions(tex));
    let halfPix = 0.5 / texSize;
    let offset = fragUniforms.atlasUVOffset;
    let scale = fragUniforms.atlasUVScale;
    return offset + clamp(uv, halfPix, vec2<f32>(1.0) - halfPix) * scale;
}

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
    let lookupSize = vec2<i32>(textureDimensions(tileTypeLookup));
    let maxVariants = lookupSize.x / 4;
    let x = (season * maxVariants + (variantIdx % maxVariants)) % lookupSize.x;
    let y = i32(tileId) % lookupSize.y;
    return textureLoad(tileTypeLookup, vec2<i32>(x, y), 0);
}

fn lookupMacroTileTypeUVs(tileId: f32, season: i32, variantIdx: i32) -> vec4<f32> {
    let lookupSize = vec2<i32>(textureDimensions(macroTileTypeLookup));
    let maxVariants = lookupSize.x / 4;
    let x = (season * maxVariants + (variantIdx % maxVariants)) % lookupSize.x;
    let y = i32(tileId) % lookupSize.y;
    return textureLoad(macroTileTypeLookup, vec2<i32>(x, y), 0);
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

fn sampleAtlasTextureGrad(
    uvOffset: vec2<f32>,
    uvScale: vec2<f32>,
    rotatedLocalUv: vec2<f32>,
    nonWrappingUv: vec2<f32>,
    ddx_vUv: vec2<f32>,
    ddy_vUv: vec2<f32>
) -> vec4<f32> {
    let uvRange = uvScale;
    let chunkDims = vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let localUv = fract(nonWrappingUv * chunkDims);
    let diff = abs(rotatedLocalUv - localUv);

    var scaledDx: vec2<f32>;
    var scaledDy: vec2<f32>;

    if (diff.x > 0.5 && diff.y > 0.5) {
        if (rotatedLocalUv.x > 0.5) {
            scaledDx = vec2<f32>(-ddy_vUv.x, ddy_vUv.y) * uvRange;
            scaledDy = vec2<f32>(ddx_vUv.x, -ddx_vUv.y) * uvRange;
        } else {
            scaledDx = vec2<f32>(ddy_vUv.x, -ddy_vUv.y) * uvRange;
            scaledDy = vec2<f32>(-ddx_vUv.x, ddx_vUv.y) * uvRange;
        }
    } else {
        scaledDx = ddx_vUv * uvRange;
        scaledDy = ddy_vUv * uvRange;
    }

    let atlasSize = vec2<f32>(textureDimensions(atlasTexture));
    let epsilon = 0.5 / atlasSize;
    let safeMin = uvOffset + epsilon;
    let safeMax = uvOffset + uvScale - epsilon;
    let atlasUv = mix(safeMin, safeMax, rotatedLocalUv);

    return textureSampleGrad(atlasTexture, textureSampler, atlasUv, scaledDx, scaledDy);
}

fn sampleMacroAtlasTextureGrad(
    uvOffset: vec2<f32>,
    uvScale: vec2<f32>,
    rotatedLocalUv: vec2<f32>,
    nonWrappingUv: vec2<f32>,
    ddx_vUv: vec2<f32>,
    ddy_vUv: vec2<f32>
) -> vec4<f32> {
    let uvRange = uvScale;
    let chunkDims = vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let localUv = fract(nonWrappingUv * chunkDims);
    let diff = abs(rotatedLocalUv - localUv);

    var scaledDx: vec2<f32>;
    var scaledDy: vec2<f32>;

    if (diff.x > 0.5 && diff.y > 0.5) {
        if (rotatedLocalUv.x > 0.5) {
            scaledDx = vec2<f32>(-ddy_vUv.x, ddy_vUv.y) * uvRange;
            scaledDy = vec2<f32>(ddx_vUv.x, -ddx_vUv.y) * uvRange;
        } else {
            scaledDx = vec2<f32>(ddy_vUv.x, -ddy_vUv.y) * uvRange;
            scaledDy = vec2<f32>(-ddx_vUv.x, ddx_vUv.y) * uvRange;
        }
    } else {
        scaledDx = ddx_vUv * uvRange;
        scaledDy = ddy_vUv * uvRange;
    }

    let atlasSize = vec2<f32>(textureDimensions(level2AtlasTexture));
    let epsilon = 0.5 / atlasSize;
    let safeMin = uvOffset + epsilon;
    let safeMax = uvOffset + uvScale - epsilon;
    let atlasUv = mix(safeMin, safeMax, rotatedLocalUv);

    return textureSampleGrad(level2AtlasTexture, textureSampler, atlasUv, scaledDx, scaledDy);
}

fn sampleTileColor(tileId: f32, worldTileCoord: vec2<f32>, local: vec2<f32>, activeSeason: i32, baseUv: vec2<f32>, ddx_vUv: vec2<f32>, ddy_vUv: vec2<f32>) -> vec4<f32> {
    if (tileId < 0.5) {
        return vec4<f32>(0.0, 0.0, 0.0, -1.0);
    }
    let r = calculateRotation(worldTileCoord, tileId, activeSeason, 9547.0 + tileId * 31.0);
    let tileVariantIdx = pickTileVariant(worldTileCoord, tileId, activeSeason);
    let d = lookupTileTypeUVs(tileId, activeSeason, tileVariantIdx);
    let uvOffset = d.xy;
    let uvScale = max(d.zw - d.xy, vec2<f32>(0.0005, 0.0005));
    let rotatedLocal = clamp(rotateUV(local, r), vec2<f32>(0.0), vec2<f32>(1.0));
    return sampleAtlasTextureGrad(uvOffset, uvScale, rotatedLocal, baseUv, ddx_vUv, ddy_vUv);
}

fn sampleMacroTileColor(tileId: f32, worldTileCoord: vec2<f32>, local: vec2<f32>, activeSeason: i32, baseUv: vec2<f32>, ddx_vUv: vec2<f32>, ddy_vUv: vec2<f32>) -> vec4<f32> {
    if (tileId < 0.5) { return vec4<f32>(0.0); }
    let r = calculateRotation(worldTileCoord, tileId, activeSeason, 100.0 + tileId * 13.0);
    let varIdx = pickTileVariant(worldTileCoord, tileId, activeSeason);
    let d = lookupMacroTileTypeUVs(tileId, activeSeason, varIdx);
    let uvOffset = d.xy;
    let uvScale = max(d.zw - d.xy, vec2<f32>(0.0005, 0.0005));
    let rotatedLocal = clamp(rotateUV(local, r), vec2<f32>(0.0), vec2<f32>(1.0));
    return sampleMacroAtlasTextureGrad(uvOffset, uvScale, rotatedLocal, baseUv, ddx_vUv, ddy_vUv);
}

fn sampleMicroTexture(input: VertexOutput, activeSeason: i32, ddx_vUv: vec2<f32>, ddy_vUv: vec2<f32>) -> vec4<f32> {
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
    let uvOffset = d.xy;
    let uvScale = max(d.zw - d.xy, vec2<f32>(0.0005, 0.0005));
    let rotatedLocal = clamp(rotateUV(local, r), vec2<f32>(0.0), vec2<f32>(1.0));
    return sampleAtlasTextureGrad(uvOffset, uvScale, rotatedLocal, input.vUv, ddx_vUv, ddy_vUv);
}

// ============================================================================
// MAIN FRAGMENT FUNCTION
// ============================================================================

@fragment
fn main(input: VertexOutput) -> @location(0) vec4<f32> {
    let activeSeason = select(fragUniforms.nextSeason, fragUniforms.currentSeason, fragUniforms.seasonTransition < 0.5);

    // Debug modes
    if (DEBUG_MODE == 1) {
        let N = normalize(calculateNormal(input));
        var normalColor = N * 0.5 + 0.5;
        let lightDir = normalize(fragUniforms.lightDirection);
        let NdotL = max(dot(N, lightDir), 0.0);
        let skyColor = vec3<f32>(0.55, 0.65, 0.85);
        let groundColor = vec3<f32>(0.2, 0.18, 0.16);
        let hemi = mix(groundColor, skyColor, N.y * 0.5 + 0.5);
        var shaded = normalColor * (0.25 + 0.75 * NdotL) + hemi * 0.3;
        shaded = pow(shaded, vec3<f32>(0.8));
        return vec4<f32>(shaded, 1.0);
    }

    if (DEBUG_MODE == 20) {
        let uv = ap_getTransmittanceUV(
            input.vDistanceToCamera * 0.01,
            0.5,
            fragUniforms.atmospherePlanetRadius,
            fragUniforms.atmosphereRadius
        );
        return vec4<f32>(uv.x, uv.y, 0.0, 1.0);
    }

    if (DEBUG_MODE == 21) {
        let transmittance = textureSample(transmittanceLUT, transmittanceSampler, input.vUv).rgb;
        return vec4<f32>(transmittance, 1.0);
    }

    let chunkDims = vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
    let ddx_vUv = dpdx(input.vUv) * chunkDims;
    let ddy_vUv = dpdy(input.vUv) * chunkDims;

    let microSample = sampleMicroTexture(input, activeSeason, ddx_vUv, ddy_vUv);

    if (microSample.a < 0.0) {
        discard;
    }

    var baseColor = microSample.rgb;

    // SPLAT LAYER
    if (fragUniforms.enableSplatLayer > 0.5 && fragUniforms.geometryLOD < 2) {
        let splatUV = applyChunkAtlasUV(input.vUv, splatDataMap);
        let splatSample = sampleRGBA32FNearest(splatDataMap, splatUV);
        let w0 = splatSample.r;
        let id0 = splatSample.g * 255.0;
        let w1 = splatSample.b;
        let id1 = splatSample.a * 255.0;
        let totalW = w0 + w1;
        if (totalW > 0.0001) {
            let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
            let tIdx = floor(tCoord);
            let local = fract(tCoord);
            let worldTileCoord = fragUniforms.chunkOffset + tIdx;
            let c0 = sampleTileColor(id0, worldTileCoord, local, activeSeason, input.vUv, ddx_vUv, ddy_vUv).rgb;
            let c1 = sampleTileColor(id1, worldTileCoord, local, activeSeason, input.vUv, ddx_vUv, ddy_vUv).rgb;
            let w0n = w0 / totalW;
            let w1n = w1 / totalW;
            let splatColor = c0 * w0n + c1 * w1n;
            baseColor = mix(baseColor, splatColor, clamp(totalW, 0.0, 1.0));
        }
    }

    // MACRO LAYER
    if (fragUniforms.enableMacroLayer > 0.5 && fragUniforms.geometryLOD == 0) {
        var macroMaskUV = input.vUv;
        if (fragUniforms.useAtlasMode != 0) {
            macroMaskUV = applyChunkAtlasUV(input.vUv, macroMaskTexture);
        }
        let macroMask = sampleRGBA32FBilinear(macroMaskTexture, macroMaskUV).r;
        if (macroMask > 0.05) {
            let tCoord = input.vUv * vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
            let tIdx = floor(tCoord);
            let local = fract(tCoord);
            let worldTileCoord = fragUniforms.chunkOffset + tIdx;
            let tileUV = (tIdx + 0.5) / vec2<f32>(fragUniforms.chunkWidth, fragUniforms.chunkHeight);
            let tileSample = sampleRGBA32FNearest(tileTexture, applyChunkAtlasUV(clamp(tileUV, vec2<f32>(0.0), vec2<f32>(1.0)), tileTexture));
            var macroTileId: f32;
            if (tileSample.r > 1.0) { macroTileId = tileSample.r; }
            else { macroTileId = tileSample.r * 255.0; }
            if (macroTileId >= 100.0) { macroTileId = macroTileId - 100.0; }

            let worldPosMeters = input.vWorldPosition.xz;
            let scaleMacro = 0.0008;
            let patchNoise = octaveNoise(worldPosMeters * scaleMacro, 4);
            let rot = mat2x2<f32>(0.866, -0.5, 0.5, 0.866);
            let streakNoise = octaveNoise((rot * worldPosMeters) * (scaleMacro * 1.35), 3);
            let maskPatch = 1.0 - smoothstep(-0.15, 0.15, patchNoise);
            let maskStreak = 1.0 - smoothstep(-0.12, 0.12, streakNoise);
            let procMask = max(maskPatch, maskStreak);

            let macroCol = sampleMacroTileColor(macroTileId, worldTileCoord, local, activeSeason, input.vUv, ddx_vUv, ddy_vUv);

            let ditchScale = 1.0;
            let ditchRot = mat2x2<f32>(0.94, -0.34, 0.34, 0.94);
            let ditchDarken = 0.8;
            let ditchNoise = octaveNoise((ditchRot * worldPosMeters) * ditchScale, 3);
            let ditchWidth = 0.01;
            let ditchMask = 1.0 - smoothstep(-ditchWidth, ditchWidth, ditchNoise);
            let luminanceMask = mix(1.0, ditchDarken, ditchMask);

            let fineScale = 0.012;
            let fineNoise = octaveNoise(worldPosMeters * fineScale, 2);
            let fineMask = smoothstep(0.3, 0.7, fineNoise);

            let macroStrength = clamp(macroMask * procMask * 0.8, 0.0, 0.85);
            let macroMixed = mix(baseColor, macroCol.rgb * luminanceMask, macroStrength);
            baseColor = mix(macroMixed, baseColor, fineMask * 0.1);
        }
    }

    // Micro crack detail
    if (fragUniforms.geometryLOD < 3) {
        let crackPos = input.vWorldPosition.xz;
        let crackScale = 0.08;
        let crackNoise = octaveNoise(crackPos * crackScale, 3);
        let crackMask = smoothstep(0.4, 0.6, crackNoise);
        let crackDarken = mix(1.0, 0.85, crackMask);
        baseColor *= crackDarken;
    }

    // Lighting
    let worldNormal = calculateNormal(input);
    let lightDir = normalize(fragUniforms.lightDirection);
    let NdotL = max(dot(worldNormal, lightDir), 0.0);
    let ambient = fragUniforms.ambientColor * 0.35;
    let diffuse = fragUniforms.lightColor * NdotL * 0.9;
    var finalColor = baseColor * (ambient + diffuse);

    // ========================================================================
    // AERIAL PERSPECTIVE
    // ========================================================================
    if (fragUniforms.aerialPerspectiveEnabled > 0.5) {
        let apResult = ap_computeSimple(
            transmittanceLUT,
            transmittanceSampler,
            input.vWorldPosition,
            fragUniforms.cameraPosition,
            lightDir,
            fragUniforms.planetCenter,
            fragUniforms.atmospherePlanetRadius,
            fragUniforms.atmosphereRadius,
            fragUniforms.atmosphereScaleHeightRayleigh,
            fragUniforms.atmosphereScaleHeightMie,
            fragUniforms.atmosphereRayleighScattering,
            fragUniforms.atmosphereMieScattering,
            fragUniforms.atmosphereMieAnisotropy,
            fragUniforms.atmosphereSunIntensity
        );

        let apBlend = clamp(input.vDistanceToCamera / 50000.0, 0.0, 1.0);
        finalColor = ap_applyWithBlend(finalColor, apResult, apBlend);
    }

    // ========================================================================
    // ALTITUDE-BASED FOG (applied after aerial perspective)
    // ========================================================================
    let viewerAlt = length(fragUniforms.cameraPosition - fragUniforms.planetCenter) - fragUniforms.atmospherePlanetRadius;
    let fragAlt = length(input.vWorldPosition - fragUniforms.planetCenter) - fragUniforms.atmospherePlanetRadius;
    finalColor = computeAltitudeFog(
        finalColor,
        input.vDistanceToCamera,
        max(0.0, viewerAlt),
        max(0.0, fragAlt),
        fragUniforms.fogDensity,
        fragUniforms.fogScaleHeight,
        fragUniforms.fogColor
    );

    return vec4<f32>(finalColor, 1.0);
}
`;
}
