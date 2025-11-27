// backend/webgpuBackend.js

import { Backend } from './backend.js';
import { TextureFormat, TextureFilter, TextureWrap, Texture } from '../resources/texture.js';

export class WebGPUBackend extends Backend {
    constructor(canvas) {
        super(canvas);
        this.device = null;
        this.adapter = null;
        this.context = null;
        this.format = null;

        this._currentRenderTarget = null;
        this._currentPipeline = null;
        this._currentBindGroups = new Map();
        this._commandEncoder = null;
        this._renderPassEncoder = null;

        this._bufferCache = new Map();
        this._textureCache = new Map();
        this._pipelineCache = new Map();
        this._bindGroupLayoutCache = new Map();
        this._samplerCache = new Map();

        this._depthTexture = null;
        this._clearColor = { r: 0, g: 0, b: 0, a: 1 };
        this._viewport = { x: 0, y: 0, width: 0, height: 0 };
        this._dummyTexture = null;
    }

    async initialize() {
        if (this.device) {
            console.log('WebGPUBackend already initialized, returning existing device');
            return;
        }

        if (!navigator.gpu) {
            throw new Error('WebGPU not supported');
        }

        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });

        if (!this.adapter) {
            throw new Error('Failed to get WebGPU adapter');
        }

        this.device = await this.adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {}
        });

        this.device.lost.then((info) => {
            console.error(`WebGPU device lost: ${info.message}`);
        });

        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque'
        });

        this._viewport = {
            x: 0,
            y: 0,
            width: this.canvas.width,
            height: this.canvas.height
        };

        this._createDepthTexture();
        this._createDefaultSamplers();

        console.log('WebGPUBackend initialized');
    }

    _createDepthTexture() {
        if (this._depthTexture) {
            this._depthTexture.destroy();
        }

        this._depthTexture = this.device.createTexture({
            size: [this._viewport.width || this.canvas.width, this._viewport.height || this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
    }

    _createDefaultSamplers() {
        this._samplerCache.set('linear', this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        }));

        this._samplerCache.set('nearest', this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        }));

        this._samplerCache.set('repeat', this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat'
        }));

        this._samplerCache.set('shadow', this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        }));
    }

    _padTextureData(data, width, height, format) {
        const bytesPerPixel = this._getBytesPerPixel(format);
        const bytesPerRow = width * bytesPerPixel;

        if (bytesPerRow % 256 === 0) {
            return { data, bytesPerRow };
        }

        const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
        const paddedSize = alignedBytesPerRow * height;
        const paddedData = new Uint8Array(paddedSize);

        const srcBuffer = new Uint8Array(data.buffer || data, data.byteOffset, data.byteLength);

        for (let y = 0; y < height; y++) {
            const srcOffset = y * bytesPerRow;
            const dstOffset = y * alignedBytesPerRow;
            if (srcOffset + bytesPerRow <= srcBuffer.length) {
                paddedData.set(srcBuffer.subarray(srcOffset, srcOffset + bytesPerRow), dstOffset);
            }
        }

        return { data: paddedData, bytesPerRow: alignedBytesPerRow };
    }

    _getOrCreateDummyTexture() {
        if (!this._dummyTexture) {
            this._dummyTexture = this.device.createTexture({
                size: [1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });

            const whitePixel = new Uint8Array([255, 255, 255, 255]);
            const { data, bytesPerRow } = this._padTextureData(whitePixel, 1, 1, TextureFormat.RGBA8);

            this.device.queue.writeTexture(
                { texture: this._dummyTexture },
                data,
                { bytesPerRow: bytesPerRow },
                [1, 1]
            );
        }
        return this._dummyTexture;
    }

    createTexture(texture) {
        const format = this._getTextureFormat(texture.format);

        if (texture._gpuTexture && texture._gpuTexture.texture) {
            texture._gpuTexture.texture.destroy();
        }

        const gpuTexture = this.device.createTexture({
            size: [texture.width, texture.height],
            format: format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });

        if (texture.data) {
            const { data, bytesPerRow } = this._padTextureData(texture.data, texture.width, texture.height, texture.format);
            this.device.queue.writeTexture(
                { texture: gpuTexture },
                data,
                { bytesPerRow: bytesPerRow },
                [texture.width, texture.height]
            );
        } else if (texture.image) {
            this.device.queue.copyExternalImageToTexture(
                { source: texture.image },
                { texture: gpuTexture },
                [texture.width, texture.height]
            );
        }

        const view = gpuTexture.createView();
        texture._gpuTexture = { texture: gpuTexture, view: view, format: format };
        texture._needsUpload = false;
        return texture._gpuTexture;
    }

    updateTexture(texture) {
        if (!texture._gpuTexture) return this.createTexture(texture);

        if (texture.data) {
            const { data, bytesPerRow } = this._padTextureData(texture.data, texture.width, texture.height, texture.format);
            this.device.queue.writeTexture(
                { texture: texture._gpuTexture.texture },
                data,
                { bytesPerRow: bytesPerRow },
                [texture.width, texture.height]
            );
        }
        texture._needsUpload = false;
    }

    createBuffer(data, usage = 'static') {
        const isIndexBuffer = data instanceof Uint16Array || data instanceof Uint32Array;
        let gpuUsage = GPUBufferUsage.COPY_DST;
        if (isIndexBuffer) gpuUsage |= GPUBufferUsage.INDEX;
        else gpuUsage |= GPUBufferUsage.VERTEX;

        if (usage === 'uniform') gpuUsage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
        else if (usage === 'storage') gpuUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

        const alignedSize = Math.ceil(data.byteLength / 4) * 4;
        const buffer = this.device.createBuffer({
            size: alignedSize,
            usage: gpuUsage,
            mappedAtCreation: true
        });

        const mapping = new (data.constructor)(buffer.getMappedRange());
        mapping.set(data);
        buffer.unmap();

        return {
            gpuBuffer: buffer,
            size: data.byteLength,
            isIndex: isIndexBuffer,
            elementType: data instanceof Uint32Array ? 'uint32' : data instanceof Uint16Array ? 'uint16' : 'float32'
        };
    }

    updateBuffer(buffer, data, offset = 0) {
        this.device.queue.writeBuffer(buffer.gpuBuffer, offset, data);
    }

    deleteBuffer(buffer) {
        if (buffer && buffer.gpuBuffer) buffer.gpuBuffer.destroy();
    }

    deleteTexture(texture) {
        if (texture._gpuTexture) {
            texture._gpuTexture.texture.destroy();
            texture._gpuTexture = null;
        }
    }

    deleteShader(material) {
        material._gpuPipeline = null;
    }

    _getVertexBufferLayouts(material) {
        if (material.vertexLayout) {
            return material.vertexLayout;
        }

        const vs = material.vertexShader;
        const vertexInputMatch = vs.match(/struct\s+VertexInput\s*\{([^}]*)\}/s);

        if (!vertexInputMatch) {
            console.warn('⚠️ Could not find VertexInput struct, using default layout');
            return this._getDefaultVertexLayout();
        }

        const inputBlock = vertexInputMatch[1];
        const locationRegex = /@location$(\d+)$\s+(\w+)\s*:\s*([^,;\n]+)/g;
        const locations = [];

        let match;
        while ((match = locationRegex.exec(inputBlock)) !== null) {
            const location = parseInt(match[1]);
            const name = match[2];
            const type = match[3].trim();
            locations.push({ location, name, type });
        }

        if (locations.length === 0) {
            console.warn('⚠️ No @location attributes found in VertexInput, using default');
            return this._getDefaultVertexLayout();
        }

        locations.sort((a, b) => a.location - b.location);

        const layouts = [];

        for (const attr of locations) {
            const format = this._getVertexFormat(attr.type);
            const size = this._getVertexSize(attr.type);

            layouts.push({
                arrayStride: size,
                stepMode: 'vertex',
                attributes: [{
                    shaderLocation: attr.location,
                    offset: 0,
                    format: format
                }]
            });
        }

        if (inputBlock.includes('instanceMatrix')) {
            const instanceStartLocation = locations.length;
            layouts.push({
                arrayStride: 64,
                stepMode: 'instance',
                attributes: [
                    { shaderLocation: instanceStartLocation + 0, offset: 0,  format: 'float32x4' },
                    { shaderLocation: instanceStartLocation + 1, offset: 16, format: 'float32x4' },
                    { shaderLocation: instanceStartLocation + 2, offset: 32, format: 'float32x4' },
                    { shaderLocation: instanceStartLocation + 3, offset: 48, format: 'float32x4' },
                ]
            });
        }

        return layouts;
    }

    _getDefaultVertexLayout() {
        return [
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            { arrayStride: 8,  stepMode: 'vertex', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
        ];
    }

    _getVertexFormat(wgslType) {
        const formatMap = {
            'vec3<f32>': 'float32x3',
            'vec2<f32>': 'float32x2',
            'vec4<f32>': 'float32x4',
            'f32': 'float32',
            'vec3<u32>': 'uint32x3',
            'vec2<u32>': 'uint32x2',
            'u32': 'uint32',
            'vec3<i32>': 'sint32x3',
            'vec2<i32>': 'sint32x2',
            'i32': 'sint32',
        };
        return formatMap[wgslType] || 'float32x3';
    }

    _getVertexSize(wgslType) {
        const sizeMap = {
            'vec3<f32>': 12,
            'vec2<f32>': 8,
            'vec4<f32>': 16,
            'f32': 4,
            'vec3<u32>': 12,
            'vec2<u32>': 8,
            'u32': 4,
            'vec3<i32>': 12,
            'vec2<i32>': 8,
            'i32': 4,
        };
        return sizeMap[wgslType] || 12;
    }

// js/renderer/backend/webgpuBackend.js

compileShader(material) {
    // ============================================
    // FIX: Normalize material name for cache key
    // ============================================
    const materialType = (material.name || 'unknown').toLowerCase().trim();
    
    // Extract base type (remove numbers, special chars)
    const baseType = materialType.replace(/[0-9_-]/g, '');
    
    console.log(`🔨 Compiling shader for material: "${material.name}" (type: ${baseType})`);
    
    const layoutKey = material.vertexLayout ? 
        JSON.stringify(material.vertexLayout.map(l => ({ 
            stride: l.arrayStride, 
            step: l.stepMode, 
            attrs: l.attributes.length 
        }))) : 
        'default';
    
    // ============================================
    // CRITICAL: Cache key must include shader hash to prevent collisions
    // ============================================
    const shaderHash = this._hashCode(material.vertexShader.substring(0, 200) + 
                                     material.fragmentShader.substring(0, 200));
    
    const cacheKey = `${baseType}_${shaderHash}_${layoutKey}`;
    
    if (this._pipelineCache.has(cacheKey)) {
        material._gpuPipeline = this._pipelineCache.get(cacheKey);
        material._needsCompile = false;
        console.log(`♻️ Using cached pipeline: ${cacheKey}`);
        return material._gpuPipeline;
    }

    console.log(`🔧 Creating NEW pipeline: ${cacheKey}`);

    const vertexModule = this.device.createShaderModule({ 
        label: `Vertex-${materialType}`, 
        code: material.vertexShader 
    });
    const fragmentModule = this.device.createShaderModule({ 
        label: `Fragment-${materialType}`, 
        code: material.fragmentShader 
    });
    
    // ============================================
    // FIX: Detect material type from shader content
    // ============================================
    const bindGroupLayouts = this._createBindGroupLayouts(material);
    
    console.log(`📐 Bind group layouts for ${materialType}:`, {
        count: bindGroupLayouts.length,
        description: this._describeLayouts(bindGroupLayouts)
    });
    
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts });
    
    const vertexBufferLayouts = material.vertexLayout || this._getVertexBufferLayouts(material);

    try {
        const pipeline = this.device.createRenderPipeline({
            label: material.name || 'Material',
            layout: pipelineLayout,
            vertex: { 
                module: vertexModule, 
                entryPoint: 'main', 
                buffers: vertexBufferLayouts
            },
            fragment: {
                module: fragmentModule, 
                entryPoint: 'main',
                targets: [{
                    format: this.format,
                    blend: material.transparent ? {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                    } : undefined
                }]
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: material.side === 'double' ? 'none' : material.side === 'back' ? 'front' : 'back',
                frontFace: 'ccw'
            },
            depthStencil: material.depthTest ? {
                format: 'depth24plus',
                depthWriteEnabled: material.depthWrite,
                depthCompare: 'less'
            } : undefined
        });

        material._gpuPipeline = { pipeline, bindGroupLayouts, pipelineLayout, vertexBufferLayouts };
        this._pipelineCache.set(cacheKey, material._gpuPipeline);
        material._needsCompile = false;
        
        console.log(`✅ Pipeline created: ${cacheKey}`);
        return material._gpuPipeline;
    } catch (error) {
        console.error(`❌ Pipeline creation failed for ${materialType}:`, error);
        console.error('Vertex shader preview:\n', material.vertexShader.substring(0, 400));
        console.error('Fragment shader preview:\n', material.fragmentShader.substring(0, 400));
        throw error;
    }
}

