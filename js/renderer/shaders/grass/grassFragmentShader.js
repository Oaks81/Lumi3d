/**
 * Build fragment shader for grass rendering
 * @returns {string} Fragment shader code
 */
export function buildGrassFragmentShader() {
    return `
        uniform sampler2D map;
        uniform vec4 grassUVRect;
        uniform vec4 billboardUVRect;
        
        // Lighting uniforms
        uniform vec3 sunLightDirection;
        uniform vec3 sunLightColor;
        uniform float sunLightIntensity;
        uniform vec3 ambientLightColor;
        uniform float ambientLightIntensity;
        uniform vec3 fogColor;
        uniform float fogDensity;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying float vDistanceToCamera;
        varying vec3 vColor;
        
        void main() {
            // Sample grass texture
            vec2 texCoord = vec2(
                mix(grassUVRect.x, grassUVRect.z, vUv.x),
                mix(grassUVRect.y, grassUVRect.w, vUv.y)
            );
            
            vec4 grassTexture = texture2D(map, texCoord);
            vec3 baseColor = grassTexture.rgb;
            float alpha = grassTexture.a;
            
            // Alpha test for grass blades
            if (alpha < 0.3) discard;
            
            // Simple lighting
            vec3 N = normalize(vNormal);
            vec3 L = normalize(sunLightDirection);
            
            float NdotL = max(dot(N, L), 0.0);
            
            // Two-sided lighting for thin grass blades
            float backLight = max(dot(-N, L), 0.0);
            NdotL = max(NdotL, backLight * 0.5);
            
            // Ambient lighting
            vec3 ambient = ambientLightColor * ambientLightIntensity;
            
            // Combine lighting
            vec3 light = sunLightColor * sunLightIntensity * NdotL + ambient;
            
            // Add some base brightness for visibility
            light += vec3(0.2, 0.25, 0.15);
            
            vec3 lit = baseColor * light;
            
            // Fog
            float fogFactor = 1.0 - exp(-fogDensity * vDistanceToCamera);
            vec3 finalColor = mix(lit, fogColor, clamp(fogFactor, 0.0, 0.8));
            
            gl_FragColor = vec4(finalColor, alpha);
        }
    `;
}
