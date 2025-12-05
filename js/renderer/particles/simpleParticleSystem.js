import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class SimpleParticleSystem {
    constructor(scene, lightManager) {
        this.scene = scene;
        this.lightManager = lightManager;
        this.emitters = new Map();
        
        console.log('SimpleParticleSystem initialized');
    }
    
    createEmitter(name, config) {
        // Create geometry with initial positions
        const geometry = new THREE.BufferGeometry();
        const maxParticles = config.maxParticles || 1000;
        
        // Allocate arrays
        const positions = new Float32Array(maxParticles * 3);
        const colors = new Float32Array(maxParticles * 3);
        const sizes = new Float32Array(maxParticles);
        const lifetimes = new Float32Array(maxParticles);
        
        // Initialize particles at origin
        for (let i = 0; i < maxParticles; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            
            colors[i * 3] = config.color?.r || 1;
            colors[i * 3 + 1] = config.color?.g || 1;
            colors[i * 3 + 2] = config.color?.b || 1;
            
            sizes[i] = 0; // Start invisible
            lifetimes[i] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
        
        // Create texture
        const texture = this.createParticleTexture();
        
        // Create material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                time: { value: 0 }
            },
            vertexShader: `
                attribute float size;
                attribute float lifetime;
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    vColor = color;
                    vLifetime = lifetime;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    if (vLifetime <= 0.0) discard;
                    
                    vec2 uv = gl_PointCoord;
                    vec4 texColor = texture2D(map, uv);
                    
                    gl_FragColor = vec4(vColor, texColor.a * vLifetime);
                }
            `,
            transparent: true,
            blending: config.blending || THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });
        
        // Create Points
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        
        // Create emitter data
        const emitter = {
            name,
            config,
            points,
            particles: [],
            activeCount: 0,
            emissionAccumulator: 0,
            position: new THREE.Vector3(),
            time: 0
        };
        
        // Initialize particle pool
        for (let i = 0; i < maxParticles; i++) {
            emitter.particles.push({
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                lifetime: 0,
                maxLifetime: 1,
                size: 1,
                active: false
            });
        }
        
        this.emitters.set(name, emitter);
        this.scene.add(points);
        
        console.log(`Created emitter: ${name} with ${maxParticles} particles`);
        return emitter;
    }
    
    update(deltaTime) {
        for (const [name, emitter] of this.emitters) {
            this.updateEmitter(emitter, deltaTime);
        }
    }
    
    updateEmitter(emitter, deltaTime) {
        const geometry = emitter.points.geometry;
        const positions = geometry.attributes.position.array;
        const sizes = geometry.attributes.size.array;
        const lifetimes = geometry.attributes.lifetime.array;
        
        emitter.time += deltaTime;
        emitter.emissionAccumulator += deltaTime;
        
        // Emit new particles
        const emissionRate = emitter.config.emissionRate || 10;
        const emissionInterval = 1.0 / emissionRate;
        let emitted = 0;
        
        while (emitter.emissionAccumulator >= emissionInterval) {
            emitter.emissionAccumulator -= emissionInterval;
            
            // Find dead particle to reuse
            for (let i = 0; i < emitter.particles.length; i++) {
                const p = emitter.particles[i];
                if (!p.active) {
                    // Spawn particle
                    p.position.copy(emitter.position);
                    p.position.x += (Math.random() - 0.5) * 2;
                    p.position.y += (Math.random() - 0.5) * 2;
                    p.position.z += (Math.random() - 0.5) * 2;
                    
                    const speed = emitter.config.velocity?.min || 5;
                    p.velocity.set(
                        (Math.random() - 0.5) * speed,
                        Math.random() * speed,
                        (Math.random() - 0.5) * speed
                    );
                    
                    p.lifetime = emitter.config.lifetime?.min || 1;
                    p.maxLifetime = p.lifetime;
                    p.size = emitter.config.size?.min || 1;
                    p.active = true;
                    
                    emitted++;
                    break;
                }
            }
            
            if (emitted >= 10) break; // Limit per frame
        }
        
        // Update particles
        let activeCount = 0;
        for (let i = 0; i < emitter.particles.length; i++) {
            const p = emitter.particles[i];
            
            if (p.active) {
                // Update physics
                p.lifetime -= deltaTime;
                
                if (p.lifetime <= 0) {
                    p.active = false;
                    sizes[i] = 0;
                    lifetimes[i] = 0;
                } else {
                    // Update position
                    p.position.x += p.velocity.x * deltaTime;
                    p.position.y += p.velocity.y * deltaTime;
                    p.position.z += p.velocity.z * deltaTime;
                    
                    // Apply forces
                    if (emitter.config.forces) {
                        p.velocity.x += emitter.config.forces.x * deltaTime;
                        p.velocity.y += emitter.config.forces.y * deltaTime;
                        p.velocity.z += emitter.config.forces.z * deltaTime;
                    }
                    
                    // Update buffers
                    positions[i * 3] = p.position.x;
                    positions[i * 3 + 1] = p.position.y;
                    positions[i * 3 + 2] = p.position.z;
                    
                    sizes[i] = p.size;
                    lifetimes[i] = p.lifetime / p.maxLifetime;
                    
                    activeCount++;
                }
            } else {
                sizes[i] = 0;
                lifetimes[i] = 0;
            }
        }
        
        // Mark for update
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;
        geometry.attributes.lifetime.needsUpdate = true;
        
        // Update material time
        emitter.points.material.uniforms.time.value = emitter.time;
        
        // Debug log occasionally
        if (Math.random() < 0.01) {
            console.log(`Emitter ${emitter.name}: ${activeCount} active, emitted ${emitted}`);
        }
    }
    
    setEmitterPosition(name, x, y, z) {
        const emitter = this.emitters.get(name);
        if (emitter) {
            emitter.position.set(x, y, z);
        }
    }
    
    createParticleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // Simple radial gradient
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }
    
    cleanup() {
        for (const emitter of this.emitters.values()) {
            this.scene.remove(emitter.points);
            emitter.points.geometry.dispose();
            emitter.points.material.dispose();
        }
        this.emitters.clear();
    }
}
