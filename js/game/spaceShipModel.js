import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class SpaceshipModel {
    constructor() {
        this.mesh = this.createMesh();
    }
    
    createMesh() {
        const group = new THREE.Group();
        
        const bodyGeometry = new THREE.ConeGeometry(0.5, 3, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4488ff,
            metalness: 0.7,
            roughness: 0.3
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = -Math.PI / 2;
        group.add(body);
        
        const noseGeometry = new THREE.ConeGeometry(0.3, 0.8, 6);
        const noseMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6600,
            emissive: 0xff3300,
            emissiveIntensity: 0.5
        });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.z = 1.8;
        nose.rotation.x = -Math.PI / 2;
        group.add(nose);
        
        const wingGeometry = new THREE.BoxGeometry(3, 0.1, 1);
        const wingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x6699ff,
            metalness: 0.6,
            roughness: 0.4
        });
        const wings = new THREE.Mesh(wingGeometry, wingMaterial);
        wings.position.z = -0.5;
        group.add(wings);
        
        const finGeometry = new THREE.BoxGeometry(0.1, 1.5, 0.8);
        const fin = new THREE.Mesh(finGeometry, wingMaterial);
        fin.position.z = -1.2;
        fin.position.y = 0.5;
        group.add(fin);
        
        const cockpitGeometry = new THREE.SphereGeometry(0.4, 8, 8);
        const cockpitMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x88ccff,
            metalness: 0.9,
            roughness: 0.1,
            transparent: true,
            opacity: 0.8
        });
        const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
        cockpit.position.z = 0.5;
        cockpit.scale.set(1, 1, 0.7);
        group.add(cockpit);
        
        const engineGeometry = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 8);
        const engineMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xff4400,
            emissive: 0xff4400,
            emissiveIntensity: 2
        });
        
        const engineLeft = new THREE.Mesh(engineGeometry, engineMaterial);
        engineLeft.position.set(-0.8, 0, -1.0);
        engineLeft.rotation.x = Math.PI / 2;
        group.add(engineLeft);
        
        const engineRight = new THREE.Mesh(engineGeometry, engineMaterial);
        engineRight.position.set(0.8, 0, -1.0);
        engineRight.rotation.x = Math.PI / 2;
        group.add(engineRight);
        
        group.scale.set(0.8, 0.8, 0.8);
        
        return group;
    }
    
    /**
     * CORRECT coordinate mapping to match terrain:
     * Game: X=east, Y=north, Z=altitude
     * THREE: X=east, Y=altitude, Z=north
     * Mapping: Game(x,y,z) -> THREE(x, z, y)
     */
    update(spaceshipState) {
        if (!this.mesh) return;
        
        this.mesh.position.set(
            spaceshipState.position.x,
            spaceshipState.position.z,
            spaceshipState.position.y
        );
        
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = -(spaceshipState.direction - Math.PI / 2);
        this.mesh.rotation.x = -spaceshipState.pitch;
        this.mesh.rotation.z = -spaceshipState.roll;
        
        if (spaceshipState.state === 'outOfControl') {
            const wobble = Math.sin(Date.now() * 0.01) * 0.2;
            this.mesh.rotation.x += wobble;
        }
    }
    
    addToScene(scene) {
        if (this.mesh) {
            scene.add(this.mesh);
            const arrowHelper = new THREE.ArrowHelper(
                new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(0, 0, 0),
                5,
                0xffff00
            );
            arrowHelper.name = 'DirectionArrow';
            this.mesh.add(arrowHelper);
            
            console.log('Spaceship added (yellow arrow = forward)');
        }
    }
    
    removeFromScene(scene) {
        if (this.mesh) {
            scene.remove(this.mesh);
        }
    }
}
