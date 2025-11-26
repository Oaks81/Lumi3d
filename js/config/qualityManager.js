/**
 * Quality manager for handling performance scaling and detail levels
 * Manages grass/shrub rendering quality based on hardware capabilities
 */
import { GRASS_QUALITY_LEVELS, getQualityConfig } from './grassConfig.js';

export class QualityManager {
    constructor() {
        this.currentQuality = 'MEDIUM';
        this.autoQuality = true;
        this.performanceMonitor = new PerformanceMonitor();
        this.qualityChangeCallbacks = new Set();
        
        // Performance thresholds for auto-quality adjustment
        this.performanceThresholds = {
            targetFPS: 60,
            minFPS: 30,
            adjustmentInterval: 5000, // 5 seconds
            stabilityPeriod: 10000 // 10 seconds before next adjustment
        };
        
        this.lastQualityAdjustment = 0;
        this.qualityStable = true;
        
        // Initialize with auto-detection
        if (this.autoQuality) {
            this._detectOptimalQuality();
        }
    }
    
    /**
     * Get current quality configuration
     * @returns {Object} Current quality configuration
     */
    getCurrentConfig() {
        return getQualityConfig(this.currentQuality);
    }
    
    /**
     * Get current quality level name
     * @returns {string} Quality level ('LOW', 'MEDIUM', 'HIGH')
     */
    getCurrentQuality() {
        return this.currentQuality;
    }
    
    /**
     * Set quality level manually (disables auto-quality)
     * @param {string} quality - Quality level ('LOW', 'MEDIUM', 'HIGH')
     */
    setQuality(quality) {
        if (!GRASS_QUALITY_LEVELS[quality]) {
            console.warn(`Invalid quality level: ${quality}`);
            return;
        }
        
        if (this.currentQuality !== quality) {
            const oldQuality = this.currentQuality;
            this.currentQuality = quality;
            this.autoQuality = false;
            
            console.log(`Quality changed from ${oldQuality} to ${quality}`);
            this._notifyQualityChange(oldQuality, quality);
        }
    }
    
    /**
     * Enable or disable auto-quality adjustment
     * @param {boolean} enabled - Whether to enable auto-quality
     */
    setAutoQuality(enabled) {
        this.autoQuality = enabled;
        
        if (enabled) {
            this._detectOptimalQuality();
        }
    }
    
    /**
     * Update quality manager (call each frame)
     * @param {number} deltaTime - Time since last frame in ms
     */
    update(deltaTime) {
        this.performanceMonitor.update(deltaTime);
        
        if (this.autoQuality && this._shouldAdjustQuality()) {
            this._adjustQualityBasedOnPerformance();
        }
    }
    
    /**
     * Register callback for quality changes
     * @param {Function} callback - Callback function (oldQuality, newQuality) => void
     */
    onQualityChange(callback) {
        this.qualityChangeCallbacks.add(callback);
    }
    
    /**
     * Unregister quality change callback
     * @param {Function} callback - Callback to remove
     */
    offQualityChange(callback) {
        this.qualityChangeCallbacks.delete(callback);
    }
    
    /**
     * Get recommended instance count for a chunk based on current quality
     * @param {string} vegetationType - 'grass' or 'shrub'
     * @param {string} density - Density level from config
     * @returns {number} Recommended instance count
     */
    getRecommendedInstanceCount(vegetationType, density) {
        const config = this.getCurrentConfig();
        const baseCount = config.maxInstancesPerChunk;
        
        // Density multipliers
        const densityMultipliers = {
            'very_high': 1.0,
            'high': 0.8,
            'medium': 0.6,
            'low': 0.4
        };
        
        // Type multipliers (shrubs are larger, so fewer per chunk)
        const typeMultipliers = {
            'grass': 1.0,
            'shrub': 0.3
        };
        
        const densityMult = densityMultipliers[density] || 0.6;
        const typeMult = typeMultipliers[vegetationType] || 1.0;
        
        return Math.floor(baseCount * densityMult * typeMult);
    }
    
    /**
     * Get recommended LOD distances based on current quality
     * @returns {Array<number>} Array of LOD switch distances
     */
    getLODDistances() {
        const config = this.getCurrentConfig();
        return config.lodDistances;
    }
    
    /**
     * Check if wind animation should be enabled
     * @returns {boolean} True if wind should be enabled
     */
    shouldEnableWind() {
        const config = this.getCurrentConfig();
        return config.enableWind;
    }
    
    /**
     * Get texture resolution for vegetation textures
     * @returns {number} Texture resolution (64, 128, 256)
     */
    getTextureResolution() {
        const config = this.getCurrentConfig();
        return config.textureResolution;
    }
    
    /**
     * Get maximum view distance for vegetation
     * @returns {number} Max view distance in world units
     */
    getMaxViewDistance() {
        const config = this.getCurrentConfig();
        return config.maxViewDistance;
    }
    
