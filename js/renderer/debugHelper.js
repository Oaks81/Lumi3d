import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { LightType } from '../lighting/lightManager.js';

export class DebugHelper {
    constructor(scene, camera, clusterGrid, lightManager) {
        this.scene = scene;
        this.camera = camera;
        this.clusterGrid = clusterGrid;
        this.lightManager = lightManager;
        this.showLightHelpers = false;
        this.lightHelperGroup = null;
    }

    debugScreenPosition(screenX, screenY, canvas) {
        const ndcX = (screenX / canvas.width) * 2 - 1;
        const ndcY = -(screenY / canvas.height) * 2 + 1;
        
        const near = new THREE.Vector3(ndcX, ndcY, -1);
        const far = new THREE.Vector3(ndcX, ndcY, 1);
        
        near.unproject(this.camera);
        far.unproject(this.camera);
        
        const direction = new THREE.Vector3().subVectors(far, near).normalize();
        
        console.log('=== Debug click at', screenX, screenY, '===');
        this._sampleRayPoints(direction);
    }

    _sampleRayPoints(direction) {
        for (let dist = 10; dist <= 100; dist += 10) {
            const worldPos = new THREE.Vector3()
                .copy(this.camera.position)
                .add(direction.clone().multiplyScalar(dist));
            
            const viewPos = worldPos.clone().applyMatrix4(this.camera.matrixWorldInverse);
            const cluster = this.clusterGrid.worldToCluster(worldPos, this.camera);
            
            console.log(`Distance ${dist}m:`, {
                worldPos: worldPos.toArray().map(v => v.toFixed(1)),
                viewPos: viewPos.toArray().map(v => v.toFixed(1)),
                cluster: cluster,
                viewZ: -viewPos.z
            });
        }
    }

    toggleLightHelpers() {
        if (this.showLightHelpers) {
            if (this.lightHelperGroup) this.lightHelperGroup.visible = false;
            this.showLightHelpers = false;
        } else {
            if (!this.lightHelperGroup) this.createLightDebugHelpers();
            if (this.lightHelperGroup) this.lightHelperGroup.visible = true;
            this.showLightHelpers = true;
        }
        console.log('Light helpers:', this.showLightHelpers ? 'ON' : 'OFF');
    }

    createLightDebugHelpers() {
        if (this.lightHelperGroup) {
            this.scene.remove(this.lightHelperGroup);
        }
        
        this.lightHelperGroup = new THREE.Group();
        this.lightHelperGroup.name = 'LightHelpers';
        
        this.lightManager.lights.forEach((light, index) => {
            if (light.type === LightType.POINT) {
                this._createPointLightHelper(light, index);
            }
        });
        
        this.scene.add(this.lightHelperGroup);
        console.log('✓ Created light debug helpers');
    }

    _createPointLightHelper(light, index) {
        // Inner sphere
        const innerGeometry = new THREE.SphereGeometry(2, 16, 16);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: light.color,
            emissive: light.color,
            emissiveIntensity: 1.0
        });
        const innerSphere = new THREE.Mesh(innerGeometry, innerMaterial);
        innerSphere.position.copy(light.position);
        
        // Label
        const sprite = this._createLabelSprite(`L${index}`);
        sprite.position.copy(light.position);
        sprite.position.y += 5;
        
        // Outer wireframe sphere
        const outerGeometry = new THREE.SphereGeometry(light.radius, 16, 16);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: light.color,
            wireframe: true,
            opacity: 0.3,
            transparent: true
        });
        const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
        outerSphere.position.copy(light.position);
        
        this.lightHelperGroup.add(innerSphere);
        this.lightHelperGroup.add(sprite);
        this.lightHelperGroup.add(outerSphere);
    }

    _createLabelSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Arial';
        ctx.fillText(text, 10, 40);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(10, 5, 1);
        return sprite;
    }

    testClusterGrid() {
        const testPositions = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 5, -20),
            new THREE.Vector3(50, 20, -100),
            new THREE.Vector3(100, 50, -400)
        ];
        
        console.log('=== Cluster Grid Test ===');
        for (const pos of testPositions) {
            const cluster = this.clusterGrid.worldToCluster(pos, this.camera);
            console.log(`World ${pos.toArray()} -> Cluster [${cluster.x}, ${cluster.y}, ${cluster.z}]`);
        }
        
        console.log('Grid Stats:', this.clusterGrid.getStats());
    }
}