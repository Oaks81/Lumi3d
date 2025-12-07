import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { Texture, TextureFormat, TextureFilter, TextureWrap } from '../resources/texture.js';

const DEFAULT_DIMS = { x: 24, y: 16, z: 24 };

/**
 * Lightweight froxel volume for weather / clouds.
 * The volume is stored as a 2D texture atlas (slices stacked vertically)
 * so it can be sampled in both WebGL2 and WebGPU without needing 3D textures.
 * Channels:
 *  R = fog density   (0..1 relative)
 *  G = low cloud density (cumulus/stratus)
 *  B = high cloud density (cirrus)
 *  A = light factor (sun visibility / brightness hint)
 */
export class FroxelGrid {
    constructor(backend, dimensions = DEFAULT_DIMS, options = {}) {
        this.backend = backend;
        this.dimensions = {
            x: dimensions.x || DEFAULT_DIMS.x,
            y: dimensions.y || DEFAULT_DIMS.y,
            z: dimensions.z || DEFAULT_DIMS.z
        };

        this.volumeSize = options.volumeSize || new THREE.Vector3(8000, 4000, 12000);
        this.maxDistance = options.maxDistance || this.volumeSize.z;
        this.baseFogDensity = options.baseFogDensity || 0.00008;
        this.seed = options.seed || 1337;

        const texHeight = this.dimensions.y * this.dimensions.z;
        this.data = new Float32Array(this.dimensions.x * texHeight * 4);
        this.texture = new Texture({
            width: this.dimensions.x,
            height: texHeight,
            format: TextureFormat.RGBA16F,
            minFilter: TextureFilter.NEAREST,
            magFilter: TextureFilter.NEAREST,
            wrapS: TextureWrap.CLAMP,
            wrapT: TextureWrap.CLAMP,
            generateMipmaps: false,
            data: this.data
        });

        this._tempVec = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
        this._forward = new THREE.Vector3(0, 0, -1);
        this._lastUploadFrame = -1;
    }

    getTexture() {
        return this.texture;
    }

    /**
     * Update froxel density values from camera + weather state.
     */
    update(camera, environmentState, uniformManager, timeSec = 0, frame = 0) {
        if (!camera) return;

        const dims = this.dimensions;
        const texHeight = dims.y * dims.z;
        if (this.data.length !== dims.x * texHeight * 4) {
            this.data = new Float32Array(dims.x * texHeight * 4);
            this.texture.setData(this.data, dims.x, texHeight);
        }

        // Build camera basis (view-space)
        const target = camera.target || new THREE.Vector3().copy(camera.position).add(new THREE.Vector3(0, 0, -1));
        this._forward.subVectors(target, camera.position).normalize();
        if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
        this._right.crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();
        this._up.crossVectors(this._right, this._forward).normalize();

        const fogScaleHeight = uniformManager?.uniforms?.fogScaleHeight?.value || 1200;
        const fogBase = environmentState?.fogDensity ?? uniformManager?.uniforms?.fogDensity?.value ?? this.baseFogDensity;
        const weatherIntensity = environmentState?.weatherIntensity ?? 0.0;
        const currentWeather = environmentState?.currentWeather || 'clear';

        const coverage = this._computeCoverage(currentWeather, weatherIntensity);
        const sunDir = (environmentState?.sunLightDirection || uniformManager?.uniforms?.sunLightDirection?.value || new THREE.Vector3(0.5, 1, 0.3)).clone().normalize();

        let index = 0;
        for (let z = 0; z < dims.z; z++) {
            const dist = this.maxDistance * (z + 0.5) / dims.z;
            for (let y = 0; y < dims.y; y++) {
                const heightOffset = (y / (dims.y - 1) - 0.5) * this.volumeSize.y;
                for (let x = 0; x < dims.x; x++, index += 4) {
                    const lateralX = (x / (dims.x - 1) - 0.5) * this.volumeSize.x;

                    const worldPos = this._tempVec
                        .copy(camera.position)
                        .addScaledVector(this._right, lateralX)
                        .addScaledVector(this._up, heightOffset)
                        .addScaledVector(this._forward, dist);

                    const altitude = worldPos.y;
                    const fogDensity = fogBase * Math.exp(-Math.max(0, altitude) / fogScaleHeight);

                    const sample = this._sampleNoise(x, y, z, timeSec);
                    const lowCloud = this._shapeCumulus(sample.low, altitude, coverage.low);
                    const highCloud = this._shapeCirrus(sample.high, altitude, coverage.high);

                    const light = Math.max(0.05, sunDir.dot(this._up) * 0.5 + 0.5);

                    this.data[index + 0] = fogDensity * 200.0; // normalized for shader
                    this.data[index + 1] = lowCloud;
                    this.data[index + 2] = highCloud;
                    this.data[index + 3] = light;
                }
            }
        }

        this.texture.setData(this.data, dims.x, texHeight);
        this.texture._needsUpload = true;
        this._lastUploadFrame = frame;
    }

