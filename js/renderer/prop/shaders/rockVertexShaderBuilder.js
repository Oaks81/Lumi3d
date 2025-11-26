export function buildRockVertexShader() {
    return `// VERTEX SHADER

varying float vSampledTerrainY;
varying float vDistanceAlongNormal; // for rim AO
varying float vBlendStart;
varying float vBlendEnd;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying float vDistanceToCamera;

uniform sampler2D terrainHeightTexture;
uniform vec4 terrainBounds;
uniform float terrainSize;

void main() {
    vec3 local = position;
    vec4 localPos = vec4(local, 1.0);

#ifdef USE_INSTANCING
    vec4 worldPos = instanceMatrix * localPos;
    mat3 normalMat = mat3(instanceMatrix);
    vec3 meshNormal = normalize(normalMat * normal);
    // Get terrain UV in local chunk space
    vec2 worldXZ = worldPos.xz + vec2(-0.5, -0.5);   
    vec2 terrainUV = (worldXZ - terrainBounds.xy) / terrainSize;
    terrainUV = clamp(terrainUV, 0.0, 1.0);

    float terrainHeight = texture2D(terrainHeightTexture, terrainUV).r;
    vSampledTerrainY = terrainHeight;
    float distanceAlongNormal = worldPos.y - terrainHeight;

    float rimNormalThickness = 0.02; // ~2cm
    float blendStart         = -rimNormalThickness * 0.4;
    float blendEnd           =  rimNormalThickness * 0.6;

    vNormal = meshNormal;
    vDistanceAlongNormal = distanceAlongNormal;
    vBlendStart  = blendStart;
    vBlendEnd    = blendEnd;

#else
    vec4 worldPos = modelMatrix * localPos;
    mat3 normalMat = mat3(modelMatrix);
    vNormal = normalize(normalMat * normal);
    vSampledTerrainY = worldPos.y;
    vDistanceAlongNormal = 1.0;
    vBlendStart = 0.0;
    vBlendEnd = 1.0;
#endif

    vWorldPosition = worldPos.xyz;
    vPosition = local;
    vDistanceToCamera = length(cameraPosition - vWorldPosition);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
    `;
}