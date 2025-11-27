// ./js/renderer/water/WaterRenderer.js
import { BaseRenderer } from './BaseRenderer.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class WaterRenderer extends BaseRenderer {
    constructor(uniformManager) {
        super();
        this.uniformManager = uniformManager;
        this.globalTime = 0;
        this.lastFrameTime = null;
        this.maxDeltaTime = 0.1;
    }

    render(loadedChunks, gameState, camera, environmentState) {
        if (!loadedChunks || loadedChunks.length === 0) return;
    
        for (const chunkEntry of loadedChunks) {
            if (!chunkEntry.waterMeshes || chunkEntry.waterMeshes.length === 0) continue;
    
            for (const waterMesh of chunkEntry.waterMeshes) {
                const material = waterMesh.material;
                if (!material || !material.uniforms) continue;
                
             
                material.uniforms.time.value = this.globalTime;
                
                this.updateWaterUniforms(material, environmentState);
                
                // Distance culling
                if (camera) {
                    const distance = camera.position.distanceTo(waterMesh.position);
                    waterMesh.visible = distance <= 1000;
                }
            }
        }
    }

    updateWaterUniforms(material, environmentState) {
        if (!material || !material.uniforms) return;
        if (!environmentState) return;

        const u = material.uniforms;

        // Wind direction
        if (u.windDirection && environmentState.windDirection) {
            const windX = environmentState.windDirection.x || 0;
            const windZ = environmentState.windDirection.z || environmentState.windDirection.y || 0;
            
            if (!isNaN(windX) && !isNaN(windZ) && isFinite(windX) && isFinite(windZ)) {
                u.windDirection.value.set(windX, windZ).normalize();
            }
        }

        // Wind speed
        if (u.windSpeed) {
            let windSpeed = environmentState.windSpeed;
            
            if (windSpeed === undefined || windSpeed === null || 
                isNaN(windSpeed) || !isFinite(windSpeed)) {
                windSpeed = 5.0;
            }
            
            windSpeed = Math.max(0.5, Math.min(25, windSpeed));
            u.windSpeed.value = windSpeed;
        }

        // Wave height (based on wind speed and weather)
        if (u.waveHeight) {
            const windSpeed = u.windSpeed?.value || 5.0;
            const weatherIntensity = environmentState.weatherIntensity || 0;
            
            const baseHeight = 0.15 + (windSpeed / 25.0) * 0.5;
            const stormBonus = weatherIntensity * 0.8;
            
            let waveHeight = baseHeight + stormBonus;
            waveHeight = Math.max(0.1, Math.min(2.0, waveHeight));
            
            u.waveHeight.value = waveHeight;
        }

        // Wave frequency (inversely related to wind speed)
        if (u.waveFrequency) {
            const windSpeed = u.windSpeed?.value || 5.0;
            let freq = 0.9 - (windSpeed / 50.0);
            freq = Math.max(0.3, Math.min(1.2, freq));
            u.waveFrequency.value = freq;
        }

        // Foam intensity
        if (u.foamIntensity) {
            const weatherIntensity = environmentState.weatherIntensity || 0;
            const windSpeed = u.windSpeed?.value || 5.0;
            
            const baseFoam = 0.5;
            const windFoam = (windSpeed / 25.0) * 0.4;
            const stormFoam = weatherIntensity * 0.5;
            
            let intensity = baseFoam + windFoam + stormFoam;
            intensity = Math.max(0.3, Math.min(2.0, intensity));
            
            u.foamIntensity.value = intensity;
        }

        // Foam depth range (based on wave height)
        if (u.foamDepthEnd && u.waveHeight) {
            const waveHeight = u.waveHeight.value;
            let depthEnd = 1.5 + waveHeight * 2.0;
            depthEnd = Math.max(1.0, Math.min(6.0, depthEnd));
            u.foamDepthEnd.value = depthEnd;
        }
    }

    // Called by renderer with deltaTime
    update(deltaTime) {
        // Validate deltaTime
        if (deltaTime === undefined || deltaTime === null || 
            isNaN(deltaTime) || !isFinite(deltaTime) || deltaTime < 0) {
            return;
        }
        
        // Cap deltaTime to prevent huge jumps
        const cappedDelta = Math.min(deltaTime, this.maxDeltaTime);
        
        // Double-check with real time
        const now = performance.now() / 1000;
        
        if (this.lastFrameTime !== null) {
            const realDelta = now - this.lastFrameTime;
            
            // If real time is way different from deltaTime, something is wrong
            if (Math.abs(realDelta - cappedDelta) > 0.5) {
                const safeDelta = Math.min(realDelta, cappedDelta, this.maxDeltaTime);
                this.globalTime += safeDelta;
            } else {
                this.globalTime += cappedDelta;
            }
        } else {
            // First frame
            this.globalTime += cappedDelta;
        }
        
        this.lastFrameTime = now;
        
        // Sanity check on global time
        if (isNaN(this.globalTime) || !isFinite(this.globalTime)) {
            this.globalTime = 0;
            this.lastFrameTime = null;
        }
    }

    resize(width, height) {
        // Water doesn't need resize handling currently
    }

    cleanup() {
        this.globalTime = 0;
        this.lastFrameTime = null;
    }
}