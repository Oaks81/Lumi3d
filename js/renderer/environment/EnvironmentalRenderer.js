import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { BaseRenderer } from '../BaseRenderer.js';
import { SkyJsSky } from '../../environment/SkyJsSky.js';
import { CloudLayer } from '../../environment/CloudLayer.js';
import { Light, LightType } from '../../lighting/lightManager.js'
export class EnvironmentalRenderer extends BaseRenderer {
    constructor(scene, lightManager) {  // NEW: accept lightManager
        super();
        this.scene = scene;
        this.lightManager = lightManager;  // NEW
        
        // Cloud layers (unchanged)
        this.cloudLayers = [];
        this.cloudLayerTypes = ['cirrus', 'altocumulus', 'cumulus', 'nimbostratus'];
        for (let i = 0; i < this.cloudLayerTypes.length; i++) {
            const layer = new CloudLayer(this.cloudLayerTypes[i], 1.0);
            scene.add(layer);
            this.cloudLayers.push(layer);
        }
        
        // Sky (unchanged)
        this.sky = new SkyJsSky(scene);

        // === NEW: Register lights with LightManager ===
        
        // Sun Light
        this.sunLightData = new Light(LightType.DIRECTIONAL, {
            name: 'Sun',
            color: new THREE.Color(0xffffff),
            intensity: 1.0,
            direction: new THREE.Vector3(0.5, 1.0, 0.3).normalize(),
            castShadow: true
        });
        this.sunLightId = this.lightManager.addLight(this.sunLightData).id;
        
        // Keep THREE.DirectionalLight for now (for shadows/visualdebug)
        this.sunLight = new THREE.DirectionalLight();
        this.sunLight.castShadow = true;
        this.sunLight.shadow.camera.left = -50;
        this.sunLight.shadow.camera.right = 50;
        this.sunLight.shadow.camera.top = 50;
        this.sunLight.shadow.camera.bottom = -50;
        this.sunLight.shadow.camera.near = 0.1;
        this.sunLight.shadow.camera.far = 200;
        scene.add(this.sunLight);

        // Moon Light
        this.moonLightData = new Light(LightType.DIRECTIONAL, {
            name: 'Moon',
            color: new THREE.Color(0x4444ff),
            intensity: 0.2,
            direction: new THREE.Vector3(-0.5, 1.0, -0.3).normalize(),
            castShadow: true
        });
        this.moonLightId = this.lightManager.addLight(this.moonLightData).id;
        
        this.moonLight = new THREE.DirectionalLight();
        this.moonLight.castShadow = true;
        scene.add(this.moonLight);

        // Ambient Light (handled by shader, not added to LightManager)
        this.ambientLight = new THREE.AmbientLight();
        scene.add(this.ambientLight);

        // Thunder Light
        this.thunderLightData = new Light(LightType.POINT, {
            name: 'Thunder',
            color: new THREE.Color(0xffffff),
            intensity: 0,
            position: new THREE.Vector3(0, 100, 0),
            radius: 500
        });
        this.thunderLightId = this.lightManager.addLight(this.thunderLightData).id;
        
        this.thunderLight = new THREE.PointLight(0xffffff, 0, 500);
        this.thunderLight.position.set(0, 100, 0);
        scene.add(this.thunderLight);
        
        // Fog (unchanged)
        this.fog = new THREE.FogExp2(0xcccccc, 0.005);
        scene.fog = this.fog;
        
        // Initialize visuals (unchanged)
        this.initPrecipitation();
        this.initSunMoon();
        this.initStars();
        
        this.currentFogColor = new THREE.Color(0xcccccc);
        this.fogTransitionSpeed = 0.01;
        this.camera = null;
    }

