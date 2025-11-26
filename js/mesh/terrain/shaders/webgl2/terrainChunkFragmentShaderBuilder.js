// renderer/terrain/shaders/terrainChunkFragmentShaderBuilder.js

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
#define MAX_MACRO_VARIANTS 8

layout(location = 0) out vec4 fragColor;

${clusteredModule}

#ifdef USE_HEIGHT_TEXTURE
    uniform sampler2D heightTexture;
#endif

#ifdef USE_NORMAL_TEXTURE
    uniform sampler2D normalTexture;
#endif

#ifdef USE_TILE_TEXTURE 
    uniform sampler2D tileTexture;
#endif

uniform sampler2D tileTypeLookup;
uniform sampler2D macroTileTypeLookup;
uniform sampler2D numVariantsTex;

uniform float splatLODBias;
uniform float macroLODBias;
uniform float detailFade;
uniform float enableSplatLayer;
uniform float enableMacroLayer;
uniform float enableClusteredLights;
uniform int geometryLOD;

uniform sampler2D splatWeightsMap;
uniform sampler2D splatTypesMap;

uniform sampler2D macroMaskTexture;
uniform sampler2D atlasTexture;
uniform vec2 atlasTextureSize;
uniform sampler2D level2AtlasTexture;
uniform vec2 level2AtlasTextureSize;
uniform float chunkWidth;
uniform float chunkHeight;
uniform float tileScale;
uniform float level2Blend;
uniform float numSeasons;
uniform vec2 chunkOffset;
uniform int lodLevel;
uniform float isFeature;
uniform int currentSeason;
uniform int nextSeason;
uniform float seasonTransition;
uniform float maxTileTypes;
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

const int MINIMAL_LIGHTING_LOD = 2;
const float PI = 3.14159265359;

${includeShadowFunctions()}
${includeHelperFunctions()}

