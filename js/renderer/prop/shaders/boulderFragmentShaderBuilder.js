export function buildBoulderFragmentShader() {
    return `
// Lighting uniforms
uniform vec3 sunLightColor;
uniform float sunLightIntensity;
uniform vec3 sunLightDirection;

uniform vec3 moonLightColor;
uniform float moonLightIntensity;
uniform vec3 moonLightDirection;

uniform vec3 ambientLightColor;
uniform float ambientLightIntensity;

// Fog
uniform vec3 fogColor;
uniform float fogDensity;

// From vertex shader
varying vec3 vWorldPosition;
varying float vDistanceToCamera;
varying vec3 vPosition;
varying vec3 vNormal;

uniform sampler2D map;
uniform vec4 uvRect;

// --- Noise functions ---
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f*f*(3.0-2.0*f);

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Compute a gradient from noise for fake normal detail
vec2 noiseGrad(vec2 uv) {
    float e = 0.001; 
    float n  = noise(uv);
    float nx = noise(uv + vec2(e,0.0));
    float ny = noise(uv + vec2(0.0,e));
    return vec2((nx - n)/e, (ny - n)/e);
}

vec2 atlasUV(vec2 uv) {
    vec2 tiledUV = fract(uv);
    return uvRect.xy + tiledUV * (uvRect.zw - uvRect.xy);
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 worldPos = vWorldPosition;

    // === Triplanar texture blending ===
    vec3 blending = abs(N);
    blending = blending * blending * blending;
    blending /= (blending.x + blending.y + blending.z);

    float scale = 2.0;

    vec2 uvX = worldPos.yz * scale;
    vec2 uvY = worldPos.xz * scale;
    vec2 uvZ = worldPos.xy * scale;

    vec4 xSample = texture2D(map, atlasUV(uvX));
    vec4 ySample = texture2D(map, atlasUV(uvY));
    vec4 zSample = texture2D(map, atlasUV(uvZ));

    vec4 triplanarColor = xSample * blending.x + ySample * blending.y + zSample * blending.z;
    if (triplanarColor.a < 0.5) discard;

    // === Crevice darkening ===
    float cavityNoise = noise(worldPos.xy * 3.0 + vec2(50.0, 120.0));
    float cracks = smoothstep(0.4, 0.6, cavityNoise);
    float creviceFactor = 1.0 - cracks * 0.5;

    // === Normal perturbation from noise ===
    vec2 grad = noiseGrad(worldPos.xy * 4.0);  
    vec3 detailNormal = normalize(N + vec3(grad.x, grad.y, 0.0) * 0.5);

    // === Lighting ===
    vec3 sun = normalize(sunLightDirection);
    vec3 moon = normalize(moonLightDirection);

    float NdLsun  = max(dot(detailNormal, sun), 0.0);
    float NdLmoon = max(dot(detailNormal, moon), 0.0);

    NdLsun = smoothstep(0.0, 1.0, NdLsun);
    NdLmoon = smoothstep(0.0, 1.0, NdLmoon);

    vec3 light = sunLightColor * sunLightIntensity * NdLsun +
                 moonLightColor * moonLightIntensity * NdLmoon +
                 ambientLightColor * ambientLightIntensity;

    vec3 lit = triplanarColor.rgb * light * creviceFactor;

    // === Fog ===
    float fogF = 1.0 - exp(-fogDensity * vDistanceToCamera);
    vec3 finalColor = mix(lit, fogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(finalColor, triplanarColor.a);
}
`;
}
