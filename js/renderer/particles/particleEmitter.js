import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class ParticleEmitter {
    constructor(name, config, renderer) {
        this.name = name;
        this.config = this.mergeWithDefaults(config);
        this.renderer = renderer;
        
        this.active = true;
        this.position = new THREE.Vector3();
        this.rotation = new THREE.Euler();
        
        this.particleCount = 0;
        this.maxParticles = this.config.maxParticles || 1000;
        
        this.emissionAccumulator = 0;
        this.time = 0;
        
        this.light = null; // Will be created if config.light exists
    }
    
    mergeWithDefaults(config) {
        return {
            // Emission
            emissionRate: 30, // particles per second
            emissionShape: 'point', // point, sphere, cone, box
            emissionRadius: 0.5,
            emissionAngle: Math.PI / 6,
            
            // Lifetime
            lifetime: { min: 1.0, max: 2.0 },
            
            // Velocity
            velocity: { min: 1, max: 3 },
            velocityDirection: new THREE.Vector3(0, 0, 1),
            velocitySpread: 0.3,
            
            // Forces
            forces: new THREE.Vector3(0, 0, -2), // gravity-like
            drag: 0.1,
            
            // Appearance
            size: { min: 0.5, max: 1.0 },
            color: { r: 1, g: 1, b: 1, a: 1 },
            colorVariation: 0.1,
            
            // Animation
            rotationSpeed: 0,
            sizeOverLifetime: null, // function(t, initialSize)
            alphaOverLifetime: (t) => t, // fade out
            
            // Rendering
            blending: THREE.AdditiveBlending,
            texture: null,
            
            // Light attachment
            light: null, // { color, intensity, radius, flicker, pulse }
            
            ...config
        };
    }
    
    update(deltaTime) {
        this.time += deltaTime;
    }
    
    getEmissionCount(deltaTime) {
        if (!this.active) {
            console.log(`${this.name}: not active`);
            return 0;
        }
        
        const rate = this.config.emissionRate;
        const interval = 1.0 / rate;
        
        this.emissionAccumulator += deltaTime;
        
        let count = 0;
        const maxEmitPerFrame = 50;
        
        while (this.emissionAccumulator >= interval && 
               this.particleCount < this.maxParticles && 
               count < maxEmitPerFrame) {
            count++;
            this.emissionAccumulator -= interval;
        }
        
        // Clamp accumulator
        this.emissionAccumulator = Math.min(this.emissionAccumulator, interval * 2);
        
        // Debug logging for engine
        if (this.name === 'spaceship_engine' && (count > 0 || Math.random() < 0.01)) {
            console.log(`${this.name} emission:`, {
                deltaTime: deltaTime.toFixed(4),
                rate,
                interval: interval.toFixed(4),
                accumulator: this.emissionAccumulator.toFixed(4),
                toEmit: count,
                particleCount: this.particleCount,
                maxParticles: this.maxParticles
            });
        }
        
        return Math.min(count, this.maxParticles - this.particleCount);
    }
    
    getSpawnPosition() {
        const pos = new THREE.Vector3();
        
        switch (this.config.emissionShape) {
            case 'point':
                pos.copy(this.position);
                break;
                
            case 'sphere':
                const r = Math.random() * this.config.emissionRadius;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                pos.set(
                    r * Math.sin(phi) * Math.cos(theta),
                    r * Math.sin(phi) * Math.sin(theta),
                    r * Math.cos(phi)
                ).add(this.position);
                break;
                
            case 'cone':
                const angle = Math.random() * this.config.emissionAngle;
                const rot = Math.random() * Math.PI * 2;
                const dist = Math.random() * this.config.emissionRadius;
                pos.set(
                    dist * Math.sin(angle) * Math.cos(rot),
                    dist * Math.sin(angle) * Math.sin(rot),
                    dist * Math.cos(angle)
                );
                pos.applyEuler(this.rotation);
                pos.add(this.position);
                break;
                
            case 'box':
                pos.set(
                    (Math.random() - 0.5) * this.config.emissionRadius,
                    (Math.random() - 0.5) * this.config.emissionRadius,
                    (Math.random() - 0.5) * this.config.emissionRadius
                ).add(this.position);
                break;
        }
        
        return pos;
    }
    
    getSpawnVelocity() {
        const vel = new THREE.Vector3();
        const speed = THREE.MathUtils.lerp(
            this.config.velocity.min,
            this.config.velocity.max,
            Math.random()
        );
        
        // Base direction
        vel.copy(this.config.velocityDirection).normalize();
        
        // Add spread
        const spread = this.config.velocitySpread;
        vel.x += (Math.random() - 0.5) * spread;
        vel.y += (Math.random() - 0.5) * spread;
        vel.z += (Math.random() - 0.5) * spread;
        vel.normalize();
        
        // Apply rotation
        vel.applyEuler(this.rotation);
        
        // Scale by speed
        vel.multiplyScalar(speed);
        
        return vel;
    }
    
    getLifetime() {
        return THREE.MathUtils.lerp(
            this.config.lifetime.min,
            this.config.lifetime.max,
            Math.random()
        );
    }
    
    getColor() {
        const base = this.config.color;
        const variation = this.config.colorVariation;
        
        return {
            r: THREE.MathUtils.clamp(base.r + (Math.random() - 0.5) * variation, 0, 1),
            g: THREE.MathUtils.clamp(base.g + (Math.random() - 0.5) * variation, 0, 1),
            b: THREE.MathUtils.clamp(base.b + (Math.random() - 0.5) * variation, 0, 1),
            a: base.a
        };
    }
    
    getSize() {
        return THREE.MathUtils.lerp(
            this.config.size.min,
            this.config.size.max,
            Math.random()
        );
    }
    
    setPosition(x, y, z) {
        this.position.set(x, y, z);
    }
    
    setRotation(x, y, z) {
        this.rotation.set(x, y, z);
    }
}