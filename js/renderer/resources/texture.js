export const TextureFormat = {
    RGBA8: 'rgba8',
    RGBA16F: 'rgba16f',
    RGBA32F: 'rgba32f',
    R8: 'r8',     
    R16F: 'r16f',
    R32F: 'r32f',
    DEPTH24: 'depth24',
    DEPTH32F: 'depth32f'
};

export const TextureFilter = {
    NEAREST: 'nearest',
    LINEAR: 'linear',
    NEAREST_MIPMAP_NEAREST: 'nearest_mipmap_nearest',
    LINEAR_MIPMAP_LINEAR: 'linear_mipmap_linear',
    NEAREST_MIPMAP_LINEAR: 'nearest_mipmap_linear',
    LINEAR_MIPMAP_NEAREST: 'linear_mipmap_nearest'
};
export const TextureWrap = {
    REPEAT: 'repeat',
    CLAMP: 'clamp',
    MIRROR: 'mirror'
};

export class Texture {
    constructor(options = {}) {
        this.id = Texture._nextId++;
        
        this.width = options.width || 1;
        this.height = options.height || 1;
        this.depth = options.depth || 1;
        
        this.format = options.format || TextureFormat.RGBA8;
        this.minFilter = options.minFilter || TextureFilter.LINEAR;
        this.magFilter = options.magFilter || TextureFilter.LINEAR;
        this.wrapS = options.wrapS || TextureWrap.CLAMP;
        this.wrapT = options.wrapT || TextureWrap.CLAMP;
        
        this.generateMipmaps = options.generateMipmaps !== false;
        
        this.data = options.data || null;
        this.image = options.image || null;
        
        this._gpuTexture = null;
        this._needsUpload = true;
    }
    
    static _nextId = 0;
    
    setData(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
        this._needsUpload = true;
    }
    
    setImage(image) {
        this.image = image;
        this.width = image.width;
        this.height = image.height;
        this._needsUpload = true;
    }
    
    dispose() {
        this.data = null;
        this.image = null;
        this._gpuTexture = null;
    }
}