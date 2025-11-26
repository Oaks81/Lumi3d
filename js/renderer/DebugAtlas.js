// TextureAtlasDebugger.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TEXTURE_LEVELS, ATLAS_CONFIG } from '../texture/TileConfig.js';

export class TextureAtlasDebugger {
    constructor() {
        this.debugPlanes = new Map();
        this.debugInfoPanels = new Map();
        this.debugGroup = new THREE.Group();
        this.debugGroup.name = 'AtlasDebugGroup';
        
        // Configuration
        this.config = {
            displaySize: 12,           // Size of debug planes in world units
            spacing: 10,              // Spacing between debug planes
            position: { x: 0, y: 2, z: 0 }, // Base position for debug display
            showGrid: true,           // Show grid overlay
            showLabels: true,         // Show texture labels
            showUtilization: true,    // Show utilization info
            gridColor: 0x00ff00,      // Grid line color
            textColor: 0xffffff,      // Text color
            backgroundColor: 0x000000, // Background color for info panels
            opacity: 0.8             // Opacity for overlays
        };
    }

    /**
     * Create debug visualization for a texture atlas
     * @param {TextureAtlasManager} atlasManager - The atlas manager instance
     * @param {string} level - The texture level to debug
     * @param {THREE.Scene} scene - The scene to add debug objects to
     * @param {Object} options - Override default configuration
     */
    createAtlasDebug(atlasManager, level, scene, options = {}) {
        const config = { ...this.config, ...options };
        const atlasInfo = atlasManager.getAtlasInfo(level);
        
        if (!atlasInfo) {
            console.warn(`No atlas info available for level: ${level}`);
            return;
        }

        console.log(`Creating debug visualization for ${level} atlas`);

        // Create debug plane showing the atlas texture
        const debugPlane = this.createAtlasPlane(atlasManager, level, config);
        
        // Create grid overlay
        if (config.showGrid) {
            const gridOverlay = this.createGridOverlay(atlasInfo, config);
            debugPlane.add(gridOverlay);
        }

        // Create info panel
        if (config.showUtilization) {
            const infoPanel = this.createInfoPanel(atlasInfo, config);
            debugPlane.add(infoPanel);
        }

        // Position the debug plane
        const levelIndex = Object.values(TEXTURE_LEVELS).indexOf(level);
        debugPlane.position.set(
            config.position.x + (levelIndex * config.spacing),
            config.position.y,
            config.position.z
        );

        // Store reference
        this.debugPlanes.set(level, debugPlane);
        this.debugGroup.add(debugPlane);
        
        // Add to scene if not already added
        if (!scene.getObjectByName('AtlasDebugGroup')) {
            scene.add(this.debugGroup);
        }

        return debugPlane;
    }

    /**
     * Create the main plane displaying the atlas texture
     */
    createAtlasPlane(atlasManager, level, config) {
        const atlasTexture = atlasManager.getAtlasTexture(level);
        if (!atlasTexture) {
            console.warn(`No atlas texture available for level: ${level}`);
            return new THREE.Group();
        }

        const geometry = new THREE.PlaneGeometry(config.displaySize, config.displaySize);
        const material = new THREE.MeshBasicMaterial({
            map: atlasTexture,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: config.opacity
        });

        const plane = new THREE.Mesh(geometry, material);
        plane.name = `AtlasDebug_${level}`;
        //plane.rotation.x = Math.PI / 2;
        // Create container group
        const container = new THREE.Group();
        container.name = `AtlasContainer_${level}`;
        container.add(plane);

        // Add title
        if (config.showLabels) {
            const title = this.createTextLabel(
                `${level.toUpperCase()} ATLAS`,
                { x: 0, y: config.displaySize / 2 + 0.5, z: 0.01 },
                config.textColor,
                0.5
            );
            container.add(title);
        }

        return container;
    }

    /**
     * Create grid overlay showing texture boundaries
     */
    createGridOverlay(atlasInfo, config) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.LineBasicMaterial({ 
            color: config.gridColor,
            transparent: true,
            opacity: 0.7
        });

        const { tilesPerRow, rows } = atlasInfo.layout;
        const positions = [];

        // Vertical lines
        for (let i = 0; i <= tilesPerRow; i++) {
            const x = (i / tilesPerRow - 0.5) * config.displaySize;
            positions.push(x, -config.displaySize / 2, 0.001);
            positions.push(x, config.displaySize / 2, 0.001);
        }

        // Horizontal lines
        for (let i = 0; i <= rows; i++) {
            const y = (0.5 - i / rows) * config.displaySize;
            positions.push(-config.displaySize / 2, y, 0.001);
            positions.push(config.displaySize / 2, y, 0.001);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const gridLines = new THREE.LineSegments(geometry, material);
        gridLines.name = 'AtlasGrid';
        
        return gridLines;
    }

