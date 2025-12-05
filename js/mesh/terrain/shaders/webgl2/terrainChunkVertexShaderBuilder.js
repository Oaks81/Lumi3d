export function buildTerrainChunkVertexShader() {
    return `#version 300 es
precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec2 vUv;
out vec3 vNormal;
out vec3 vWorldPosition;
out vec3 vViewPosition;
out float vDistanceToCamera;
out vec2 vTileUv;
out vec2 vWorldPos;
out vec3 vSphereDir;
out float vHeight;

// DEBUG: Pass vertex shader values to fragment for inspection
out float vDebugChunkFace;
out float vDebugChunkSizeUV;
out vec2 vDebugChunkLocation;
out vec2 vDebugFaceUV;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

uniform vec2 chunkOffset;
uniform float chunkSize;

uniform float planetRadius;
uniform vec3 planetOrigin;
uniform int chunkFace;
uniform vec2 chunkLocation;
uniform float chunkSizeUV;

uniform float useAtlasMode;
uniform vec2 atlasUVOffset;
uniform float atlasUVScale;

uniform float heightScale;

uniform sampler2D heightTexture;

vec3 getCubePoint(int face, vec2 faceUV) {
    vec2 xy = faceUV * 2.0 - 1.0;
    if (face == 0) return vec3(1.0, xy.y, -xy.x);
    if (face == 1) return vec3(-1.0, xy.y, xy.x);
    if (face == 2) return vec3(xy.x, 1.0, -xy.y);
    if (face == 3) return vec3(xy.x, -1.0, xy.y);
    if (face == 4) return vec3(xy.x, xy.y, 1.0);
    return vec3(-xy.x, xy.y, -1.0);
}

vec2 getAtlasSampleUV(vec2 localUV) {
    if (useAtlasMode > 0.5) {
        return atlasUVOffset + localUV * atlasUVScale;
    }
    return localUV;
}

float sampleHeight(vec2 localUV) {
    vec2 sampleUV = getAtlasSampleUV(localUV);
    sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));
    return texture(heightTexture, sampleUV).r;
}

void main() {
    float heightSample = sampleHeight(uv);
    float height = heightSample;
    
    vec3 worldPosition;
    vec3 outNormal;
    vec3 sphereDir = vec3(0.0, 1.0, 0.0);
    
    // DEBUG: Pass values to fragment shader
    vDebugChunkFace = float(chunkFace);
    vDebugChunkSizeUV = chunkSizeUV;
    vDebugChunkLocation = chunkLocation;

    if (chunkFace >= 0) {
        // SPHERICAL MODE
        vec2 faceUV = chunkLocation + uv * chunkSizeUV;
        vDebugFaceUV = faceUV;  // DEBUG
        
        vec3 cubePoint = getCubePoint(chunkFace, faceUV);
        sphereDir = normalize(cubePoint);
        
        float heightMultiplier = max(heightScale, 0.0001);
        float radius = planetRadius + (height * heightMultiplier);
        
        worldPosition = planetOrigin + sphereDir * radius;
        outNormal = sphereDir;
    } else {
        // FLAT MODE
        vDebugFaceUV = vec2(-1.0);  // DEBUG: indicate flat mode
        
        float heightMultiplier = max(heightScale, 0.0001);
        float yPos = height * heightMultiplier;
        
        worldPosition = vec3(
            position.x + chunkOffset.x,
            yPos,
            position.z + chunkOffset.y
        );
        outNormal = normal;
    }

    vWorldPosition = worldPosition;
    vSphereDir = sphereDir;
    vHeight = height;

    vec4 viewPos = viewMatrix * vec4(worldPosition, 1.0);
    vViewPosition = viewPos.xyz;
    vDistanceToCamera = length(viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;

    vUv = uv;
    vTileUv = uv * chunkSize;
    vWorldPos = chunkOffset + uv * chunkSize;
    vNormal = outNormal;
}
`;
}