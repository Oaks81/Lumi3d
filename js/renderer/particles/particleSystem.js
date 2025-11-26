import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { ParticleEmitter } from './ParticleEmitter.js';
import { getParticleRenderShader } from './ParticleShaders.js';

export class ParticleSystem {
    constructor(renderer, lightManager) {
        this.renderer = renderer;
        this.lightManager = lightManager;
        
        this.emitters = new Map();
        this.particleMeshes = new Map();
        
        // Global settings
        this.maxParticles = 10000;
        this.particlePoolSize = this.maxParticles;
        
        console.log('✓ ParticleSystem initialized');
    }
    
    /**
     * Create a new emitter
     */
    createEmitter(name, config) {
        const emitter = new ParticleEmitter(name, config, this.renderer);
        this.emitters.set(name, emitter);
        
        // Create instanced mesh for this emitter
        const mesh = this.createParticleMesh(emitter);
        this.particleMeshes.set(name, mesh);
        
        console.log(`✓ Created emitter: ${name}`);
        return emitter;
    }
    
    createParticleMesh(emitter) {
        // Base plane
        const base = new THREE.PlaneGeometry(1, 1);
    
        // Create an InstancedBufferGeometry and copy base attributes properly
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        // copy vertex attributes explicitly (clone to be safe)
        geometry.setAttribute('position', base.attributes.position.clone());
        if (base.attributes.normal) geometry.setAttribute('normal', base.attributes.normal.clone());
        if (base.attributes.uv) geometry.setAttribute('uv', base.attributes.uv.clone());
    
        const maxCount = emitter.maxParticles;
    
        // Instance attributes (per-particle data)
        const instancePositions = new Float32Array(maxCount * 3);
        const instanceVelocities = new Float32Array(maxCount * 3);
        const instanceColors = new Float32Array(maxCount * 4);
        const instanceLifetimes = new Float32Array(maxCount * 2); // current, max
        const instanceSizes = new Float32Array(maxCount);
        const instanceRotations = new Float32Array(maxCount);
    
        // Initialize lifetimes' max values to 1 to avoid divide-by-zero in shader on unused slots
        for (let i = 0; i < maxCount; i++) {
            instanceLifetimes[i * 2 + 0] = 0.0; // current life
            instanceLifetimes[i * 2 + 1] = 1.0; // max life (avoid zero)
            instanceSizes[i] = 1.0;
            instanceColors[i * 4 + 0] = 1.0;
            instanceColors[i * 4 + 1] = 1.0;
            instanceColors[i * 4 + 2] = 1.0;
            instanceColors[i * 4 + 3] = 0.0;
        }
    
        geometry.setAttribute('instancePosition',
            new THREE.InstancedBufferAttribute(instancePositions, 3, false));
        geometry.setAttribute('instanceVelocity',
            new THREE.InstancedBufferAttribute(instanceVelocities, 3, false));
        geometry.setAttribute('instanceColor',
            new THREE.InstancedBufferAttribute(instanceColors, 4, false));
        geometry.setAttribute('instanceLifetime',
            new THREE.InstancedBufferAttribute(instanceLifetimes, 2, false));
        geometry.setAttribute('instanceSize',
            new THREE.InstancedBufferAttribute(instanceSizes, 1, false));
        geometry.setAttribute('instanceRotation',
            new THREE.InstancedBufferAttribute(instanceRotations, 1, false));
    
        // Important: start with instanceCount = 0 (no visible instances)
        geometry.instanceCount = 0;
    
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                map: { value: emitter.config.texture || this.createDefaultParticleTexture() },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 }
            },
            vertexShader: getParticleRenderShader().vertex,
            fragmentShader: getParticleRenderShader().fragment,
            transparent: true,
            depthWrite: false,
            blending: emitter.config.blending || THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
    
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
    
        mesh.userData.emitter = emitter;
        mesh.userData._instancedMaxCount = maxCount; // handy to keep around
    
        return mesh;
    }
    


/**
 * Helper method to spawn a particle at a specific index
 */