    /**
     * Create information panel with atlas statistics
     */
    createInfoPanel(atlasInfo, config) {
        const panelGroup = new THREE.Group();
        panelGroup.name = 'InfoPanel';

        // Background panel
        const panelGeometry = new THREE.PlaneGeometry(3, 2);
        const panelMaterial = new THREE.MeshBasicMaterial({
            color: config.backgroundColor,
            transparent: true,
            opacity: 0.7
        });
        const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
        panelMesh.position.set(config.displaySize / 2 + 2, 0, 0);
        panelGroup.add(panelMesh);

        // Information text
        const info = [
            `Level: ${atlasInfo.level}`,
            `Size: ${atlasInfo.atlasSize}x${atlasInfo.atlasSize}`,
            `Texture Size: ${atlasInfo.textureSize}px`,
            `Grid: ${atlasInfo.layout.tilesPerRow}x${atlasInfo.layout.rows}`,
            `Utilization: ${atlasInfo.utilization.utilization}`,
            `Used: ${atlasInfo.utilization.used}/${atlasInfo.utilization.capacity}`,
            `Seasonal: ${atlasInfo.seasonalTextures}`,
            `Snow: ${atlasInfo.snowTextures}`,
            `Total: ${atlasInfo.totalTextures}`
        ];

        const startY = 0.8;
        const lineHeight = 0.18;

        info.forEach((text, index) => {
            const label = this.createTextLabel(
                text,
                { 
                    x: config.displaySize / 2 + 2, 
                    y: startY - (index * lineHeight), 
                    z: 0.01 
                },
                config.textColor,
                0.15
            );
            panelGroup.add(label);
        });

        return panelGroup;
    }

    /**
     * Create text label using canvas-based sprites
     */
    createTextLabel(text, position, color = 0xffffff, size = 0.3) {
        // Create canvas for text rendering
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Set canvas size based on text length
        const textLength = text.length;
        canvas.width = Math.max(256, textLength * 16);
        canvas.height = 64;
        
        // Clear canvas with transparent background
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Configure text style
        context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        context.font = 'Bold 24px Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Add text stroke for better visibility
        context.strokeStyle = '#000000';
        context.lineWidth = 2;
        context.strokeText(text, canvas.width / 2, canvas.height / 2);
        
        // Draw text
        context.fillText(text, canvas.width / 2, canvas.height / 2);
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        
        // Create sprite
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.01
        });
        
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(position.x, position.y, position.z);
        
        // Scale based on text length and desired size
        const aspect = canvas.width / canvas.height;
        sprite.scale.set(size * aspect * 2, size * 2, 1);
        
        return sprite;
    }

    /**
     * Update debug visualization (call when atlas changes)
     */
    updateAtlasDebug(atlasManager, level) {
        const debugPlane = this.debugPlanes.get(level);
        if (!debugPlane) return;

        // Update texture
        const atlasTexture = atlasManager.getAtlasTexture(level);
        const mesh = debugPlane.getObjectByName(`AtlasDebug_${level}`);
        if (mesh && atlasTexture) {
            mesh.material.map = atlasTexture;
            mesh.material.needsUpdate = true;
        }

        // Update info panel
        const infoPanel = debugPlane.getObjectByName('InfoPanel');
        if (infoPanel) {
            // Remove old info panel and create new one
            debugPlane.remove(infoPanel);
            const atlasInfo = atlasManager.getAtlasInfo(level);
            if (atlasInfo) {
                const newInfoPanel = this.createInfoPanel(atlasInfo, this.config);
                debugPlane.add(newInfoPanel);
            }
        }
    }

    /*
    createAllAtlasDebugs(atlasManager, scene, options = {}) {
        const debugPlanes = [];
        
        Object.values(TEXTURE_LEVELS).forEach((level, index) => {
            const debugPlane = this.createAtlasDebug(atlasManager, level, scene, options);
            if (debugPlane) {
                debugPlanes.push(debugPlane);
            }
        });

        return debugPlanes;
    }*/
    /**
     * Toggle visibility of debug visualization
     */
    toggleVisibility(level = null) {
        if (level) {
            const debugPlane = this.debugPlanes.get(level);
            if (debugPlane) {
                debugPlane.visible = !debugPlane.visible;
            }
        } else {
            this.debugGroup.visible = !this.debugGroup.visible;
        }
    }

    /**
     * Remove debug visualization
     */
    removeAtlasDebug(level) {
        const debugPlane = this.debugPlanes.get(level);
        if (debugPlane) {
            this.debugGroup.remove(debugPlane);
            this.debugPlanes.delete(level);
            
            // Clean up materials and geometries
            debugPlane.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
    }

    /**
     * Remove all debug visualizations
     */
    removeAllDebugs() {
        this.debugPlanes.forEach((_, level) => {
            this.removeAtlasDebug(level);
        });
        
        if (this.debugGroup.parent) {
            this.debugGroup.parent.remove(this.debugGroup);
        }
    }

    /**
     * Get debug statistics
     */
    getDebugStats() {
        return {
            totalDebugPlanes: this.debugPlanes.size,
            debugLevels: Array.from(this.debugPlanes.keys()),
            visible: this.debugGroup.visible,
            position: this.debugGroup.position.clone()
        };
    }

    /**
     * Configure debug settings
     */
    configure(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Update existing debug planes
        this.debugPlanes.forEach((debugPlane, level) => {
            // You could update existing planes here if needed
            // For now, user should recreate them
        });
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        this.removeAllDebugs();
        this.debugPlanes.clear();
        this.debugInfoPanels.clear();
    }
}