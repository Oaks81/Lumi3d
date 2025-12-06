import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class UniformManager {
    constructor() {
        this.uniforms = {
            aerialPerspectiveEnabled: { value: 1.0 },
            planetCenter: { value: new THREE.Vector3(0, 0, 0) },
            cameraPosition: { value: new THREE.Vector3() },
            cameraNear: { value: 0.1 },
            cameraFar: { value: 1000.0 },
            clusterDimensions: { value: new THREE.Vector3(16, 8, 24) },
            clusterDataTexture: { value: null },
            lightDataTexture: { value: null },
            lightIndicesTexture: { value: null },
            numLights: { value: 0 },
            maxLightsPerCluster: { value: 32 },
            sunLightColor: { value: new THREE.Color(0xffffff) },
            sunLightIntensity: { value: 1.0 },
            sunLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
            moonLightColor: { value: new THREE.Color(0x4444ff) },
            moonLightIntensity: { value: 0.2 },
            moonLightDirection: { value: new THREE.Vector3(-0.5, 1.0, -0.3).normalize() },
            ambientLightColor: { value: new THREE.Color(0x404040) },
            ambientLightIntensity: { value: 0.7 },
            skyAmbientColor: { value: new THREE.Color(0x87baff) },
            groundAmbientColor: { value: new THREE.Color(0x554630) },
            thunderLightIntensity: { value: 0.0 },
            thunderLightColor: { value: new THREE.Color(0xffffff) },
            thunderLightPosition: { value: new THREE.Vector3() },
            playerLightColor: { value: new THREE.Color(0x6699ff) },
            playerLightIntensity: { value: 0.0 },
            playerLightPosition: { value: new THREE.Vector3() },
            playerLightDistance: { value: 15.0 },
            fogColor: { value: new THREE.Color(0xcccccc) },
            fogDensity: { value: 0.00005 },
            fogScaleHeight: { value: 1200 },
            weatherIntensity: { value: 0.0 },
            currentWeather: { value: 0 },
            shadowMapCascade0: { value: null },
            shadowMapCascade1: { value: null },
            shadowMapCascade2: { value: null },
            shadowMatrixCascade0: { value: new THREE.Matrix4() },
            shadowMatrixCascade1: { value: new THREE.Matrix4() },
            shadowMatrixCascade2: { value: new THREE.Matrix4() },
            cascadeSplits: { value: new THREE.Vector3(30, 90, 200) },
            numCascades: { value: 3 },
            shadowBias: { value: 0.001 },
            shadowNormalBias: { value: 0.1 },
            shadowMapSize: { value: 2048.0 },
            receiveShadow: { value: 1.0 },

            atmospherePlanetRadius: { value: 50000 },
            atmosphereRadius: { value: 55000 },
            atmosphereScaleHeightRayleigh: { value: 800 },
            atmosphereScaleHeightMie: { value: 120 },
            atmosphereRayleighScattering: { value: new THREE.Vector3(5.5e-5, 13.0e-5, 22.4e-5) },
            atmosphereMieScattering: { value: 21e-5 },
            atmosphereOzoneAbsorption: { value: new THREE.Vector3(0.65e-6, 1.881e-6, 0.085e-6) },
            atmosphereMieAnisotropy: { value: 0.8 },
            atmosphereGroundAlbedo: { value: 0.3 },
            atmosphereSunIntensity: { value: 20.0 },
            viewerAltitude: { value: 0.0 },

            transmittanceLUT: { value: null },
            multiScatterLUT: { value: null },
            skyViewLUT: { value: null }
        };

        this.materials = new Set();
        this.currentEnvironmentState = null;
        this.currentPlanetConfig = null;
        this._dirtyUniforms = new Set();
        this._needsUpdate = false;

        this.fogParams = {
            baseDensity: 0.00005,
            density: 0.00005,
            scaleHeight: 1200,
            color: { r: 0.7, g: 0.8, b: 1.0 }
        };

        console.log('UniformManager initialized with', Object.keys(this.uniforms).length, 'uniforms');
    }

    registerMaterial(material) {
        this.materials.add(material);

        if (material.uniforms) {
            for (const [key, uniform] of Object.entries(this.uniforms)) {
                if (!material.uniforms[key]) {
                    material.uniforms[key] = uniform;
                }
            }
        }
    }

    unregisterMaterial(material) {
        this.materials.delete(material);
    }

    _markUniformDirty(uniformName) {
        this._dirtyUniforms.add(uniformName);
        this._needsUpdate = true;
    }

    updateCameraParameters(camera) {
        if (camera.position) {
            if (camera.position.isVector3) {
                this.uniforms.cameraPosition.value.copy(camera.position);
            } else {
                this.uniforms.cameraPosition.value.set(
                    camera.position.x || 0,
                    camera.position.y || 0,
                    camera.position.z || 0
                );
            }
        }

        if (camera.near !== undefined) {
            this.uniforms.cameraNear.value = camera.near;
        }
        if (camera.far !== undefined) {
            this.uniforms.cameraFar.value = camera.far;
        }

        if (this.currentPlanetConfig) {
            const altitude = this._calculateAltitude(this.uniforms.cameraPosition.value);
            this.uniforms.viewerAltitude.value = altitude;
        }
    }

    _calculateAltitude(cameraPos) {
        if (!this.currentPlanetConfig) return 0;

        const origin = this.currentPlanetConfig.origin;
        const dx = cameraPos.x - origin.x;
        const dy = cameraPos.y - origin.y;
        const dz = cameraPos.z - origin.z;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);

        return Math.max(0, distanceFromCenter - this.currentPlanetConfig.radius);
    }

    updateFogParams(altitude, atmosphereSettings) {
        const scaleHeight = atmosphereSettings?.scaleHeightMie || this.fogParams.scaleHeight;
        this.fogParams.scaleHeight = scaleHeight;
        this.fogParams.density = this.fogParams.baseDensity * Math.exp(-altitude / scaleHeight);

        this.uniforms.fogDensity.value = this.fogParams.density;
        this.uniforms.fogScaleHeight.value = this.fogParams.scaleHeight;
        this.uniforms.fogColor.value.setRGB(
            this.fogParams.color.r,
            this.fogParams.color.g,
            this.fogParams.color.b
        );
    }

    updateFromPlanetConfig(planetConfig) {
        if (!planetConfig) return;

        this.currentPlanetConfig = planetConfig;

        const atmo = planetConfig.atmosphereSettings;
        if (!atmo) {
            this.uniforms.atmospherePlanetRadius.value = planetConfig.radius;
            this.uniforms.atmosphereRadius.value = planetConfig.radius + planetConfig.atmosphereHeight;
            return;
        }
        this.uniforms.planetCenter.value.copy(planetConfig.origin);
        this.uniforms.aerialPerspectiveEnabled.value = planetConfig.hasAtmosphere ? 1.0 : 0.0;
        
        this.uniforms.atmospherePlanetRadius.value = atmo.planetRadius;
        this.uniforms.atmosphereRadius.value = atmo.atmosphereRadius;
        this.uniforms.atmosphereScaleHeightRayleigh.value = atmo.scaleHeightRayleigh;
        this.uniforms.atmosphereScaleHeightMie.value = atmo.scaleHeightMie;
        this.uniforms.atmosphereRayleighScattering.value.copy(atmo.rayleighScattering);
        this.uniforms.atmosphereMieScattering.value = atmo.mieScattering;
        this.uniforms.atmosphereOzoneAbsorption.value.copy(atmo.ozoneAbsorption);
        this.uniforms.atmosphereMieAnisotropy.value = atmo.mieAnisotropy;
        this.uniforms.atmosphereGroundAlbedo.value = atmo.groundAlbedo;
        this.uniforms.atmosphereSunIntensity.value = atmo.sunIntensity;

        this._markUniformDirty('atmosphere');

        console.log('[UniformManager] Atmosphere uniforms updated from PlanetConfig:', {
            planetRadius: atmo.planetRadius,
            atmosphereRadius: atmo.atmosphereRadius,
            rayleighScattering: atmo.rayleighScattering.toArray(),
            mieScattering: atmo.mieScattering
        });
    }

    setAtmosphereLUTs(transmittance, multiScatter, skyView) {
        if (transmittance) {
            this.uniforms.transmittanceLUT.value = transmittance;
            this._markUniformDirty('transmittanceLUT');
        }
        if (multiScatter) {
            this.uniforms.multiScatterLUT.value = multiScatter;
            this._markUniformDirty('multiScatterLUT');
        }
        if (skyView) {
            this.uniforms.skyViewLUT.value = skyView;
            this._markUniformDirty('skyViewLUT');
        }
    }

    getAtmosphereUniformBuffer() {
        const data = new Float32Array(16);

        data[0] = this.uniforms.atmospherePlanetRadius.value;
        data[1] = this.uniforms.atmosphereRadius.value;
        data[2] = this.uniforms.atmosphereScaleHeightRayleigh.value;
        data[3] = this.uniforms.atmosphereScaleHeightMie.value;

        const rayleigh = this.uniforms.atmosphereRayleighScattering.value;
        data[4] = rayleigh.x;
        data[5] = rayleigh.y;
        data[6] = rayleigh.z;
        data[7] = this.uniforms.atmosphereMieScattering.value;

        const ozone = this.uniforms.atmosphereOzoneAbsorption.value;
        data[8] = ozone.x;
        data[9] = ozone.y;
        data[10] = ozone.z;
        data[11] = this.uniforms.atmosphereMieAnisotropy.value;

        data[12] = this.uniforms.atmosphereGroundAlbedo.value;
        data[13] = this.uniforms.atmosphereSunIntensity.value;
        data[14] = this.uniforms.viewerAltitude.value;
        data[15] = 0.0;

        return data;
    }

    updateFromEnvironmentState(environmentState) {
        if (!environmentState) return;

        const u = this.uniforms;

        if (environmentState.sunLightColor) {
            u.sunLightColor.value.copy(environmentState.sunLightColor);
        }

        if (environmentState.sunLightIntensity !== undefined) {
            u.sunLightIntensity.value = environmentState.sunLightIntensity;
        }

        if (environmentState.sunLightDirection) {
            u.sunLightDirection.value.copy(environmentState.sunLightDirection);
        }

        if (environmentState.moonLightColor) {
            u.moonLightColor.value.copy(environmentState.moonLightColor);
        }

        if (environmentState.moonLightIntensity !== undefined) {
            u.moonLightIntensity.value = environmentState.moonLightIntensity;
        }

        if (environmentState.moonLightDirection) {
            u.moonLightDirection.value.copy(environmentState.moonLightDirection);
        }

        if (environmentState.ambientLightColor) {
            u.ambientLightColor.value.copy(environmentState.ambientLightColor);
        }

        if (environmentState.ambientLightIntensity !== undefined) {
            u.ambientLightIntensity.value = environmentState.ambientLightIntensity;
        }

        if (environmentState.getSkyAmbientColor) {
            u.skyAmbientColor.value.copy(environmentState.getSkyAmbientColor());
        }
        if (environmentState.getGroundAmbientColor) {
            u.groundAmbientColor.value.copy(environmentState.getGroundAmbientColor());
        }

        if (environmentState.thunderLightIntensity !== undefined) {
            u.thunderLightIntensity.value = environmentState.thunderLightIntensity;
        }
        if (environmentState.thunderLightColor) {
            u.thunderLightColor.value.copy(environmentState.thunderLightColor);
        }
        if (environmentState.thunderLightPosition) {
            u.thunderLightPosition.value.copy(environmentState.thunderLightPosition);
        }

        if (environmentState.playerLight) {
            u.playerLightColor.value.copy(environmentState.playerLight.color);
            u.playerLightIntensity.value = environmentState.playerLight.intensity;
            u.playerLightPosition.value.copy(environmentState.playerLight.position);
            u.playerLightDistance.value = environmentState.playerLight.distance;
        }

        if (environmentState.fogColor) {
            u.fogColor.value.copy(environmentState.fogColor);
        }
        if (environmentState.fogDensity !== undefined) {
            u.fogDensity.value = environmentState.fogDensity;
        }

        if (environmentState.weatherIntensity !== undefined) {
            u.weatherIntensity.value = environmentState.weatherIntensity;
        }
        if (environmentState.currentWeather !== undefined) {
            u.currentWeather.value = this._encodeWeather(environmentState.currentWeather);
        }
    }

    updateFromShadowRenderer(shadowData) {
        if (!shadowData) return;

        if (shadowData.cascades) {
            this.uniforms.numCascades.value = shadowData.numCascades;

            for (let i = 0; i < Math.min(3, shadowData.cascades.length); i++) {
                const cascade = shadowData.cascades[i];
                this.uniforms[`shadowMapCascade${i}`].value = cascade.renderTarget.texture;
                this.uniforms[`shadowMatrixCascade${i}`].value.copy(cascade.shadowMatrix);
            }

            if (shadowData.cascades.length >= 3) {
                this.uniforms.cascadeSplits.value.set(
                    shadowData.cascades[0].split.far,
                    shadowData.cascades[1].split.far,
                    shadowData.cascades[2].split.far
                );
            }
        }
    }

    updateFromClusteredLights(clusterGrid, clusteredLightManager, textures) {
        this.uniforms.clusterDimensions.value.copy(clusterGrid.clusterDimensions);
        this.uniforms.clusterDataTexture.value = textures.clusterData;
        this.uniforms.lightDataTexture.value = textures.lightData;
        this.uniforms.lightIndicesTexture.value = textures.lightIndices;
        this.uniforms.numLights.value = clusteredLightManager.lights.length;
    }

    updateFromLightManager(lightManager) {
    }

    getLightingUniforms() {
        return this.uniforms;
    }

    setShadowsEnabled(enabled) {
        this.uniforms.receiveShadow.value = enabled ? 1.0 : 0.0;
        this._markUniformDirty('receiveShadow');
        this._markMaterialsForUpdate();
    }

    _markMaterialsForUpdate() {
        if (!this._needsUpdate) return;

        for (const material of this.materials) {
            if (material.uniforms) {
                material.uniformsNeedUpdate = true;
            }
        }

        this._dirtyUniforms.clear();
        this._needsUpdate = false;
    }

    _encodeWeather(weatherString) {
        const weatherMap = {
            'clear': 0,
            'rain': 1,
            'storm': 2,
            'foggy': 3,
            'snow': 4
        };
        return weatherMap[weatherString] || 0;
    }
}