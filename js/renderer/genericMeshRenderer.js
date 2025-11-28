import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';

export class GenericMeshRenderer {
    constructor(backend) {
        this.backend = backend;
        this.meshes = new Map(); // key -> {geometry, material, visible, modelMatrix}
    }

    addMesh(key, threeJsMesh) {
        return;
        // Convert THREE.js mesh to custom format
        const geometry = this._convertGeometry(threeJsMesh.geometry);
        const material = this._convertMaterial(threeJsMesh.material);
        
        const entry = {
            geometry,
            material,
            visible: true,
            modelMatrix: threeJsMesh.matrixWorld.clone(),
            threeJsMesh // Keep reference for updates
        };
        
        this.meshes.set(key, entry);
        return entry;
    }

    updateMesh(key, threeJsMesh) {
        return;
        const entry = this.meshes.get(key);
        if (!entry) return;
        
        // Update model matrix from THREE.js mesh
        entry.modelMatrix.copy(threeJsMesh.matrixWorld);
        
        if (entry.material && entry.material.uniforms && entry.material.uniforms.modelMatrix) {
            entry.material.uniforms.modelMatrix.value.copy(entry.modelMatrix);
        }
    }

    removeMesh(key) {
        return;
        const entry = this.meshes.get(key);
        if (!entry) return;
        
        if (entry.geometry) entry.geometry.dispose();
        if (entry.material) this.backend.deleteShader(entry.material);
        
        this.meshes.delete(key);
    }

    render(viewMatrix, projectionMatrix) {
        return;
        for (const [key, entry] of this.meshes) {
            if (!entry.visible) continue;
            
            // Update matrices
            if (entry.material && entry.material.uniforms) {
                if (entry.material.uniforms.viewMatrix) {
                    entry.material.uniforms.viewMatrix.value.copy(viewMatrix);
                }
                if (entry.material.uniforms.projectionMatrix) {
                    entry.material.uniforms.projectionMatrix.value.copy(projectionMatrix);
                }
                if (entry.material.uniforms.modelMatrix) {
                    entry.material.uniforms.modelMatrix.value.copy(entry.modelMatrix);
                }
            }
            
            this.backend.draw(entry.geometry, entry.material);
        }
    }

    _convertGeometry(threeGeometry) {
        // Convert THREE.js BufferGeometry to custom format
        const attributes = new Map();
        
        for (const [name, attr] of Object.entries(threeGeometry.attributes)) {
            attributes.set(name, {
                array: attr.array,
                itemSize: attr.itemSize,
                count: attr.count
            });
        }
        
        const geometry = {
            attributes,
            index: threeGeometry.index ? {
                array: threeGeometry.index.array,
                count: threeGeometry.index.count
            } : null,
            drawCount: threeGeometry.index ? threeGeometry.index.count : attributes.get('position').count,
            dispose: () => threeGeometry.dispose()
        };
        
        return geometry;
    }

    _convertMaterial(threeMaterial) {
        // Create a basic material for WebGPU backend
        // This is simplified - you'll need to expand based on your needs
        const material = {
            type: 'basicmaterial',
            uniforms: {
                modelMatrix: { value: new THREE.Matrix4() },
                viewMatrix: { value: new THREE.Matrix4() },
                projectionMatrix: { value: new THREE.Matrix4() },
                color: { value: threeMaterial.color ? threeMaterial.color.clone() : new THREE.Color(1, 1, 1) },
                opacity: { value: threeMaterial.opacity !== undefined ? threeMaterial.opacity : 1.0 }
            },
            _needsCompile: true,
            dispose: () => {}
        };
        
        return material;
    }

    cleanup() {
        for (const [key, entry] of this.meshes) {
            this.removeMesh(key);
        }
        this.meshes.clear();
    }
}