spawnParticle(emitter, index, positions, velocities, colors, lifetimes, sizes, rotations) {
    const idx = index * 3;
    const idx2 = index * 2;
    const idx4 = index * 4;
    
    const spawnPos = emitter.getSpawnPosition();
    const spawnVel = emitter.getSpawnVelocity();
    const lifetime = emitter.getLifetime();
    const color = emitter.getColor();
    const size = emitter.getSize();
    
    positions.array[idx] = spawnPos.x;
    positions.array[idx + 1] = spawnPos.y;
    positions.array[idx + 2] = spawnPos.z;
    
    velocities.array[idx] = spawnVel.x;
    velocities.array[idx + 1] = spawnVel.y;
    velocities.array[idx + 2] = spawnVel.z;
    
    lifetimes.array[idx2] = lifetime; // current
    lifetimes.array[idx2 + 1] = lifetime; // max
    
    colors.array[idx4] = color.r;
    colors.array[idx4 + 1] = color.g;
    colors.array[idx4 + 2] = color.b;
    colors.array[idx4 + 3] = color.a;
    
    sizes.array[index] = size;
    rotations.array[index] = Math.random() * Math.PI * 2;
    
    // Debug first spawn
    if (index === 0 && !this._spawnedFirst) {
        console.log(`First particle spawned for ${emitter.name}:`, {
            pos: spawnPos,
            vel: spawnVel,
            lifetime,
            size,
            color
        });
        this._spawnedFirst = true;
    }
}
    /**
     * Update all emitters
     */
    update(deltaTime, camera) {
        for (const [name, emitter] of this.emitters) {
            if (!emitter.active) continue;
            
            const mesh = this.particleMeshes.get(name);
            if (!mesh) continue;
            // Update emitter logic
            emitter.update(deltaTime);
            
            // Update particle states on GPU
            this.updateParticles(emitter, mesh, deltaTime);

            mesh.material.uniforms.time.value += deltaTime;
            mesh.material.uniforms.cameraNear.value = camera.near;
            mesh.material.uniforms.cameraFar.value = camera.far;
            
            // Update attached lights
            if (emitter.config.light) {
                this.updateEmitterLight(emitter, mesh);
            }
            if (!this._loggedFirstUpdate || (this._frameCount % 60 === 0)) {
                console.log(`Updating emitter ${name}:`, {
                    active: emitter.active,
                    particleCount: emitter.particleCount,
                    meshCount: mesh.count,
                    position: emitter.position
                });
                this._loggedFirstUpdate = true;
            }
            
        }
        this._frameCount = (this._frameCount || 0) + 1;
    }

    // In ParticleEmitter.js, update getEmissionCount:
getEmissionCount(deltaTime) {
    if (!this.active) return 0;
    
    const rate = this.config.emissionRate;
    const interval = 1.0 / rate;
    
    let count = 0;
    const maxEmitPerFrame = 50; // Safety limit
    
    while (this.emissionAccumulator >= interval && 
           this.particleCount < this.maxParticles && 
           count < maxEmitPerFrame) {
        count++;
        this.emissionAccumulator -= interval;
    }
    
    // Clamp accumulator to prevent huge buildups
    this.emissionAccumulator = Math.min(this.emissionAccumulator, interval * 2);
    
    return Math.min(count, this.maxParticles - this.particleCount);
}
/**
 * GPU particle update (positions, lifetimes, etc.)
 */
