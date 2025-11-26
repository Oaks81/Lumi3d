// buildStreamedChunkFragmentShader.js
export function buildStreamedChunkFragmentShader() {
    return `
        precision highp float;
        
        // ✅ Inputs from vertex shader (must match!)
        varying vec3 v_worldPos;
        varying vec2 vUv;
        varying float v_alpha;
        varying vec3 v_viewPos;
        
        // Uniforms
        uniform vec3 plantColor;
        uniform vec3 u_cameraPosition;
        uniform float u_waterLevel;
        
        void main() {
            // ✅ Early discard if fully transparent
            if (v_alpha < 0.01) discard;
            
            // Calculate normal from derivatives
            vec3 normal = normalize(cross(dFdx(v_worldPos), dFdy(v_worldPos)));
            
            // Simple lighting
            vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
            float diffuse = max(0.4, dot(normal, lightDir));
            
            // Base color with lighting
            vec3 color = plantColor * diffuse;
            
            // Distance fog
            float dist = length(v_viewPos);
            float fogFactor = smoothstep(60.0, 100.0, dist);
            vec3 fogColor = vec3(0.7, 0.8, 0.9);
            color = mix(color, fogColor, fogFactor);
            
            // ✅ Apply alpha from vertex shader
            gl_FragColor = vec4(color, v_alpha);
        }
    `;
}