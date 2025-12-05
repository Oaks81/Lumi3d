
import { getClusteredLightingModule } from '../../../../lighting/clusteredLightModule.js';

export function buildTerrainChunkFragmentShader(options = {}) {
    const maxLightIndices = options.maxLightIndices || 8192;
    const clusteredModule = getClusteredLightingModule(maxLightIndices);

    return `#version 300 es
precision highp float;
precision highp int;

#define MAX_TILE_TYPES 256
#define MAX_SEASONS 4
#define MAX_VARIANTS 8

layout(location = 0) out vec4 fragColor;

${clusteredModule}

uniform sampler2D heightTexture;
uniform sampler2D normalTexture;
uniform sampler2D tileTexture;
uniform sampler2D splatDataMap;
uniform sampler2D macroMaskTexture;

uniform sampler2D tileTypeLookup;
uniform sampler2D macroTileTypeLookup;
uniform sampler2D numVariantsTex;

uniform sampler2D atlasTexture;
uniform vec2 atlasTextureSize;
uniform sampler2D level2AtlasTexture;
uniform vec2 level2AtlasTextureSize;

uniform float useAtlasMode;
uniform vec2 atlasUVOffset;
uniform float atlasUVScale;

uniform float chunkWidth;
uniform float chunkHeight;
uniform vec2 chunkOffset;
uniform float chunkSize;
uniform float tileScale;
uniform float level2Blend;

uniform float splatLODBias;
uniform float macroLODBias;
uniform float detailFade;
uniform float enableSplatLayer;
uniform float enableMacroLayer;
uniform float enableClusteredLights;
uniform int geometryLOD;
uniform int lodLevel;
uniform float isFeature;

uniform int currentSeason;
uniform int nextSeason;
uniform float seasonTransition;

uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 sunLightColor;
uniform float sunLightIntensity;
uniform vec3 sunLightDirection;
uniform vec3 moonLightColor;
uniform float moonLightIntensity;
uniform vec3 moonLightDirection;
uniform vec3 ambientLightColor;
uniform float ambientLightIntensity;
uniform vec3 skyAmbientColor;
uniform vec3 groundAmbientColor;
uniform float weatherIntensity;
uniform float currentWeather;
uniform float thunderLightIntensity;
uniform vec3 thunderLightColor;
uniform vec3 playerLightColor;
uniform float playerLightIntensity;
uniform vec3 playerLightPosition;
uniform float playerLightDistance;

uniform sampler2D shadowMapCascade0;
uniform sampler2D shadowMapCascade1;
uniform sampler2D shadowMapCascade2;
uniform mat4 shadowMatrixCascade0;
uniform mat4 shadowMatrixCascade1;
uniform mat4 shadowMatrixCascade2;
uniform vec3 cascadeSplits;
uniform int numCascades;
uniform float shadowBias;
uniform float shadowNormalBias;
uniform float shadowMapSize;
uniform float receiveShadow;

in vec2 vUv;
in vec3 vNormal;
in vec3 vWorldPosition;
in float vDistanceToCamera;
in vec3 vViewPosition;
in vec2 vWorldPos;
in float vHeight;

in float vDebugChunkFace;
in float vDebugChunkSizeUV;
in vec2 vDebugChunkLocation;
in vec2 vDebugFaceUV;

const float PI = 3.14159265359;

// ============================================
// DEBUG MODE
// 0 = Normal rendering (WITH FOG FIX)
// 22 = level1 texture
// 25 = lit (texture * light)
// 26 = final with fog
// 51 = sunLightIntensity only (as greyscale)
// 52 = ambientLightIntensity only
// 53 = fogDensity raw value * 10000
// 54 = vDistanceToCamera / 100000 (for spherical scale)
// 55 = fogF with FIXED density
// 56 = Final with FIXED fog (density = 0.00001)
// 60 = splatDataMap raw sample
// 61 = splat weights visualization
// 62 = splat types visualization
// 63 = macroMaskTexture raw sample
// 64 = level2 (macro) texture sample
// 65 = level2AtlasTexture direct sample
// 66 = enableSplatLayer / enableMacroLayer flags
// ============================================
#define DEBUG_MODE 0

vec2 applyAtlasTransform(vec2 localUV) {
    if (useAtlasMode > 0.5) {
        return atlasUVOffset + localUV * atlasUVScale;
    }
    return localUV;
}

${includeShadowFunctions()}
${includeHelperFunctions()}

void main() {
    int activeSeason = (seasonTransition < 0.5) ? currentSeason : nextSeason;

    // Common calculations
    vec2 tCoord = vUv * vec2(chunkWidth, chunkHeight);
    vec2 tIdx = floor(tCoord);
    vec2 local = fract(tCoord);
    vec2 worldTileCoord = chunkOffset + tIdx;

    vec2 tileUV = (tIdx + 0.5) / vec2(chunkWidth, chunkHeight);
    tileUV = clamp(tileUV, vec2(0.0), vec2(1.0));
    vec2 atlasTileUV = applyAtlasTransform(tileUV);
    
    vec4 tileSample = texture(tileTexture, atlasTileUV);
    float rawVal = tileSample.r;
    float tileId = (rawVal > 1.0) ? rawVal : (rawVal * 255.0);

    float rotVal = calculateRotation(worldTileCoord, tileId, activeSeason, 9547.0);
    int tileVariantIdx = pickTileVariant(worldTileCoord, tileId, activeSeason);
    vec4 d = lookupTileTypeUVs(tileId, activeSeason, tileVariantIdx);

    vec2 chunkDims = vec2(chunkWidth, chunkHeight);
    vec2 rotatedLocal = rotateUV(local, rotVal);
    rotatedLocal = clamp(rotatedLocal, 0.0, 1.0);

    // Normal calculation
    vec3 N;
    vec2 normalSampleUV = applyAtlasTransform(vUv);
    vec3 normalSample = texture(normalTexture, normalSampleUV).xyz;
    
    if (length(normalSample) > 0.01) {
        vec3 tangentNormal = normalize(normalSample * 2.0 - 1.0);
        vec3 worldUp = normalize(vNormal);
        vec3 tangent = normalize(cross(worldUp, vec3(0.0, 0.0, 1.0)));
        if (length(tangent) < 0.1) {
            tangent = normalize(cross(worldUp, vec3(1.0, 0.0, 0.0)));
        }
        vec3 bitangent = normalize(cross(worldUp, tangent));
        mat3 TBN = mat3(tangent, bitangent, worldUp);
        N = normalize(TBN * tangentNormal);
        if (dot(N, N) < 0.01 || any(isnan(N))) {
            N = worldUp;
        }
    } else {
        N = normalize(vNormal);
    }

    // Get level1 sample
    vec4 level1 = sampleTextureWithGradients(
        atlasTexture,
        d.xy, d.zw,
        rotatedLocal,
        vUv,
        chunkDims,
        atlasTextureSize,
        splatLODBias * float(geometryLOD),
        rotVal
    );

    // ============================================
    // DEBUG MODE 22: level1 atlas sample
    // ============================================
    #if DEBUG_MODE == 22
        fragColor = vec4(level1.rgb, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 51: sunLightIntensity only
    // ============================================
    #if DEBUG_MODE == 51
        fragColor = vec4(sunLightIntensity, sunLightIntensity, sunLightIntensity, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 52: ambientLightIntensity only
    // ============================================
    #if DEBUG_MODE == 52
        fragColor = vec4(ambientLightIntensity, ambientLightIntensity, ambientLightIntensity, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 53: fogDensity * 10000
    // ============================================
    #if DEBUG_MODE == 53
        float fd53 = fogDensity * 10000.0;
        fragColor = vec4(fd53, fd53, fd53, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 54: vDistanceToCamera / 100000
    // ============================================
    #if DEBUG_MODE == 54
        float dist54 = vDistanceToCamera / 100000.0;
        fragColor = vec4(dist54, dist54, dist54, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 55: fogF with test density
    // ============================================
    #if DEBUG_MODE == 55
        float testDensity = 0.00001; // Very low for spherical distances
        float fogF55 = 1.0 - exp(-testDensity * vDistanceToCamera);
        fragColor = vec4(fogF55, fogF55, fogF55, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 56: Final with FIXED low fog
    // ============================================
    #if DEBUG_MODE == 56
        vec3 baseColor56 = level1.rgb;
        
        vec3 sun56 = normalize(sunLightDirection);
        float NdLsun56 = max(dot(N, sun56), 0.0);
        
        // Use hardcoded lighting values
        vec3 hardcodedSunColor = vec3(1.0, 0.95, 0.8);
        float hardcodedSunIntensity = 1.0;
        vec3 hardcodedAmbient = vec3(0.3, 0.35, 0.4);
        
        vec3 direct56 = hardcodedSunColor * hardcodedSunIntensity * NdLsun56;
        vec3 totalLight56 = direct56 + hardcodedAmbient;
        
        vec3 lit56 = baseColor56 * totalLight56;
        
        // Use very low fog density for spherical
        float fixedFogDensity = 0.000005;
        float fogF56 = 1.0 - exp(-fixedFogDensity * vDistanceToCamera);
        fogF56 = clamp(fogF56, 0.0, 0.5); // Cap fog at 50%
        
        vec3 fixedFogColor = vec3(0.7, 0.8, 0.9); // Light blue fog
        vec3 finalRGB56 = mix(lit56, fixedFogColor, fogF56);
        
        fragColor = vec4(finalRGB56, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 60: splatDataMap raw sample
    // ============================================
    #if DEBUG_MODE == 60
        vec2 splatUV60 = applyAtlasTransform(vUv);
        vec4 splatRaw = texture(splatDataMap, splatUV60);
        fragColor = vec4(splatRaw.rgb, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 61: splat weights visualization
    // ============================================
    #if DEBUG_MODE == 61
        vec2 splatUV61 = applyAtlasTransform(vUv);
        vec4 splatData61 = texture(splatDataMap, splatUV61);
        float w1 = splatData61.r;
        float w2 = splatData61.b;
        // R = weight1, G = weight2, B = sum
        fragColor = vec4(w1, w2, w1 + w2, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 62: splat types visualization
    // ============================================
    #if DEBUG_MODE == 62
        vec2 splatUV62 = applyAtlasTransform(vUv);
        vec4 splatData62 = texture(splatDataMap, splatUV62);
        float type1 = splatData62.g * 255.0;
        float type2 = splatData62.a * 255.0;
        // Color code types
        vec3 col62;
        if (type1 < 3.5) col62 = vec3(0.0, 1.0, 0.0); // grass = green
        else if (type1 < 7.5) col62 = vec3(0.5, 0.3, 0.1); // rock = brown
        else col62 = vec3(0.3, 0.5, 0.7); // tundra = blue
        fragColor = vec4(col62, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 63: macroMaskTexture raw sample
    // ============================================
    #if DEBUG_MODE == 63
        vec2 macroUV63 = applyAtlasTransform(vUv);
        vec4 macroMask63 = texture(macroMaskTexture, macroUV63);
        fragColor = vec4(macroMask63.r, macroMask63.r, macroMask63.r, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 64: level2 (macro) texture sample
    // ============================================
    #if DEBUG_MODE == 64
        vec2 macroTileIdx64 = floor(worldTileCoord);
        vec2 macroLocal64 = fract(tCoord) * tileScale;
        float macroTileId64 = tileId;
        if (macroTileId64 >= 100.0) macroTileId64 -= 100.0;
        
        int macroVarIdx64 = pickTileVariant(macroTileIdx64, macroTileId64, activeSeason);
        vec4 macroUVs64 = lookupMacroTileTypeUVs(macroTileId64, activeSeason, macroVarIdx64);
        float macroRot64 = calculateRotation(macroTileIdx64, macroTileId64, activeSeason, 100.0);
        vec2 rotatedMacroLocal64 = rotateUV(macroLocal64, macroRot64);
        
        vec4 level2_64 = sampleTextureWithGradients(
            level2AtlasTexture,
            macroUVs64.xy, macroUVs64.zw,
            rotatedMacroLocal64,
            vUv,
            chunkDims,
            level2AtlasTextureSize,
            0.0,
            macroRot64
        );
        fragColor = vec4(level2_64.rgb, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 65: level2AtlasTexture direct sample
    // ============================================
    #if DEBUG_MODE == 65
        vec4 macro65 = texture(level2AtlasTexture, vUv * 0.2);
        fragColor = vec4(macro65.rgb, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 66: enableSplatLayer / enableMacroLayer
    // ============================================
    #if DEBUG_MODE == 66
        // R = enableSplatLayer, G = enableMacroLayer, B = geometryLOD/4
        fragColor = vec4(enableSplatLayer, enableMacroLayer, float(geometryLOD) / 4.0, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 25: lit (texture * light)
    // ============================================
    #if DEBUG_MODE == 25
        vec3 baseColor25 = level1.rgb;
        
        vec3 sun25 = normalize(sunLightDirection);
        float NdLsun25 = max(dot(N, sun25), 0.0);
        
        float hemi25 = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 ambient25 = mix(groundAmbientColor, skyAmbientColor, hemi25) * ambientLightIntensity;
        vec3 direct25 = sunLightColor * sunLightIntensity * NdLsun25;
        vec3 totalLight25 = direct25 + ambient25;
        
        vec3 lit25 = baseColor25 * totalLight25;
        fragColor = vec4(lit25, 1.0);
        return;
    #endif

    // ============================================
    // DEBUG MODE 26: final with fog
    // ============================================
    #if DEBUG_MODE == 26
        vec3 baseColor26 = level1.rgb;
        
        vec3 sun26 = normalize(sunLightDirection);
        float NdLsun26 = max(dot(N, sun26), 0.0);
        
        float hemi26 = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 ambient26 = mix(groundAmbientColor, skyAmbientColor, hemi26) * ambientLightIntensity;
        vec3 direct26 = sunLightColor * sunLightIntensity * NdLsun26;
        vec3 totalLight26 = direct26 + ambient26;
        
        vec3 lit26 = baseColor26 * totalLight26;
        
        float fogF26 = 1.0 - exp(-fogDensity * vDistanceToCamera);
        vec3 finalRGB26 = mix(lit26, fogColor, clamp(fogF26, 0.0, 1.0));
        
        fragColor = vec4(finalRGB26, 1.0);
        return;
    #endif

    // ============================================
    // NORMAL RENDERING (DEBUG_MODE == 0)
    // Uses FIXED fog for spherical terrain
    // ============================================
    
    if (isFeature < 0.5 && tileId >= 100.0) {
        discard;
        return;
    }

    vec3 rgb = level1.rgb;
    float a = level1.a;

    // Macro layer
    vec4 level2 = vec4(0.0);
    float level2A = 0.0;

    if (enableMacroLayer > 0.5 && geometryLOD == 0) {
        vec2 macroTileIdx = floor(worldTileCoord);
        vec2 macroLocal = fract(tCoord) * tileScale;
        float macroTileId = tileId;

        if (macroTileId >= 0.5) {
            if (macroTileId >= 100.0) macroTileId -= 100.0;

            int macroVarIdx = pickTileVariant(macroTileIdx, macroTileId, activeSeason);
            vec4 macroUVs = lookupMacroTileTypeUVs(macroTileId, activeSeason, macroVarIdx);
            float macroRot = calculateRotation(macroTileIdx, macroTileId, activeSeason, 100.0);

            vec2 rotatedMacroLocal = rotateUV(macroLocal, macroRot);

            level2 = sampleTextureWithGradients(
                level2AtlasTexture,
                macroUVs.xy, macroUVs.zw,
                rotatedMacroLocal,
                vUv,
                chunkDims,
                level2AtlasTextureSize,
                macroLODBias,
                macroRot
            );

            level2A = level2Blend * level2.a;

            vec2 worldPosNoise = chunkOffset + vUv * chunkWidth;
            float scaleNoise = 0.035;
            float patchNoise = octaveNoise(worldPosNoise * scaleNoise, 4);
            mat2 rotMat = mat2(0.866, -0.5, 0.5, 0.866);
            float streakNoise = octaveNoise((rotMat * worldPosNoise) * (scaleNoise * 1.8), 2);
            float maskPatch = 1.0 - smoothstep(-0.28, 0.28, patchNoise);
            float maskStreak = 1.0 - smoothstep(-0.18, 0.18, streakNoise);
            float mask = max(maskPatch, maskStreak);

            level2A = level2A * mask;
        }
    }

    // Splat layer
    float splatSum = 0.0;

    if (enableSplatLayer > 0.5 && geometryLOD < 2) {
        vec2 splatSampleUV = applyAtlasTransform(vUv);
        vec4 splatData = texture(splatDataMap, splatSampleUV);
        
        float weight1 = splatData.r;
        float type1 = splatData.g * 255.0;
        float weight2 = splatData.b;
        float type2 = splatData.a * 255.0;
        
        splatSum = weight1 + weight2;

        if (splatSum > 0.01) {
            vec3 splatColor = vec3(0.0);
            
            if (weight1 > 0.001 && type1 > 0.5) {
                int varIdx1 = pickTileVariant(worldTileCoord, type1, activeSeason);
                vec4 uvs1 = lookupTileTypeUVs(type1, activeSeason, varIdx1);
                float rot1 = calculateRotation(worldTileCoord, type1, activeSeason, 9547.0);
                vec2 rotLocal1 = rotateUV(local, rot1);
                
                vec4 color1 = sampleTextureWithGradients(
                    atlasTexture, uvs1.xy, uvs1.zw, rotLocal1,
                    vUv, chunkDims, atlasTextureSize,
                    splatLODBias * float(geometryLOD), rot1
                );
                splatColor += color1.rgb * weight1;
            }
            
            if (weight2 > 0.001 && type2 > 0.5) {
                int varIdx2 = pickTileVariant(worldTileCoord, type2, activeSeason);
                vec4 uvs2 = lookupTileTypeUVs(type2, activeSeason, varIdx2);
                float rot2 = calculateRotation(worldTileCoord, type2, activeSeason, 9548.0);
                vec2 rotLocal2 = rotateUV(local, rot2);
                
                vec4 color2 = sampleTextureWithGradients(
                    atlasTexture, uvs2.xy, uvs2.zw, rotLocal2,
                    vUv, chunkDims, atlasTextureSize,
                    splatLODBias * float(geometryLOD), rot2
                );
                splatColor += color2.rgb * weight2;
            }

            if (splatSum > 0.0) {
                splatColor /= splatSum;
                float fadeFactor = detailFade * (1.0 - float(geometryLOD) / 3.0);
                rgb = mix(rgb, splatColor, clamp(splatSum * fadeFactor, 0.0, 1.0));
                a = max(a, splatSum);
            }
        }
    }

    // Apply macro layer
    if (geometryLOD == 0 && enableMacroLayer > 0.5) {
        vec2 macroMaskUV = applyAtlasTransform(vUv);
        float macroMask = texture(macroMaskTexture, macroMaskUV).r;
        float macroStrength = clamp(smoothstep(0.15, 0.82, macroMask) * level2A * 2.0, 0.0, 1.0);
        rgb = mix(rgb, level2.rgb, macroStrength);
    }

    vec3 baseColor = rgb;

    // Lighting - use safe defaults if uniforms are zero
    vec3 sun = normalize(sunLightDirection);
    vec3 moon = normalize(moonLightDirection);

    // Ensure we have some lighting even if uniforms are wrong
    float effectiveSunIntensity = max(sunLightIntensity, 0.5);
    float effectiveAmbientIntensity = max(ambientLightIntensity, 0.3);
    vec3 effectiveSunColor = length(sunLightColor) > 0.1 ? sunLightColor : vec3(1.0, 0.95, 0.8);
    vec3 effectiveSkyAmbient = length(skyAmbientColor) > 0.1 ? skyAmbientColor : vec3(0.4, 0.45, 0.5);
    vec3 effectiveGroundAmbient = length(groundAmbientColor) > 0.1 ? groundAmbientColor : vec3(0.3, 0.25, 0.2);

    float shadow = 1.0;
    if (geometryLOD < 2) {
        shadow = sampleShadowMap(vWorldPosition, N, vDistanceToCamera);
    }

    float NdLsun = max(dot(N, sun), 0.0) * shadow;
    float NdLmoon = max(dot(N, moon), 0.0);

    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 ambient = mix(effectiveGroundAmbient, effectiveSkyAmbient, hemi) * effectiveAmbientIntensity;

    vec3 directionalLight = effectiveSunColor * effectiveSunIntensity * NdLsun +
                            moonLightColor * moonLightIntensity * NdLmoon;

    vec3 clusteredLight = vec3(0.0);
    if (enableClusteredLights > 0.5 && geometryLOD < 2) {
        clusteredLight = evaluateClusteredLights(
            vWorldPosition,
            vViewPosition,
            N,
            vec3(1.0)
        );
    }

    vec3 totalLight = directionalLight + ambient + clusteredLight;

    // Ensure minimum light
    totalLight = max(totalLight, vec3(0.1));

    if (lodLevel < 2) {
        if (thunderLightIntensity > 0.0) {
            totalLight += thunderLightColor * thunderLightIntensity * 0.5;
        }

        vec3 toPlayer = playerLightPosition - vWorldPosition;
        float distP = length(toPlayer);
        vec3 dirP = normalize(toPlayer);
        float attnP = clamp(1.0 - distP / playerLightDistance, 0.0, 1.0);
        totalLight += playerLightColor * playerLightIntensity * attnP * max(dot(N, dirP), 0.0);
    }

    if (currentWeather >= 1.0) {
        totalLight *= mix(1.0, 0.6, weatherIntensity);
    }
    if (currentWeather >= 3.0) {
        totalLight *= mix(1.0, 0.8, weatherIntensity);
    }

    vec3 lit = baseColor * totalLight;

    // ====== FIXED FOG FOR SPHERICAL TERRAIN ======
    // The fog density uniform is calibrated for flat terrain (small distances).
    // For spherical terrain, distances can be 1000-50000+ meters.
    // We need to use a much smaller density.
    
    // Detect if we're in spherical mode by checking distance scale
    float adjustedFogDensity = fogDensity;
    if (vDistanceToCamera > 1000.0) {
        // Spherical mode - use much lower fog density
        adjustedFogDensity = fogDensity * 0.001; // Reduce by 1000x
    }
    
    float fogF = 1.0 - exp(-adjustedFogDensity * vDistanceToCamera);
    fogF = clamp(fogF, 0.0, 0.8); // Cap fog at 80% to always show some terrain

    if (currentWeather >= 1.0) {
        fogF = mix(fogF, min(fogF * 1.5, 0.9), weatherIntensity);
    }
    if (currentWeather >= 3.0) {
        fogF = mix(fogF, min(fogF * 2.0, 0.95), weatherIntensity);
    }

    // Use effective fog color (fallback to light blue if grey)
    vec3 effectiveFogColor = length(fogColor - vec3(0.5)) < 0.1 ? vec3(0.7, 0.8, 0.9) : fogColor;
    
    vec3 finalRGB = mix(lit, effectiveFogColor, fogF);

    fragColor = vec4(finalRGB, a);
}
`;
}

