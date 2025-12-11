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

    _packAtmosphereUniforms(uniforms) {
        const data = new Float32Array(16);

        data[0] = uniforms.atmospherePlanetRadius?.value ?? 50000;
        data[1] = uniforms.atmosphereRadius?.value ?? 55000;
        data[2] = uniforms.atmosphereScaleHeightRayleigh?.value ?? 800;
        data[3] = uniforms.atmosphereScaleHeightMie?.value ?? 120;

        const rayleigh = uniforms.atmosphereRayleighScattering?.value;
        data[4] = rayleigh?.x ?? 5.5e-5;
        data[5] = rayleigh?.y ?? 13.0e-5;
        data[6] = rayleigh?.z ?? 22.4e-5;
        data[7] = uniforms.atmosphereMieScattering?.value ?? 21e-5;

        const ozone = uniforms.atmosphereOzoneAbsorption?.value;
        data[8] = ozone?.x ?? 0.65e-6;
        data[9] = ozone?.y ?? 1.881e-6;
        data[10] = ozone?.z ?? 0.085e-6;
        data[11] = uniforms.atmosphereMieAnisotropy?.value ?? 0.8;

        data[12] = uniforms.atmosphereGroundAlbedo?.value ?? 0.3;
        data[13] = uniforms.atmosphereSunIntensity?.value ?? 20.0;
        data[14] = uniforms.viewerAltitude?.value ?? 0.0;
        data[15] = 0.0;

        return data;
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

    createStorageTexture(width, height, format) {
        const gpuFormat = this._getTextureFormat({ format });

        const texture = this.device.createTexture({
            size: [width, height],
            format: gpuFormat,
            usage: GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.TEXTURE_BINDING |
                   GPUTextureUsage.COPY_SRC
        });

        return {
            texture: texture,
            view: texture.createView(),
            format: gpuFormat,
            width: width,
            height: height
        };
    }

    deleteStorageTexture(gpuTexture) {
        if (gpuTexture && gpuTexture.texture) {
            gpuTexture.texture.destroy();
        }
    }

    createComputePipeline(descriptor) {
        const shaderModule = this.device.createShaderModule({
            label: descriptor.label || 'Compute Shader',
            code: descriptor.shaderSource
        });

        const bindGroupLayoutEntries = descriptor.bindGroupLayouts[0].entries.map(entry => {
            const layoutEntry = {
                binding: entry.binding,
                visibility: GPUShaderStage.COMPUTE
            };

            if (entry.type === 'uniform') {
                layoutEntry.buffer = { type: 'uniform' };
            } else if (entry.type === 'storageTexture') {
                layoutEntry.storageTexture = {
                    access: entry.access === 'read' ? 'read-only' : 'write-only',
                    format: entry.format,
                    viewDimension: '2d'
                };
            } else if (entry.type === 'texture') {
                layoutEntry.texture = { sampleType: 'float' };
            } else if (entry.type === 'sampler') {
                layoutEntry.sampler = { type: 'filtering' };
            }

            return layoutEntry;
        });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: bindGroupLayoutEntries
        });

        const pipeline = this.device.createComputePipeline({
            label: descriptor.label,
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout]
            }),
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });

        return { pipeline, bindGroupLayout };
    }

    createBindGroup(layout, entries) {
        const bindGroupEntries = entries.map(entry => {
            const bgEntry = { binding: entry.binding };

            if (entry.resource.gpuBuffer) {
                bgEntry.resource = { buffer: entry.resource.gpuBuffer };
            } else if (entry.resource.view) {
                bgEntry.resource = entry.resource.view;
            } else if (entry.resource.texture) {
                bgEntry.resource = entry.resource.texture.createView();
            } else {
                bgEntry.resource = entry.resource;
            }

            return bgEntry;
        });

        return this.device.createBindGroup({
            layout: layout,
            entries: bindGroupEntries
        });
    }

    dispatchCompute(pipeline, bindGroup, workgroupsX, workgroupsY = 1, workgroupsZ = 1) {
        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();

        computePass.setPipeline(pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);

        computePass.end();
        this.device.queue.submit([commandEncoder.finish()]);
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
            console.warn('Warning: Could not find VertexInput struct, using default layout');
            return this._getDefaultVertexLayout();
        }

        const inputBlock = vertexInputMatch[1];
        const locationRegex = /@location\((\d+)\)\s+(\w+)\s*:\s*([^,;\n]+)/g;
        const locations = [];

        let match;
        while ((match = locationRegex.exec(inputBlock)) !== null) {
            const location = parseInt(match[1]);
            const name = match[2];
            const type = match[3].trim();
            locations.push({ location, name, type });
        }

        if (locations.length === 0) {
            console.warn('Warning: No @location attributes found in VertexInput, using default');
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

    compileShader(material) {
        const materialType = (material.name || 'unknown').toLowerCase().trim();
        const baseType = materialType.replace(/[0-9_-]/g, '');

        console.log(`Compiling shader for material: "${material.name}" (type: ${baseType})`);

        const layoutVersion = materialType.includes('terrain') ? 'v16' : 'v1';
        const layoutKeyRaw = material.vertexLayout ?
            JSON.stringify(material.vertexLayout.map(l => ({
                stride: l.arrayStride,
                step: l.stepMode,
                attrs: l.attributes.length
            }))) :
            `default_${layoutVersion}`;
        const layoutKey = materialType.includes('terrain')
            ? `${layoutKeyRaw}_v${layoutVersion}`
            : layoutKeyRaw;

        const shaderHash = this._hashCode(material.vertexShader.substring(0, 200) +
                                         material.fragmentShader.substring(0, 200));

        const cacheKey = `${baseType}_${shaderHash}_${layoutKey}`;

        if (this._pipelineCache.has(cacheKey)) {
            material._gpuPipeline = this._pipelineCache.get(cacheKey);
            material._needsCompile = false;
            console.log(`Using cached pipeline: ${cacheKey}`);
            return material._gpuPipeline;
        }

        console.log(`Creating NEW pipeline: ${cacheKey}`);

        const vertexModule = this.device.createShaderModule({
            label: `Vertex-${materialType}`,
            code: material.vertexShader
        });
        const fragmentModule = this.device.createShaderModule({
            label: `Fragment-${materialType}`,
            code: material.fragmentShader
        });

        const bindGroupLayouts = this._createBindGroupLayouts(material);

        console.log(`Bind group layouts for ${materialType}:`, {
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

            console.log(`Pipeline created: ${cacheKey}`);
            return material._gpuPipeline;
        } catch (error) {
            console.error(`Pipeline creation failed for ${materialType}:`, error);
            console.error('Vertex shader preview:\n', material.vertexShader.substring(0, 400));
            console.error('Fragment shader preview:\n', material.fragmentShader.substring(0, 400));
            throw error;
        }
    }

    _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    _describeLayouts(layouts) {
        return layouts.map((layout, i) => `Group${i}`);
    }

    _createOrbitalSphereLayouts() {
        const layouts = [];

        const group0 = this.device.createBindGroupLayout({
            label: 'OrbitalSphere-Group0-Uniforms',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });
        layouts.push(group0);

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

        console.log('  Orbital layouts created:', {
            group0: 'Uniforms (2 buffers)',
            group1: 'Texture@0 + Sampler@1'
        });

        return layouts;
    }

    _createBindGroupLayouts(material) {
        const materialName = (material.name || '').toLowerCase();

        console.log(`Creating bind group layouts for: ${materialName}`);

        if (materialName.includes('shadow') || materialName.includes('depth')) {
            console.log('  -> Shadow layout');
            return this._createShadowLayouts();
        }

        if (materialName.includes('orbital') || materialName.includes('sphere')) {
            console.log('  -> Orbital sphere layout');
            return this._createOrbitalSphereLayouts();
        }

        if (material.bindGroupLayoutSpec) {
            return this._buildLayoutsFromSpec(material.bindGroupLayoutSpec);
        }

        const shaderContent = (material.fragmentShader || '').toLowerCase();

        if (shaderContent.includes('planettexture')) {
            console.log('  -> Orbital sphere layout (from shader content)');
            return this._createOrbitalSphereLayouts();
        }

        console.log('  -> Terrain layout');
        return this._createTerrainBindGroupLayouts();
    }

    _createTerrainBindGroupLayouts() {
        const layouts = [];

        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        }));

        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }
            ]
        }));

        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
            ]
        }));

        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
            ]
        }));

        return layouts;
    }

    _createShadowLayouts() {
        const layouts = [];
        layouts.push(this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
            ]
        }));
        return layouts;
    }

    _buildLayoutsFromSpec(spec) {
        return spec.map((group, idx) => this.device.createBindGroupLayout({
            label: group.label || `CustomGroup${idx}`,
            entries: group.entries.map(e => ({
                binding: e.binding,
                visibility: this._mapVisibility(e.visibility),
                buffer: e.buffer,
                sampler: e.sampler,
                texture: e.texture
            }))
        }));
    }

    _mapVisibility(v) {
        if (!v) return GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        if (typeof v === 'number') return v;
        const parts = Array.isArray(v) ? v : v.toString().toLowerCase().split('|');
        let mask = 0;
        for (const p of parts) {
            if (p.includes('vertex')) mask |= GPUShaderStage.VERTEX;
            if (p.includes('fragment')) mask |= GPUShaderStage.FRAGMENT;
            if (p.includes('compute')) mask |= GPUShaderStage.COMPUTE;
        }
        return mask || (GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT);
    }

    _createBindGroups(material, uniforms) {
        const groups = [];
        const materialName = (material.name || '').toLowerCase();

        if (materialName.includes('instanceddebug') && material.bindGroupLayoutSpec) {
            const packed = this._packDebugUniforms(uniforms);
            const buf = this._getOrCreateUniformBuffer(`instanced_${material.id}`, packed);
            groups.push(this.device.createBindGroup({
                layout: material._gpuPipeline.bindGroupLayouts[0],
                entries: [{ binding: 0, resource: { buffer: buf } }]
            }));
            return groups;
        }

        if (material.bindGroupLayoutSpec && !materialName.includes('orbital') && !materialName.includes('sphere')) {
            return this._createBindGroupsFromSpec(material, uniforms);
        }

        if (materialName.includes('orbital') || materialName.includes('sphere')) {
            return this._createOrbitalSphereBindGroups(material, uniforms);
        }

        return this._createTerrainBindGroups(material, uniforms);
    }

    _createBindGroupsFromSpec(material, uniforms) {
        const groups = [];

        const resolveSampler = (name, samplerDesc) => {
            const explicit = (uniforms[name]?.value ?? uniforms[name]);
            if (explicit && this._samplerCache.has(explicit)) return this._samplerCache.get(explicit);
            if (samplerDesc?.type === 'nearest') return this._samplerCache.get('nearest');
            if (samplerDesc?.type === 'shadow') return this._samplerCache.get('shadow');
            if (samplerDesc?.type === 'non-filtering') return this._samplerCache.get('nearest');
            return this._samplerCache.get('linear');
        };

        material.bindGroupLayoutSpec.forEach((groupSpec, gi) => {
            const entries = [];

            for (const entry of groupSpec.entries) {
                const name = entry.name || entry.label || `binding${entry.binding}`;
                if (entry.buffer) {
                    const data = this._resolveUniformData(uniforms, name);
                    const buf = this._getOrCreateUniformBuffer(`${material.id}_g${gi}_b${entry.binding}`, data);
                    entries.push({ binding: entry.binding, resource: { buffer: buf } });
                } else if (entry.texture) {
                    const tex = this._resolveUniformTexture(uniforms, name);
                    const view = tex?._gpuTexture?.view || this._getOrCreateDummyTexture().createView();
                    entries.push({ binding: entry.binding, resource: view });
                } else if (entry.sampler) {
                    entries.push({ binding: entry.binding, resource: resolveSampler(name, entry.sampler) });
                }
            }

            groups.push(this.device.createBindGroup({
                layout: material._gpuPipeline.bindGroupLayouts[gi],
                entries
            }));
        });

        return groups;
    }

    _resolveUniformData(uniforms, name) {
        let data = name ? (uniforms[name]?.value ?? uniforms[name]) : null;
        if (data instanceof Float32Array) return data;
        if (data?.elements) return new Float32Array(data.elements);
        if (Array.isArray(data)) return new Float32Array(data);
        if (typeof data === 'number') return new Float32Array([data, 0, 0, 0]);
        return new Float32Array(16);
    }

    _resolveUniformTexture(uniforms, name) {
        const tex = name ? (uniforms[name]?.value ?? uniforms[name]) : null;
        if (tex && tex._gpuTexture) return tex;
        return tex;
    }

    _createOrbitalSphereBindGroups(material, uniforms) {
        const groups = [];

        console.log('Creating orbital sphere bind groups');

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

        const planetTex = uniforms.planetTexture?.value;

        if (!planetTex) {
            console.error('No planetTexture uniform found!');
        } else if (!planetTex._gpuTexture) {
            console.error('planetTexture has no GPU texture!');
        }

        const textureView = (planetTex && planetTex._gpuTexture && planetTex._gpuTexture.view)
            ? planetTex._gpuTexture.view
            : this._getOrCreateDummyTexture().createView();

        const sampler = this._samplerCache.get('linear');

        console.log('  Binding texture:', {
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

        console.log('Orbital sphere bind groups created');

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

        const getView = (name) => {
            const tex = uniforms[name]?.value;
            if (tex && tex._gpuTexture && tex._gpuTexture.view) {
                return tex._gpuTexture.view;
            }
            return this._getOrCreateDummyTexture().createView();
        };

        const vertKey = `vert_${material.id}`;
        const fragKey = `frag_${material.id}`;
        const vertU = this._getOrCreateUniformBuffer(vertKey, this._packVertexUniforms(uniforms));
        const fragU = this._getOrCreateUniformBuffer(fragKey, this._packFragmentUniforms(uniforms));
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[0],
            entries: [
                { binding: 0, resource: { buffer: vertU } },
                { binding: 1, resource: { buffer: fragU } }
            ]
        }));

        const chunkTextureNames = ['heightTexture', 'normalTexture', 'tileTexture', 'splatDataMap', 'macroMaskTexture'];
        const g1Entries = chunkTextureNames.map((name, i) => ({ binding: i, resource: getView(name) }));
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[1],
            entries: g1Entries
        }));

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

        const g3Entries = [
            { binding: 7, resource: getView('transmittanceLUT') },
            { binding: 8, resource: this._samplerCache.get('linear') }
        ];
        groups.push(this.device.createBindGroup({
            layout: material._gpuPipeline.bindGroupLayouts[3],
            entries: g3Entries
        }));

        return groups;
    }

    _packVertexUniforms(uniforms) {
        // Fixed-size packing for terrain uniforms (80 floats / 320 bytes), including useInstancing slot
        const buffer = new ArrayBuffer(80 * 4);
        const data = new Float32Array(buffer);
        const intView = new Int32Array(buffer);
        let offset = 0;

        const writeMat = (m) => {
            if (m && m.elements) {
                data.set(m.elements, offset);
            } else {
                data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], offset);
            }
            offset += 16;
        };

        writeMat(uniforms.modelMatrix?.value);
        writeMat(uniforms.viewMatrix?.value);
        writeMat(uniforms.projectionMatrix?.value);

        data[offset++] = uniforms.chunkOffset?.value?.x || 0;
        data[offset++] = uniforms.chunkOffset?.value?.y || 0;
        data[offset++] = uniforms.chunkSize?.value || 128;
        data[offset++] = uniforms.macroScale?.value || 0.1;

        data[offset++] = uniforms.planetRadius?.value || 50000;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;

        const origin = uniforms.planetOrigin?.value;
        data[offset++] = origin?.x || 0;
        data[offset++] = origin?.y || 0;
        data[offset++] = origin?.z || 0;
        data[offset++] = 0;

        intView[offset] = (uniforms.chunkFace?.value ?? -1);
        offset++;
        data[offset++] = 0;
        data[offset++] = uniforms.chunkLocation?.value?.x || 0;
        data[offset++] = uniforms.chunkLocation?.value?.y || 0;
        data[offset++] = uniforms.chunkSizeUV?.value || 0.0625;

        data[offset++] = uniforms.useAtlasMode?.value || 0;
        data[offset++] = uniforms.atlasUVOffset?.value?.x || 0;
        data[offset++] = uniforms.atlasUVOffset?.value?.y || 0;
        data[offset++] = uniforms.atlasUVScale?.value || 1.0;
        data[offset++] = uniforms.useInstancing?.value || 0;

        data[offset++] = uniforms.heightScale?.value || 50.0;
        const atlasSizeVal = uniforms.atlasTextureSize?.value;
        data[offset++] = typeof atlasSizeVal === 'object' ? (atlasSizeVal?.x || atlasSizeVal?.width || 129) : (atlasSizeVal || 129);
        data[offset++] = 0;
        data[offset++] = 0;

        return data;
    }

    _packFragmentUniforms(uniforms) {
        const buf = new ArrayBuffer(512);
        const f32 = new Float32Array(buf);
        const i32 = new Int32Array(buf);

        const cam = uniforms.cameraPosition?.value;
        f32[0] = cam?.x ?? 0;
        f32[1] = cam?.y ?? 0;
        f32[2] = cam?.z ?? 0;
        f32[3] = uniforms.time?.value ?? 0;

        f32[4] = uniforms.chunkOffset?.value?.x ?? 0;
        f32[5] = uniforms.chunkOffset?.value?.y ?? 0;
        f32[6] = uniforms.chunkWidth?.value ?? uniforms.chunkSize?.value ?? 128;
        f32[7] = uniforms.chunkHeight?.value ?? uniforms.chunkSize?.value ?? 128;

        const sunDir = uniforms.sunLightDirection?.value;
        f32[8] = sunDir?.x ?? 0;
        f32[9] = sunDir?.y ?? 1;
        f32[10] = sunDir?.z ?? 0;
        f32[11] = 0;

        const sunCol = uniforms.sunLightColor?.value;
        f32[12] = sunCol?.r ?? 1;
        f32[13] = sunCol?.g ?? 1;
        f32[14] = sunCol?.b ?? 1;
        f32[15] = 0;

        const amb = uniforms.ambientLightColor?.value;
        f32[16] = amb?.r ?? 0.3;
        f32[17] = amb?.g ?? 0.3;
        f32[18] = amb?.b ?? 0.4;
        f32[19] = uniforms.enableSplatLayer?.value ?? 1;

        f32[20] = uniforms.enableMacroLayer?.value ?? 1;
        i32[21] = uniforms.geometryLOD?.value ?? 0;
        i32[22] = uniforms.currentSeason?.value ?? 0;
        i32[23] = uniforms.nextSeason?.value ?? 1;

        f32[24] = uniforms.seasonTransition?.value ?? 0;
        const atlasSize = uniforms.atlasTextureSize?.value;
        f32[25] = typeof atlasSize === 'object' ? (atlasSize?.x ?? atlasSize?.width ?? 1024) : (atlasSize ?? 1024);
        f32[26] = 0;
        f32[27] = 0;

        const atlasOffset = uniforms.atlasUVOffset?.value;
        f32[28] = atlasOffset?.x ?? 0;
        f32[29] = atlasOffset?.y ?? 0;
        f32[30] = uniforms.atlasUVScale?.value ?? 1;
        i32[31] = uniforms.useAtlasMode?.value ?? 0;

        f32[32] = uniforms.isFeature?.value ?? 0;
        f32[33] = uniforms.aerialPerspectiveEnabled?.value ?? 1.0;
        f32[34] = 0;
        f32[35] = 0;

        const planetCenter = uniforms.planetCenter?.value;
        f32[36] = planetCenter?.x ?? 0;
        f32[37] = planetCenter?.y ?? 0;
        f32[38] = planetCenter?.z ?? 0;
        f32[39] = uniforms.atmospherePlanetRadius?.value ?? 50000;

        f32[40] = uniforms.atmosphereRadius?.value ?? 60000;
        f32[41] = uniforms.atmosphereScaleHeightRayleigh?.value ?? 800;
        f32[42] = uniforms.atmosphereScaleHeightMie?.value ?? 120;
        f32[43] = uniforms.atmosphereMieAnisotropy?.value ?? 0.8;

        const rayleigh = uniforms.atmosphereRayleighScattering?.value;
        f32[44] = rayleigh?.x ?? 5.5e-5;
        f32[45] = rayleigh?.y ?? 13.0e-5;
        f32[46] = rayleigh?.z ?? 22.4e-5;
        f32[47] = uniforms.atmosphereMieScattering?.value ?? 21e-5;

        f32[48] = uniforms.atmosphereSunIntensity?.value ?? 20.0;
        f32[49] = 0;
        f32[50] = 0;
        f32[51] = 0;

        return f32;
    }

    _packDebugUniforms(uniforms) {
        const data = new Float32Array(32);
        let offset = 0;
        const writeMat = (m) => {
            if (m?.elements) data.set(m.elements, offset);
            else data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], offset);
            offset += 16;
        };
        writeMat(uniforms.viewMatrix?.value);
        writeMat(uniforms.projectionMatrix?.value);
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
        const skip = new Set([
            'clusterDataTexture',
            'lightDataTexture',
            'lightIndicesTexture',
            'shadowMapCascade0',
            'shadowMapCascade1',
            'shadowMapCascade2'
        ]);

        const check = (name) => {
            if (skip.has(name)) return;
            const tex = uniforms[name]?.value;
            if (!tex) return;

            if (tex._gpuTexture && tex._gpuTexture.texture && tex._gpuTexture.view) {
                return;
            }

            if (tex._needsUpload && (tex.data || tex.image)) {
                this.updateTexture(tex);
            } else if (!tex._gpuTexture) {
                console.warn(`Warning: Texture ${name} missing GPU resource and CPU data`);
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

        for (const [name, attr] of geometry.attributes) {
            if (attr.stepMode === 'instance' && attr.slot !== undefined) {
                setVBuf(attr.slot, attr);
            }
        }

        if (material.vertexShader.includes('instanceMatrix') || material.vertexShader.includes('@location(4)')) {
            const instanceMatrix = geometry.attributes.get('instanceMatrix');
            if (instanceMatrix) {
                const buf = this._getOrCreateAttributeBuffer(geometry, instanceMatrix.data);
                const isShadow = material.vertexShader.includes('SHADOW_DEPTH_SHADER') || (!material.vertexShader.includes('vUv'));
                const startSlot = isShadow ? 1 : 3;
                this._renderPassEncoder.setVertexBuffer(startSlot, buf.gpuBuffer);
            }
        }

        let count = geometry.drawRange.count;
        if (count === Infinity) {
            if (geometry.index) count = geometry.index.count;
            else if (geometry.attributes.get('position')) count = geometry.attributes.get('position').count;
            else count = 0;
        }

        if (count === 0) return;

        const instanceCount = geometry.instanceCount || 1;

        if (geometry.index) {
            const iBuf = this._getOrCreateAttributeBuffer(geometry, geometry.index.data, true);
            this._renderPassEncoder.setIndexBuffer(iBuf.gpuBuffer, geometry.index.data instanceof Uint32Array ? 'uint32' : 'uint16');
            this._renderPassEncoder.drawIndexed(count, instanceCount, geometry.drawRange.start, 0, 0);
        } else {
            this._renderPassEncoder.draw(count, instanceCount, geometry.drawRange.start, 0);
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
        const key = typeof fmt === 'string' ? fmt : fmt?.format;
        const map = {
            [TextureFormat.RGBA8]: 'rgba8unorm',
            [TextureFormat.RGBA16F]: 'rgba16float',
            [TextureFormat.RGBA32F]: 'rgba32float',
            [TextureFormat.R8]: 'r8unorm',
            [TextureFormat.R16F]: 'r16float',
            [TextureFormat.R32F]: 'r32float',
            [TextureFormat.DEPTH24]: 'depth24plus',
            [TextureFormat.DEPTH32F]: 'depth32float',
            'rgba16float': 'rgba16float',
            'rgba16f': 'rgba16float'
        };
        return map[key] || 'rgba8unorm';
    }

    getAPIName() {
        return 'webgpu';
    }

    dispose() {
        if (this._depthTexture) {
            this._depthTexture.destroy();
            this._depthTexture = null;
        }

        if (this._dummyTexture) {
            this._dummyTexture.destroy();
            this._dummyTexture = null;
        }

        for (const buffer of this._bufferCache.values()) {
            if (buffer.gpuBuffer) buffer.gpuBuffer.destroy();
        }
        this._bufferCache.clear();

        this._samplerCache.clear();
        this._pipelineCache.clear();
        this._bindGroupLayoutCache.clear();

        console.log('WebGPUBackend disposed');
    }
}
