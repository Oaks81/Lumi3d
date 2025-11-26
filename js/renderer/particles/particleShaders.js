export function getParticleRenderShader() {
    return {
        vertex: `
            attribute vec3 instancePosition;
            attribute vec3 instanceVelocity;
            attribute vec4 instanceColor;
            attribute vec2 instanceLifetime; // current, max
            attribute float instanceSize;
            attribute float instanceRotation;
            
            varying vec2 vUv;
            varying vec4 vColor;
            varying float vLife;
            
            uniform float time;
            uniform float cameraNear;
            uniform float cameraFar;
            
            void main() {
                vUv = uv;
                vColor = instanceColor;
                vLife = instanceLifetime.x / instanceLifetime.y;
                
                // Billboard rotation
                vec4 mvPosition = modelViewMatrix * vec4(instancePosition, 1.0);
                
                // Apply particle rotation
                float c = cos(instanceRotation);
                float s = sin(instanceRotation);
                vec2 rotatedPosition = vec2(
                    position.x * c - position.y * s,
                    position.x * s + position.y * c
                );
                
                // Scale by size
                mvPosition.xy += rotatedPosition * instanceSize;
                
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragment: `
            uniform sampler2D map;
            uniform float time;
            
            varying vec2 vUv;
            varying vec4 vColor;
            varying float vLife;
            
            void main() {
                vec4 texColor = texture2D(map, vUv);
                
                // Fade out dead particles
                if (vLife <= 0.0) discard;
                
                gl_FragColor = texColor * vColor;
                gl_FragColor.a *= vLife; // Additional fade based on lifetime
            }
        `
    };
}