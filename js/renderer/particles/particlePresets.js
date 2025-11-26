import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export const ParticlePresets = {
    // Sparks (e.g., from impacts)
    sparks: {
        maxParticles: 200,
        emissionRate: 50,
        emissionShape: 'sphere',
        emissionRadius: 0.3,
        lifetime: { min: 0.2, max: 0.5 },
        velocity: { min: 3, max: 8 },
        forces: new THREE.Vector3(0, 0, -15),
        drag: 3.0,
        size: { min: 0.1, max: 0.3 },
        color: { r: 1.0, g: 0.8, b: 0.3, a: 1.0 },
        blending: THREE.AdditiveBlending
    },
    
    // Smoke plume
    smoke: {
        maxParticles: 300,
        emissionRate: 40,
        emissionShape: 'cone',
        emissionAngle: Math.PI / 6,
        lifetime: { min: 2.0, max: 3.0 },
        velocity: { min: 0.5, max: 1.5 },
        forces: new THREE.Vector3(0, 0, 1), // Rise up
        drag: 0.5,
        size: { min: 1.0, max: 2.0 },
        color: { r: 0.3, g: 0.3, b: 0.3, a: 0.4 },
        sizeOverLifetime: (t, size) => size * (1 + t * 3),
        alphaOverLifetime: (t) => t * 0.5,
        blending: THREE.NormalBlending
    },
    
    // Plasma effect
    plasma: {
        maxParticles: 500,
        emissionRate: 100,
        emissionShape: 'sphere',
        emissionRadius: 0.5,
        lifetime: { min: 0.5, max: 1.0 },
        velocity: { min: 0.2, max: 1.0 },
        forces: new THREE.Vector3(0, 0, 0),
        drag: 1.0,
        size: { min: 0.5, max: 1.2 },
        color: { r: 0.5, g: 0.3, b: 1.0, a: 0.8 },
        rotationSpeed: 5.0,
        blending: THREE.AdditiveBlending,
        light: {
            color: new THREE.Color(0.5, 0.3, 1.0),
            intensity: 20,
            radius: 15
        }
    }
};