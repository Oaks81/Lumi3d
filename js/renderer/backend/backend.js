// renderer/backend/Backend.js

export class Backend {
    constructor(canvas) {
        this.canvas = canvas;
        this.context = null;
    }
    
    async initialize() {
        throw new Error('Backend.initialize() must be implemented');
    }

      /**
     * Upload a Texture object to GPU
     * @param {Texture} texture - The texture wrapper with .data, .width, .height
     * @returns {void} - Sets texture._gpuTexture
     */
      uploadTexture(texture) {
        throw new Error('uploadTexture must be implemented by subclass');
    }
    
    createBuffer(data, usage) {
        throw new Error('Backend.createBuffer() must be implemented');
    }
    
    updateBuffer(buffer, data, offset = 0) {
        throw new Error('Backend.updateBuffer() must be implemented');
    }
    
    deleteBuffer(buffer) {
        throw new Error('Backend.deleteBuffer() must be implemented');
    }
    
    createTexture(texture) {
        throw new Error('Backend.createTexture() must be implemented');
    }
    
    updateTexture(texture) {
        throw new Error('Backend.updateTexture() must be implemented');
    }
    
    deleteTexture(texture) {
        throw new Error('Backend.deleteTexture() must be implemented');
    }
    
    compileShader(material) {
        throw new Error('Backend.compileShader() must be implemented');
    }
    
    deleteShader(material) {
        throw new Error('Backend.deleteShader() must be implemented');
    }
    
    createRenderTarget(renderTarget) {
        throw new Error('Backend.createRenderTarget() must be implemented');
    }
    
    deleteRenderTarget(renderTarget) {
        throw new Error('Backend.deleteRenderTarget() must be implemented');
    }
    
    setRenderTarget(renderTarget) {
        throw new Error('Backend.setRenderTarget() must be implemented');
    }
    
    clear(color, depth, stencil) {
        throw new Error('Backend.clear() must be implemented');
    }
    
    setViewport(x, y, width, height) {
        throw new Error('Backend.setViewport() must be implemented');
    }
    
    draw(geometry, material, uniforms) {
        throw new Error('Backend.draw() must be implemented');
    }
    
    readPixels(renderTarget, x, y, width, height, format) {
        throw new Error('Backend.readPixels() must be implemented');
    }
    
    getContext() {
        return this.context;
    }
    
    getAPIName() {
        return 'Base';
    }
    
    dispose() {
        throw new Error('Backend.dispose() must be implemented');
    }
}