void main() {
    int activeSeason = (seasonTransition < 0.5) ? currentSeason : nextSeason;
    
    // ============================================
    // NORMAL CALCULATION - FIX 1: Restore proper normals
    // ============================================
    vec3 N;
    
    #ifdef USE_NORMAL_TEXTURE
        vec3 normalSample = texture(normalTexture, vUv).xyz;
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
    #else
        N = normalize(vNormal);
    #endif
    // ============================================
    // MICRO TILE SAMPLING
    // ============================================
    vec2 tCoord = vUv * vec2(chunkWidth, chunkHeight);
    vec2 tIdx = floor(tCoord);
    vec2 local = fract(tCoord);
    vec2 worldTileCoord = chunkOffset + tIdx;

    float tileId;
    #ifdef USE_TILE_TEXTURE
        vec2 tileUV = (tIdx + 0.5) / vec2(chunkWidth, chunkHeight);
        tileUV = clamp(tileUV, vec2(0.0), vec2(1.0));
        vec4 tileSample = texture(tileTexture, tileUV);
        float rawVal = tileSample.r;
        tileId = (rawVal > 1.0) ? rawVal : (rawVal * 255.0);
    #else
        tileId = 3.0;
    #endif

    if (isFeature < 0.5 && tileId >= 100.0) {
        discard;
        return;
    }

    float r = calculateRotation(worldTileCoord, tileId, activeSeason, 9547.0);
    int tileVariantIdx = pickTileVariant(worldTileCoord, tileId, activeSeason);
    vec4 d = lookupTileTypeUVs(tileId, activeSeason, tileVariantIdx);

    vec2 chunkDims = vec2(chunkWidth, chunkHeight);
    vec2 rotatedLocal = rotateUV(local, r);
    rotatedLocal = clamp(rotatedLocal, 0.0, 1.0);

    vec4 level1 = sampleTextureWithGradients(
        atlasTexture,
        d.xy, d.zw,
        rotatedLocal,
        vUv,
        chunkDims,
        atlasTextureSize,
        splatLODBias * float(geometryLOD),
        r  
    );

    vec3 rgb = level1.rgb;
    float a = level1.a;

    // ============================================
    // MACRO LAYER - FIX 2 & 3: Handle tile ID 0 and allow zero opacity
    // ============================================
    vec4 level2 = vec4(0.0);
    float level2A = 0.0;
 

     if (enableMacroLayer > 0.5  && geometryLOD == 0) {

        vec2 macroTileIdx = floor(worldTileCoord);
        vec2 macroLocal = fract(tCoord) * tileScale;
        float macroTileId;
        #ifdef USE_TILE_TEXTURE
            vec2 macroUV = (tIdx + 0.5) / chunkDims;
            macroUV = clamp(macroUV, vec2(0.0), vec2(1.0));
            vec4 macroTileSample = texture(tileTexture, macroUV);
            macroTileId = (macroTileSample.r > 1.0) ? 
                macroTileSample.r : macroTileSample.r * 255.0;
            
            // FIX 2: If tile ID is 0 (invalid/black), skip macro for this pixel
            if (macroTileId < 0.5) {
                // Don't render macro at all - level2A stays 0.0
                macroTileId = 0.0;
            }
        #else
            macroTileId = tileId;
        #endif

        macroTileId = 3.0;

        // Only process macro if we have a valid tile ID
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


            // Procedural masking
            vec2 worldPos = chunkOffset + vUv * chunkWidth;
            float scale = 0.035;
            float patchNoise = octaveNoise(worldPos * scale, 4);
            mat2 rot = mat2(0.866, -0.5, 0.5, 0.866);
            float streakNoise = octaveNoise((rot * worldPos) * (scale * 1.8), 2);
            float maskPatch = 1.0 - smoothstep(-0.28, 0.28, patchNoise);
            float maskStreak = 1.0 - smoothstep(-0.18, 0.18, streakNoise);
            float mask = max(maskPatch, maskStreak);
            
            // FIX 3: Allow zero opacity (removed min/max clamping)
            level2A = level2A * mask;

            // Ditch darkening
            float ditchScale = 1.2;
            mat2 ditchRot = mat2(0.94, -0.34, 0.34, 0.94);
            float ditchDarken = 0.9;
            float ditchNoise = octaveNoise((ditchRot * worldPos) * ditchScale, 3);
            float ditchWidth = 0.015;
            float ditchMask = 1.0 - smoothstep(-ditchWidth, ditchWidth, ditchNoise);
            float luminanceMask = mix(1.0, ditchDarken, ditchMask);
            level2.rgb *= luminanceMask;

        }
            
    }

    // ============================================
    // SPLAT LAYER
    // ============================================
    float splatSum = 0.0;

    if (enableSplatLayer > 0.5 && geometryLOD < 2) {
        vec4 splatWeights = texture(splatWeightsMap, vUv);
        vec4 splatTypes = texture(splatTypesMap, vUv);

        splatSum = splatWeights.r + splatWeights.g + splatWeights.b + splatWeights.a;

        if (splatSum > 0.01) {
            vec3 splatColor = vec3(0.0);
            vec2 splatTexelSize = 1.0 / vec2(chunkWidth, chunkHeight);
            vec2 splatPixel = vUv / splatTexelSize;
            vec2 splatBase = floor(splatPixel);
            vec2 splatFrac = fract(splatPixel);

            for (int sy = 0; sy < 2; sy++) {
                for (int sx = 0; sx < 2; sx++) {
                    vec2 sampleUV = (splatBase + vec2(float(sx), float(sy)) + 0.5) * splatTexelSize;
                    vec4 weights = texture(splatWeightsMap, sampleUV);
                    vec4 types = texture(splatTypesMap, sampleUV);

                    float bilinear = (sx == 0 ? (1.0 - splatFrac.x) : splatFrac.x) *
                                (sy == 0 ? (1.0 - splatFrac.y) : splatFrac.y);

                    for (int i = 0; i < 4; i++) {
                        float weight = (i == 0) ? weights.r :
                                    (i == 1) ? weights.g :
                                    (i == 2) ? weights.b : weights.a;
                        float thisType = (i == 0) ? types.r :
                                        (i == 1) ? types.g :
                                        (i == 2) ? types.b : types.a;

                        thisType = thisType * 255.0;

                        if (weight > 0.001 && thisType > 0.5) {
                            int thisVarIdx = pickTileVariant(chunkOffset + tIdx, thisType, activeSeason);
                            vec4 thisD = lookupTileTypeUVs(thisType, activeSeason, thisVarIdx);
                            float rr = calculateRotation(chunkOffset + tIdx, thisType, activeSeason, 9547.0 + thisType*31.0);

                            vec2 rotatedSplatLocal = rotateUV(local, rr);

                            vec4 color = sampleTextureWithGradients(
                                atlasTexture,
                                thisD.xy,
                                thisD.zw,
                                rotatedSplatLocal,
                                vUv,
                                chunkDims,
                                atlasTextureSize,
                                splatLODBias * float(geometryLOD),
                                rr 
                            );
                            splatColor += color.rgb * weight * bilinear;
                        }
                    }
                }
            }

               if (splatSum > 0.0) {
                splatColor /= splatSum;
                float fadeFactor = detailFade * (1.0 - float(geometryLOD) / 3.0);
                rgb = mix(rgb, splatColor, clamp(splatSum * fadeFactor, 0.0, 1.0));
                a = max(a, splatSum);
            }
        }
    }

    // ============================================
    // BLEND MACRO LAYER
    // ============================================
    if (geometryLOD == 0 && enableMacroLayer > 0.5) {
        float macroMask = texture(macroMaskTexture, vUv).r;
        float macroStrength = clamp(smoothstep(0.15, 0.82, macroMask) * level2A * 2.0, 0.0, 1.0);
        rgb = mix(rgb, level2.rgb, macroStrength);
    }

    vec3 baseColor = rgb;
    // ============================================
    // LIGHTING - FIX 1: Restore all lighting calculations
    // ============================================
    vec3 sun = normalize(sunLightDirection);
    vec3 moon = normalize(moonLightDirection);

    float shadow = 1.0;
    if (geometryLOD < 2) {
        shadow = sampleShadowMap(vWorldPosition, N, vDistanceToCamera);
    }


    float NdLsun = max(dot(N, sun), 0.0) * shadow;
    float NdLmoon = max(dot(N, moon), 0.0);

    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 ambient = mix(groundAmbientColor, skyAmbientColor, hemi) * ambientLightIntensity;

    vec3 directionalLight = sunLightColor * sunLightIntensity * NdLsun +
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



    // ============================================
    // FOG
    // ============================================
    float fogF = 1.0 - exp(-fogDensity * vDistanceToCamera);

    if (currentWeather >= 1.0) {
        fogF = mix(fogF, min(fogF * 1.5, 1.0), weatherIntensity);
    }
    if (currentWeather >= 3.0) {
        fogF = mix(fogF, min(fogF * 3.0, 1.0), weatherIntensity);
    }

    vec3 finalRGB = mix(lit, fogColor, clamp(fogF, 0.0, 1.0));

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
    float r = hash12(worldPos + vec2(tileId, rotSeed + float(season)*19.0));
    return floor(r * 4.0);
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
    int r = int(rotation + 0.5);
    if (r == 0) return uv;
    if (r == 1) return vec2(1.0 - uv.y, uv.x);
    if (r == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
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
    vec2 vUv,
    vec2 chunkDims,
    vec2 atlSize,
    float lodBias,
    float rotation
) {
    vec2 uvRange = uvMax - uvMin;

    vec2 ddx = dFdx(vUv) * chunkDims * uvRange;
    vec2 ddy = dFdy(vUv) * chunkDims * uvRange;

    vec2 scaledDx, scaledDy;
    int r = int(rotation + 0.5);

    if (r == 0) {
        scaledDx = ddx;
        scaledDy = ddy;
    } else if (r == 1) {
        scaledDx = vec2(-ddy.x, ddx.x);
        scaledDy = vec2(-ddy.y, ddx.y);
    } else if (r == 2) {
        scaledDx = -ddx;
        scaledDy = -ddy;
    } else {
        scaledDx = vec2(ddy.x, -ddx.x);
        scaledDy = vec2(ddy.y, -ddx.y);
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