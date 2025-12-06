import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class PlanetAtmosphereSettings {
    constructor(options = {}) {
        this.planetRadius = options.planetRadius || 6371000;
        this.atmosphereHeight = options.atmosphereHeight || 100000;
        this.atmosphereRadius = this.planetRadius + this.atmosphereHeight;
        
        this.rayleighScattering = new THREE.Vector3(
            options.rayleighScatteringR ?? 5.5e-6,
            options.rayleighScatteringG ?? 13.0e-6,
            options.rayleighScatteringB ?? 22.4e-6
        );
        
        this.mieScattering = options.mieScattering ?? 21e-6;
        this.mieAnisotropy = options.mieAnisotropy ?? 0.758;
        
        this.ozoneAbsorption = new THREE.Vector3(
            options.ozoneAbsorptionR ?? 0.650e-6,
            options.ozoneAbsorptionG ?? 1.881e-6,
            options.ozoneAbsorptionB ?? 0.085e-6
        );
        
        this.scaleHeightRayleigh = options.scaleHeightRayleigh ?? 8000;
        this.scaleHeightMie = options.scaleHeightMie ?? 1200;
        
        this.groundAlbedo = options.groundAlbedo ?? 0.3;
        this.sunIntensity = options.sunIntensity ?? 20.0;
        
        this._validateParameters();
    }
    
    _validateParameters() {
        if (this.atmosphereHeight <= 0) {
            console.warn('AtmosphereSettings: atmosphereHeight must be positive');
            this.atmosphereHeight = this.planetRadius * 0.1;
            this.atmosphereRadius = this.planetRadius + this.atmosphereHeight;
        }
        
        if (this.scaleHeightRayleigh <= 0 || this.scaleHeightMie <= 0) {
            console.warn('AtmosphereSettings: scale heights must be positive');
            this.scaleHeightRayleigh = Math.max(100, this.scaleHeightRayleigh);
            this.scaleHeightMie = Math.max(100, this.scaleHeightMie);
        }
    }
    
    getRayleighDensity(altitude) {
        return Math.exp(-Math.max(0, altitude) / this.scaleHeightRayleigh);
    }
    
    getMieDensity(altitude) {
        return Math.exp(-Math.max(0, altitude) / this.scaleHeightMie);
    }
    
    getOzoneDensity(altitude) {
        const ozoneLayerCenter = 25000;
        const ozoneLayerWidth = 15000;
        const x = (altitude - ozoneLayerCenter) / ozoneLayerWidth;
        return Math.max(0, 1.0 - x * x);
    }
    
    toUniforms() {
        return {
            planetRadius: { value: this.planetRadius },
            atmosphereRadius: { value: this.atmosphereRadius },
            rayleighScattering: { value: this.rayleighScattering.clone() },
            mieScattering: { value: this.mieScattering },
            mieAnisotropy: { value: this.mieAnisotropy },
            ozoneAbsorption: { value: this.ozoneAbsorption.clone() },
            scaleHeightRayleigh: { value: this.scaleHeightRayleigh },
            scaleHeightMie: { value: this.scaleHeightMie },
            groundAlbedo: { value: this.groundAlbedo },
            sunIntensity: { value: this.sunIntensity }
        };
    }
    
    toUniformBuffer() {
        return new Float32Array([
            this.planetRadius,
            this.atmosphereRadius,
            this.scaleHeightRayleigh,
            this.scaleHeightMie,
            
            this.rayleighScattering.x,
            this.rayleighScattering.y,
            this.rayleighScattering.z,
            this.mieScattering,
            
            this.ozoneAbsorption.x,
            this.ozoneAbsorption.y,
            this.ozoneAbsorption.z,
            this.mieAnisotropy,
            
            this.groundAlbedo,
            this.sunIntensity,
            0.0,
            0.0
        ]);
    }
    
    static createForPlanet(planetRadius, options = {}) {
        const scale = planetRadius / 6371000;
        
        return new PlanetAtmosphereSettings({
            planetRadius: planetRadius,
            atmosphereHeight: options.atmosphereHeight ?? planetRadius * 0.0157,
            rayleighScatteringR: (options.rayleighScatteringR ?? 5.5e-6) / scale,
            rayleighScatteringG: (options.rayleighScatteringG ?? 13.0e-6) / scale,
            rayleighScatteringB: (options.rayleighScatteringB ?? 22.4e-6) / scale,
            mieScattering: (options.mieScattering ?? 21e-6) / scale,
            mieAnisotropy: options.mieAnisotropy ?? 0.758,
            scaleHeightRayleigh: (options.scaleHeightRayleigh ?? 8000) * scale,
            scaleHeightMie: (options.scaleHeightMie ?? 1200) * scale,
            groundAlbedo: options.groundAlbedo ?? 0.3,
            sunIntensity: options.sunIntensity ?? 20.0,
            ...options
        });
    }
    
    static createForSmallMoon(planetRadius) {
        return new PlanetAtmosphereSettings({
            planetRadius: planetRadius,
            atmosphereHeight: planetRadius * 0.2,
            rayleighScatteringR: 5.5e-5,
            rayleighScatteringG: 13.0e-5,
            rayleighScatteringB: 22.4e-5,
            mieScattering: 21e-5,
            mieAnisotropy: 0.8,
            scaleHeightRayleigh: planetRadius * 0.016,
            scaleHeightMie: planetRadius * 0.0024,
            groundAlbedo: 0.2,
            sunIntensity: 15.0
        });
    }
    
    static createThinAtmosphere(planetRadius) {
        return new PlanetAtmosphereSettings({
            planetRadius: planetRadius,
            atmosphereHeight: planetRadius * 0.05,
            rayleighScatteringR: 2.0e-6,
            rayleighScatteringG: 5.0e-6,
            rayleighScatteringB: 10.0e-6,
            mieScattering: 5e-6,
            mieAnisotropy: 0.9,
            scaleHeightRayleigh: planetRadius * 0.01,
            scaleHeightMie: planetRadius * 0.002,
            groundAlbedo: 0.1,
            sunIntensity: 25.0
        });
    }

    static createPreset(presetName) {
        switch (presetName.toLowerCase()) {
            case 'earth':
                return new PlanetAtmosphereSettings({
                    planetRadius: 6371000,
                    atmosphereHeight: 100000,
                    rayleighScatteringR: 5.5e-6,
                    rayleighScatteringG: 13.0e-6,
                    rayleighScatteringB: 22.4e-6,
                    mieScattering: 21e-6,
                    mieAnisotropy: 0.758,
                    scaleHeightRayleigh: 8000,
                    scaleHeightMie: 1200,
                    groundAlbedo: 0.3,
                    sunIntensity: 20.0
                });

            case 'mars':
                return new PlanetAtmosphereSettings({
                    planetRadius: 3389500,
                    atmosphereHeight: 125000,
                    rayleighScatteringR: 19.9e-6,
                    rayleighScatteringG: 13.6e-6,
                    rayleighScatteringB: 5.8e-6,
                    mieScattering: 4e-6,
                    mieAnisotropy: 0.76,
                    scaleHeightRayleigh: 11100,
                    scaleHeightMie: 2500,
                    groundAlbedo: 0.25,
                    sunIntensity: 18.0
                });

            case 'venus':
                return new PlanetAtmosphereSettings({
                    planetRadius: 6051800,
                    atmosphereHeight: 250000,
                    rayleighScatteringR: 4.5e-6,
                    rayleighScatteringG: 11.0e-6,
                    rayleighScatteringB: 20.0e-6,
                    mieScattering: 30e-6,
                    mieAnisotropy: 0.85,
                    scaleHeightRayleigh: 15900,
                    scaleHeightMie: 3000,
                    groundAlbedo: 0.75,
                    sunIntensity: 25.0
                });

            default:
                console.warn(`Unknown preset: ${presetName}, using Earth`);
                return PlanetAtmosphereSettings.createPreset('earth');
        }
    }
}