    /**
     * Detect optimal quality based on hardware capabilities
     * @private
     */
    _detectOptimalQuality() {
        // Get GPU info if available
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        
        if (!gl) {
            this.currentQuality = 'LOW';
            return;
        }
        
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
        
        // Memory estimate
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
        
        // Screen resolution factor
        const pixelCount = window.innerWidth * window.innerHeight;
        const pixelDensity = window.devicePixelRatio || 1;
        const totalPixels = pixelCount * pixelDensity * pixelDensity;
        
        // Hardware heuristics
        let qualityScore = 0;
        
        // GPU heuristics based on renderer string
        if (renderer.toLowerCase().includes('nvidia')) {
            if (renderer.includes('RTX') || renderer.includes('GTX 1060')) qualityScore += 3;
            else if (renderer.includes('GTX')) qualityScore += 2;
            else qualityScore += 1;
        } else if (renderer.toLowerCase().includes('amd') || renderer.toLowerCase().includes('radeon')) {
            if (renderer.includes('RX')) qualityScore += 2;
            else qualityScore += 1;
        } else if (renderer.toLowerCase().includes('intel')) {
            qualityScore += 0; // Integrated graphics
        } else {
            qualityScore += 1; // Unknown, assume medium
        }
        
        // Memory/capability heuristics
        if (maxTextureSize >= 4096) qualityScore += 1;
        if (maxVertexUniforms >= 1024) qualityScore += 1;
        
        // Resolution penalty for high pixel counts
        if (totalPixels > 2073600) qualityScore -= 1; // > 1080p
        if (totalPixels > 8294400) qualityScore -= 2; // > 4K
        
        // Mobile detection
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) qualityScore -= 2;
        
        // Determine quality level
        if (qualityScore >= 3) {
            this.currentQuality = 'HIGH';
        } else if (qualityScore >= 1) {
            this.currentQuality = 'MEDIUM';
        } else {
            this.currentQuality = 'LOW';
        }
        
        console.log(`Auto-detected quality: ${this.currentQuality} (score: ${qualityScore})`);
        console.log(`Renderer: ${renderer}`);
        console.log(`Max texture size: ${maxTextureSize}, Vertex uniforms: ${maxVertexUniforms}`);
        console.log(`Resolution: ${window.innerWidth}x${window.innerHeight}, DPI: ${pixelDensity}`);
    }
    
    /**
     * Check if quality should be adjusted based on performance
     * @returns {boolean} True if adjustment should be made
     * @private
     */
    _shouldAdjustQuality() {
        const now = Date.now();
        const timeSinceLastAdjustment = now - this.lastQualityAdjustment;
        
        return timeSinceLastAdjustment >= this.performanceThresholds.adjustmentInterval &&
               this.qualityStable;
    }
    
    /**
     * Adjust quality based on current performance
     * @private
     */
    _adjustQualityBasedOnPerformance() {
        const stats = this.performanceMonitor.getStats();
        const targetFPS = this.performanceThresholds.targetFPS;
        const minFPS = this.performanceThresholds.minFPS;
        
        let newQuality = this.currentQuality;
        
        // Performance too low - reduce quality
        if (stats.averageFPS < minFPS) {
            if (this.currentQuality === 'HIGH') {
                newQuality = 'MEDIUM';
            } else if (this.currentQuality === 'MEDIUM') {
                newQuality = 'LOW';
            }
        }
        // Performance good - potentially increase quality
        else if (stats.averageFPS > targetFPS && stats.frameTimeVariance < 5) {
            if (this.currentQuality === 'LOW') {
                newQuality = 'MEDIUM';
            } else if (this.currentQuality === 'MEDIUM') {
                newQuality = 'HIGH';
            }
        }
        
        if (newQuality !== this.currentQuality) {
            const oldQuality = this.currentQuality;
            this.currentQuality = newQuality;
            this.lastQualityAdjustment = Date.now();
            this.qualityStable = false;
            
            // Mark as stable after stability period
            setTimeout(() => {
                this.qualityStable = true;
            }, this.performanceThresholds.stabilityPeriod);
            
            console.log(`Auto-adjusted quality: ${oldQuality} -> ${newQuality} (FPS: ${stats.averageFPS.toFixed(1)})`);
            this._notifyQualityChange(oldQuality, newQuality);
        }
    }
    
    /**
     * Notify callbacks of quality change
     * @param {string} oldQuality - Previous quality level
     * @param {string} newQuality - New quality level
     * @private
     */
    _notifyQualityChange(oldQuality, newQuality) {
        for (const callback of this.qualityChangeCallbacks) {
            try {
                callback(oldQuality, newQuality);
            } catch (error) {
                console.error('Error in quality change callback:', error);
            }
        }
    }
}

/**
 * Performance monitor for tracking FPS and frame times
 */
class PerformanceMonitor {
    constructor() {
        this.frameCount = 0;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.frameTimes = [];
        this.maxSamples = 60; // Track last 60 frames
        
        this.stats = {
            averageFPS: 60,
            currentFPS: 60,
            frameTime: 16.67,
            frameTimeVariance: 0
        };
    }
    
    /**
     * Update performance monitor
     * @param {number} deltaTime - Time since last frame in ms
     */
    update(deltaTime) {
        const currentTime = performance.now();
        const frameTime = currentTime - this.lastFrameTime;
        
        this.frameCount++;
        this.frameTimes.push(frameTime);
        
        // Keep only recent samples
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }
        
        // Calculate stats every 30 frames
        if (this.frameCount % 30 === 0) {
            this._calculateStats();
        }
        
        this.lastFrameTime = currentTime;
    }
    
    /**
     * Get performance statistics
     * @returns {Object} Performance stats
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Calculate performance statistics
     * @private
     */
    _calculateStats() {
        if (this.frameTimes.length === 0) return;
        
        // Average frame time
        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        
        // Current FPS (from last frame)
        const currentFrameTime = this.frameTimes[this.frameTimes.length - 1];
        this.stats.currentFPS = 1000 / currentFrameTime;
        
        // Average FPS
        this.stats.averageFPS = 1000 / avgFrameTime;
        this.stats.frameTime = avgFrameTime;
        
        // Frame time variance (stability metric)
        const variance = this.frameTimes.reduce((acc, time) => {
            return acc + Math.pow(time - avgFrameTime, 2);
        }, 0) / this.frameTimes.length;
        
        this.stats.frameTimeVariance = Math.sqrt(variance);
    }
}

// Singleton instance
export const qualityManager = new QualityManager();
