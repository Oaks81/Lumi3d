import { Texture, TextureFormat, TextureFilter } from '../resources/texture.js';

export class AtmosphericScatteringLUT {
    constructor(backend, uniformManager) {
        this.backend = backend;
        this.uniformManager = uniformManager;
        
        this.transmittanceLUT = null;
        this.multiScatterLUT = null;
        
        this.transmittanceSize = { width: 256, height: 64 };
        this.multiScatterSize = { width: 32, height: 32 };
        
        this._isDirty = true;
        this._isInitialized = false;
    }
    
    async initialize() {
        this._createTextures();
        await this._initializeResources();
        this._isInitialized = true;
    }
    
    _createTextures() {
        this.transmittanceLUT = new Texture({
            width: this.transmittanceSize.width,
            height: this.transmittanceSize.height,
            format: TextureFormat.RGBA16F,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR,
            generateMipmaps: false
        });
        
        this.multiScatterLUT = new Texture({
            width: this.multiScatterSize.width,
            height: this.multiScatterSize.height,
            format: TextureFormat.RGBA16F,
            minFilter: TextureFilter.LINEAR,
            magFilter: TextureFilter.LINEAR,
            generateMipmaps: false
        });
    }
    
    async _initializeResources() {
        throw new Error('AtmosphericScatteringLUT._initializeResources() must be implemented');
    }
    
    _getAtmosphereUniformData() {
        const uniforms = this.uniformManager.uniforms;
        
        const data = new Float32Array(16);
        data[0] = uniforms.atmospherePlanetRadius.value;
        data[1] = uniforms.atmosphereRadius.value;
        data[2] = uniforms.atmosphereScaleHeightRayleigh.value;
        data[3] = uniforms.atmosphereScaleHeightMie.value;
        
        const rayleigh = uniforms.atmosphereRayleighScattering.value;
        data[4] = rayleigh.x;
        data[5] = rayleigh.y;
        data[6] = rayleigh.z;
        data[7] = uniforms.atmosphereMieScattering.value;
        
        const ozone = uniforms.atmosphereOzoneAbsorption.value;
        data[8] = ozone.x;
        data[9] = ozone.y;
        data[10] = ozone.z;
        data[11] = 0.0;
        
        data[12] = this.transmittanceSize.width;
        data[13] = this.transmittanceSize.height;
        data[14] = 0.0;
        data[15] = 0.0;
        
        return data;
    }
    
    markDirty() {
        this._isDirty = true;
    }
    
    update() {
        if (!this._isInitialized || !this._isDirty) return;
        
        this._generateTransmittanceLUT();
        this._isDirty = false;
        
        this.uniformManager.setAtmosphereLUTs(
            this.transmittanceLUT,
            this.multiScatterLUT,
            null
        );
    }
    
    _generateTransmittanceLUT() {
        throw new Error('AtmosphericScatteringLUT._generateTransmittanceLUT() must be implemented');
    }
    
    getTransmittanceLUT() {
        return this.transmittanceLUT;
    }
    
    getMultiScatterLUT() {
        return this.multiScatterLUT;
    }
    
    dispose() {
        throw new Error('AtmosphericScatteringLUT.dispose() must be implemented');
    }
    
    static async create(backend, uniformManager) {
        const apiName = backend.getAPIName();
        
        let LUTClass;
        if (apiName === 'webgpu') {
            const module = await import('./webGPUAtmosphericScatteringLUT.js');
            LUTClass = module.WebGPUAtmosphericScatteringLUT;
        } else {
            const module = await import('./webGL2AtmosphericScatteringLUT.js');
            LUTClass = module.WebGL2AtmosphericScatteringLUT;
        }
        
        const instance = new LUTClass(backend, uniformManager);
        await instance.initialize();
        return instance;
    }
}