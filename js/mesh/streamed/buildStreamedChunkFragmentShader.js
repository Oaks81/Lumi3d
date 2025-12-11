export function buildStreamedChunkFragmentShader() {
    return `#version 300 es
        precision highp float;
        
        in vec3 v_worldPos;
        in vec2 vUv;
        in float v_alpha;
        in vec3 v_viewPos;
        
        uniform vec3 plantColor;
        uniform vec3 u_cameraPosition;
        uniform float u_waterLevel;

        out vec4 fragColor;
        
        void main() {
            if (v_alpha < 0.01) {
                discard;
            }
            
            vec3 normal = normalize(cross(dFdx(v_worldPos), dFdy(v_worldPos)));
            
            vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
            float diffuse = max(0.4, dot(normal, lightDir));
            
            vec3 color = plantColor * diffuse;
            
            float dist = length(v_viewPos);
            float fogFactor = smoothstep(60.0, 100.0, dist);
            vec3 fogColor = vec3(0.7, 0.8, 0.9);
            color = mix(color, fogColor, fogFactor);
            
            fragColor = vec4(color, v_alpha);
        }
    `;
}
