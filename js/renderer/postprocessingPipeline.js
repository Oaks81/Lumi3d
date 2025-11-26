import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { blurMaterial, compositeMaterial } from './shaders/postProcessing.js';

export class PostProcessingPipeline {
    constructor(renderer, width, height) {
        this.renderer = renderer;
        
        this._createRenderTargets(width, height);
        this._createFullscreenQuad();
    }

    _createRenderTargets(width, height) {
        const rtOptions = {
            type: THREE.FloatType,
            encoding: THREE.LinearEncoding,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: true,
            stencilBuffer: false,
        };
        
        this.hdrRenderTarget = new THREE.WebGLRenderTarget(width, height, rtOptions);
        this.bloomRenderTarget1 = this.hdrRenderTarget.clone();
        this.bloomRenderTarget2 = this.hdrRenderTarget.clone();
    }

    _createFullscreenQuad() {
        const quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.fullscreenQuad = new THREE.Mesh(quadGeometry, null);
        this.fullscreenScene = new THREE.Scene();
        this.fullscreenScene.add(this.fullscreenQuad);
        this.fullscreenCamera = new THREE.Camera();
        this.fullscreenCamera.position.z = 1;
    }

    render(scene, camera, blurStrength = 5.0, bloomStrength = 0.2) {
        // Main render pass
        this.renderer.setRenderTarget(this.hdrRenderTarget);
        this.renderer.clear();
        this.renderer.render(scene, camera);
        
        // Post-processing
        this._horizontalBlurPass(blurStrength);
        this._verticalBlurPass(blurStrength);
        this._compositePass(bloomStrength);
    }

    _horizontalBlurPass(strength) {
        blurMaterial.uniforms.tDiffuse.value = this.hdrRenderTarget.texture;
        blurMaterial.uniforms.resolution.value.set(
            this.hdrRenderTarget.width, 
            this.hdrRenderTarget.height
        );
        blurMaterial.uniforms.direction.value.set(1.0, 0.0);
        blurMaterial.uniforms.strength.value = strength;

        this.fullscreenQuad.material = blurMaterial;
        this.renderer.setRenderTarget(this.bloomRenderTarget1);
        this.renderer.clear();
        this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    }

    _verticalBlurPass(strength) {
        blurMaterial.uniforms.tDiffuse.value = this.bloomRenderTarget1.texture;
        blurMaterial.uniforms.direction.value.set(0.0, 1.0);
        blurMaterial.uniforms.strength.value = strength;

        this.fullscreenQuad.material = blurMaterial;
        this.renderer.setRenderTarget(this.bloomRenderTarget2);
        this.renderer.clear();
        this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    }

    _compositePass(bloomStrength) {
        compositeMaterial.uniforms.tScene.value = this.hdrRenderTarget.texture;
        compositeMaterial.uniforms.tBloom.value = this.bloomRenderTarget2.texture;
        compositeMaterial.uniforms.bloomStrength.value = bloomStrength;

        this.fullscreenQuad.material = compositeMaterial;
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
    }

    resize(width, height) {
        this.hdrRenderTarget.setSize(width, height);
        this.bloomRenderTarget1.setSize(width, height);
        this.bloomRenderTarget2.setSize(width, height);
    }
}