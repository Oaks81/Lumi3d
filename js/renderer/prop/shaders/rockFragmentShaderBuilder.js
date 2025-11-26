export function buildRockFragmentShader() {
    return `

    varying float vDistanceAlongNormal;
varying float vBlendStart;
varying float vBlendEnd;
varying vec3 vWorldPosition;
varying float vDistanceToCamera;
varying vec3 vNormal;
varying float vSampledTerrainY;

uniform sampler2D map;
uniform vec4 uvRect;

uniform vec3 sunLightColor;
uniform float sunLightIntensity;
uniform vec3 sunLightDirection;

uniform vec3 moonLightColor;
uniform float moonLightIntensity;
uniform vec3 moonLightDirection;

uniform float ambientLightIntensity;
uniform vec3 skyAmbientColor;
uniform vec3 groundAmbientColor;

uniform vec3 fogColor;
uniform float fogDensity;

float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

vec2 atlasUV(vec2 uv) {
    vec2 tiledUV = fract(uv);
    return clamp(uvRect.xy + tiledUV * (uvRect.zw - uvRect.xy), 0.0, 1.0);
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 worldPos = vWorldPosition;
    float scale = 2.5;

    vec3 blending = pow(abs(N), vec3(3.0));
    blending /= dot(blending, vec3(1.0));

    vec2 noiseX = vec2(noise(worldPos.yz*0.05), noise(worldPos.yz*0.05+50.0)) * 0.1;
    vec2 noiseY = vec2(noise(worldPos.xz*0.05), noise(worldPos.xz*0.05+100.0)) * 0.1;
    vec2 noiseZ = vec2(noise(worldPos.xy*0.05), noise(worldPos.xy*0.05+150.0)) * 0.1;

    vec2 uvX = worldPos.yz * scale + noiseX;
    vec2 uvY = worldPos.xz * scale + noiseY;
    vec2 uvZ = worldPos.xy * scale + noiseZ;

    vec4 xSample = texture2D(map, atlasUV(uvX));
    vec4 ySample = texture2D(map, atlasUV(uvY));
    vec4 zSample = texture2D(map, atlasUV(uvZ));
    vec4 triplanarColor = xSample * blending.x + ySample * blending.y + zSample * blending.z;

    if (triplanarColor.a < 0.1) discard;

    // --- Lighting
    vec3 sun  = normalize(sunLightDirection);
    vec3 moon = normalize(moonLightDirection);
    float NdLsun  = max(dot(N, sun), 0.0);
    float NdLmoon = max(dot(N, moon), 0.0);
    NdLsun = smoothstep(0.0, 1.0, NdLsun);
    NdLmoon= smoothstep(0.0, 1.0, NdLmoon);

    // Hemisphere AO: same as terrain
    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 ambient = mix(groundAmbientColor, skyAmbientColor, hemi) * ambientLightIntensity;

    vec3 light =
        sunLightColor * sunLightIntensity * NdLsun +
        moonLightColor * moonLightIntensity * NdLmoon +
        ambient;

    vec3 lit = triplanarColor.rgb * light;

    // --- Rim AO (contact shadow with ground)
    float rimAO = 1.0 - smoothstep(vBlendStart, vBlendEnd, vDistanceAlongNormal);
    float rimDarken = mix(1.0, 0.75, rimAO); // up to 25% darker at ground rim
    lit *= rimDarken;

    // --- FOG
    float fogF = 1.0 - exp(-fogDensity * vDistanceToCamera);
    vec3 outColor = mix(lit, fogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(outColor, triplanarColor.a);
}
                `;
}   