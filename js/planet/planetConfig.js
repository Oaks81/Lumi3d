import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { PlanetAtmosphereSettings } from './atmosphere/planetAtmosphereSettings.js';

export class PlanetConfig {
    constructor(options = {}) {
        this.name = options.name || 'Planet';
        this.radius = options.radius || 6371000;
        this.atmosphereHeight = options.atmosphereHeight || 100000;
        this.hasAtmosphere = options.hasAtmosphere !== false;
        this.seed = options.seed || 12345;

        this.surfaceChunkSize = options.surfaceChunkSize || 128;
        this.maxTerrainHeight = options.maxTerrainHeight || 8000;

        this.altitudeZones = {
            surface: options.surfaceAltitude || 2000,
            low: options.lowAltitude || 20000,
            transition: options.transitionAltitude || 100000,
            orbital: options.orbitalAltitude || 200000
        };

        this.origin = new THREE.Vector3(
            options.originX || 0,
            options.originY || 0,
            options.originZ || 0
        );

        this.rotationAxis = new THREE.Vector3(0, 0, 1);
        this.rotationSpeed = options.rotationSpeed || 0.0001;
        this.currentRotation = 0;

        this.atmosphereSettings = null;
        if (this.hasAtmosphere) {
            if (options.atmosphereSettings instanceof PlanetAtmosphereSettings) {
                this.atmosphereSettings = options.atmosphereSettings;
            } else {
                this.atmosphereSettings = PlanetAtmosphereSettings.createForPlanet(
                    this.radius,
                    options.atmosphereOptions || {}
                );
            }
        }
    }

    get atmosphereRadius() {
        if (this.atmosphereSettings) {
            return this.atmosphereSettings.atmosphereRadius;
        }
        return this.radius + this.atmosphereHeight;
    }

    get surfaceRadius() {
        return this.radius;
    }

    getAltitudeZone(altitude) {
        if (altitude < this.altitudeZones.surface) return 'surface';
        if (altitude < this.altitudeZones.low) return 'low';
        if (altitude < this.altitudeZones.transition) return 'transition';
        return 'orbital';
    }

    getAtmosphereUniforms() {
        if (!this.atmosphereSettings) return null;
        return this.atmosphereSettings.toUniforms();
    }

    update(deltaTime) {
        this.currentRotation += this.rotationSpeed * deltaTime;
    }

    toJSON() {
        return {
            name: this.name,
            radius: this.radius,
            atmosphereHeight: this.atmosphereHeight,
            seed: this.seed,
            altitudeZones: this.altitudeZones,
            hasAtmosphere: this.hasAtmosphere
        };
    }

    static fromJSON(json) {
        return new PlanetConfig(json);
    }

    static createEarthLike(options = {}) {
        return new PlanetConfig({
            name: 'Earth',
            radius: 6371000,
            atmosphereHeight: 100000,
            maxTerrainHeight: 8848,
            originZ: -6371000,
            hasAtmosphere: true,
            atmosphereOptions: {},
            ...options
        });
    }

    static createMoonLike(options = {}) {
        return new PlanetConfig({
            name: 'Moon',
            radius: 1737000,
            atmosphereHeight: 0,
            hasAtmosphere: false,
            maxTerrainHeight: 10786,
            originZ: -1737000,
            ...options
        });
    }

    static createSmallMoon(options = {}) {
        const radius = options.radius || 50000;
        const config = new PlanetConfig({
            name: 'SmallMoon',
            radius: radius,
            atmosphereHeight: options.atmosphereHeight || 5000,
            hasAtmosphere: true,
            maxTerrainHeight: 2000,
            surfaceAltitude: 500,
            lowAltitude: 5000,
            transitionAltitude: 15000,
            orbitalAltitude: 30000,
            originX: 0,
            originY: 0,
            originZ: 0,
            ...options
        });

        config.atmosphereSettings = PlanetAtmosphereSettings.createForSmallMoon(radius);

        return config;
    }

    static createFlatWorld(options = {}) {
        return new PlanetConfig({
            name: 'FlatWorld',
            radius: Infinity,
            atmosphereHeight: 100000,
            hasAtmosphere: true,
            maxTerrainHeight: 8000,
            originX: 0,
            originY: 0,
            originZ: 0,
            atmosphereOptions: {
                scaleHeightRayleigh: 8000,
                scaleHeightMie: 1200
            },
            ...options
        });
    }
}