function includeShadowFunctions() {
    return `
float sampleCascadeShadow(sampler2D shadowMap, mat4 shadowMatrix, vec3 worldPos, vec3 normal) {
    vec3 lightDir = normalize(sunLightDirection);
    float cosTheta = clamp(dot(normal, lightDir), 0.0, 1.0);
    float slopeBias = shadowBias * tan(acos(cosTheta));
    slopeBias = clamp(slopeBias, 0.0, shadowBias * 2.0);

    float verticalFactor = abs(normal.y);
    float adaptiveNormalBias = shadowNormalBias * mix(0.3, 1.0, verticalFactor);

    vec3 biasedPos = worldPos + normal * adaptiveNormalBias;
    vec4 shadowCoord = shadowMatrix * vec4(biasedPos, 1.0);
    shadowCoord.xyz /= shadowCoord.w;

    if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
        shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
        shadowCoord.z < 0.0 || shadowCoord.z > 1.0) {
        return 1.0;
    }

    vec2 poissonDisk[9];
    poissonDisk[0] = vec2(-0.94201624, -0.39906216);
    poissonDisk[1] = vec2(0.94558609, -0.76890725);
    poissonDisk[2] = vec2(-0.094184101, -0.92938870);
    poissonDisk[3] = vec2(0.34495938, 0.29387760);
    poissonDisk[4] = vec2(-0.91588581, 0.45771432);
    poissonDisk[5] = vec2(-0.81544232, -0.87912464);
    poissonDisk[6] = vec2(-0.38277543, 0.27676845);
    poissonDisk[7] = vec2(0.97484398, 0.75648379);
    poissonDisk[8] = vec2(0.44323325, -0.97511554);

    float shadow = 0.0;
    vec2 texelSize = 1.0 / vec2(shadowMapSize);
    float searchRadius = 1.0;

    int sampleCount = geometryLOD == 0 ? 5 : (geometryLOD == 1 ? 3 : 1);

    for (int i = 0; i < 9; i++) {
        if (i >= sampleCount) break;
        vec2 offset = poissonDisk[i] * texelSize * searchRadius;
        float pcfDepth = texture(shadowMap, shadowCoord.xy + offset).r;
        shadow += (shadowCoord.z - slopeBias) > pcfDepth ? 0.0 : 1.0;
    }
    shadow /= float(sampleCount);

    float fadeStart = 0.85;
    float edgeX = min(shadowCoord.x, 1.0 - shadowCoord.x);
    float edgeY = min(shadowCoord.y, 1.0 - shadowCoord.y);
    float edgeFade = smoothstep(0.0, 1.0 - fadeStart, min(edgeX, edgeY) / (1.0 - fadeStart));
    shadow = mix(1.0, shadow, edgeFade);

    return shadow;
}

float sampleShadowMap(vec3 worldPos, vec3 normal, float distanceToCamera) {
    if (receiveShadow < 0.5 || geometryLOD >= 2) return 1.0;
    float shadow = 1.0;
    if (numCascades >= 3) {
        if (distanceToCamera < cascadeSplits.x) {
            shadow = sampleCascadeShadow(shadowMapCascade0, shadowMatrixCascade0, worldPos, normal);
        } else if (distanceToCamera < cascadeSplits.y) {
            shadow = sampleCascadeShadow(shadowMapCascade1, shadowMatrixCascade1, worldPos, normal);
        } else if (distanceToCamera < cascadeSplits.z) {
            shadow = sampleCascadeShadow(shadowMapCascade2, shadowMatrixCascade2, worldPos, normal);
        }
    } else {
        shadow = sampleCascadeShadow(shadowMapCascade0, shadowMatrixCascade0, worldPos, normal);
    }
    return shadow;
}
`;
}

