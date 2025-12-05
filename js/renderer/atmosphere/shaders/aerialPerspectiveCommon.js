export const AERIAL_PERSPECTIVE_UNIFORMS_WGSL = `
    atmospherePlanetRadius: f32,
    atmosphereRadius: f32,
    atmosphereScaleHeightRayleigh: f32,
    atmosphereScaleHeightMie: f32,
    
    atmosphereRayleighScattering: vec3<f32>,
    atmosphereMieScattering: f32,
    
    atmosphereMieAnisotropy: f32,
    atmosphereSunIntensity: f32,
    viewerAltitude: f32,
    aerialPerspectiveEnabled: f32,
`;

export const AERIAL_PERSPECTIVE_UNIFORMS_GLSL = `
uniform float atmospherePlanetRadius;
uniform float atmosphereRadius;
uniform float atmosphereScaleHeightRayleigh;
uniform float atmosphereScaleHeightMie;
uniform vec3 atmosphereRayleighScattering;
uniform float atmosphereMieScattering;
uniform float atmosphereMieAnisotropy;
uniform float atmosphereSunIntensity;
uniform float viewerAltitude;
uniform float aerialPerspectiveEnabled;
uniform sampler2D transmittanceLUT;
`;

export const AERIAL_PERSPECTIVE_FUNCTIONS_WGSL = `
fn sampleTransmittanceLUT(transmittanceTex: texture_2d<f32>, transmittanceSampler: sampler, altitude: f32, cosTheta: f32) -> vec3<f32> {
    let H = sqrt(atmosphereRadius * atmosphereRadius - atmospherePlanetRadius * atmospherePlanetRadius);
    let rho = sqrt(max(0.0, (atmospherePlanetRadius + altitude) * (atmospherePlanetRadius + altitude) - atmospherePlanetRadius * atmospherePlanetRadius));
    
    let u = clamp(rho / H, 0.0, 1.0);
    
    let r = atmospherePlanetRadius + altitude;
    let dMin = atmosphereRadius - r;
    let dMax = rho + H;
    
    let cosT = clamp(cosTheta, -1.0, 1.0);
    let d = dMin + (cosT * 0.5 + 0.5) * (dMax - dMin);
    let v = clamp((d - dMin) / (dMax - dMin), 0.0, 1.0);
    
    return textureSample(transmittanceTex, transmittanceSampler, vec2<f32>(u, v)).rgb;
}

fn rayleighPhase(cosTheta: f32) -> f32 {
    return (3.0 / (16.0 * 3.14159265359)) * (1.0 + cosTheta * cosTheta);
}

fn miePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = (1.0 - g2);
    let denom = 4.0 * 3.14159265359 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / denom;
}

fn computeAerialPerspective(
    transmittanceTex: texture_2d<f32>,
    transmittanceSampler: sampler,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    sunDir: vec3<f32>,
    planetCenter: vec3<f32>
) -> vec4<f32> {
    let toFragment = worldPos - cameraPos;
    let distance = length(toFragment);
    let viewDir = toFragment / distance;
    
    let cameraAltitude = length(cameraPos - planetCenter) - atmospherePlanetRadius;
    let fragmentAltitude = length(worldPos - planetCenter) - atmospherePlanetRadius;
    let avgAltitude = (cameraAltitude + fragmentAltitude) * 0.5;
    
    let upDir = normalize(cameraPos - planetCenter);
    let cosViewZenith = dot(viewDir, upDir);
    
    let transmittance = sampleTransmittanceLUT(transmittanceTex, transmittanceSampler, avgAltitude, cosViewZenith);
    
    let cosSun = dot(viewDir, sunDir);
    let phaseR = rayleighPhase(cosSun);
    let phaseM = miePhase(cosSun, atmosphereMieAnisotropy);
    
    let densityR = exp(-avgAltitude / atmosphereScaleHeightRayleigh);
    let densityM = exp(-avgAltitude / atmosphereScaleHeightMie);
    
    let opticalDepthScale = distance * 0.001;
    
    let scatteringR = atmosphereRayleighScattering * densityR * phaseR * opticalDepthScale;
    let scatteringM = vec3<f32>(atmosphereMieScattering * densityM * phaseM * opticalDepthScale);
    
    let inscatter = (scatteringR + scatteringM) * atmosphereSunIntensity;
    
    return vec4<f32>(inscatter, 1.0 - (transmittance.r + transmittance.g + transmittance.b) / 3.0);
}

fn applyAerialPerspective(
    baseColor: vec3<f32>,
    aerialData: vec4<f32>
) -> vec3<f32> {
    let inscatter = aerialData.rgb;
    let extinction = aerialData.a;
    
    return mix(baseColor, baseColor * (1.0 - extinction) + inscatter, extinction);
}
`;

