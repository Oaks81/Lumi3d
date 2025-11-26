// buildStreamedChunkVertexShader.js
export function buildStreamedChunkVertexShader() {
    return `precision highp float;
precision highp int;

// ═══════════════════════════════════════════════════
// UNIFORMS
// ═══════════════════════════════════════════════════

uniform float u_noiseSeed; // ✅ ADD THIS NEW UNIFORM
// Chunk data
uniform vec2 u_chunkOffset;
uniform float u_chunkSize;
uniform float u_gridSpacing;
uniform int u_instancesPerRow;

// LOD configuration
uniform float u_maxDistance;
uniform float u_taperStartDistance;
uniform float u_taperEndDistance;
uniform float u_minCullDistance;

// Feature configuration
uniform float u_density;
uniform float u_waterLevel;
uniform vec3 u_cameraPosition;

// Textures
uniform sampler2D u_heightTexture;
uniform sampler2D u_tileTypeTexture;

// Wind animation
uniform float u_time;
uniform float u_windStrength;


varying vec3 v_worldPos;
varying vec2 vUv;
varying float v_alpha;
varying vec3 v_viewPos;

// ═══════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════

float hash(float x, float y, float seed) {
    return fract(sin(dot(vec3(x, y, seed), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}
float smoothTaper(float distance, float start, float end) {
    if (distance < start) return 1.0;
    if (distance > end) return 0.0;
    float t = (distance - start) / (end - start);
    return 1.0 - smoothstep(0.0, 1.0, t);
}

bool isCulledByFrustum(vec3 worldPos, float radius) {
    vec4 clipPos = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    float margin = radius * clipPos.w;
    
    return (clipPos.x < -clipPos.w - margin || clipPos.x > clipPos.w + margin ||
            clipPos.y < -clipPos.w - margin || clipPos.y > clipPos.w + margin ||
            clipPos.z < -clipPos.w - margin || clipPos.z > clipPos.w + margin);
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════
void main() {
    int instanceID = gl_InstanceID;
    int gridX = instanceID % u_instancesPerRow;
    int gridZ = instanceID / u_instancesPerRow;
    
    float fGridX = float(gridX);
    float fGridZ = float(gridZ);
    
    // ✅ Use u_noiseSeed to make the pattern unique for this feature type
    float jitterX = hash(fGridX, fGridZ, 0.1 + u_noiseSeed) * u_gridSpacing * 0.8;
    float jitterZ = hash(fGridX, fGridZ, 0.2 + u_noiseSeed) * u_gridSpacing * 0.8;

    vec2 worldXZ = u_chunkOffset + vec2(
        fGridX * u_gridSpacing + jitterX,
        fGridZ * u_gridSpacing + jitterZ
    );
    
    vec2 cameraXZ = u_cameraPosition.xz;
    float distanceToCamera = distance(worldXZ, cameraXZ);
    
   float randomOffset = hash(fGridX, fGridZ, 0.5 + u_noiseSeed) * 3.0;

    if (distanceToCamera > u_maxDistance + randomOffset) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
float cullMargin = u_gridSpacing * 1.5; // Account for grid cell size + half the blade size
    float cullDistance = u_maxDistance + hash(fGridX, fGridZ, 0.5 + u_noiseSeed) * cullMargin;

    if (distanceToCamera > cullDistance) { // ✅ Use the new cullDistance
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    float distanceAlpha = smoothTaper(distanceToCamera, u_taperStartDistance, u_taperEndDistance);
    
    if (distanceAlpha <= 0.01) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    float densityFalloff = mix(1.0, 0.3, clamp((distanceToCamera - u_taperStartDistance) / (u_maxDistance - u_taperStartDistance), 0.0, 1.0));
    float effectiveDensity = u_density * densityFalloff;
    
    if (hash(fGridX, fGridZ, 0.3 + u_noiseSeed) > effectiveDensity) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    vec2 localXZ = worldXZ - u_chunkOffset;
    vec2 texUv = clamp(localXZ / u_chunkSize, 0.001, 0.999);
    
    float terrainHeight = texture2D(u_heightTexture, texUv).r;
    
    if (terrainHeight <= u_waterLevel + 0.1) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
    vec3 worldPosWithHeight = vec3(worldXZ.x, terrainHeight, worldXZ.y);
    
    if (isCulledByFrustum(worldPosWithHeight, 2.0)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
        return;
    }
    
float rotation = hash(fGridX, fGridZ, 0.4 + u_noiseSeed) * 6.2831853;
    float c = cos(rotation);
    float s = sin(rotation);
    
    float scaleMultiplier = mix(1.0, 0.85, clamp((distanceToCamera - u_taperStartDistance) / (u_maxDistance - u_taperStartDistance), 0.0, 1.0));
    
    vec3 localPos = position * scaleMultiplier;
    
    vec3 rotatedPos = vec3(
        localPos.x * c - localPos.z * s,
        localPos.y,
        localPos.x * s + localPos.z * c
    );
    
    float windPhase = u_time + (worldXZ.x * 0.1 + worldXZ.y * 0.1);
    float windSway = sin(windPhase) * cos(windPhase * 0.7) * u_windStrength;
    
    float swayWeight = clamp(localPos.y / 0.8, 0.0, 1.0);
    rotatedPos.x += windSway * swayWeight;
    
    vec3 worldPos = vec3(
        worldXZ.x + rotatedPos.x,
        terrainHeight + rotatedPos.y,
        worldXZ.y + rotatedPos.z
    );
    
    vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * viewPos;
    
    // Pass to fragment shader
    v_worldPos = worldPos;
    v_viewPos = viewPos.xyz;
    vUv = localPos.xz;
    v_alpha = distanceAlpha;
}
`;
}