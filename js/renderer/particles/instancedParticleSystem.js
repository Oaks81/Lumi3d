import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class InstancedParticleSystem {
    constructor(scene, lightManager, camera) {
        this.scene = scene;
        this.lightManager = lightManager;
        this.camera = camera; // Need camera for billboarding
        this.emitters = new Map();
        
        // Shared geometries
        this.geometries = {
            quad: this.createQuadGeometry(),
            cone: this.createConeGeometry()
        };
        
        // Reusable objects for performance
        this._matrix = new THREE.Matrix4();
        this._position = new THREE.Vector3();
        this._quaternion = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        this._cameraWorldPos = new THREE.Vector3();
        this._toBillboard = new THREE.Vector3();
        
        console.log('✓ InstancedParticleSystem initialized');
    }
    
    createQuadGeometry() {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
             0.5,  0.5, 0,
            -0.5,  0.5, 0
        ]);
        const uvs = new Float32Array([
            0, 0,
            1, 0,
            1, 1,
            0, 1
        ]);
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        
        return geometry;
    }
    
    createConeGeometry() {
        // Elongated cone for engine flames
        const geometry = new THREE.ConeGeometry(0.5, 2, 8, 1);
        geometry.rotateX(Math.PI / 2); // Point along Z axis
        return geometry;
    }
    

    createEmitter(name, config) {
        const maxParticles = config.maxParticles || 1000;
        const geometry = this.geometries[config.geometry || 'quad'];
        
        // Create material
        const material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: config.texture || this.createTexture(config.textureType || 'soft') },
                time: { value: 0 },
                cameraPosition: { value: new THREE.Vector3() }
            },
            vertexShader: this.getVertexShader(config.billboard),
            fragmentShader: this.getFragmentShader(),
            transparent: true,
            blending: config.blending || THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.InstancedMesh(geometry, material, maxParticles);
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        
        // Custom instance attributes
        const colors = new Float32Array(maxParticles * 4);
        const lifetimes = new Float32Array(maxParticles * 2);
        
        mesh.geometry.setAttribute('instanceColor', 
            new THREE.InstancedBufferAttribute(colors, 4));
        mesh.geometry.setAttribute('instanceLifetime', 
            new THREE.InstancedBufferAttribute(lifetimes, 2));
        
        // Emitter data
        const emitter = {
            name,
            config,
            mesh,
            particles: [],
            emissionAccumulator: 0,
            position: new THREE.Vector3(),
            direction: new THREE.Vector3(0, 0, 1),
            time: 0,
            light: null,
            persistent: config.persistent || false, // NEW: persistent flag
            initialized: false
        };
        
        // Initialize particle pool
        for (let i = 0; i < maxParticles; i++) {
            emitter.particles.push({
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                scale: new THREE.Vector3(1, 1, 1),
                color: new THREE.Color(1, 1, 1),
                alpha: 1,
                lifetime: 0,
                maxLifetime: 1,
                active: false,
                persistent: false // Track if this particle is persistent
            });
        }
        
        this.emitters.set(name, emitter);
        this.scene.add(mesh);
        
        // Attach light if configured
        if (config.light) {
            emitter.light = this.lightManager.addLight(1, {
                position: emitter.position.clone(),
                color: config.light.color || new THREE.Color(1, 1, 1),
                intensity: config.light.intensity || 50,
                radius: config.light.radius || 30,
                decay: config.light.decay || 2
            });
            console.log(`✓ Attached point light to ${name}:`, {
                intensity: emitter.light.intensity,
                radius: emitter.light.radius,
                color: emitter.light.color
            });
        }
        
        console.log(`✓ Created emitter: ${name} (${maxParticles} particles, persistent: ${emitter.persistent})`);
        return emitter;
    }
    
    update(deltaTime) {
        // Update camera position for billboarding
        this.camera.getWorldPosition(this._cameraWorldPos);
        
        for (const [name, emitter] of this.emitters) {
            this.updateEmitter(emitter, deltaTime);
        }
    }

    updateEmitter(emitter, deltaTime) {
        const mesh = emitter.mesh;
        const config = emitter.config;
        
        emitter.time += deltaTime;
        
        // Update material uniforms
        mesh.material.uniforms.time.value = emitter.time;
        mesh.material.uniforms.cameraPosition.value.copy(this._cameraWorldPos);
        
        // Initialize persistent particles once
        if (config.persistent && !emitter.initialized) {
            for (let i = 0; i < Math.min(config.maxParticles, emitter.particles.length); i++) {
                const p = emitter.particles[i];
                this.spawnParticle(p, emitter);
                p.persistent = true;
                p.lifetime = 999999; // Effectively infinite
                p.maxLifetime = 999999;
            }
            emitter.initialized = true;
        }
        
        // Regular emission for non-persistent emitters
        if (!config.persistent && config.emissionRate > 0) {
            emitter.emissionAccumulator += deltaTime * config.emissionRate;
            
            while (emitter.emissionAccumulator >= 1.0) {
                emitter.emissionAccumulator -= 1.0;
                
                // Find inactive particle
                for (let i = 0; i < emitter.particles.length; i++) {
                    if (!emitter.particles[i].active && !emitter.particles[i].persistent) {
                        this.spawnParticle(emitter.particles[i], emitter);
                        break;
                    }
                }
            }
        }
        
        // Get attributes
        const colors = mesh.geometry.attributes.instanceColor.array;
        const lifetimes = mesh.geometry.attributes.instanceLifetime.array;
        
        // Update particles
        let activeCount = 0;
        
        for (let i = 0; i < emitter.particles.length; i++) {
            const p = emitter.particles[i];
            
            if (p.active) {
                // Update lifetime (skip for persistent particles)
                if (!p.persistent) {
                    p.lifetime -= deltaTime;
                    
                    if (p.lifetime <= 0) {
                        p.active = false;
                        this._scale.set(0, 0, 0);
                        this._matrix.compose(p.position, this._quaternion, this._scale);
                        mesh.setMatrixAt(i, this._matrix);
                        continue;
                    }
                }
                
                // Update physics
                if (config.stationary === true) {
                    // Stationary particles track emitter position
                    p.position.copy(emitter.position);
                } else {
                    p.position.add(p.velocity.clone().multiplyScalar(deltaTime));
                    
                    if (config.forces) {
                        p.velocity.add(config.forces.clone().multiplyScalar(deltaTime));
                    }
                    
                    if (config.drag) {
                        p.velocity.multiplyScalar(Math.max(0, 1.0 - config.drag * deltaTime));
                    }
                }
                
                // Update visuals
                let t = 0;
                let tInverse = 1;
                
                if (!p.persistent) {
                    t = 1.0 - (p.lifetime / p.maxLifetime);
                    tInverse = p.lifetime / p.maxLifetime;
                }
                
                // Scale over lifetime
                let scale = p.scale.x;
                if (config.scaleOverLifetime && !p.persistent) {
                    scale *= config.scaleOverLifetime(t);
                }
                
                // Alpha over lifetime
                let alpha = 1.0;
                if (config.alphaOverLifetime) {
                    // For persistent particles, pass time instead of lifetime ratio
                    alpha = p.persistent ? 
                        config.alphaOverLifetime(emitter.time) : 
                        config.alphaOverLifetime(tInverse);
                }
                
                // Color
                let color = p.color;
                if (config.colorOverLifetime && !p.persistent) {
                    color = config.colorOverLifetime(t);
                }
                
                // Build matrix
                if (config.billboard) {
                    // Billboard: always face camera
                    this._toBillboard.subVectors(this._cameraWorldPos, p.position).normalize();
                    this._quaternion.setFromUnitVectors(
                        new THREE.Vector3(0, 0, 1),
                        this._toBillboard
                    );
                } else {
                    this._quaternion.identity();
                }
                
                this._scale.set(scale, scale, scale);
                this._matrix.compose(p.position, this._quaternion, this._scale);
                mesh.setMatrixAt(i, this._matrix);
                
                // Update attributes
                colors[i * 4] = color.r;
                colors[i * 4 + 1] = color.g;
                colors[i * 4 + 2] = color.b;
                colors[i * 4 + 3] = alpha;
                
                lifetimes[i * 2] = p.lifetime;
                lifetimes[i * 2 + 1] = p.maxLifetime;
                
                activeCount++;
            } else {
                // Hide inactive
                this._scale.set(0, 0, 0);
                this._matrix.compose(p.position, this._quaternion, this._scale);
                mesh.setMatrixAt(i, this._matrix);
            }
        }
        
        // Mark for update
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.attributes.instanceColor.needsUpdate = true;
        mesh.geometry.attributes.instanceLifetime.needsUpdate = true;
        
        // Update light position to follow emitter
        if (emitter.light) {
            emitter.light.position.copy(emitter.position);
            
            // Modulate intensity
            if (config.light.pulse) {
                const pulse = Math.sin(emitter.time * config.light.pulseSpeed) * 0.5 + 0.5;
                emitter.light.intensity = config.light.intensity * (0.3 + pulse * 0.7);
            }
        }
    }
    spawnParticle(particle, emitter) {
        const config = emitter.config;
        
        particle.active = true;
        particle.position.copy(emitter.position);
        
        // Add spawn variance
        if (config.spawnRadius) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * config.spawnRadius;
            particle.position.x += Math.cos(angle) * radius;
            particle.position.y += Math.sin(angle) * radius;
        }
        
        // Velocity
        if (config.stationary) {
            particle.velocity.set(0, 0, 0);
        } else {
            const speed = THREE.MathUtils.lerp(
                config.velocity?.min || 1,
                config.velocity?.max || 5,
                Math.random()
            );
            
            particle.velocity.copy(emitter.direction);
            
            // Add cone spread
            if (config.coneAngle) {
                const angle = Math.random() * Math.PI * 2;
                const spread = Math.random() * config.coneAngle;
                const perpendicular = new THREE.Vector3(
                    Math.cos(angle),
                    Math.sin(angle),
                    0
                );
                particle.velocity.add(perpendicular.multiplyScalar(Math.sin(spread)));
                particle.velocity.normalize();
            }
            
            particle.velocity.multiplyScalar(speed);
        }
        
        // Lifetime
        particle.lifetime = THREE.MathUtils.lerp(
            config.lifetime?.min || 1,
            config.lifetime?.max || 2,
            Math.random()
        );
        particle.maxLifetime = particle.lifetime;
        
        // Scale
        const size = THREE.MathUtils.lerp(
            config.size?.min || 1,
            config.size?.max || 2,
            Math.random()
        );
        particle.scale.set(size, size, size);
        
        // Color
        if (config.color) {
            particle.color.setRGB(config.color.r, config.color.g, config.color.b);
        } else {
            particle.color.setRGB(1, 1, 1);
        }
    }
    
    setEmitterPosition(name, x, y, z) {
        const emitter = this.emitters.get(name);
        if (emitter) {
            emitter.position.set(x, y, z);
        }
    }
    
    setEmitterDirection(name, direction) {
        const emitter = this.emitters.get(name);
        if (emitter) {
            emitter.direction.copy(direction).normalize();
        }
    }
    
    getVertexShader(billboard) {
        return `
            attribute vec4 instanceColor;
            attribute vec2 instanceLifetime;
            
            varying vec2 vUv;
            varying vec4 vColor;
            
            void main() {
                vUv = uv;
                vColor = instanceColor;
                
                vec4 worldPos = instanceMatrix * vec4(position, 1.0);
                vec4 mvPosition = viewMatrix * worldPos;
                
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
    }
    
    getFragmentShader() {
        return `
            uniform sampler2D map;
            
            varying vec2 vUv;
            varying vec4 vColor;
            
            void main() {
                vec4 texColor = texture2D(map, vUv);
                vec4 finalColor = texColor * vColor;
                
                if (finalColor.a < 0.01) discard;
                
                gl_FragColor = finalColor;
            }
        `;
    }
    

    createTexture(type) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        if (type === 'glow') {
            // Bright center glow with more transparent edges - for wing lights
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, 'rgba(255,255,255,1.0)');    // Bright white center
            gradient.addColorStop(0.1, 'rgba(255,255,255,1.0)');  // Keep bright
            gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
            gradient.addColorStop(0.6, 'rgba(255,255,255,0.3)');
            gradient.addColorStop(0.85, 'rgba(255,255,255,0.05)');
            gradient.addColorStop(1, 'rgba(255,255,255,0.0)');    // Fully transparent
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);
        } else if (type === 'spark') {
            // Tiny bright spark - for engine plume
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
            gradient.addColorStop(0.3, 'rgba(255,255,255,0.9)');
            gradient.addColorStop(0.7, 'rgba(255,255,255,0.3)');
            gradient.addColorStop(1, 'rgba(255,255,255,0.0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);
        } else {
            // Soft particle - default
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
            gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');
            gradient.addColorStop(1, 'rgba(255,255,255,0.0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);
        }
        
        return new THREE.CanvasTexture(canvas);
    }
    
    getEmitter(name) {
        return this.emitters.get(name);
    }
    
    cleanup() {
        for (const emitter of this.emitters.values()) {
            this.scene.remove(emitter.mesh);
            emitter.mesh.geometry.dispose();
            emitter.mesh.material.dispose();
        }
        this.emitters.clear();
    }
}