export function buildBoulderVertexShader() {
    return `
attribute float deformSeed;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying float vDistanceToCamera;

// Hash / noise helpers
float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);

    float n000 = hash(i + vec3(0,0,0));
    float n100 = hash(i + vec3(1,0,0));
    float n010 = hash(i + vec3(0,1,0));
    float n110 = hash(i + vec3(1,1,0));
    float n001 = hash(i + vec3(0,0,1));
    float n101 = hash(i + vec3(1,0,1));
    float n011 = hash(i + vec3(0,1,1));
    float n111 = hash(i + vec3(1,1,1));

    vec3 u = f*f*(3.0-2.0*f);

    return mix(
        mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
        mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y),
        u.z
    );
}

void main() {
    vec3 local = position;
    vec3 nrm = normalize(normal);

    // --- Displacement for boulder roughness ---
    float baseNoise = noise(local * 2.5 + vec3(deformSeed * 17.0));
    float secondary = noise(local * 5.0 + vec3(deformSeed * 73.0));
    float crackMask = abs(sin(local.y * 4.0 + deformSeed * 6.0));

    float displacement = (baseNoise - 0.5) * 0.5
                       + (secondary - 0.5) * 0.2
                       - crackMask * 0.3;

    local += nrm * displacement;

    // Apply instance transform
    vec4 localPos = vec4(local, 1.0);
    vec4 worldPos = instanceMatrix * localPos;

    vPosition = local;

    // Transform normals (ignoring translation)
    mat3 normalMat = mat3(instanceMatrix);
    vNormal = normalize(normalMat * nrm);

    vWorldPosition = worldPos.xyz;
    vDistanceToCamera = length(cameraPosition - vWorldPosition);

    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
}
`;
}
