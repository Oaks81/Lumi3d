/**
 * Build vertex shader for grass rendering
 * @param {boolean} isInstanced - Whether to use instancing
 * @returns {string} Vertex shader code
 */
export function buildGrassVertexShader(isInstanced = true) {
    return `
        ${isInstanced ? '#define USE_INSTANCING' : ''}
        
        uniform float time;
        uniform float windStrength;
        uniform vec2 windDirection;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying float vDistanceToCamera;
        varying vec3 vColor;
        
        void main() {
            vUv = uv;
            vColor = color;
            
            // Transform position
            vec3 transformed = position;
            
            #ifdef USE_INSTANCING
                mat4 instanceMatrix4 = instanceMatrix;
                vec4 worldPos = modelMatrix * instanceMatrix4 * vec4(transformed, 1.0);
                mat3 normalMatrix = mat3(transpose(inverse(modelMatrix * instanceMatrix4)));
            #else
                vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
                mat3 normalMatrix = mat3(transpose(inverse(modelMatrix)));
            #endif
            
            // Wind animation - use vertex color red channel as height factor
            float heightFactor = color.r;
            float windTime = time * 2.0;
            
            // Create wind wave
            vec2 windPos = worldPos.xz * 0.1;
            float windWave = sin(windTime + windPos.x * windDirection.x + windPos.y * windDirection.y) * 0.5 + 0.5;
            windWave += sin(windTime * 1.3 + windPos.x * 0.7 + windPos.y * 0.8) * 0.3;
            
            // Apply wind displacement (only to upper parts of grass)
            vec3 windOffset = vec3(
                windDirection.x * windWave * windStrength * heightFactor * 0.3,
                0.0,
                windDirection.y * windWave * windStrength * heightFactor * 0.3
            );
            
            worldPos.xyz += windOffset;
            
            vWorldPosition = worldPos.xyz;
            vDistanceToCamera = length(cameraPosition - worldPos.xyz);
            vNormal = normalize(normalMatrix * normal);
            
            vec4 viewPos = viewMatrix * worldPos;
            gl_Position = projectionMatrix * viewPos;
        }
    `;
}
