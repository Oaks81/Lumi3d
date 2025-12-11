// Updated EnvironmentState.js - Optimized version
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class EnvironmentState {
    constructor(gameTime, planetConfig = null) {
        this.gameTime = gameTime;
        this.planetConfig = planetConfig;
        this.windDirection = new THREE.Vector2(1, 0);
        this.windSpeed = 5.0;
        this.targetWindDirection = new THREE.Vector2(1, 0);
        this.targetWindSpeed = 5.0;

        this.currentWeather = 'clear';
        this.weatherIntensity = 0;
        this.targetWeatherIntensity = 0;
        
        this.sunLightColor = new THREE.Color(0xffffff);
        this.sunLightIntensity = 1;
        this.sunLightDirection = new THREE.Vector3(1,1,0);

        this.moonLightColor = new THREE.Color(0x4444ff);
        this.moonLightIntensity = 0.2;
        this.moonLightDirection = new THREE.Vector3(-1,1,0);

        this.ambientLightColor = new THREE.Color(0x404040);
        this.ambientLightIntensity = 0.7;

        this.thunderLightColor = new THREE.Color(0xffffff);
        this.thunderLightIntensity = 0;
        this.thunderLightPosition = new THREE.Vector3();

        this.fogColor = new THREE.Color(0xcccccc);
        this.baseFogDensity = 0.003;
        this.fogDensity = this.baseFogDensity;

        this.skyTopColor = new THREE.Color(0x0077ff);
        this.skyBottomColor = new THREE.Color(0xffffff);
        this.weatherMultiplier = 1.0;
        this.humidity = 0.5;
        
        this.nextThunderTime = Date.now();
        this._rnd = Math.random;

        // NEW: Caching and throttling
        this._cachedSkyAmbient = new THREE.Color().setHSL(0.6, 0.6, 0.85);
        this._cachedGroundAmbient = new THREE.Color().setHSL(0.11, 0.4, 0.25);
        this._lastPeriod = null;
        this._lastSeason = null;
        this._frameCount = 0;
        
        // NEW: Throttle intervals (in frames)
        this._windUpdateInterval = 30; // ~500ms at 60fps
        this._weatherUpdateInterval = 60; // ~1s at 60fps
        this._skyUpdateInterval = 15; // ~250ms at 60fps
        this._fogUpdateInterval = 10; // ~166ms at 60fps

        this.initLights();
    }

    getSkyAmbientColor() {
        return this._cachedSkyAmbient;
    }

    getGroundAmbientColor() {
        return this._cachedGroundAmbient;
    }

    initLights() {
        this.sunLight = new THREE.DirectionalLight();
        this.sunLight.castShadow = true;
        this.sunLight.shadow.camera.left = -50;
        this.sunLight.shadow.camera.right = 50;
        this.sunLight.shadow.camera.top = 50;
        this.sunLight.shadow.camera.bottom = -50;
        this.sunLight.shadow.camera.near = 0.1;
        this.sunLight.shadow.camera.far = 200;

        this.moonLight = new THREE.DirectionalLight();
        this.moonLight.castShadow = true;

        this.ambientLight = new THREE.AmbientLight();
        this.thunderLight = new THREE.PointLight(0xffffff, 0, 500);
        this.thunderLight.position.set(0,100,0);
        this.playerLight = new THREE.PointLight(0x6699ff, 0, 15);
        this.playerLight.position.set(0, 2, 0);
    }

    setPlanetConfig(planetConfig) {
        this.planetConfig = planetConfig;
    }

    update(gameState) {
        this._frameCount++;
        
        // Always update lighting (relatively cheap)
        this.updateLighting(gameState);
        
        // Throttled updates
        if (this._frameCount % this._windUpdateInterval === 0) {
            this.updateWind();
        }
        
        if (this._frameCount % this._weatherUpdateInterval === 0) {
            this.updateWeather(gameState);
        } else {
            // Still smooth weather transitions every frame
            this.smoothWeatherTransition();
        }
        
        if (this._frameCount % this._fogUpdateInterval === 0) {
            this.updateFog();
        }
        
        if (this._frameCount % this._skyUpdateInterval === 0) {
            this.updateSky();
            this.updateCloudLayer();
            this.updateAmbientColors();
        }
        
        this.updateActualLights(gameState);
    }

    // NEW: Smooth weather transitions between full updates
    smoothWeatherTransition() {
        const transitionSpeed = this.currentWeather === 'clear' ? 0.005 : 0.01;
        this.weatherIntensity += (this.targetWeatherIntensity - this.weatherIntensity) * transitionSpeed;
        
        // Thunder decay (needs to be smooth)
        if (this.currentWeather !== 'storm' || this.weatherIntensity < 0.5) {
            this.thunderLightIntensity *= 0.95;
        }
    }

    // NEW: Update ambient color cache when season/weather changes
    updateAmbientColors() {
        const currentSeason = this.gameTime.getSeason();
        const seasonChanged = this._lastSeason !== currentSeason;
        
        if (seasonChanged || this.currentWeather === 'snow') {
            this._lastSeason = currentSeason;
            
            // Sky ambient
            this._cachedSkyAmbient.setHSL(0.6, 0.6, 0.85);
            
            // Ground ambient
            if (this.currentWeather === 'snow') {
                this._cachedGroundAmbient.setHSL(0.58, 0.2, 0.8);
            } else {
                this._cachedGroundAmbient.setHSL(0.11, 0.4, 0.25);
            }
        }
    }

    updateWind() {
        if (Math.random() < 0.03) { // Increased from 0.001 since we check less often
            const angle = Math.random() * Math.PI * 2;
            this.targetWindDirection.set(Math.cos(angle), Math.sin(angle));

            if (this.currentWeather === 'storm') {
                this.targetWindSpeed = 15.0 + Math.random() * 10.0;
            } else if (this.currentWeather === 'rain') {
                this.targetWindSpeed = 8.0 + Math.random() * 5.0;
            } else if (this.currentWeather === 'clear') {
                this.targetWindSpeed = 3.0 + Math.random() * 4.0;
            } else {
                this.targetWindSpeed = 5.0 + Math.random() * 3.0;
            }
        }

        this.windDirection.lerp(this.targetWindDirection, 0.01);
        this.windDirection.normalize();
        this.windSpeed += (this.targetWindSpeed - this.windSpeed) * 0.01;
    }

    updateCloudLayer() {
        let targetMultiplier = 0.0;

        switch (this.currentWeather) {
            case 'clear': targetMultiplier = 0.1; break;
            case 'rain': targetMultiplier = 0.6 * this.weatherIntensity; break;
            case 'storm': targetMultiplier = 0.9 * this.weatherIntensity; break;
            case 'foggy': targetMultiplier = 0.5 * this.weatherIntensity; break;
            case 'snow': targetMultiplier = 0.7 * this.weatherIntensity; break;
        }

        this.weatherMultiplier += (targetMultiplier - this.weatherMultiplier) * 0.05;
    }

    updateActualLights(gameState) {
        // Update light properties (cheap operations)
        this.sunLight.color.copy(this.sunLightColor);
        this.sunLight.intensity = this.sunLightIntensity;
        this.sunLight.position.copy(this.sunLightDirection).multiplyScalar(100);

        this.moonLight.color.copy(this.moonLightColor);
        this.moonLight.intensity = this.moonLightIntensity;
        this.moonLight.position.copy(this.moonLightDirection).multiplyScalar(100);

        this.ambientLight.color.copy(this.ambientLightColor);
        this.ambientLight.intensity = this.ambientLightIntensity;

        this.thunderLight.color.copy(this.thunderLightColor);
        this.thunderLight.intensity = this.thunderLightIntensity;
        this.thunderLight.position.copy(this.thunderLightPosition);

        // Update player light position
        if (gameState && gameState.characters && gameState.characters.has('player')) {
            const player = gameState.characters.get('player');
            this.playerLight.position.set(player.position.x, player.position.y + 2, player.position.z);
        }

        // Player light intensity based on time of day
        const isNight = this.gameTime.isNight();
        const currentPeriod = this.gameTime.getCurrentPeriod();
        const isDawnDusk = currentPeriod.name === 'Dawn' || currentPeriod.name === 'Dusk';

        if (isNight) {
            this.playerLight.intensity = 0.3;
            this.playerLight.color.setHSL(0.6, 0.4, 0.8);
            this.playerLight.distance = 20;
        } else if (isDawnDusk) {
            this.playerLight.intensity = 0.25;
            this.playerLight.color.setHSL(0.08, 0.3, 0.7);
            this.playerLight.distance = 12;
        } else {
            this.playerLight.intensity = 0.2;
        }

        if (this.currentWeather === 'snow' && !isNight) {
            this.playerLight.intensity = 0.05;
            this.playerLight.color.setHSL(0.6, 0.2, 0.9);
            this.playerLight.distance = 10;
        }
    }

    updateLighting(gameState) {
        const timeOfDay = this.gameTime.timeOfDay;
        const planetOrigin = this.planetConfig?.origin || { x: 0, y: 0, z: 0 };
        const axialTilt = this.planetConfig?.axialTilt || 0;

        // Spin the sun once per 24h; phase shift puts noon overhead and midnight below the horizon
        const sunPhase = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
        const sunDir = new THREE.Vector3(Math.cos(sunPhase), Math.sin(sunPhase), 0);
        if (axialTilt !== 0) {
            sunDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), axialTilt);
        }
        sunDir.normalize();
        this.sunLightDirection.copy(sunDir);

        // Local up from planet center to camera
        const camPos = gameState?.camera?.position || new THREE.Vector3();
        const localUp = new THREE.Vector3(
            camPos.x - planetOrigin.x,
            camPos.y - planetOrigin.y,
            camPos.z - planetOrigin.z
        );
        if (localUp.lengthSq() < 1e-6) localUp.set(0, 1, 0);
        localUp.normalize();

        // Daylight factor based on sun above local horizon
        const daylightRaw = Math.max(localUp.dot(sunDir), 0);
        const daylight = Math.max(daylightRaw, 0.18); // keep a minimum so scenes aren’t pitch black
        const night = 1 - daylightRaw;

        // Base intensities and colors (slightly boosted baseline)
        let sunIntensity = daylight * 2.8;
        let moonIntensity = night * 0.3;
        let ambientIntensity = 0.18 + daylight * 0.55 + night * 0.1;

        this.sunLightColor.setHSL(
            0.12,
            0.15 + 0.35 * night,
            0.65 + 0.25 * daylight
        );
        this.ambientLightColor.setHSL(
            0.58,
            0.1 + 0.2 * daylight,
            0.35 + 0.25 * daylight
        );

        // Moon follows the opposite side of the planet
        this.moonLightDirection.copy(sunDir).multiplyScalar(-1);

        if (this.currentWeather === 'rain' || this.currentWeather === 'storm') {
            const weatherDimming = 1 - (this.weatherIntensity * 0.35);
            sunIntensity *= weatherDimming;
            moonIntensity *= weatherDimming;
            ambientIntensity *= weatherDimming;
        } else if (this.currentWeather === 'foggy') {
            const fogDimming = 1 - (this.weatherIntensity * 0.15);
            sunIntensity *= fogDimming;
            moonIntensity *= fogDimming;
            ambientIntensity *= fogDimming;
        } else if (this.currentWeather === 'snow') {
            const snowDimming = 1 - (this.weatherIntensity * 0.25);
            sunIntensity *= snowDimming;
            moonIntensity *= snowDimming;
            ambientIntensity *= 1 + (this.weatherIntensity * 0.15);
        }

        // Humidity and cloud cover reduce direct light slightly and raise ambient haze
        const humidityDimming = 1 - Math.min(0.4, this.humidity * 0.4 + this.weatherMultiplier * 0.2);
        sunIntensity *= humidityDimming;
        ambientIntensity *= 1 + this.humidity * 0.15;
        
        this.sunLightIntensity = sunIntensity;
        this.moonLightIntensity = moonIntensity;
        this.ambientLightIntensity = ambientIntensity;

        // Only update colors when period changes
        const period = this.gameTime.getCurrentPeriod();
        if (this._lastPeriod !== period.name || this.currentWeather === 'snow') {
            this._lastPeriod = period.name;
            
            if (period.name === 'Dawn' || period.name === 'Dusk') {
                this.sunLightColor.setHSL(0.08, 0.8, 0.8);
            } else if (period.name === 'Noon') {
                this.sunLightColor.setHSL(0.15, 0.1, 1);
            } else {
                this.sunLightColor.setHSL(0.15, 0.3, 0.9);
            }
            
            if (this.currentWeather === 'snow') {
                this.sunLightColor.setHSL(0.6, 0.2, 0.9);
            }

            if (this.gameTime.isNight()) {
                this.ambientLightColor.setHSL(0.6, 0.3, 0.3);
            } else if (period.name === 'Dawn' || period.name === 'Dusk') {
                this.ambientLightColor.setHSL(0.08, 0.4, 0.5);
            } else {
                this.ambientLightColor.setHSL(0.15, 0.2, 0.6);
            }

            if (this.currentWeather === 'snow') {
                this.ambientLightColor.setHSL(0.6, 0.15, 0.75);
            }
        }
    }

    updateWeather(gameState) {
        if (this._rnd() < 0.006) { // Adjusted for less frequent checks
            const season = this.gameTime.getSeason();
            const weathers = ['clear', 'rain', 'storm', 'foggy'];
            if (season === 'Winter') weathers.push('snow');
    
            let newWeather;
    
            if (this.currentWeather === 'clear') {
                if (season === 'Winter') {
                    const roll = this._rnd();
                    newWeather = roll < 0.4 ? 'snow' : (roll < 0.7 ? 'clear' : (roll < 0.85 ? 'rain' : 'foggy'));
                    // Winter: 40% snow, 30% stays clear, 15% rain, 15% foggy
                } else {
                    const roll = this._rnd();
                    newWeather = roll < 0.5 ? 'clear' : (roll < 0.75 ? 'rain' : 'foggy');
                    // Non-winter: 50% stays clear, 25% rain, 25% foggy
                }
            } else if (this.currentWeather === 'rain') {
                newWeather = this._rnd() < 0.3 ? 'storm' : 'clear';
            } else if (this.currentWeather === 'storm') {
                newWeather = this._rnd() < 0.6 ? 'rain' : 'clear';
            } else if (this.currentWeather === 'foggy') {
                // Foggy clears faster
                if (season === 'Winter') {
                    newWeather = this._rnd() < 0.5 ? 'snow' : 'clear';
                } else {
                    newWeather = 'clear'; // Always clears to clear (not to another weather)
                }
            } else if (this.currentWeather === 'snow') {
                newWeather = 'clear';
            }
    
            this.currentWeather = newWeather || 'clear';
        }
    
        // Set target intensity
        if (this.currentWeather === 'clear') {
            this.targetWeatherIntensity = 0;
        } else if (this.currentWeather === 'rain') {
            this.targetWeatherIntensity = 0.6 + this._rnd() * 0.2;
        } else if (this.currentWeather === 'storm') {
            this.targetWeatherIntensity = 0.8 + this._rnd() * 0.2;
        } else if (this.currentWeather === 'foggy') {
            // REDUCED: Was 0.5-0.8, now 0.3-0.6
            this.targetWeatherIntensity = 0.3 + this._rnd() * 0.3;
        } else if (this.currentWeather === 'snow') {
            this.targetWeatherIntensity = 0.4 + this._rnd() * 0.4;
        }

        // Thunder
        if (this.currentWeather === 'storm' && this.weatherIntensity > 0.5 && this.gameTime.getSeason() !== 'Winter') {
            const now = Date.now();
            if (now > this.nextThunderTime) {
                this.thunderLightIntensity = 2 + this._rnd() * 3 * this.weatherIntensity;
                this.thunderLightPosition.set(
                    (this._rnd() - 0.5) * 200,
                    50 + this._rnd() * 50,
                    (this._rnd() - 0.5) * 200
                );
                this.nextThunderTime = now + 5000 * (2 - this.weatherIntensity) + this._rnd() * 5000 * (2 - this.weatherIntensity);
            }
        }
    }

    updateFog() {
        let fogDensity = this.baseFogDensity;
        const period = this.gameTime.getCurrentPeriod();
    
        if (period.name === 'Dawn' || period.name === 'Dusk') {
            fogDensity *= 1.8;
        } else if (period.name === 'Night') {
            fogDensity *= 1.4;
        } else if (period.name === 'Early Morning') {
            fogDensity *= 1.5;
        }
    
        if (this.currentWeather === 'foggy') {
            // REDUCED: Was 2 + (intensity * 2), now 1.5 + (intensity * 1.5)
            fogDensity *= 1.5 + (this.weatherIntensity * 1.5);
        } else if (this.currentWeather === 'rain' || this.currentWeather === 'storm') {
            fogDensity *= 1 + (this.weatherIntensity * 1.2);
        }
    
        const season = this.gameTime.getSeason();
        if (season === 'Autumn') {
            // REDUCED: Was 1.2, now 1.1
            fogDensity *= 1.1;
        } else if (season === 'Winter') {
            fogDensity *= 1.1;
        } else if (season === 'Spring') {
            fogDensity *= 1.05;
        }
    
        this.fogDensity = Math.max(0.001, Math.min(0.025, fogDensity));
    

        // Fog color
        if (this.gameTime.isNight()) {
            this.fogColor.setHSL(0.6, 0.2, 0.08);
        } else if (period.name === 'Dawn') {
            this.fogColor.setHSL(0.08, 0.4, 0.4);
        } else if (period.name === 'Dusk') {
            this.fogColor.setHSL(0.02, 0.3, 0.35);
        } else if (this.currentWeather === 'storm') {
            this.fogColor.setHSL(0.6, 0.1, 0.2);
        } else if (this.currentWeather === 'rain') {
            this.fogColor.setHSL(0.6, 0.15, 0.4);
        } else {
            this.fogColor.setHSL(0.6, 0.1, 0.7);
        }
    }

    updateSky() {
        const period = this.gameTime.getCurrentPeriod();

        if (period.name === 'Night') {
            this.skyTopColor.setHSL(0.65, 0.7, 0.05);
            this.skyBottomColor.setHSL(0.6, 0.4, 0.15);
        } else if (period.name === 'Dawn') {
            this.skyTopColor.setHSL(0.6, 0.5, 0.25);
            this.skyBottomColor.setHSL(0.08, 0.7, 0.55);
        } else if (period.name === 'Morning') {
            this.skyTopColor.setHSL(0.55, 0.7, 0.45);
            this.skyBottomColor.setHSL(0.1, 0.3, 0.75);
        } else if (period.name === 'Noon') {
            this.skyTopColor.setHSL(0.55, 0.8, 0.55);
            this.skyBottomColor.setHSL(0.1, 0.2, 0.9);
        } else if (period.name === 'Afternoon') {
            this.skyTopColor.setHSL(0.55, 0.7, 0.5);
            this.skyBottomColor.setHSL(0.1, 0.25, 0.85);
        } else if (period.name === 'Evening') {
            this.skyTopColor.setHSL(0.65, 0.7, 0.05);
            this.skyBottomColor.setHSL(0.8, 0.4, 0.12);
        } else if (period.name === 'Dusk') {
            this.skyTopColor.setHSL(0.65, 0.7, 0.05);
            this.skyBottomColor.setHSL(0.8, 0.6, 0.2);
        }

        // Weather effects on sky
        if (this.currentWeather === 'storm') {
            const stormDarkening = 0.2 + (0.3 * (1 - this.weatherIntensity));
            this.skyTopColor.multiplyScalar(stormDarkening);
            this.skyBottomColor.multiplyScalar(stormDarkening * 1.2);
        } else if (this.currentWeather === 'rain') {
            const rainDarkening = 0.4 + (0.4 * (1 - this.weatherIntensity));
            this.skyTopColor.multiplyScalar(rainDarkening);
            this.skyBottomColor.multiplyScalar(rainDarkening);
        } else if (this.currentWeather === 'foggy') {
            const fogColor = new THREE.Color(0x999999);
            const fogBlend = this.weatherIntensity * 0.4;
            this.skyTopColor.lerp(fogColor, fogBlend);
            this.skyBottomColor.lerp(fogColor.clone().multiplyScalar(1.2), fogBlend);
        }
    }

    // Keep other methods unchanged...
    resize(width, height) {
        if (this.sunLight.shadow) {
            this.sunLight.shadow.mapSize.width = Math.min(2048, width);
            this.sunLight.shadow.mapSize.height = Math.min(2048, height);
        }
        if (this.moonLight.shadow) {
            this.moonLight.shadow.mapSize.width = Math.min(1024, width);
            this.moonLight.shadow.mapSize.height = Math.min(1024, height);
        }
    }

    setWeather(weather, intensity = null) {
        if (['clear', 'rain', 'storm', 'foggy', 'snow'].includes(weather)) {
            this.currentWeather = weather;
            if (intensity !== null) {
                this.weatherIntensity = Math.max(0, Math.min(1, intensity));
                this.targetWeatherIntensity = this.weatherIntensity;
            }
        }
    }

    getWeatherInfo() {
        return {
            weather: this.currentWeather,
            intensity: this.weatherIntensity,
            targetIntensity: this.targetWeatherIntensity
        };
    }

    shouldFlashThunder() {
        return this.thunderLightIntensity > 1.0;
    }

    isSunVisible() {
        return this.sunLightIntensity > 0.01;
    }

    isMoonVisible() {
        return this.moonLightIntensity > 0.01;
    }

    cleanup() {
        if (this.sunLight && this.sunLight.dispose) this.sunLight.dispose();
        if (this.moonLight && this.moonLight.dispose) this.moonLight.dispose();
        if (this.thunderLight && this.thunderLight.dispose) this.thunderLight.dispose();
        if (this.playerLight && this.playerLight.dispose) this.playerLight.dispose();
    }
}