export const AERIAL_PERSPECTIVE_FUNCTIONS_GLSL = `
vec3 sampleTransmittanceLUT(sampler2D transmittanceTex, float altitude, float cosTheta) {
    float H = sqrt(atmosphereRadius * atmosphereRadius - atmospherePlanetRadius * atmospherePlanetRadius);
    float rho = sqrt(max(0.0, (atmospherePlanetRadius + altitude) * (atmospherePlanetRadius + altitude) - atmospherePlanetRadius * atmospherePlanetRadius));
    
    float u = clamp(rho / H, 0.0, 1.0);
    
    float r = atmospherePlanetRadius + altitude;
    float dMin = atmosphereRadius - r;
    float dMax = rho + H;
    
    float cosT = clamp(cosTheta, -1.0, 1.0);
    float d = dMin + (cosT * 0.5 + 0.5) * (dMax - dMin);
    float v = clamp((d - dMin) / (dMax - dMin), 0.0, 1.0);
    
    return texture(transmittanceTex, vec2(u, v)).rgb;
}

float rayleighPhase(float cosTheta) {
    return (3.0 / (16.0 * 3.14159265359)) * (1.0 + cosTheta * cosTheta);
}

float miePhase(float cosTheta, float g) {
    float g2 = g * g;
    float num = (1.0 - g2);
    float denom = 4.0 * 3.14159265359 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / denom;
}

vec4 computeAerialPerspective(
    sampler2D transmittanceTex,
    vec3 worldPos,
    vec3 cameraPos,
    vec3 sunDir,
    vec3 planetCenter
) {
    vec3 toFragment = worldPos - cameraPos;
    float distance = length(toFragment);
    vec3 viewDir = toFragment / distance;
    
    float cameraAltitude = length(cameraPos - planetCenter) - atmospherePlanetRadius;
    float fragmentAltitude = length(worldPos - planetCenter) - atmospherePlanetRadius;
    float avgAltitude = (cameraAltitude + fragmentAltitude) * 0.5;
    
    vec3 upDir = normalize(cameraPos - planetCenter);
    float cosViewZenith = dot(viewDir, upDir);
    
    vec3 transmittance = sampleTransmittanceLUT(transmittanceTex, avgAltitude, cosViewZenith);
    
    float cosSun = dot(viewDir, sunDir);
    float phaseR = rayleighPhase(cosSun);
    float phaseM = miePhase(cosSun, atmosphereMieAnisotropy);
    
    float densityR = exp(-avgAltitude / atmosphereScaleHeightRayleigh);
    float densityM = exp(-avgAltitude / atmosphereScaleHeightMie);
    
    float opticalDepthScale = distance * 0.001;
    
    vec3 scatteringR = atmosphereRayleighScattering * densityR * phaseR * opticalDepthScale;
    vec3 scatteringM = vec3(atmosphereMieScattering * densityM * phaseM * opticalDepthScale);
    
    vec3 inscatter = (scatteringR + scatteringM) * atmosphereSunIntensity;
    
    float extinction = 1.0 - (transmittance.r + transmittance.g + transmittance.b) / 3.0;
    
    return vec4(inscatter, extinction);
}

vec3 applyAerialPerspective(vec3 baseColor, vec4 aerialData) {
    vec3 inscatter = aerialData.rgb;
    float extinction = aerialData.a;
    
    return mix(baseColor, baseColor * (1.0 - extinction) + inscatter, extinction);
}
`;

export function getAerialPerspectiveChunkWGSL() {
    return AERIAL_PERSPECTIVE_FUNCTIONS_WGSL;
}

export function getAerialPerspectiveChunkGLSL() {
    return AERIAL_PERSPECTIVE_UNIFORMS_GLSL + '\n' + AERIAL_PERSPECTIVE_FUNCTIONS_GLSL;
}