    initSunMoon() {
        // Sun visual
        const sunGeo = new THREE.SphereGeometry(3, 32, 32);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xFFFFC0, emissive: 0xFFF666 });
        this.sunSphere = new THREE.Mesh(sunGeo, sunMat);
        this.sunSphere.name = 'SunViz';
        this.scene.add(this.sunSphere);

        // Moon visual
        const moonGeo = new THREE.SphereGeometry(1.5, 32, 32);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xCCCCFF, emissive: 0x6666DD });
        this.moonSphere = new THREE.Mesh(moonGeo, moonMat);
        this.moonSphere.name = 'MoonViz';
        this.scene.add(this.moonSphere);
    }

    initStars() {
        const STAR_COUNT = 5000;
        const positions = new Float32Array(STAR_COUNT * 3);
        for (let i = 0; i < STAR_COUNT; i++) {
            const theta = Math.random() * Math.PI / 2;
            const phi = Math.random() * 2 * Math.PI;
            const r = 490 + Math.random() * 10;
            positions[i * 3 + 0] = r * Math.sin(theta) * Math.cos(phi);
            positions[i * 3 + 1] = r * Math.cos(theta);
            positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMat = new THREE.PointsMaterial({ 
            color: 0xFFFFFF, 
            size: 3, 
            sizeAttenuation: false, 
            depthWrite: false,
            transparent: true,
            opacity: 0.8
        });
        this.starsPoints = new THREE.Points(starGeo, starMat);
        this.scene.add(this.starsPoints);
    }

    initPrecipitation() {
        const count = 8000;
        this.rainGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count);
        const drift = new Float32Array(count);
    
        for (let i = 0; i < count; i++) {
            positions[i * 3] = Math.random() * 200 - 100;
            positions[i * 3 + 1] = Math.random() * 100 + 50;
            positions[i * 3 + 2] = Math.random() * 200 - 100;
    
            velocities[i] = 0.5 + Math.random();
            drift[i] = (Math.random() - 0.5) * 0.2;
        }
    
        this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.rainGeometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));
        this.rainGeometry.setAttribute('drift', new THREE.BufferAttribute(drift, 1));
    
        this.rainMaterial = new THREE.PointsMaterial({
            color: 0xaaaaaa,
            size: 0.05,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });

        this.rainUniforms = {
            time: { value: 0 }
        };
        this.rainMaterial.onBeforeCompile = shader => {
            shader.uniforms.time = this.rainUniforms.time;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                uniform float time;`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `vec3 transformed = vec3(position.x, position.y + sin(position.x + time) * 0.1, position.z);`
            );
        };
        this.rainParticles = new THREE.Points(this.rainGeometry, this.rainMaterial);
        this.scene.add(this.rainParticles);
    }

    updateFogColorSmooth(environmentState) {
        const targetFogColor = environmentState.fogColor;
        this.currentFogColor.lerp(targetFogColor, this.fogTransitionSpeed);
        this.fog.color.copy(this.currentFogColor);
    }

    render(gameState, camera, environmentState) {
        this.camera = camera;

        // === NEW: Update LightManager with current values ===
        
        // Update sun light data
        this.sunLightData.color.copy(environmentState.sunLightColor);
        this.sunLightData.intensity = environmentState.sunLightIntensity;
        this.sunLightData.direction.copy(environmentState.sunLightDirection);
      
        
        // Update moon light data
        this.moonLightData.color.copy(environmentState.moonLightColor);
        this.moonLightData.intensity = environmentState.moonLightIntensity;
        this.moonLightData.direction.copy(environmentState.moonLightDirection);

        
        // Update thunder light data
        this.thunderLightData.color.copy(environmentState.thunderLightColor);
        this.thunderLightData.intensity = environmentState.thunderLightIntensity;
        this.thunderLightData.position.copy(environmentState.thunderLightPosition);
 
        // Also update THREE.js lights (for shadows/visuals until we replace them)
        this.sunLight.color.copy(environmentState.sunLightColor);
        this.sunLight.intensity = environmentState.sunLightIntensity;
        this.sunLight.position.copy(environmentState.sunLightDirection).multiplyScalar(100);

        this.moonLight.color.copy(environmentState.moonLightColor);
        this.moonLight.intensity = environmentState.moonLightIntensity;
        this.moonLight.position.copy(environmentState.moonLightDirection).multiplyScalar(100);

        this.ambientLight.color.copy(environmentState.ambientLightColor);
        this.ambientLight.intensity = environmentState.ambientLightIntensity;

        this.thunderLight.color.copy(environmentState.thunderLightColor);
        this.thunderLight.intensity = environmentState.thunderLightIntensity;
        this.thunderLight.position.copy(environmentState.thunderLightPosition);

        // Rest of your existing render code (fog, sky, precipitation, etc.)
        // ... unchanged ...
        
        this.fog.density = Math.min(environmentState.fogDensity, 0.015);
        this.updateFogColorSmooth(environmentState);
        this.sky.updateFromEnvironment(environmentState);

        const weather = environmentState.currentWeather;
        const weatherIntensity = environmentState.weatherIntensity;

        if (weather === 'snow' || weather === 'rain' || weather === 'storm') {
            this.updateRain(weatherIntensity, environmentState);
            this.rainParticles.visible = true;
            if (weather === 'snow') {
                this.rainMaterial.color.set(0xFFFFFF);
                this.rainMaterial.size = 0.15;
                this.rainMaterial.opacity = 0.9;
            } else {
                this.rainMaterial.color.set(0xaaaaaa);
                this.rainMaterial.size = 0.05;
                this.rainMaterial.opacity = Math.min(0.8, 0.4 + 0.4 * weatherIntensity);
            }
        } else {
            this.rainParticles.visible = false;
        }

        // Sun/Moon visualization
        this.sunSphere.position.copy(environmentState.sunLightDirection).multiplyScalar(400);
        this.sunSphere.visible = environmentState.isSunVisible();
        this.sunSphere.material.color.set(environmentState.sunLightColor).lerp(new THREE.Color(0xFFFFCC), 0.3);

        this.moonSphere.position.copy(environmentState.moonLightDirection).multiplyScalar(400);
        this.moonSphere.visible = environmentState.isMoonVisible();
        this.moonSphere.material.color.set(environmentState.moonLightColor).lerp(new THREE.Color(0xEEEEFF), 0.5);
        
        // Clouds
        let sunDir = environmentState.sunLightDirection || new THREE.Vector3(1,1,0);
        for (let i = 0; i < this.cloudLayers.length; i++) {
            this.cloudLayers[i].setSunDir(sunDir);
        }

        let now = performance.now() * 0.0002;
        for (let i = 0; i < this.cloudLayers.length; i++) this.cloudLayers[i].update(now);
        
        let covers = [0,0,0,0];
        if (weather == 'clear') covers = [0.08+0.05*weatherIntensity, 0.02, 0.07, 0];
        else if (weather == 'rain') covers = [0.10, 0.2+0.2*weatherIntensity, 0.12, Math.max(0.18, 0.6*weatherIntensity)];
        else if (weather == 'storm') covers = [0.08, 0.19, 0.18+0.15*weatherIntensity, 0.85*weatherIntensity];
        else if (weather == 'foggy') covers = [0, 0.20*weatherIntensity, 0.20*weatherIntensity, 0.10*weatherIntensity];
        else if (weather == 'snow') covers = [0.15, 0.20, 0.21, 0.10+0.5*weatherIntensity];
        
        for (let i = 0; i < this.cloudLayers.length; i++) {
            const v = covers[i];
            this.cloudLayers[i].setWeatherMultiplier(v);
            this.cloudLayers[i].visible = v > 0.01;
            this.cloudLayers[i].position.set(camera.position.x, 0, camera.position.z);
        }
        
        // Stars
        const isNight = environmentState.gameTime.isNight();
        const period = environmentState.gameTime.getCurrentPeriod();
        const isDawnDusk = period.name === 'Dawn' || period.name === 'Dusk';
        if (isNight) {
            this.starsPoints.visible = true;
            this.starsPoints.material.opacity = 0.9;
        } else if (isDawnDusk) {
            this.starsPoints.visible = true;
            this.starsPoints.material.opacity = 0.3;
        } else {
            this.starsPoints.visible = false;
        }
        if (environmentState.isMoonVisible() && this.starsPoints.visible) {
            this.starsPoints.material.opacity = Math.min(1.0, this.starsPoints.material.opacity + environmentState.moonLightIntensity);
        }
        this.starsPoints.material.transparent = true;
    }



    updateRain(weatherIntensity, environmentState) {
        const weather = environmentState.currentWeather;
        const isSnow = weather === 'snow';
        const positions = this.rainGeometry.attributes.position.array;
        const velocities = this.rainGeometry.attributes.velocity.array;
        const drift = this.rainGeometry.attributes.drift.array;
        const cameraPos = this.camera ? this.camera.position : new THREE.Vector3();
        this.rainUniforms.time.value = performance.now() * 0.001;
        for (let i = 0; i < positions.length / 3; i++) {
            const index = i * 3;
            const speedMultiplier = isSnow ? 0.4 : (1.5 + weatherIntensity * 2);
            positions[index + 1] -= velocities[i] * speedMultiplier;
            const wind = environmentState.wind || new THREE.Vector3(0.3, 0, 0);
            const windFactor = isSnow ? 2.5 : 0.5;
            positions[index] += drift[i] * wind.x * windFactor;
            positions[index + 2] += drift[i] * wind.z * windFactor;
            if (positions[index + 1] < 0) {
                positions[index] = cameraPos.x + (Math.random() - 0.5) * 200;
                positions[index + 1] = 100 + Math.random() * 50;
                positions[index + 2] = cameraPos.z + (Math.random() - 0.5) * 200;
            }
            // Keep around camera
            const dx = positions[index] - cameraPos.x;
            const dz = positions[index + 2] - cameraPos.z;
            if (dx * dx + dz * dz > 10000) {
                positions[index] = cameraPos.x + (Math.random() - 0.5) * 200;
                positions[index + 2] = cameraPos.z + (Math.random() - 0.5) * 200;
            }
        }
        this.rainGeometry.attributes.position.needsUpdate = true;
    }

    // For sun/moon/star/precipitation/cleanup code see above (unchanged except for removal of skyGradient)
    resize(width, height) {
        if (this.sunLight.shadow) {
            this.sunLight.shadow.mapSize.width = Math.min(2048, width);
            this.sunLight.shadow.mapSize.height = Math.min(2048, height);
        }
        for (let l of this.cloudLayers) {
            this.scene.remove(l);
            l.geometry.dispose();
            l.material.dispose();
        }
        if (this.moonLight.shadow) {
            this.moonLight.shadow.mapSize.width = Math.min(1024, width);
            this.moonLight.shadow.mapSize.height = Math.min(1024, height);
        }
    }

    cleanup() {
        this.sky.cleanup();
        this.lightManager.removeLight(this.sunLightId);
        this.lightManager.removeLight(this.moonLightId);
        this.lightManager.removeLight(this.thunderLightId);
        if (this.sunSphere) {
            this.scene.remove(this.sunSphere);
            this.sunSphere.geometry.dispose();
            this.sunSphere.material.dispose();
        }
        if (this.moonSphere) {
            this.scene.remove(this.moonSphere);
            this.moonSphere.geometry.dispose();
            this.moonSphere.material.dispose();
        }
        if (this.starsPoints) {
            this.scene.remove(this.starsPoints);
            this.starsPoints.geometry.dispose();
            this.starsPoints.material.dispose();
        }
        if (this.sunLight) {
            this.scene.remove(this.sunLight);
            if (this.sunLight.dispose) this.sunLight.dispose();
        }
        if (this.moonLight) {
            this.scene.remove(this.moonLight);
            if (this.moonLight.dispose) this.moonLight.dispose();
        }
        if (this.ambientLight) this.scene.remove(this.ambientLight);
        if (this.thunderLight) {
            this.scene.remove(this.thunderLight);
            if (this.thunderLight.dispose) this.thunderLight.dispose();
        }
        if (this.rainParticles) {
            this.scene.remove(this.rainParticles);
            if (this.rainGeometry) this.rainGeometry.dispose();
            if (this.rainMaterial) this.rainMaterial.dispose();
        }
        this.scene.fog = null;
    }
}