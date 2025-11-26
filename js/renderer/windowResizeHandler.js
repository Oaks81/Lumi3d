export class WindowResizeHandler {
    constructor(canvas, renderer, camera, postProcessing) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.camera = camera;
        this.postProcessing = postProcessing;
        
        window.addEventListener('resize', () => this.updateCanvasSize());
        this.updateCanvasSize();
    }

    updateCanvasSize() {
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        if (this.renderer && this.camera) {
            this.renderer.setSize(this.canvas.width, this.canvas.height, false);
            this.camera.aspect = this.canvas.width / this.canvas.height;
            this.camera.updateProjectionMatrix();
            
            if (this.postProcessing) {
                this.postProcessing.resize(this.canvas.width, this.canvas.height);
            }
        }
    }

    handleResize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        
        if (this.postProcessing) {
            this.postProcessing.resize(width, height);
        }
    }
}