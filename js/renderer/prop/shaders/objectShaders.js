// ./js/renderer/objects/shaders/objectShaders.js

export function objectVertexShader() {
    return `
    precision highp float;

    // Instance attributes
    attribute vec3 instancePosition;
    attribute vec3 instanceScale;
    attribute vec4 instanceQuaternion;
    attribute vec3 instanceColor;

    // Standard attributes
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;

    // Uniforms
    uniform mat4 modelMatrix;
    uniform mat4 viewMatrix;
    uniform mat4 projectionMatrix;
    uniform mat3 normalMatrix;
    
    uniform float time;
    uniform float windStrength;

    // Varyings
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vInstanceColor;
    varying float vFogDepth;

    // Quaternion multiplication
    vec3 applyQuaternion(vec3 v, vec4 q) {
        vec3 qv = cross(q.xyz, v) + q.w * v;
        return v + 2.0 * cross(q.xyz, qv);
    }

    // Wind animation for foliage
    vec3 applyWind(vec3 pos, float strength) {
        float windTime = time * 2.0;
        float windX = sin(windTime + pos.y * 0.5) * strength;
        float windZ = cos(windTime * 0.7 + pos.y * 0.3) * strength * 0.7;
        
        // Only affect upper parts (foliage)
        float heightFactor = smoothstep(0.0, 5.0, pos.y);
        
        return vec3(windX * heightFactor, 0.0, windZ * heightFactor);
    }

    void main() {
        // Apply instance transform
        vec3 transformed = position;
        
        #ifdef USE_WIND
            transformed += applyWind(position, windStrength);
        #endif
        
        // Apply instance transforms manually (for compatibility)
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        
        vWorldPosition = worldPosition.xyz;
        vUv = uv;
        
        // Transform normal
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        
        // Pass instance color
        #ifdef USE_INSTANCING
            vInstanceColor = instanceColor;
        #else
            vInstanceColor = vec3(1.0);
        #endif
        
        // Calculate fog depth
        vec4 mvPosition = viewMatrix * worldPosition;
        vFogDepth = -mvPosition.z;
        
        gl_Position = projectionMatrix * mvPosition;
    }
    `;
}

export function objectFragmentShader() {
    return `
    precision highp float;

    // Uniforms
    uniform sampler2D atlasTexture;
    uniform sampler2D normalMap;
    uniform vec2 uvScale;
    uniform vec2 uvOffset;
    
    uniform float roughness;
    uniform float metalness;
    uniform float colorVariation;
    
    // Lighting
    uniform vec3 sunLightDirection;
    uniform vec3 sunLightColor;
    uniform float sunLightIntensity;
    uniform vec3 ambientLightColor;
    uniform float ambientLightIntensity;
    
    // Environment
    uniform vec3 fogColor;
    uniform float fogDensity;

    // Varyings
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vInstanceColor;
    varying float vFogDepth;

    // Lighting calculations
    vec3 calculateLighting(vec3 normal, vec3 viewDir, vec3 baseColor) {
        // Simple Blinn-Phong with enhancements
        vec3 lightDir = normalize(sunLightDirection);
        float NdL = max(dot(normal, lightDir), 0.0);
        
        // Diffuse
        vec3 diffuse = baseColor * sunLightColor * sunLightIntensity * NdL;
        
        // Specular  
        vec3 halfwayDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfwayDir), 0.0), 32.0 * (1.0 - roughness));
        vec3 specular = sunLightColor * spec * (1.0 - roughness) * 0.5;
        
        // Ambient with hemisphere lighting
        float ambientOcclusion = 1.0; // Could be from a texture
        vec3 ambient = baseColor * ambientLightColor * ambientLightIntensity * ambientOcclusion;
        
        // Rim lighting for nice edge glow
        float rim = 1.0 - max(dot(normal, viewDir), 0.0);
        rim = pow(rim, 2.0) * 0.3;
        vec3 rimLight = sunLightColor * rim * sunLightIntensity;
        
        return diffuse + specular + ambient + rimLight;
    }

    void main() {
        // Sample texture with UV scaling
        vec2 scaledUV = vUv * uvScale + uvOffset;
        vec4 texColor = texture2D(atlasTexture, scaledUV);
        
        // Apply instance color variation
        vec3 baseColor = texColor.rgb * mix(vec3(1.0), vInstanceColor, colorVariation);
        
        // Normal mapping (if available)
        vec3 normal = normalize(vNormal);
        #ifdef USE_NORMALMAP
            vec3 normalTex = texture2D(normalMap, scaledUV).rgb * 2.0 - 1.0;
            // Transform normal from tangent space (simplified)
            normal = normalize(normal + normalTex * 0.5);
        #endif
        
        // View direction
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        
        // Calculate lighting
        vec3 color = calculateLighting(normal, viewDir, baseColor);
        
        // Apply fog
        float fogFactor = 1.0 - exp(-fogDensity * vFogDepth * 0.01);
        color = mix(color, fogColor, clamp(fogFactor, 0.0, 1.0));
        
        // Tone mapping (ACES approximation)
        color = color / (color + vec3(1.0));
        color = pow(color, vec3(1.0 / 2.2)); // Gamma correction
        
        // Alpha testing for foliage
        #ifdef ALPHA_TEST
            if (texColor.a < 0.5) discard;
        #endif
        
        gl_FragColor = vec4(color, texColor.a);
    }
    `;
}