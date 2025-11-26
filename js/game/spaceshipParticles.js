import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class SpaceshipParticles {
    constructor(particleSystem, spaceshipModel) {
        this.particleSystem = particleSystem;
        this.spaceshipModel = spaceshipModel;
        
    //    this.setupWingLights();
        // NO ENGINE - removed setupEngineFlame()
        
        console.log('✓ Spaceship particles initialized (wing lights only)');
    }
    
    setupWingLights() {
        // Left wing - RED (navigation light - port side)
        this.leftWingEmitter = this.particleSystem.createEmitter('leftWing', {
            maxParticles: 1,
            geometry: 'quad',
            textureType: 'glow',
            persistent: true, // NEW: Single persistent particle
            billboard: true,
            stationary: true,
            
            size: { min: 1.0, max: 1.0 },
            
            color: { r: 1.0, g: 0.0, b: 0.0 }, // RED
            
            alphaOverLifetime: (time) => {
                // Use time directly for persistent particles
                const pulse = Math.sin(time * 2.09) * 0.5 + 0.5; // 3-second cycle
                return 0.3 + pulse * 0.7;
            },
            
            blending: THREE.AdditiveBlending,
            
            light: {
                color: new THREE.Color(1, 0, 0), // RED
                intensity: 80, // Brighter
                radius: 20,    // Larger radius
                decay: 2,
                pulse: true,
                pulseSpeed: 2.09
            }
        });
        
        // Right wing - GREEN (navigation light - starboard side)  
        this.rightWingEmitter = this.particleSystem.createEmitter('rightWing', {
            maxParticles: 1,
            geometry: 'quad',
            textureType: 'glow',
            persistent: true,
            billboard: true,
            stationary: true,
            
            size: { min: 1.0, max: 1.0 },
            
            color: { r: 0.0, g: 1.0, b: 0.0 }, // GREEN
            
            alphaOverLifetime: (time) => {
                const pulse = Math.sin(time * 2.09) * 0.5 + 0.5;
                return 0.3 + pulse * 0.7;
            },
            
            blending: THREE.AdditiveBlending,
            
            light: {
                color: new THREE.Color(0, 1, 0), // GREEN  
                intensity: 80,
                radius: 20,
                decay: 2,
                pulse: true,
                pulseSpeed: 2.09
            }
        });
    }
    
    update(spaceshipState) {
        const mesh = this.spaceshipModel.mesh;
        if (!mesh) return;
        return;
        
        // Update wing light positions
        const leftPos = new THREE.Vector3(-1.5, 0, -0.5);
        leftPos.applyMatrix4(mesh.matrixWorld);
        this.particleSystem.setEmitterPosition('leftWing', leftPos.x, leftPos.y, leftPos.z);
        
        const rightPos = new THREE.Vector3(1.5, 0, -0.5);
        rightPos.applyMatrix4(mesh.matrixWorld);
        this.particleSystem.setEmitterPosition('rightWing', rightPos.x, rightPos.y, rightPos.z);
    }
}