updateParticles(emitter, mesh, deltaTime) {
    const geometry = mesh.geometry;
    const config = emitter.config;
    
    // Get instance attributes
    const positions = geometry.attributes.instancePosition;
    const velocities = geometry.attributes.instanceVelocity;
    const colors = geometry.attributes.instanceColor;
    const lifetimes = geometry.attributes.instanceLifetime;
    const sizes = geometry.attributes.instanceSize;
    const rotations = geometry.attributes.instanceRotation;
    
    let activeCount = 0;
    
    // Emit new particles
    const toEmit = Math.min(
        emitter.getEmissionCount(deltaTime),
        emitter.maxParticles - emitter.particleCount
    );
    
    // Debug: Log emission
    if (emitter.name === 'spaceship_engine' && toEmit > 0) {
        console.log(`Engine emitting ${toEmit} particles`);
    }
    
    // FIXED: Store the initial particle count before modifying it
    const currentParticleCount = emitter.particleCount;
    
    // First pass: Update existing particles and count alive ones
    let aliveBeforeUpdate = 0;
    for (let i = 0; i < currentParticleCount; i++) {
        const idx = i * 3;
        const idx2 = i * 2;
        const idx4 = i * 4;
        
        // Check if particle was alive before update
        const oldLife = lifetimes.array[idx2];
        if (oldLife > 0) aliveBeforeUpdate++;
        
        // Update existing particle
        const currentLife = lifetimes.array[idx2];
        
        if (currentLife <= 0) {
            // Mark as available for reuse but don't update
            continue;
        }
        
        // Update lifetime
        const newLife = Math.max(0, currentLife - deltaTime);
        lifetimes.array[idx2] = newLife;
        
        // Only update physics if still alive
        if (newLife > 0) {
            // Update position
            positions.array[idx] += velocities.array[idx] * deltaTime;
            positions.array[idx + 1] += velocities.array[idx + 1] * deltaTime;
            positions.array[idx + 2] += velocities.array[idx + 2] * deltaTime;
            
            // Apply forces
            velocities.array[idx] += config.forces.x * deltaTime;
            velocities.array[idx + 1] += config.forces.y * deltaTime;
            velocities.array[idx + 2] += config.forces.z * deltaTime;
            
            // Apply drag
            const drag = 1.0 - (config.drag || 0) * deltaTime;
            velocities.array[idx] *= drag;
            velocities.array[idx + 1] *= drag;
            velocities.array[idx + 2] *= drag;
            
            // Update rotation
            rotations.array[i] += (config.rotationSpeed || 0) * deltaTime;
            
            // Update size (growth/shrink over lifetime)
            if (config.sizeOverLifetime) {
                const t = 1.0 - (newLife / lifetimes.array[idx2 + 1]);
                sizes.array[i] = config.sizeOverLifetime(t, sizes.array[i]);
            }
            
            // Update color/alpha over lifetime
            if (config.alphaOverLifetime) {
                const t = newLife / lifetimes.array[idx2 + 1];
                colors.array[idx4 + 3] = config.alphaOverLifetime(t);
            }
            
            activeCount++;
        }
    }
    
    // Second pass: Spawn new particles (reuse dead particle slots first)
    if (toEmit > 0) {
        let spawned = 0;
        
        // First try to reuse dead particles
        for (let i = 0; i < currentParticleCount && spawned < toEmit; i++) {
            const idx2 = i * 2;
            
            if (lifetimes.array[idx2] <= 0) {
                // Reuse this dead particle
                this.spawnParticle(emitter, i, positions, velocities, colors, lifetimes, sizes, rotations);
                spawned++;
                activeCount++;
            }
        }
        
        // Then add new particles if needed
        while (spawned < toEmit && emitter.particleCount < emitter.maxParticles) {
            const i = emitter.particleCount;
            this.spawnParticle(emitter, i, positions, velocities, colors, lifetimes, sizes, rotations);
            emitter.particleCount++;
            spawned++;
            activeCount++;
        }
        
        if (emitter.name === 'spaceship_engine') {
            console.log(`Engine spawned ${spawned} particles, activeCount=${activeCount}`);
        }
    }
    
    // Mark attributes for update
    positions.needsUpdate = true;
    velocities.needsUpdate = true;
    colors.needsUpdate = true;
    lifetimes.needsUpdate = true;
    sizes.needsUpdate = true;
    rotations.needsUpdate = true;
    
    // Debug logging
    if (!this._debugLog) this._debugLog = {};
    if (!this._debugLog[emitter.name]) {
        console.log(`[${emitter.name}] First update:`, {
            toEmit,
            currentParticleCount,
            aliveBeforeUpdate,
            activeCount,
            deltaTime: deltaTime.toFixed(4),
            emissionRate: config.emissionRate,
            accumulator: emitter.emissionAccumulator.toFixed(4)
        });
        this._debugLog[emitter.name] = true;
    }
    
    if (activeCount > 0 && (!this._particleLogCount || this._particleLogCount % 60 === 0)) {
        console.log(`[${emitter.name}] Particles:`, {
            active: activeCount,
            total: emitter.particleCount,
            emitted: toEmit,
            position: emitter.position
        });
    }
    this._particleLogCount = (this._particleLogCount || 0) + 1;
    
    mesh.count = activeCount;
}


    
    /**
     * Update lights attached to emitters
     */
    updateEmitterLight(emitter, mesh) {
        const lightConfig = emitter.config.light;
        
        if (!emitter.light) {
            // Create light
            emitter.light = this.lightManager.addLight(1, { // POINT light
                position: emitter.position.clone(),
                color: lightConfig.color || new THREE.Color(1, 1, 1),
                intensity: lightConfig.intensity || 10,
                radius: lightConfig.radius || 20,
                decay: lightConfig.decay || 2.0
            });
        }
        
        // Update light position to emitter position
        emitter.light.position.copy(emitter.position);
        
        // Modulate intensity
        if (lightConfig.flicker) {
            const t = performance.now() * 0.001;
            const flicker = 0.8 + Math.random() * 0.2 + Math.sin(t * lightConfig.flickerSpeed) * 0.1;
            emitter.light.intensity = lightConfig.intensity * flicker;
        }
        
        if (lightConfig.pulse) {
            const t = performance.now() * 0.001;
            const pulse = 0.5 + 0.5 * Math.sin(t * lightConfig.pulseSpeed);
            emitter.light.intensity = lightConfig.intensity * pulse;
        }
    }
    
    /**
     * Add particle mesh to scene
     */
    addToScene(scene) {
        for (const mesh of this.particleMeshes.values()) {
            scene.add(mesh);
        }
    }
    
    /**
     * Remove from scene
     */
    removeFromScene(scene) {
        for (const mesh of this.particleMeshes.values()) {
            scene.remove(mesh);
        }
    }
    
    /**
     * Get emitter by name
     */
    getEmitter(name) {
        return this.emitters.get(name);
    }
    
    /**
     * Create default particle texture
     */
    createDefaultParticleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Radial gradient
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }
    
    /**
     * Cleanup
     */
    cleanup() {
        for (const emitter of this.emitters.values()) {
            if (emitter.light) {
                // Remove light from light manager
                const idx = this.lightManager.lights.indexOf(emitter.light);
                if (idx >= 0) {
                    this.lightManager.lights.splice(idx, 1);
                }
            }
        }
        
        for (const mesh of this.particleMeshes.values()) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        
        this.emitters.clear();
        this.particleMeshes.clear();
    }
}