    _computeCoverage(weather, intensity) {
        const clamped = Math.min(Math.max(intensity || 0, 0), 1);
        let low = 0.18;
        let high = 0.25;
        switch (weather) {
            case 'storm':
                low = 0.75 * clamped + 0.35;
                high = 0.45 * clamped + 0.2;
                break;
            case 'rain':
                low = 0.55 * clamped + 0.25;
                high = 0.35 * clamped + 0.2;
                break;
            case 'foggy':
                low = 0.35 * clamped + 0.2;
                high = 0.4 * clamped + 0.25;
                break;
            case 'snow':
                low = 0.45 * clamped + 0.2;
                high = 0.3 * clamped + 0.2;
                break;
            default:
                low = 0.15 + 0.25 * clamped;
                high = 0.2 + 0.25 * clamped;
                break;
        }
        return { low, high };
    }

    getCoverageForWeather(weather, intensity) {
        return this._computeCoverage(weather, intensity);
    }

    _shapeCumulus(noiseVal, altitude, coverage) {
        // Cumulus sit low (0-2.5 km)
        const heightFade = this._smoothstep(0, 2500, altitude);
        const softness = 0.25;
        const density = Math.max(0, noiseVal * coverage - softness) * (1.0 - heightFade);
        return density;
    }

    _shapeCirrus(noiseVal, altitude, coverage) {
        // Cirrus sit high (4-8 km)
        const start = 3500;
        const end = 9000;
        const heightFadeIn = this._smoothstep(start - 500, start + 500, altitude);
        const heightFadeOut = 1.0 - this._smoothstep(end, end + 1500, altitude);
        const weight = Math.max(0, heightFadeIn * heightFadeOut);
        const density = Math.max(0, noiseVal * coverage * 0.8 - 0.1);
        return density * weight;
    }

    _sampleNoise(x, y, z, timeSec) {
        const base = this._hashNoise(x, y, z, this.seed);
        const w0 = this._hashNoise(x + 13, y + 37, z + 71, this.seed + 19);
        const t = timeSec * 0.25;
        const anim = this._hashNoise(x + t * 3, y + t * 5, z + t * 7, this.seed + 101);

        const low = this._fbm(base, anim, 0.6);
        const high = this._fbm(w0, anim * 0.7, 0.45);
        return { low, high };
    }

    _fbm(a, b, weight = 0.5) {
        const f1 = a;
        const f2 = b;
        const f3 = this._lerp(a, b, 0.5);
        return (f1 + f2 + f3 * 0.5) * weight;
    }

    _hashNoise(x, y, z, seed = 1) {
        // Deterministic pseudo-noise in [0,1]
        const n = x * 15731 + y * 789221 + z * 1376312589 + seed * 11;
        let r = (n << 13) ^ n;
        r = (r * (r * r * 15731 + 789221) + 1376312589) & 0x7fffffff;
        return 0.5 + (r / 1073741824.0) * 0.5;
    }

    _smoothstep(a, b, x) {
        const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.0001, b - a)));
        return t * t * (3 - 2 * t);
    }

    _lerp(a, b, t) { return a + (b - a) * t; }
}