function includeHelperFunctions() {
    return `
int getNumVariants(int tileType, int season) {
    float tu = (float(tileType) + 0.5) / 256.0;
    float tv = (float(season) + 0.5) / 4.0;
    return int(255.0 * texture(numVariantsTex, vec2(tu, tv)).r + 0.5);
}

float goodTileHash(vec2 pos, float tileType, float season) {
    float s1 = sin(dot(pos, vec2(127.1 + tileType*31.7, 311.7 + season*181.3)));
    float s2 = sin(dot(pos, vec2(269.5 + season*19.17, 183.3 + tileType*47.21)));
    float s3 = sin(dot(pos, vec2(tileType*101.9, season*233.7)));
    return fract(43758.5453123 * (s1 + s2 + s3));
}

int pickTileVariant(vec2 worldPos, float tileType, int season) {
    int intType = int(tileType + 0.5);
    int varCount = getNumVariants(intType, season);
    if (varCount <= 1) return 0;
    float h = goodTileHash(worldPos, tileType, float(season));
    return clamp(int(floor(h * float(varCount))), 0, varCount-1);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float calculateRotation(vec2 worldPos, float tileId, int season, float rotSeed) {
    float rHash = hash12(worldPos + vec2(tileId, rotSeed + float(season)*19.0));
    return floor(rHash * 4.0);
}

float fade(float t) {
    return t*t*t*(t*(t*6.0-15.0)+10.0);
}

float perlin2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float n00 = hash12(i);
    float n01 = hash12(i + vec2(0.0, 1.0));
    float n10 = hash12(i + vec2(1.0, 0.0));
    float n11 = hash12(i + vec2(1.0, 1.0));
    vec2 u = vec2(fade(f.x), fade(f.y));
    return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 2.0 - 1.0;
}

float octaveNoise(vec2 p, int octaves) {
    float v = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    float norm = 0.0;
    for (int i = 0; i < octaves; ++i) {
        v += perlin2D(p * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return v / norm;
}

vec2 rotateUV(vec2 uv, float rotation) {
    int rInt = int(rotation + 0.5);
    if (rInt == 0) return uv;
    if (rInt == 1) return vec2(1.0 - uv.y, uv.x);
    if (rInt == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
    return vec2(uv.y, 1.0 - uv.x);
}

vec4 lookupMacroTileTypeUVs(float tileType, int season, int variantIdx) {
    float H_maxVariants = 8.0;
    float H_numSeasons  = 4.0;
    float H_maxTileTypes = 256.0;

    float lookupWidth = H_numSeasons * H_maxVariants;
    float columnIndex = float(season) * H_maxVariants + float(variantIdx);

    float u = (columnIndex + 0.5) / lookupWidth;
    float v = (tileType + 0.5) / H_maxTileTypes;

    return texture(macroTileTypeLookup, vec2(u, v));
}

vec4 sampleTextureWithGradients(
    sampler2D atl,
    vec2 uvMin,
    vec2 uvMax,
    vec2 rotatedLocalUv,
    vec2 vUvIn,
    vec2 chunkDimsIn,
    vec2 atlSize,
    float lodBias,
    float rotation
) {
    vec2 uvRange = uvMax - uvMin;

    vec2 ddxVal = dFdx(vUvIn) * chunkDimsIn * uvRange;
    vec2 ddyVal = dFdy(vUvIn) * chunkDimsIn * uvRange;

    vec2 scaledDx, scaledDy;
    int rInt = int(rotation + 0.5);

    if (rInt == 0) {
        scaledDx = ddxVal;
        scaledDy = ddyVal;
    } else if (rInt == 1) {
        scaledDx = vec2(-ddyVal.x, ddxVal.x);
        scaledDy = vec2(-ddyVal.y, ddxVal.y);
    } else if (rInt == 2) {
        scaledDx = -ddxVal;
        scaledDy = -ddyVal;
    } else {
        scaledDx = vec2(ddyVal.x, -ddxVal.x);
        scaledDy = vec2(ddyVal.y, -ddxVal.y);
    }

    float lodScale = pow(2.0, lodBias);
    scaledDx *= lodScale;
    scaledDy *= lodScale;

    float lenX = dot(scaledDx, scaledDx);
    float lenY = dot(scaledDy, scaledDy);

    float maxGradient = min(abs(uvRange.x), abs(uvRange.y)) * 0.125;
    float maxLenSq = maxGradient * maxGradient;

    if (lenX > maxLenSq) scaledDx *= sqrt(maxLenSq / lenX);
    if (lenY > maxLenSq) scaledDy *= sqrt(maxLenSq / lenY);

    vec2 epsilon = 0.5 / atlSize;
    vec2 safeMin = uvMin + epsilon;
    vec2 safeMax = uvMax - epsilon;
    vec2 atlasUv = mix(safeMin, safeMax, rotatedLocalUv);

    return textureGrad(atl, atlasUv, scaledDx, scaledDy);
}

vec4 lookupTileTypeUVs(float tileType, int season, int variantIdx) {
    float H_maxVariants = 8.0;
    float H_numSeasons  = 4.0;
    float H_maxTileTypes = 256.0;

    float lookupWidth = H_numSeasons * H_maxVariants;
    float columnIndex = float(season) * H_maxVariants + float(variantIdx);

    float u = (columnIndex + 0.5) / lookupWidth;
    float v = (tileType + 0.5) / H_maxTileTypes;

    return texture(tileTypeLookup, vec2(u, v));
}
`;
}