// ============================================
// HELPER: Simple string hash for cache keys
// ============================================
_hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

// ============================================
// HELPER: Describe layouts for debugging
// ============================================
_describeLayouts(layouts) {
    return layouts.map((layout, i) => {
        const entries = [];
        // Layouts don't have entries property directly, but we created them
        // This is just for logging, return simple count
        return `Group${i}`;
    });
}

    _createOrbitalSphereLayouts() {
        const layouts = [];
        
        // Group 0: Uniforms (vertex + fragment)
        const group0 = this.device.createBindGroupLayout({
            label: 'OrbitalSphere-Group0-Uniforms',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });
        layouts.push(group0);
        
        // Group 1: Texture + Sampler
        const group1 = this.device.createBindGroupLayout({
            label: 'OrbitalSphere-Group1-TextureSampler',
            entries: [
                { 
                    binding: 0, 
                    visibility: GPUShaderStage.FRAGMENT, 
                    texture: { 
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    } 
                },
                { 
                    binding: 1, 
                    visibility: GPUShaderStage.FRAGMENT, 
                    sampler: { 
                        type: 'filtering'
                    } 
                }
            ]
        });
        layouts.push(group1);
        
        console.log('  📋 Orbital layouts created:', {
            group0: 'Uniforms (2 buffers)',
            group1: 'Texture@0 + Sampler@1'
        });
        
        return layouts;
    }
    _createBindGroupLayouts(material) {
        const materialName = (material.name || '').toLowerCase();
        
        console.log(`🔧 Creating bind group layouts for: ${materialName}`);
        
        if (materialName.includes('shadow') || materialName.includes('depth')) {
            console.log('  → Shadow layout');
            return this._createShadowLayouts();
        }
        
        if (materialName.includes('orbital') || materialName.includes('sphere')) {
            console.log('  → Orbital sphere layout');
            return this._createOrbitalSphereLayouts();
        }
        
        // Fallback: Check shader content
        const shaderContent = (material.fragmentShader || '').toLowerCase();
        
        if (shaderContent.includes('planettexture')) {
            console.log('  → Orbital sphere layout (from shader content)');
            return this._createOrbitalSphereLayouts();
        }
        
        console.log('  → Terrain layout');
        return this._createTerrainBindGroupLayouts();
    }


    _createTerrainBindGroupLayouts() {
        const layouts = [];

        // Group 0: Uniforms
        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        }));

        // Group 1: Chunk textures
        const chunkEntries = [];
        for (let i = 0; i < 5; i++) {
            chunkEntries.push({
                binding: i,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'unfilterable-float' }
            });
        }
        layouts.push(this.device.createBindGroupLayout({ entries: chunkEntries }));

        // Group 2: Atlas & Lookups
        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },      // atlasTexture
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },      // level2AtlasTexture
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, // tileTypeLookup
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, // macroTileTypeLookup
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, // numVariantsTex
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } }
            ]
        }));

        // Group 3: Shadows & Clusters
        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }
            ]
        }));
        return layouts;
    }

    _createShadowLayouts() {
        const layouts = [];

        // Group 0: Uniforms only (no fragment uniforms for depth pass)
        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
            ]
        }));

        return layouts;
    }

    _createBindGroups(material, uniforms) {
        const groups = [];

        const materialName = (material.name || '').toLowerCase();

        // ORBITAL SPHERE: Special bind group creation
        if (materialName.includes('orbital') || materialName.includes('sphere')) {
            return this._createOrbitalSphereBindGroups(material, uniforms);
        }

        // TERRAIN: Standard bind group creation
        return this._createTerrainBindGroups(material, uniforms);
    }

    _createOrbitalSphereBindGroups(material, uniforms) {
        const groups = [];
        
        console.log('🔗 Creating orbital sphere bind groups');
        
        // Group 0: Uniforms
        const vertU = this._getOrCreateUniformBuffer('vert_orbital', this._packOrbitalVertexUniforms(uniforms));
        const fragU = this._getOrCreateUniformBuffer('frag_orbital', this._packOrbitalFragmentUniforms(uniforms));
        
        const group0 = this.device.createBindGroup({
            label: 'OrbitalSphere-BindGroup0',
            layout: material._gpuPipeline.bindGroupLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: vertU } },
                { binding: 1, resource: { buffer: fragU } }
            ]
        });
        groups.push(group0);
        
        // Group 1: Texture + Sampler
        const planetTex = uniforms.planetTexture?.value;
        
        if (!planetTex) {
            console.error('❌ No planetTexture uniform found!');
        } else if (!planetTex._gpuTexture) {
            console.error('❌ planetTexture has no GPU texture!');
        }
        
        const textureView = (planetTex && planetTex._gpuTexture && planetTex._gpuTexture.view) 
            ? planetTex._gpuTexture.view 
            : this._getOrCreateDummyTexture().createView();
        
        const sampler = this._samplerCache.get('linear');
        
        console.log('  🖼️ Binding texture:', {
            hasTexture: !!planetTex,
            hasGPUTexture: !!planetTex?._gpuTexture,
            hasView: !!planetTex?._gpuTexture?.view,
            usingDummy: textureView === this._getOrCreateDummyTexture().createView()
        });
        
        const group1 = this.device.createBindGroup({
            label: 'OrbitalSphere-BindGroup1',
            layout: material._gpuPipeline.bindGroupLayouts[1],
            entries: [
                { binding: 0, resource: textureView },
                { binding: 1, resource: sampler }
            ]
        });
        groups.push(group1);
        
        console.log('✅ Orbital sphere bind groups created');
        
        return groups;
    }
    _packOrbitalVertexUniforms(uniforms) {
        const data = new Float32Array(64);
        let offset = 0;

        const writeMat = (m) => {
            if (m?.elements) {
                data.set(m.elements, offset);
            } else {
                data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], offset);
            }
            offset += 16;
        };

        writeMat(uniforms.modelMatrix?.value);
        writeMat(uniforms.viewMatrix?.value);
        writeMat(uniforms.projectionMatrix?.value);

        const origin = uniforms.planetOrigin?.value;
        data[offset++] = origin?.x ?? 0;
        data[offset++] = origin?.y ?? 0;
        data[offset++] = origin?.z ?? 0;
        data[offset++] = uniforms.planetRadius?.value ?? 50000;

        return data;
    }

    _packOrbitalFragmentUniforms(uniforms) {
        const data = new Float32Array(16);
        let offset = 0;

        const sunDir = uniforms.sunDirection?.value;
        data[offset++] = sunDir?.x ?? 0.5;
        data[offset++] = sunDir?.y ?? 0.5;
        data[offset++] = sunDir?.z ?? 0.5;
        data[offset++] = uniforms.opacity?.value ?? 1.0;

        return data;
    }

    _createTerrainBindGroups(material, uniforms) {
        const groups = [];

        // Helper to get texture view
        const getView = (name) => {
            const tex = uniforms[name]?.value;
            if (tex && tex._gpuTexture && tex._gpuTexture.view) {
                return tex._gpuTexture.view;
            }
            return this._getOrCreateDummyTexture().createView();
        };

        // Group 0: Uniforms
        const vertU = this._getOrCreateUniformBuffer('vert', this._packVertexUniforms(uniforms));
        const fragU = this._getOrCreateUniformBuffer('frag', this._packFragmentUniforms(uniforms));
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: vertU } },
                { binding: 1, resource: { buffer: fragU } }
            ]
        }));

        // Group 1: Chunk textures
        const chunkTextureNames = [
            'heightTexture',
            'normalTexture',
            'tileTexture',
            'splatDataMap',
            'macroMaskTexture'
        ];

        const g1Entries = [];
        chunkTextureNames.forEach((name, i) => {
            g1Entries.push({ binding: i, resource: getView(name) });
        });

        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[1],
            entries: g1Entries
        }));

        // Group 2: Atlases & Lookups
        const g2Entries = [
            { binding: 0, resource: getView('atlasTexture') },
            { binding: 1, resource: getView('level2AtlasTexture') },
            { binding: 2, resource: getView('tileTypeLookup') },
            { binding: 3, resource: getView('macroTileTypeLookup') },
            { binding: 4, resource: getView('numVariantsTex') },
            { binding: 5, resource: this._samplerCache.get('linear') },
            { binding: 6, resource: this._samplerCache.get('nearest') }
        ];
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[2],
            entries: g2Entries
        }));

        // Group 3: Shadows & Clusters
        const g3Entries = [
            { binding: 0, resource: getView('shadowMapCascade0') },
            { binding: 1, resource: getView('shadowMapCascade1') },
            { binding: 2, resource: getView('shadowMapCascade2') },
            { binding: 3, resource: this._samplerCache.get('shadow') },
            { binding: 4, resource: getView('clusterDataTexture') },
            { binding: 5, resource: getView('lightDataTexture') },
            { binding: 6, resource: getView('lightIndicesTexture') }
        ];
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[3],
            entries: g3Entries
        }));

        return groups;
    }

    _packVertexUniforms(uniforms) {
        const data = new Float32Array(64);
        let offset = 0;
        const writeMat = (m) => {
            if (m?.elements) data.set(m.elements, offset);
            else data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], offset);
            offset += 16;
        };
        writeMat(uniforms.modelMatrix?.value);
        writeMat(uniforms.viewMatrix?.value);
        writeMat(uniforms.projectionMatrix?.value);

        data[offset++] = uniforms.chunkOffset?.value?.x || 0;
        data[offset++] = uniforms.chunkOffset?.value?.y || 0;
        data[offset++] = uniforms.chunkSize?.value || 128;
        data[offset++] = uniforms.macroScale?.value || 0.1;
        return data;
    }

    _packFragmentUniforms(uniforms) {
        const data = new Float32Array(256);
        let offset = 0;

        data[offset++] = uniforms.chunkOffset?.value?.x || 0; data[offset++] = uniforms.chunkOffset?.value?.y || 0; data[offset++] = uniforms.chunkSize?.value || 128; data[offset++] = uniforms.chunkWidth?.value || 128;
        data[offset++] = uniforms.chunkHeight?.value || 128; data[offset++] = uniforms.tileScale?.value || 1; data[offset++] = uniforms.level2Blend?.value || 0.7; data[offset++] = uniforms.macroScale?.value || 0.1;
        data[offset++] = uniforms.currentSeason?.value || 0; data[offset++] = uniforms.nextSeason?.value || 1; data[offset++] = uniforms.seasonTransition?.value || 0; data[offset++] = uniforms.maxTileTypes?.value || 256;
        data[offset++] = uniforms.lodLevel?.value || 0; data[offset++] = uniforms.geometryLOD?.value || 0; data[offset++] = uniforms.splatLODBias?.value || 0; data[offset++] = uniforms.macroLODBias?.value || 0;
        data[offset++] = uniforms.detailFade?.value || 1; data[offset++] = uniforms.enableSplatLayer?.value || 1; data[offset++] = uniforms.enableMacroLayer?.value || 1; data[offset++] = uniforms.enableClusteredLights?.value || 1;

        const sunColor = uniforms.sunLightColor?.value; data[offset++] = sunColor?.r ?? 1; data[offset++] = sunColor?.g ?? 1; data[offset++] = sunColor?.b ?? 1; data[offset++] = uniforms.sunLightIntensity?.value ?? 1;
        const sunDir = uniforms.sunLightDirection?.value; data[offset++] = sunDir?.x ?? 0; data[offset++] = sunDir?.y ?? 1; data[offset++] = sunDir?.z ?? 0; data[offset++] = 0;
        const moonColor = uniforms.moonLightColor?.value; data[offset++] = moonColor?.r ?? 1; data[offset++] = moonColor?.g ?? 1; data[offset++] = moonColor?.b ?? 1; data[offset++] = uniforms.moonLightIntensity?.value ?? 0.2;
        const moonDir = uniforms.moonLightDirection?.value; data[offset++] = moonDir?.x ?? 0; data[offset++] = moonDir?.y ?? 1; data[offset++] = moonDir?.z ?? 0; data[offset++] = 0;
        const ambColor = uniforms.ambientLightColor?.value; data[offset++] = ambColor?.r ?? 0.2; data[offset++] = ambColor?.g ?? 0.2; data[offset++] = ambColor?.b ?? 0.2; data[offset++] = uniforms.ambientLightIntensity?.value ?? 0.5;
        const skyColor = uniforms.skyAmbientColor?.value; data[offset++] = skyColor?.r ?? 0.5; data[offset++] = skyColor?.g ?? 0.7; data[offset++] = skyColor?.b ?? 1.0; data[offset++] = 0;
        const gndColor = uniforms.groundAmbientColor?.value; data[offset++] = gndColor?.r ?? 0.2; data[offset++] = gndColor?.g ?? 0.2; data[offset++] = gndColor?.b ?? 0.2; data[offset++] = 0;
        const fogColor = uniforms.fogColor?.value; data[offset++] = fogColor?.r ?? 0.7; data[offset++] = fogColor?.g ?? 0.7; data[offset++] = fogColor?.b ?? 0.7; data[offset++] = uniforms.fogDensity?.value ?? 0.005;
        const camPos = uniforms.cameraPosition?.value; data[offset++] = camPos?.x ?? 0; data[offset++] = camPos?.y ?? 0; data[offset++] = camPos?.z ?? 0; data[offset++] = uniforms.cameraNear?.value ?? 0.1;
        data[offset++] = uniforms.cameraFar?.value ?? 1000; data[offset++] = uniforms.thunderLightIntensity?.value ?? 0; data[offset++] = uniforms.weatherIntensity?.value ?? 0; data[offset++] = uniforms.currentWeather?.value ?? 0;
        const thunColor = uniforms.thunderLightColor?.value; data[offset++] = thunColor?.r ?? 1; data[offset++] = thunColor?.g ?? 1; data[offset++] = thunColor?.b ?? 1; data[offset++] = 0;
        const plyColor = uniforms.playerLightColor?.value; data[offset++] = plyColor?.r ?? 1; data[offset++] = plyColor?.g ?? 1; data[offset++] = plyColor?.b ?? 1; data[offset++] = uniforms.playerLightIntensity?.value ?? 0;
        const plyPos = uniforms.playerLightPosition?.value; data[offset++] = plyPos?.x ?? 0; data[offset++] = plyPos?.y ?? 0; data[offset++] = plyPos?.z ?? 0; data[offset++] = uniforms.playerLightDistance?.value ?? 10;
        data[offset++] = uniforms.receiveShadow?.value ?? 1; data[offset++] = uniforms.isFeature?.value ?? 0; data[offset++] = uniforms.numCascades?.value ?? 3; data[offset++] = uniforms.shadowBias?.value ?? 0.0001;
        data[offset++] = uniforms.shadowNormalBias?.value ?? 0.1; data[offset++] = uniforms.shadowMapSize?.value ?? 2048; data[offset++] = 0; data[offset++] = 0;
        const splits = uniforms.cascadeSplits?.value; data[offset++] = splits?.x ?? 0; data[offset++] = splits?.y ?? 0; data[offset++] = splits?.z ?? 0; data[offset++] = 0;
        const cDims = uniforms.clusterDimensions?.value; data[offset++] = cDims?.x ?? 1; data[offset++] = cDims?.y ?? 1; data[offset++] = cDims?.z ?? 1; data[offset++] = uniforms.numLights?.value ?? 0;
        const atlasSize = uniforms.atlasTextureSize?.value; data[offset++] = atlasSize?.x ?? 1024; data[offset++] = atlasSize?.y ?? 1024;
        const l2Size = uniforms.level2AtlasTextureSize?.value; data[offset++] = l2Size?.x ?? 1024; data[offset++] = l2Size?.y ?? 1024;

        const writeMat = (m) => { if (m?.elements) { for(let i=0;i<16;i++) data[offset++] = m.elements[i]; } else { const id=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; for(let i=0;i<16;i++) data[offset++] = id[i]; } };
        writeMat(uniforms.shadowMatrixCascade0?.value); writeMat(uniforms.shadowMatrixCascade1?.value); writeMat(uniforms.shadowMatrixCascade2?.value);

        return data;
    }

    _getOrCreateBuffer(name, data) { return this._getOrCreateUniformBuffer(name, data); }

    _getOrCreateUniformBuffer(name, data) {
        const alignedSize = Math.ceil(data.byteLength / 256) * 256;
        const key = name;
        let record = this._bufferCache.get(key);
        if (!record || record.size < alignedSize) {
            if (record) record.gpuBuffer.destroy();
            const buffer = this.device.createBuffer({ size: alignedSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            record = { gpuBuffer: buffer, size: alignedSize };
            this._bufferCache.set(key, record);
        }
        this.device.queue.writeBuffer(record.gpuBuffer, 0, data);
        return record.gpuBuffer;
    }

    _ensureTexturesUploaded(uniforms) {
        const check = (name) => {
            const tex = uniforms[name]?.value;
            if (!tex) return;
    
            // ============================================
            // FIX: Check if texture already has GPU resources
            // (either created directly or uploaded previously)
            // ============================================
            if (tex._gpuTexture && tex._gpuTexture.texture && tex._gpuTexture.view) {
                // Texture is already on GPU - either GPU-only or previously uploaded
                // No action needed
                return;
            }
    
            // ============================================
            // Only upload if we have CPU data and need upload
            // ============================================
            if (tex._needsUpload && (tex.data || tex.image)) {
                this.updateTexture(tex);
            } else if (!tex._gpuTexture) {
                // Texture has no GPU resource and no way to create one
                console.warn(`⚠️ Texture ${name} missing GPU resource and CPU data`);
            }
        };
    
        ['heightTexture', 'normalTexture', 'tileTexture', 'splatDataMap', 'macroMaskTexture'].forEach(check);
        ['atlasTexture', 'level2AtlasTexture', 'tileTypeLookup', 'macroTileTypeLookup', 'numVariantsTex'].forEach(check);
        ['shadowMapCascade0', 'shadowMapCascade1', 'shadowMapCascade2',
         'clusterDataTexture', 'lightDataTexture', 'lightIndicesTexture'].forEach(check);
        ['planetTexture'].forEach(check);
    }

    draw(geometry, material, uniforms = {}) {
        if (!this._renderPassEncoder) this.clear(true, true, false);
        if (material._needsCompile || !material._gpuPipeline) this.compileShader(material);

        const allUniforms = { ...material.uniforms, ...uniforms };
        this._ensureTexturesUploaded(allUniforms);

        this._renderPassEncoder.setPipeline(material._gpuPipeline.pipeline);

        const bindGroups = this._createBindGroups(material, allUniforms);
        bindGroups.forEach((bg, i) => this._renderPassEncoder.setBindGroup(i, bg));

        const setVBuf = (slot, attr) => {
            if (attr) {
                const buf = this._getOrCreateAttributeBuffer(geometry, attr.data);
                this._renderPassEncoder.setVertexBuffer(slot, buf.gpuBuffer);
            }
        };
        setVBuf(0, geometry.attributes.get('position'));
        setVBuf(1, geometry.attributes.get('normal'));
        setVBuf(2, geometry.attributes.get('uv'));

        // Handle Instance Matrix Buffers
        if (material.vertexShader.includes('instanceMatrix') || material.vertexShader.includes('@location(4)')) {
            const instanceMatrix = geometry.attributes.get('instanceMatrix');
            if (instanceMatrix) {
                const buf = this._getOrCreateAttributeBuffer(geometry, instanceMatrix.data);
                const isShadow = material.vertexShader.includes('SHADOW_DEPTH_SHADER') || (!material.vertexShader.includes('vUv'));
                const startSlot = isShadow ? 1 : 3;
                this._renderPassEncoder.setVertexBuffer(startSlot, buf.gpuBuffer);
            }
        }

        // Safe Draw Count (Handle Zero/Infinity)
        let count = geometry.drawRange.count;
        if (count === Infinity) {
            if (geometry.index) count = geometry.index.count;
            else if (geometry.attributes.get('position')) count = geometry.attributes.get('position').count;
            else count = 0;
        }

        // Guard against 0 vertex draws
        if (count === 0) return;

        if (geometry.index) {
            const iBuf = this._getOrCreateAttributeBuffer(geometry, geometry.index.data, true);
            this._renderPassEncoder.setIndexBuffer(iBuf.gpuBuffer, geometry.index.data instanceof Uint32Array ? 'uint32' : 'uint16');
            this._renderPassEncoder.drawIndexed(count, 1, geometry.drawRange.start, 0, 0);
        } else {
            this._renderPassEncoder.draw(count, 1, geometry.drawRange.start, 0);
        }
    }

    _getOrCreateAttributeBuffer(geometry, data, isIndex = false) {
        return this.createBuffer(data, isIndex ? 'index' : 'vertex');
    }

    setRenderTarget(rt) {
        this._endCurrentRenderPass();
        if (rt) {
             if (!rt._gpuRenderTarget || rt._needsSetup) this.createRenderTarget(rt);
             this._currentRenderTarget = rt;
        } else {
            this._currentRenderTarget = null;
        }
    }

    createRenderTarget(rt) {
        const createView = (tex) => {
            if (!tex._gpuTexture) this.createTexture(tex);
            return tex._gpuTexture.view;
        };
        const cViews = rt.colorAttachments.map(createView);
        let dView = null;
        if (rt.depthAttachment) dView = createView(rt.depthAttachment);
        else if (rt._depthBuffer) {
             const dTex = this.device.createTexture({ size: [rt.width, rt.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
             dView = dTex.createView();
             rt._gpuRenderTarget = { colorViews: cViews, depthView: dView, depthTexture: dTex };
             return;
        }
        rt._gpuRenderTarget = { colorViews: cViews, depthView: dView };
    }

    deleteRenderTarget(rt) {
        if (rt._gpuRenderTarget?.depthTexture) rt._gpuRenderTarget.depthTexture.destroy();
        rt._gpuRenderTarget = null;
    }

    clear(color=true, depth=true) {
        this._ensureCommandEncoder();
        const colorAttachments = [];
        const depthAttachment = {
            view: this._currentRenderTarget ? this._currentRenderTarget._gpuRenderTarget.depthView : this._depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: depth ? 'clear' : 'load',
            depthStoreOp: 'store'
        };

        if (this._currentRenderTarget) {
            this._currentRenderTarget._gpuRenderTarget.colorViews.forEach(view => {
                colorAttachments.push({
                    view, clearValue: this._clearColor, loadOp: color ? 'clear' : 'load', storeOp: 'store'
                });
            });
        } else {
            colorAttachments.push({
                view: this.context.getCurrentTexture().createView(),
                clearValue: this._clearColor, loadOp: color ? 'clear' : 'load', storeOp: 'store'
            });
        }

        this._renderPassEncoder = this._commandEncoder.beginRenderPass({
            colorAttachments, depthStencilAttachment: depthAttachment
        });
        this._renderPassEncoder.setViewport(this._viewport.x, this._viewport.y, this._viewport.width, this._viewport.height, 0, 1);
    }

    _ensureCommandEncoder() {
        if (!this._commandEncoder) this._commandEncoder = this.device.createCommandEncoder();
    }

    _endCurrentRenderPass() {
        if (this._renderPassEncoder) {
            this._renderPassEncoder.end();
            this._renderPassEncoder = null;
        }
    }

    submitCommands() {
        this._endCurrentRenderPass();
        if (this._commandEncoder) {
            this.device.queue.submit([this._commandEncoder.finish()]);
            this._commandEncoder = null;
        }
    }

    readPixels() {
        console.warn("Async readPixels not implemented in sync path");
        return new Float32Array(0);
    }

    setClearColor(r,g,b,a) {
        this._clearColor = {r,g,b,a};
    }

    setViewport(x,y,w,h) {
        this._viewport = {x,y,width:w,height:h};
        if (w !== this._depthTexture.width || h !== this._depthTexture.height) this._createDepthTexture();
    }

    _getBytesPerPixel(format) {
        const map = {
            [TextureFormat.RGBA8]: 4,
            [TextureFormat.RGBA16F]: 8,
            [TextureFormat.RGBA32F]: 16,
            [TextureFormat.R8]: 1,
            [TextureFormat.R16F]: 2,
            [TextureFormat.R32F]: 4
        };
        return map[format] || 4;
    }

    _getTextureFormat(fmt) {
        const map = {
            [TextureFormat.RGBA8]: 'rgba8unorm',
            [TextureFormat.RGBA16F]: 'rgba16float',
            [TextureFormat.RGBA32F]: 'rgba32float',
            [TextureFormat.R8]: 'r8unorm',
            [TextureFormat.R16F]: 'r16float',
            [TextureFormat.R32F]: 'r32float',
            [TextureFormat.DEPTH24]: 'depth24plus',
            [TextureFormat.DEPTH32F]: 'depth32float'
        };
        return map[fmt] || 'rgba8unorm';
    }

    getAPIName() {
        return 'webgpu';
    }

    dispose() {
        // Cleanup resources
        if (this._depthTexture) {
            this._depthTexture.destroy();
            this._depthTexture = null;
        }

        if (this._dummyTexture) {
            this._dummyTexture.destroy();
            this._dummyTexture = null;
        }

        // Clear caches
        for (const buffer of this._bufferCache.values()) {
            if (buffer.gpuBuffer) buffer.gpuBuffer.destroy();
        }
        this._bufferCache.clear();

        for (const sampler of this._samplerCache.values()) {
            // Samplers don't need explicit destruction
        }
        this._samplerCache.clear();

        this._pipelineCache.clear();
        this._bindGroupLayoutCache.clear();

        console.log('WebGPUBackend disposed');
    }
}