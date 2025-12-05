
import { TEXTURE_CONFIG } from "../atlasConfig.js";
import { SEASONS } from "../TileConfig.js";

export function getAllProceduralVariantsForLevel(level) {
    const variants = [];

    for (const entry of TEXTURE_CONFIG) {
        if (!entry.textures?.base) continue;

        for (const season of Object.values(SEASONS)) {
            const seasonCfg = entry.textures.base[season];
            if (!seasonCfg || !seasonCfg[level]) continue;

            const layerSets = seasonCfg[level];
            for (let variantIdx = 0; variantIdx < layerSets.length; variantIdx++) {
                variants.push({
                    tileType: entry.id,
                    season,
                    variant: variantIdx,
                    level,
                    layers: layerSets[variantIdx],
                });
            }
        }
    }

    console.log(`getAllProceduralVariantsForLevel(${level}): ${variants.length} variants`);
    return variants;
}

export class ProceduralTextureGenerator {
    constructor(device, width = 128, height = 128) {
        this.device = device;
        this.width = width;
        this.height = height;
        this.layers = [];
        this.initialized = false;

        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    async initialize() {
        if (this.initialized) return;

        this.outputTexture = this.device.createTexture({
            size: [this.width, this.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_SRC |
                   GPUTextureUsage.TEXTURE_BINDING
        });

        this.uniformBuffer = this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        await this._createPipelines();
        this.initialized = true;
    }

    async _createPipelines() {
        const noiseShader = this._createNoiseShader();
        this.noiseModule = this.device.createShaderModule({
            label: 'Procedural Noise Shader',
            code: noiseShader
        });

        const info = await this.noiseModule.getCompilationInfo();
        if (info.messages.length > 0) {
            for (const msg of info.messages) {
                if (msg.type === 'error') {
                    console.error('Noise shader error:', msg.message);
                }
            }
        }

        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: 'rgba8unorm',
                        viewDimension: '2d'
                    }
                }
            ]
        });

        this.pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout]
        });

        this.noisePipeline = this.device.createComputePipeline({
            layout: this.pipelineLayout,
            compute: {
                module: this.noiseModule,
                entryPoint: 'main'
            }
        });
    }

    _createNoiseShader() {
        return `
struct Uniforms {
    resolution: vec2<f32>,
    seed: f32,
    noiseType: i32,
    octaves: i32,
    frequency: f32,
    amplitude: f32,
    persistence: f32,
    rotation: f32,
    turbulencePower: f32,
    ridgeOffset: f32,
    warpStrength: f32,
    warpFrequency: f32,
    cellScale: f32,
    cellRandomness: f32,
    cellElongation: f32,
    _pad: f32,
    cellStretch: vec2<f32>,
    color: vec3<f32>,
    _pad2: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn rand(p: vec2<f32>) -> f32 {
    let pm = p % 2048.0;
    let s = sin(pm.x * 127.1 + pm.y * 311.7 + (uniforms.seed * 13.13) % 2048.0) * 43758.5453123;
    return fract(s);
}

fn smoothstep_cpu(a: f32, b: f32, t: f32) -> f32 {
    let x = clamp((t - a) / (b - a), 0.0, 1.0);
    return x * x * (3.0 - 2.0 * x);
}

fn valueNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);

    let u = smoothstep_cpu(0.0, 1.0, f.x);
    let v = smoothstep_cpu(0.0, 1.0, f.y);

    let a = rand(i);
    let b = rand(i + vec2<f32>(1.0, 0.0));
    let c = rand(i + vec2<f32>(0.0, 1.0));
    let d = rand(i + vec2<f32>(1.0, 1.0));

    let val = mix(mix(a, b, u), mix(c, d, u), v);
    return val * 2.0 - 1.0;
}

fn fbm(p: vec2<f32>, oct: i32, persistence: f32) -> f32 {
    var value = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var maxv = 0.0;

    for (var i = 0; i < 16; i++) {
        if (i >= oct) { break; }
        value += amp * valueNoise(p * freq + vec2<f32>(uniforms.seed));
        maxv += amp;
        amp *= persistence;
        freq *= 2.0;
    }
    return value / maxv;
}

fn turbulence(p: vec2<f32>, oct: i32, persistence: f32, power: f32) -> f32 {
    var v = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var maxv = 0.0;

    for (var i = 0; i < 16; i++) {
        if (i >= oct) { break; }
        let n = valueNoise(p * freq + vec2<f32>(uniforms.seed * 100.0));
        v += pow(abs(n), power) * amp;
        maxv += amp;
        amp *= persistence;
        freq *= 2.0;
    }
    return clamp(v / maxv, 0.0, 1.0);
}

fn ridged(p: vec2<f32>, oct: i32, persistence: f32, offset: f32) -> f32 {
    var v = 0.0;
    var amp = 1.0;
    var freq = 1.0;
    var maxv = 0.0;

    for (var i = 0; i < 16; i++) {
        if (i >= oct) { break; }
        var n = abs(valueNoise(p * freq + vec2<f32>(uniforms.seed * 200.0)));
        n = offset - n;
        n = n * n;
        v += n * amp;
        maxv += amp;
        amp *= persistence;
        freq *= 2.0;
    }
    return clamp(v / maxv, 0.0, 1.0);
}

fn voronoi(p: vec2<f32>, randomness: f32) -> f32 {
    let i = floor(p);
    var minD = 1e6;
    for (var j = -1; j <= 1; j++) {
        for (var i2 = -1; i2 <= 1; i2++) {
            let neighbor = vec2<f32>(f32(i2), f32(j));
            let point = vec2<f32>(
                hash12(i + neighbor + vec2<f32>(12.34 * uniforms.seed)),
                hash12(i + neighbor + vec2<f32>(56.78 * uniforms.seed))
            );
            let pointJittered = 0.5 + 0.5 * sin(point * randomness * 6.2831853);
            let diff = neighbor + pointJittered - fract(p);
            minD = min(minD, length(diff));
        }
    }
    return minD;
}

fn cellPattern(p: vec2<f32>, scale: f32, randomness: f32, elongation: f32, stretch: vec2<f32>) -> f32 {
    let pScaled = p * stretch * scale;
    let i = floor(pScaled);
    var min1 = 1e6;
    var min2 = 1e6;

    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let nb = vec2<f32>(f32(x), f32(y));
            let pt = vec2<f32>(hash12(i + nb), hash12(i + nb + vec2<f32>(5.3)));
            let ptJittered = 0.5 + 0.5 * sin(pt * randomness * 6.2831853);
            let diff = nb + ptJittered - fract(pScaled);
            let dist = length(diff);
            if (dist < min1) {
                min2 = min1;
                min1 = dist;
            } else if (dist < min2) {
                min2 = dist;
            }
        }
    }
    let cell = min2 - min1;
    return smoothstep(elongation - 0.1, elongation + 0.1, cell);
}

fn rotateCoord(uv: vec2<f32>, ang: f32) -> vec2<f32> {
    let center = uniforms.resolution * 0.5;
    var p = uv * uniforms.resolution - center;
    let c = cos(ang);
    let s = sin(ang);
    p = vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
    return (p + center) / uniforms.resolution;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let texSize = textureDimensions(outputTexture);
    if (global_id.x >= texSize.x || global_id.y >= texSize.y) {
        return;
    }

    var coord = vec2<f32>(f32(global_id.x), f32(global_id.y));
    let v_uv = coord / uniforms.resolution;

    if (uniforms.rotation != 0.0) {
        coord = rotateCoord(v_uv, uniforms.rotation) * uniforms.resolution;
    }

    let maxDim = max(uniforms.resolution.x, uniforms.resolution.y);
    let px = coord.x / maxDim;
    let py = coord.y / maxDim;

    let nx = px * uniforms.frequency * uniforms.resolution.x + uniforms.seed;
    let ny = py * uniforms.frequency * uniforms.resolution.y + uniforms.seed;
    var p = vec2<f32>(nx, ny);

    if (uniforms.warpStrength > 0.0) {
        let q = vec2<f32>(
            fbm(p * uniforms.warpFrequency, 3, 0.5),
            fbm(p * uniforms.warpFrequency + vec2<f32>(5.2, 1.3), 3, 0.5)
        );
        p = p + q * uniforms.warpStrength;
    }

    var val = 0.0;

    if (uniforms.noiseType == 0) {
        val = valueNoise(p);
        val = (val + 1.0) * 0.5;
    } else if (uniforms.noiseType == 1) {
        val = fbm(p, uniforms.octaves, uniforms.persistence);
        val = (val + 1.0) * 0.5;
    } else if (uniforms.noiseType == 2) {
        val = turbulence(p, uniforms.octaves, uniforms.persistence, uniforms.turbulencePower);
    } else if (uniforms.noiseType == 3) {
        val = ridged(p, uniforms.octaves, uniforms.persistence, uniforms.ridgeOffset);
    } else if (uniforms.noiseType == 4) {
        val = voronoi(p * uniforms.cellScale, uniforms.cellRandomness);
    } else if (uniforms.noiseType == 5) {
        val = cellPattern(p, uniforms.cellScale, uniforms.cellRandomness, uniforms.cellElongation, uniforms.cellStretch);
    }

    val = clamp(val * uniforms.amplitude, 0.0, 1.0);
    let outColor = vec4<f32>(val * uniforms.color, 1.0);

    textureStore(outputTexture, vec2<i32>(global_id.xy), outColor);
}
`;
    }

    addLayer(config) {
        this.layers.push(Object.assign({}, config));
    }

    removeLayer(idx) {
        this.layers.splice(idx, 1);
    }

    clearLayers() {
        this.layers.length = 0;
    }

    async generate() {
        if (!this.initialized) {
            await this.initialize();
        }

        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = 'black';

        for (const layer of this.layers) {
            if (layer.type === 'fill') {
                this.ctx.fillStyle = layer.color || '#ffffff';
                this.ctx.globalAlpha = layer.opacity || 1.0;
                this.ctx.fillRect(0, 0, this.width, this.height);
                this.ctx.globalAlpha = 1.0;
                continue;
            }

            if (layer.type === 'leaf_cluster_mask') {
                const maskCanvas = this._generateLeafClusterMask(layer);
                this._compositeLayerCanvas(maskCanvas, layer);
                continue;
            }

            if (layer.type === 'custom_leaf_shape') {
                const leafCanvas = this._generateLeafShapeCPU(layer);
                this._compositeLayerCanvas(leafCanvas, layer);
                continue;
            }

            if (layer.type === 'grass_billboard') {
                const billboardCanvas = this._generateGrassBillboard(layer);
                this._compositeLayerCanvas(billboardCanvas, layer);
                continue;
            }

            if (layer.type === 'horizontal_dashes') {
                const dashCanvas = this._generateDashesCPU(layer);
                this._compositeLayerCanvas(dashCanvas, layer);
                continue;
            }

            await this._renderNoiseLayer(layer);
            await this._compositeGPUToCanvas(layer);
        }

        return this.canvas;
    }

    async _renderNoiseLayer(layer) {
        const uniformData = new ArrayBuffer(256);
        const view = new DataView(uniformData);
    
        // Offsets 0-63 stay the same...
        view.setFloat32(0, this.width, true);
        view.setFloat32(4, this.height, true);
        view.setFloat32(8, layer.seed || 0, true);
        view.setInt32(12, this._noiseTypeIndex(layer.type), true);
    
        view.setInt32(16, layer.octaves || 4, true);
        view.setFloat32(20, layer.frequency || 0.01, true);
        view.setFloat32(24, layer.amplitude || 1.0, true);
        view.setFloat32(28, layer.persistence || 0.5, true);
    
        view.setFloat32(32, (layer.rotation || 0) * Math.PI / 180, true);
        view.setFloat32(36, layer.turbulencePower || 1.0, true);
        view.setFloat32(40, layer.ridgeOffset || 0.5, true);
        view.setFloat32(44, layer.domainWarp ? (layer.warpStrength || 0) : 0, true);
    
        view.setFloat32(48, layer.warpFrequency || 0.02, true);
        view.setFloat32(52, layer.cellScale || 1.0, true);
        view.setFloat32(56, layer.cellRandomness || 1.0, true);
        view.setFloat32(60, layer.cellElongation || 0.5, true);
    
        // offset 64: _pad (can skip or set to 0)
        view.setFloat32(64, 0.0, true);
        
        // offset 68: implicit padding (skip)
        const stretch = layer.cellStretch || [1.0, 1.0];
        view.setFloat32(72, stretch[0], true);  // cellStretch.x at 72
        view.setFloat32(76, stretch[1], true);  // cellStretch.y at 76
    
        const { r, g, b } = this._hexToRgb(layer.color || '#ffffff');
        view.setFloat32(80, r / 255, true);     // color.r at 80
        view.setFloat32(84, g / 255, true);     // color.g at 84
        view.setFloat32(88, b / 255, true);     // color.b at 88
    
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.outputTexture.createView() }
            ]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();

        passEncoder.setPipeline(this.noisePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(this.width / 8),
            Math.ceil(this.height / 8)
        );
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
    }

    async _compositeGPUToCanvas(layer) {
        const bytesPerRow = Math.ceil(this.width * 4 / 256) * 256;
        const bufferSize = bytesPerRow * this.height;

        const readBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            { texture: this.outputTexture },
            { buffer: readBuffer, bytesPerRow: bytesPerRow },
            [this.width, this.height]
        );

        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = readBuffer.getMappedRange();

        const data = new Uint8ClampedArray(this.width * this.height * 4);
        const src = new Uint8Array(arrayBuffer);

        for (let y = 0; y < this.height; y++) {
            const srcRowStart = y * bytesPerRow;
            const dstRowStart = y * this.width * 4;
            for (let x = 0; x < this.width * 4; x++) {
                data[dstRowStart + x] = src[srcRowStart + x];
            }
        }

        readBuffer.unmap();
        readBuffer.destroy();
        
        // === DIAGNOSTIC: Sample first 32 pixels ===
        const samplePixels = [];
        for (let i = 0; i < 32; i++) {
            const r = data[i * 4 + 0];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const a = data[i * 4 + 3];
            samplePixels.push(`[${r},${g},${b},${a}]`);
        }
        console.log('WebGPU readback first 32 pixels:', samplePixels.slice(0, 8).join(' '));
        console.log(`   Dimensions: ${this.width}x${this.height}, bytesPerRow: ${bytesPerRow} (padded from ${this.width * 4})`);
        
        const imageData = new ImageData(data, this.width, this.height);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.width;
        tempCanvas.height = this.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        this._compositeLayerCanvas(tempCanvas, layer);
    }

    _compositeLayerCanvas(layerCanvas, layer) {
        const ctx = this.ctx;
        const prevGlobalCompositeOperation = ctx.globalCompositeOperation;
        const prevAlpha = ctx.globalAlpha;

        ctx.globalAlpha = (typeof layer.opacity === 'number') ? layer.opacity : 1.0;
        ctx.globalCompositeOperation = this._blendModeToCompositeOp(layer.blendMode);

        ctx.drawImage(layerCanvas, 0, 0, this.width, this.height);

        ctx.globalCompositeOperation = prevGlobalCompositeOperation;
        ctx.globalAlpha = prevAlpha;
    }

    _generateLeafClusterMask(layer) {
        const c = document.createElement('canvas');
        c.width = this.width;
        c.height = this.height;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, this.width, this.height);

        const clusterCount = layer.clusterCount ?? 6;
        const minScale = layer.minScale ?? 0.5;
        const maxScale = layer.maxScale ?? 1.0;

        for (let i = 0; i < clusterCount; i++) {
            const scale = minScale + Math.random() * (maxScale - minScale);
            const w = this.width * 0.25 * scale;
            const h = this.height * 0.33 * scale;
            const cx = Math.random() * this.width;
            const cy = Math.random() * this.height;
            const rotation = (Math.random() - 0.5) * Math.PI * 0.8;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rotation);

            ctx.beginPath();
            ctx.moveTo(0, -h);
            for (let t = 0; t <= 20; t++) {
                const tt = t / 20;
                const bx = -w * Math.sin(tt * Math.PI) * (1 - tt * 0.3);
                const by = -h + h * 1.8 * tt;
                ctx.lineTo(bx, by);
            }
            for (let t = 20; t >= 0; t--) {
                const tt = t / 20;
                const bx = w * Math.sin(tt * Math.PI) * (1 - tt * 0.3);
                const by = -h + h * 1.8 * tt;
                ctx.lineTo(bx, by);
            }
            ctx.closePath();

            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h));
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.8, 'rgba(255,255,255,1)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fill();

            ctx.restore();
        }

        return c;
    }

    _generateLeafShapeCPU(layer) {
        const c = document.createElement('canvas');
        c.width = this.width;
        c.height = this.height;
        const ctx = c.getContext('2d');

        ctx.clearRect(0, 0, this.width, this.height);

        const shape = layer.shape || 'oak';
        ctx.fillStyle = 'rgba(255,255,255,1)';

        if (shape === 'birch') {
            for (let i = 0; i < 4; i++) {
                const scale = 0.6 + Math.random() * 0.4;
                const w = this.width * 0.3 * scale;
                const h = this.height * 0.45 * scale;
                const cx = this.width / 2 + (Math.random() - 0.5) * this.width * 0.25;
                const cy = this.height / 2 + (Math.random() - 0.5) * this.height * 0.25;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((Math.random() - 0.5) * 0.8);
                ctx.beginPath();
                ctx.moveTo(0, -h);
                for (let t = 0; t <= 20; t++) {
                    const tt = t / 20;
                    const bx = -w * Math.sin(tt * Math.PI) * (1 - tt * 0.3);
                    const by = -h + h * 1.8 * tt;
                    ctx.lineTo(bx, by);
                }
                for (let t = 20; t >= 0; t--) {
                    const tt = t / 20;
                    const bx = w * Math.sin(tt * Math.PI) * (1 - tt * 0.3);
                    const by = -h + h * 1.8 * tt;
                    ctx.lineTo(bx, by);
                }
                ctx.closePath();
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h));
                g.addColorStop(0, 'rgba(255,255,255,1)');
                g.addColorStop(0.8, 'rgba(255,255,255,1)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.fill();
                ctx.restore();
            }
        } else {
            ctx.beginPath();
            ctx.ellipse(this.width / 2, this.height / 2, this.width * 0.35, this.height * 0.4, 0, 0, Math.PI * 2);
            const g = ctx.createRadialGradient(this.width / 2, this.height / 2, 0, this.width / 2, this.height / 2, Math.max(this.width, this.height));
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.8, 'rgba(255,255,255,1)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fill();
        }

        return c;
    }

    _generateDashesCPU(layer) {
        const c = document.createElement('canvas');
        c.width = this.width;
        c.height = this.height;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, this.width, this.height);

        const density = layer.density ?? 0.15;
        const minWidth = layer.minWidth ?? 0.15;
        const maxWidth = layer.maxWidth ?? 0.35;
        const minHeight = layer.minHeight ?? 0.02;
        const maxHeight = layer.maxHeight ?? 0.06;
        const seed = layer.seed ?? 0;
        const { r, g, b } = this._hexToRgb(layer.color || '#2a2a2a');

        const referenceSize = 128;
        const sizeScale = (this.width * this.height) / (referenceSize * referenceSize);
        const numDashes = Math.min(256, Math.floor(density * 100 * sizeScale));

        const rand = (x, y, seedOffset) => {
            const pm_x = x % 2048.0;
            const pm_y = y % 2048.0;
            const s = Math.sin(pm_x * 127.1 + pm_y * 311.7 + ((seed + seedOffset) * 13.13) % 2048.0) * 43758.5453123;
            return s - Math.floor(s);
        };

        for (let i = 0; i < numDashes; i++) {
            const x = rand(i, 0, 1) * this.width;
            const y = rand(i, 1, 2) * this.height;
            const w = (minWidth + rand(i, 2, 3) * (maxWidth - minWidth)) * this.width;
            const h = (minHeight + rand(i, 3, 4) * (maxHeight - minHeight)) * this.height;
            const rotation = (rand(i, 4, 5) - 0.5) * 0.2;
            const alpha = 0.5 + rand(i, 12, 13) * 0.5;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.globalAlpha = 1.0;
        return c;
    }

    _generateGrassBillboard(layer) {
        const c = document.createElement('canvas');
        c.width = this.width;
        c.height = this.height;
        const ctx = c.getContext('2d');

        ctx.clearRect(0, 0, this.width, this.height);

        const grassType = layer.grassType || 'meadow';
        const height = layer.height || 0.6;
        const density = layer.density || 'medium';
        const seed = layer.seed || 12345;

        let rngSeed = seed;
        const seededRandom = () => {
            rngSeed = (rngSeed * 9301 + 49297) % 233280;
            return rngSeed / 233280;
        };

        const grassColors = this._getGrassColors(grassType);
        const densityMap = { 'high': 25, 'medium': 15, 'low': 8 };
        const bladeCount = densityMap[density] || 15;

        for (let i = 0; i < bladeCount; i++) {
            this._drawGrassBlade(ctx, {
                x: seededRandom() * this.width,
                y: this.height * 0.8 + seededRandom() * this.height * 0.2,
                height: height * this.height * (0.7 + seededRandom() * 0.6),
                width: 2 + seededRandom() * 4,
                bend: (seededRandom() - 0.5) * 0.3,
                color: grassColors[Math.floor(seededRandom() * grassColors.length)],
                rng: seededRandom
            });
        }

        return c;
    }

    _getGrassColors(grassType) {
        const colorSets = {
            meadow: ['#4a7c2a', '#5a8c3a', '#6fa040', '#3d6b25'],
            tall: ['#3d6b25', '#2d5b15', '#5d8b35', '#4a7c2a'],
            short: ['#4f7d30', '#6f9d50', '#7fa055', '#5a8c3a'],
            wild: ['#456728', '#65873a', '#6b4423', '#4a7c2a']
        };
        return colorSets[grassType] || colorSets.meadow;
    }

    _drawGrassBlade(ctx, params) {
        const { x, y, height, width, bend, color, rng } = params;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(x, y);

        const segments = 4;
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const bendAmount = bend * t * t;
            const segmentX = x + bendAmount * height * 0.3;
            const segmentY = y - (height * t);

            const variation = (rng() - 0.5) * width * 0.3;

            if (i === segments) {
                ctx.lineWidth = width * 0.3;
            }

            ctx.lineTo(segmentX + variation, segmentY);
        }

        ctx.stroke();
        ctx.restore();
    }

    _noiseTypeIndex(type) {
        const map = {
            perlin: 0,
            fbm: 1,
            turbulence: 2,
            ridged: 3,
            voronoi: 4,
            cells: 5
        };
        return map[type] ?? 1;
    }

    _hexToRgb(hex) {
        const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#ffffff');
        if (!res) return { r: 255, g: 255, b: 255 };
        return {
            r: parseInt(res[1], 16),
            g: parseInt(res[2], 16),
            b: parseInt(res[3], 16)
        };
    }

    _blendModeToCompositeOp(mode) {
        switch ((mode || 'normal')) {
            case 'multiply': return 'multiply';
            case 'screen': return 'screen';
            case 'overlay': return 'overlay';
            case 'lighter': return 'lighter';
            case 'destination-in': return 'destination-in';
            case 'source-in': return 'source-in';
            default: return 'source-over';
        }
    }

    dispose() {
        if (this.outputTexture) {
            this.outputTexture.destroy();
        }
        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
        }
        this.layers = [];
        this.ctx = null;
        this.canvas = null;
    }
}
