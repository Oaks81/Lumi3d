import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TEXTURE_LEVELS, ATLAS_CONFIG, TextureConfigHelper, SEASONS, TILE_CONFIG } from './TileConfig.js';
import { Texture, TextureFormat, TextureFilter, TextureWrap } from '../renderer/resources/texture.js';

function stableStringify(obj) {
    if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
    } else if (obj && typeof obj === 'object') {
        return '{' + Object.keys(obj).sort().map(
            key => `"${key}":${stableStringify(obj[key])}`
        ).join(',') + '}';
    } else {
        return JSON.stringify(obj);
    }
}

function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
}

function getLayerConfigHash(layers) {
    const stable = stableStringify(layers) + (layers?.[0]?.uniqueId || '');
    return djb2Hash(stable).toString(36);
}

export class TextureAtlasManager {
    constructor(enableDebug = false, apiName = 'webgl2', gpuDevice = null) {
        this.apiName = apiName;
        this.gpuDevice = gpuDevice;
        this._backend = null; // NEW: Store backend reference
        this.atlases = new Map();
        this.textureLoader = new THREE.TextureLoader();
        this.currentSeason = SEASONS.SUMMER;
        this.PADDING = 32;

        this._uvCache = new Map();
        this._textureGeneratorModule = null;
        this._initialized = false;

        Object.values(TEXTURE_LEVELS).forEach(level => {
            this.atlases.set(level, {
                texture: null,
                canvas: null,
                context: null,
                layout: null,
                textureMap: new Map(),
                seasonalTextureMap: new Map(),
            });
        });
        
        this.loaded = false;
        window.SEASONS = SEASONS;
        window.ATLAS = this;
        window.TEXTURE_LEVELS = TEXTURE_LEVELS;
        
        this.lookupTables = {
            tileTypeLookup: null,
            macroTileTypeLookup: null,
            numVariantsTex: null
        };

        this._lookupTablesReady = false;
        
        console.log(`TextureAtlasManager created for API: ${this.apiName}`);
    }

    set backend(value) {
        this._backend = value;
        console.log(` Backend set on TextureAtlasManager (${this.apiName})`);
        
        // If lookup tables exist but weren't uploaded, upload them now
        if (this._lookupTablesReady && this.lookupTables.tileTypeLookup && !this.lookupTables.tileTypeLookup._gpuTexture) {
            console.log(' Uploading pending lookup tables...');
            this._uploadLookupTablesToGPU();
        }
    }
    get backend() {
        return this._backend;
    }
    

    async _loadTextureGeneratorModule() {
        if (this._textureGeneratorModule) {
            return this._textureGeneratorModule;
        }
        console.log("Loading " + this.apiName)
        if (this.apiName === 'webgpu') {
            this._textureGeneratorModule = await import('./webgpu/textureGenerator.js');
        } else {
            this._textureGeneratorModule = await import('./webgl2/textureGenerator.js');
        }

        return this._textureGeneratorModule;
    }

    async _createTextureGenerator(width, height) {
        const module = await this._loadTextureGeneratorModule();
        
        if (this.apiName === 'webgpu') {
            if (!this.gpuDevice) {
                throw new Error('WebGPU device required for WebGPU texture generation');
            }
            const generator = new module.ProceduralTextureGenerator(this.gpuDevice, width, height);
            await generator.initialize();
            return generator;
        } else {
            return new module.ProceduralTextureGenerator(width, height);
        }
    }

    async _getAllProceduralVariants(level) {
        const module = await this._loadTextureGeneratorModule();
        return module.getAllProceduralVariantsForLevel(level);
    }

    initializeLookupTables() {
        if (this._lookupTablesReady) {
            console.log('Lookup tables already initialized');
            return;
        }

        console.log('Building global lookup tables...');

        const maxTileTypes = 256;
        const maxMicroVariants = 8;
        const maxMacroVariants = 8;

        const seasons = [
            SEASONS.SPRING,
            SEASONS.SUMMER,
            SEASONS.AUTUMN,
            SEASONS.WINTER
        ];

        this.lookupTables.tileTypeLookup = this._buildTileTypeLookup(
            maxTileTypes,
            maxMicroVariants,
            TEXTURE_LEVELS.MICRO,
            seasons
        );

        this.lookupTables.macroTileTypeLookup = this._buildTileTypeLookup(
            maxTileTypes,
            maxMacroVariants,
            TEXTURE_LEVELS.MACRO_1024,
            seasons
        );

        this.lookupTables.numVariantsTex = this._buildNumVariantsTexture(
            maxTileTypes,
            seasons
        );
        
        this._lookupTablesReady = true;
        
        // Only upload if backend is available
        if (this._backend) {
            this._uploadLookupTablesToGPU();
        } else {
            console.warn(' Backend not set yet, will upload lookup tables later');
        }
    }
    _uploadLookupTablesToGPU() {
        if (!this._backend) {
            console.error('Cannot upload lookup tables: no backend reference');
            return;
        }
        
        console.log('Uploading lookup tables via backend...');
        
        // Use backend's createTexture instead of direct GPU calls
        if (this.lookupTables.tileTypeLookup && !this.lookupTables.tileTypeLookup._gpuTexture) {
            this._backend.createTexture(this.lookupTables.tileTypeLookup);
            console.log(`   tileTypeLookup (${this.lookupTables.tileTypeLookup.width}x${this.lookupTables.tileTypeLookup.height})`);
        }
        
        if (this.lookupTables.macroTileTypeLookup && !this.lookupTables.macroTileTypeLookup._gpuTexture) {
            this._backend.createTexture(this.lookupTables.macroTileTypeLookup);
            console.log(`  macroTileTypeLookup (${this.lookupTables.macroTileTypeLookup.width}x${this.lookupTables.macroTileTypeLookup.height})`);
        }
        
        if (this.lookupTables.numVariantsTex && !this.lookupTables.numVariantsTex._gpuTexture) {
            this._backend.createTexture(this.lookupTables.numVariantsTex);
            console.log(`  numVariantsTex (${this.lookupTables.numVariantsTex.width}x${this.lookupTables.numVariantsTex.height})`);
        }
        
        console.log('All lookup tables uploaded');
    }
    

    _buildTileTypeLookup(maxTileTypes, maxVariants, level, seasons) {
        const numSeasons = seasons.length;
        const width = numSeasons * maxVariants;
        const height = maxTileTypes;
        const lookupData = new Float32Array(width * height * 4);

        let successCount = 0;
        let failCount = 0;
        
        for (let tileId = 0; tileId < maxTileTypes; tileId++) {
            for (let s = 0; s < numSeasons; s++) {
                const season = seasons[s];
                const variantCount = this.getNumVariants(tileId, season, level);

                for (let v = 0; v < maxVariants; v++) {
                    const safeVar = Math.min(v, variantCount - 1);
                    const uvs = this.getSeasonalTextureUV(tileId, season, safeVar, level);

                    const x = s * maxVariants + v;
                    const idx = (tileId * width + x) * 4;

                    if (uvs) {
                        lookupData[idx + 0] = uvs.u1;
                        lookupData[idx + 1] = uvs.v1;
                        lookupData[idx + 2] = uvs.u2;
                        lookupData[idx + 3] = uvs.v2;
                        successCount++;
                    } else {
                        lookupData[idx + 0] = 0.0;
                        lookupData[idx + 1] = 0.0;
                        lookupData[idx + 2] = 1.0;
                        lookupData[idx + 3] = 1.0;
                        failCount++;
                    }
                }
            }
        }

        console.log(`  ${level} lookup: ${successCount} valid, ${failCount} fallback entries`);
        
        const texture = new Texture({
            width: width,
            height: height,
            format: TextureFormat.RGBA32F,
            minFilter: TextureFilter.NEAREST,
            magFilter: TextureFilter.NEAREST,
            wrapS: TextureWrap.CLAMP,
            wrapT: TextureWrap.CLAMP,
            generateMipmaps: false,
            data: lookupData
        });

        return texture;
    }

    _buildNumVariantsTexture(maxTileTypes, seasons) {
        const numSeasons = seasons.length;
        const numVariants = new Uint8Array(maxTileTypes * numSeasons);

        for (let s = 0; s < numSeasons; s++) {
            for (let t = 0; t < maxTileTypes; t++) {
                const varCount = this.getNumVariants(t, seasons[s], TEXTURE_LEVELS.MICRO) || 1;
                numVariants[s * maxTileTypes + t] = varCount;
            }
        }

        const texture = new Texture({
            width: maxTileTypes,
            height: numSeasons,
            format: TextureFormat.R8,
            minFilter: TextureFilter.NEAREST,
            magFilter: TextureFilter.NEAREST,
            wrapS: TextureWrap.CLAMP,
            wrapT: TextureWrap.CLAMP,
            generateMipmaps: false,
            data: numVariants
        });

        return texture;
    }

    getLookupTables() {
        if (!this.loaded && this.atlases.get('micro').seasonalTextureMap.size === 0) {
            console.warn('Requesting lookup tables before Atlases are loaded!');
            return this.lookupTables;
        }

        if (!this._lookupTablesReady) {
            console.warn('Lookup tables not ready, initializing now...');
            this.initializeLookupTables();
        }
        return this.lookupTables;
    }

    calculateLayout(numTextures, atlasSize, textureSize) {
        const paddedTextureSize = textureSize + (this.PADDING * 2);
        const maxTilesPerSide = Math.floor(atlasSize / paddedTextureSize);
        const maxTotalTiles = maxTilesPerSide * maxTilesPerSide;

        if (numTextures > maxTotalTiles) {
            console.warn(`Too many textures (${numTextures}) for atlas size ${atlasSize}x${atlasSize}`);
        }

        const tilesPerRow = maxTilesPerSide;
        const rows = Math.ceil(numTextures / tilesPerRow);

        return {
            tilesPerRow: tilesPerRow,
            rows: Math.min(rows, maxTilesPerSide),
            totalTextures: Math.min(numTextures, maxTotalTiles),
            maxCapacity: maxTotalTiles,
            paddedTextureSize: paddedTextureSize,
            atlasSize: atlasSize,
            textureSize: textureSize
        };
    }

    extendPadding(ctx, x, y, textureSize, padding) {
        const topEdge = ctx.getImageData(x, y, textureSize, 1);
        for (let i = 1; i <= padding; i++) {
            ctx.putImageData(topEdge, x, y - i);
        }

        const bottomEdge = ctx.getImageData(x, y + textureSize - 1, textureSize, 1);
        for (let i = 1; i <= padding; i++) {
            ctx.putImageData(bottomEdge, x, y + textureSize - 1 + i);
        }

        const leftEdge = ctx.getImageData(x, y, 1, textureSize);
        for (let i = 1; i <= padding; i++) {
            ctx.putImageData(leftEdge, x - i, y);
        }

        const rightEdge = ctx.getImageData(x + textureSize - 1, y, 1, textureSize);
        for (let i = 1; i <= padding; i++) {
            ctx.putImageData(rightEdge, x + textureSize - 1 + i, y);
        }

        const tlCorner = ctx.getImageData(x, y, 1, 1);
        ctx.fillStyle = `rgba(${tlCorner.data[0]},${tlCorner.data[1]},${tlCorner.data[2]},${tlCorner.data[3] / 255})`;
        ctx.fillRect(x - padding, y - padding, padding, padding);

        const trCorner = ctx.getImageData(x + textureSize - 1, y, 1, 1);
        ctx.fillStyle = `rgba(${trCorner.data[0]},${trCorner.data[1]},${trCorner.data[2]},${trCorner.data[3] / 255})`;
        ctx.fillRect(x + textureSize, y - padding, padding, padding);

        const blCorner = ctx.getImageData(x, y + textureSize - 1, 1, 1);
        ctx.fillStyle = `rgba(${blCorner.data[0]},${blCorner.data[1]},${blCorner.data[2]},${blCorner.data[3] / 255})`;
        ctx.fillRect(x - padding, y + textureSize, padding, padding);

        const brCorner = ctx.getImageData(x + textureSize - 1, y + textureSize - 1, 1, 1);
        ctx.fillStyle = `rgba(${brCorner.data[0]},${brCorner.data[1]},${brCorner.data[2]},${brCorner.data[3] / 255})`;
        ctx.fillRect(x + textureSize, y + textureSize, padding, padding);
    }

    addTextureToAtlas(level, image, index, texturePath = null) {
        const atlas = this.atlases.get(level);
        const layout = atlas.layout;
        const padding = layout.padding !== undefined ? layout.padding : this.PADDING;

        const row = Math.floor(index / layout.tilesPerRow);
        const col = index % layout.tilesPerRow;

        const x = col * layout.paddedTextureSize + padding;
        const y = row * layout.paddedTextureSize + padding;

        atlas.context.drawImage(
            image,
            0, 0, image.width, image.height,
            x, y, layout.textureSize, layout.textureSize
        );

        this.extendPadding(atlas.context, x, y, layout.textureSize, padding);
    }

    createPlaceholderTexture(level, index, texturePath) {
        const atlas = this.atlases.get(level);
        const layout = atlas.layout;

        const row = Math.floor(index / layout.tilesPerRow);
        const col = index % layout.tilesPerRow;

        const x = col * layout.paddedTextureSize + this.PADDING;
        const y = row * layout.paddedTextureSize + this.PADDING;

        atlas.context.fillStyle = `hsl(${(index * 137.5) % 360}, 50%, 50%)`;
        atlas.context.fillRect(x, y, layout.textureSize, layout.textureSize);

        atlas.context.fillStyle = 'rgba(255, 255, 255, 0.3)';
        atlas.context.fillRect(x, y, layout.textureSize / 2, layout.textureSize / 2);
        atlas.context.fillRect(x + layout.textureSize / 2, y + layout.textureSize / 2,
            layout.textureSize / 2, layout.textureSize / 2);

        console.warn(`Created placeholder for ${texturePath} in ${level} atlas`);
    }

    calculateUVFromIndex(level, index) {
        const cacheKey = `${level}_${index}`;
        if (this._uvCache.has(cacheKey)) {
            return this._uvCache.get(cacheKey);
        }

        const atlas = this.atlases.get(level);
        if (!atlas || !atlas.layout) return null;
        const layout = atlas.layout;

        const row = Math.floor(index / layout.tilesPerRow);
        const col = index % layout.tilesPerRow;

        const textureSize = layout.textureSize;
        const paddedTextureSize = layout.paddedTextureSize;
        const atlasSize = layout.atlasSize;
        const padding = layout.padding !== undefined ? layout.padding : this.PADDING;

        const x1 = col * paddedTextureSize + padding;
        const y1 = row * paddedTextureSize + padding;

        const x2 = x1 + textureSize;
        const y2 = y1 + textureSize;
        const inset = 1.5;

        const u1 = (x1 + inset) / atlasSize;
        const v1 = (y1 + inset) / atlasSize;

        const u2 = (x2 - inset) / atlasSize;
        const v2 = (y2 - inset) / atlasSize;

        const result = { u1, v1, u2, v2 };
        this._uvCache.set(cacheKey, result);

        return result;
    }

    updateSeasonData(gameTime) {
        const [daysUntilNext, newSeason] = gameTime.getRunningSeasonInfo();

        if (this.currentSeason !== newSeason) {
            this.currentSeason = newSeason;
            console.log(`Season changed to ${newSeason}`);
        }
    }

    async initializeAtlases(procedural = false, cpu = false) {
        const promises = Object.values(TEXTURE_LEVELS).map(level =>
            procedural
                ? this.createProceduralAtlas(level, cpu)
                : this.createAtlas(level)
        );

        await Promise.all(promises);

        console.log("Verifying atlas population:");
        for (const [level, atlas] of this.atlases.entries()) {
            console.log(`  ${level}: ${atlas.seasonalTextureMap.size} mappings`);
        }

        console.log("Building lookup tables...");
        this._lookupTablesReady = false;

        if (this.lookupTables.tileTypeLookup?._gpuTexture) {
            this.lookupTables.tileTypeLookup = null;
        }
        if (this.lookupTables.macroTileTypeLookup?._gpuTexture) {
            this.lookupTables.macroTileTypeLookup = null;
        }
        if (this.lookupTables.numVariantsTex?._gpuTexture) {
            this.lookupTables.numVariantsTex = null;
        }

        this.initializeLookupTables();

        this.loaded = true;
        console.log('All texture atlases and lookups initialized');
    }
    async createProceduralAtlas(level, useCpu = false) {
        const config = ATLAS_CONFIG[level];
        const atlas = this.atlases.get(level);
    
        const hasTransparent = (level === TEXTURE_LEVELS.MICRO);
    
        const variants = await this._getAllProceduralVariants(level);
    
        if (!variants || variants.length === 0) {
            console.error(`No procedural variants found for level ${level}`);
            return null;
        }
    
        const hashToUniqueIndex = new Map();
        const uniqueVariants = [];
        const variantIndexToUniqueIndex = new Map();
    
        let startIndex = hasTransparent ? 1 : 0;
    
        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            const hash = getLayerConfigHash(variant.layers);
    
            let uniqueIdx = hashToUniqueIndex.get(hash);
            if (uniqueIdx === undefined) {
                uniqueIdx = uniqueVariants.length + startIndex;
                hashToUniqueIndex.set(hash, uniqueIdx);
                uniqueVariants.push({
                    hash,
                    layers: variant.layers,
                    firstTileType: variant.tileType,
                    firstSeason: variant.season,
                    firstVariant: variant.variant
                });
            }
    
            variantIndexToUniqueIndex.set(i, uniqueIdx);
        }
    
        console.log(`Deduplicated: ${variants.length} variants -> ${uniqueVariants.length} unique textures`);
    
        const totalTextures = hasTransparent ? uniqueVariants.length + 1 : uniqueVariants.length;
        atlas.layout = this.calculateLayout(
            totalTextures,
            config.atlasSize,
            config.textureSize
        );
    
        atlas.layout.padding = this.PADDING;
    
        atlas.canvas = document.createElement('canvas');
        atlas.canvas.width = atlas.layout.atlasSize;
        atlas.canvas.height = atlas.layout.atlasSize;
        atlas.context = atlas.canvas.getContext('2d', { willReadFrequently: true });
    
        atlas.context.fillStyle = '#808080';
        atlas.context.fillRect(0, 0, atlas.canvas.width, atlas.canvas.height);
    
        if (hasTransparent) {
            const transparentCanvas = document.createElement('canvas');
            transparentCanvas.width = atlas.layout.textureSize;
            transparentCanvas.height = atlas.layout.textureSize;
            const transparentCtx = transparentCanvas.getContext('2d');
            transparentCtx.fillStyle = 'rgba(128, 128, 128, 1)';
            transparentCtx.fillRect(0, 0, atlas.layout.textureSize, atlas.layout.textureSize);
    
            this.addTextureToAtlas(level, transparentCanvas, 0, 'transparent');
        }
    
        for (let i = 0; i < uniqueVariants.length; i++) {
            const variant = uniqueVariants[i];
            const atlasIndex = i + startIndex;
    
            if (!atlas.textureMap.has(variant.firstTileType)) {
                atlas.textureMap.set(variant.firstTileType, atlasIndex);
            }
        }
    
        console.log(`Creating procedural atlas for ${level} with ${variants.length} variants (${this.apiName})`);
    
        const textureImages = [];
        const generators = []; // Keep track of generators to dispose later
        
        for (let i = 0; i < uniqueVariants.length; i++) {
            try {
                const gen = await this._createTextureGenerator(
                    atlas.layout.textureSize,
                    atlas.layout.textureSize
                );
    
                const layers = uniqueVariants[i].layers;
                if (!Array.isArray(layers)) {
                    console.error(`Invalid layers for variant ${i}:`, layers);
                    continue;
                }
    
                layers.forEach(layerConfig => {
                    gen.addLayer(layerConfig);
                });
    
                let textureCanvas;
                if (this.apiName === 'webgpu') {
                    textureCanvas = await gen.generate();
                } else {
                    textureCanvas = gen.generate();
                }
    
                // CRITICAL FIX: Copy the canvas content to a new canvas before storing
                // This prevents dispose() from destroying the texture data
                const copyCanvas = document.createElement('canvas');
                copyCanvas.width = textureCanvas.width;
                copyCanvas.height = textureCanvas.height;
                const copyCtx = copyCanvas.getContext('2d');
                copyCtx.drawImage(textureCanvas, 0, 0);
                
                textureImages[i] = copyCanvas;
                generators.push(gen); // Store for later disposal
    
            } catch (error) {
                console.error(`Failed to generate texture ${i}:`, error);
                const fallbackCanvas = document.createElement('canvas');
                fallbackCanvas.width = atlas.layout.textureSize;
                fallbackCanvas.height = atlas.layout.textureSize;
                const fallbackCtx = fallbackCanvas.getContext('2d');
                fallbackCtx.fillStyle = `hsl(${(i * 137.5) % 360}, 70%, 50%)`;
                fallbackCtx.fillRect(0, 0, atlas.layout.textureSize, atlas.layout.textureSize);
                textureImages[i] = fallbackCanvas;
            }
        }
    
        // Now add all textures to the atlas
        for (let i = 0; i < uniqueVariants.length; i++) {
            if (!textureImages[i]) {
                console.error(`Missing texture image for index ${i}`);
                continue;
            }
            
            // Validate dimensions before adding
            if (textureImages[i].width === 0 || textureImages[i].height === 0) {
                console.error(`Invalid texture dimensions for index ${i}: ${textureImages[i].width}x${textureImages[i].height}`);
                const fallbackCanvas = document.createElement('canvas');
                fallbackCanvas.width = atlas.layout.textureSize;
                fallbackCanvas.height = atlas.layout.textureSize;
                const fallbackCtx = fallbackCanvas.getContext('2d');
                fallbackCtx.fillStyle = `hsl(${(i * 137.5) % 360}, 70%, 50%)`;
                fallbackCtx.fillRect(0, 0, atlas.layout.textureSize, atlas.layout.textureSize);
                textureImages[i] = fallbackCanvas;
            }
            
            const atlasIndex = hasTransparent ? i + 1 : i;
            this.addTextureToAtlas(level, textureImages[i], atlasIndex, `procedural_${atlasIndex}`);
        }
    
        // NOW dispose all generators after textures are added to atlas
        for (const gen of generators) {
            if (gen.dispose) {
                gen.dispose();
            }
        }
    
        for (let i = 0; i < variants.length; i++) {
            const { tileType, season, variant } = variants[i];
            const key = `${tileType}:${season}:${variant}`;
            const atlasIndex = variantIndexToUniqueIndex.get(i);
            atlas.seasonalTextureMap.set(key, atlasIndex);
        }
    
        atlas.texture = this._canvasToTexture(atlas.canvas, {
            minFilter: TextureFilter.LINEAR_MIPMAP_LINEAR,
            magFilter: TextureFilter.LINEAR,
            generateMipmaps: true,
            anisotropy: 8,
        });
    
        if (this._backend) {
            console.log(`Uploading ${level} atlas via backend (${atlas.canvas.width}x${atlas.canvas.height})`);
            this._backend.createTexture(atlas.texture);
            console.log(` ${level} atlas uploaded`);
        } else {
            console.error(` No backend available for ${level} atlas upload!`);
        }
    
        console.log(`Created procedural atlas for ${level}: ${uniqueVariants.length} unique textures`);
    
        return atlas.texture;
    }
    async createAtlas(level) {
        const config = ATLAS_CONFIG[level];
        const atlas = this.atlases.get(level);

        const allTextures = TextureConfigHelper.getAllTexturesForLevel(level);
        atlas.layout = this.calculateLayout(allTextures.length, config.atlasSize, config.textureSize);

        atlas.layout.padding = this.PADDING;

        atlas.canvas = document.createElement('canvas');
        atlas.canvas.width = atlas.layout.atlasSize;
        atlas.canvas.height = atlas.layout.atlasSize;
        atlas.context = atlas.canvas.getContext('2d');

        if (level === TEXTURE_LEVELS.MICRO) {
            atlas.context.fillStyle = '#888888';
            atlas.context.fillRect(0, 0, atlas.canvas.width, atlas.canvas.height);
        }
        
        atlas.texture = this._canvasToTexture(atlas.canvas, {
            minFilter: TextureFilter.LINEAR_MIPMAP_LINEAR,
            magFilter: TextureFilter.LINEAR,
            generateMipmaps: true
        });
        
        // CRITICAL: Use backend to upload
        if (this._backend) {
            console.log(` Uploading ${level} atlas via backend`);
            this._backend.createTexture(atlas.texture);
            console.log(` ${level} atlas uploaded`);
        } else {
            console.error(`No backend for ${level} atlas!`);
        }
        await this.loadTexturesForLevel(level);
        return atlas.texture;
    }

    _canvasToTexture(canvas, options = {}) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const texture = new Texture({
            width: canvas.width,
            height: canvas.height,
            format: TextureFormat.RGBA8,
            minFilter: options.minFilter || TextureFilter.LINEAR_MIPMAP_LINEAR,
            magFilter: options.magFilter || TextureFilter.LINEAR,
            wrapS: options.wrapS || TextureWrap.CLAMP,
            wrapT: options.wrapT || TextureWrap.CLAMP,
            generateMipmaps: options.generateMipmaps !== false,
            data: new Uint8Array(imageData.data.buffer)
        });
        
        texture.image = {
            width: canvas.width,
            height: canvas.height
        };
        
        return texture;
    }

    async loadTexturesForLevel(level) {
        const atlas = this.atlases.get(level);
        const allTexturePaths = TextureConfigHelper.getAllTexturesForLevel(level);

        let currentIndex = 0;

        for (const texturePath of allTexturePaths) {
            if (currentIndex >= atlas.layout.maxCapacity) {
                console.warn(`Atlas full, skipping texture: ${texturePath}`);
                continue;
            }
            try {
                const img = await this.loadImage(texturePath);
                this.addTextureToAtlas(level, img, currentIndex, texturePath);
                atlas.textureMap.set(texturePath, currentIndex);
                currentIndex++;
            } catch (error) {
                console.error(`Failed to load texture ${texturePath}:`, error);
                this.createPlaceholderTexture(level, currentIndex, texturePath);
                atlas.textureMap.set(texturePath, currentIndex);
                currentIndex++;
            }
        }

        for (const tileConfig of TILE_CONFIG) {
            for (const season of Object.values(SEASONS)) {
                const textures = TextureConfigHelper.getTexturesForSeason(tileConfig.id, season, level);
                for (let variant = 0; variant < textures.length; variant++) {
                    const texturePath = textures[variant];
                    const key = `${tileConfig.id}:${season}:${variant}`;
                    const index = atlas.textureMap.get(texturePath);
                    atlas.seasonalTextureMap.set(key, index);
                }
            }
        }

        atlas.texture.needsUpdate = true;
        console.log(`Loaded ${currentIndex} textures for ${level} atlas.`);
    }

    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = src;
        });
    }

    getSeasonalTextureUV(tileType, season, variant, level) {
        const cacheKey = `${level}_${tileType}_${season}_${variant}`;
        if (this._uvCache.has(cacheKey)) {
            return this._uvCache.get(cacheKey);
        }

        const atlas = this.atlases.get(level);

        if (!atlas) {
            console.warn('No atlas for level', level);
            return null;
        }

        const key = `${tileType}:${season}:${variant}`;
        const index = atlas.seasonalTextureMap.get(key);

        if (index === undefined) {
            return null;
        }

        const result = this.calculateUVFromIndex(level, index);

        if (result) {
            this._uvCache.set(cacheKey, result);
        }

        return result;
    }

    getNumVariants(tileType, season, level) {
        const atlas = this.atlases.get(level);

        if (!atlas) {
            console.warn(`No atlas for level: ${level}`);
            return 0;
        }

        let count = 0;
        for (let v = 0; v < 16; v++) {
            const key = `${tileType}:${season}:${v}`;
            if (atlas.seasonalTextureMap.has(key)) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }

    getAtlasTexture(level) {
        const atlas = this.atlases.get(level);
        return atlas ? atlas.texture : null;
    }

    getNextSeason(currentSeason) {
        const seasons = Object.values(SEASONS);
        const currentIndex = seasons.indexOf(currentSeason);
        return seasons[(currentIndex + 1) % seasons.length];
    }

    getTextureIndex(level, texturePath) {
        const atlas = this.atlases.get(level);
        return atlas ? atlas.textureMap.get(texturePath) ?? -1 : -1;
    }

    getTextureUV(level, texturePath) {
        const index = this.getTextureIndex(level, texturePath);
        if (index === -1) return null;
        return this.calculateUVFromIndex(level, index);
    }

    getAtlasUtilization(level) {
        const atlas = this.atlases.get(level);
        if (!atlas || !atlas.layout) return null;

        const used = atlas.textureMap.size || atlas.seasonalTextureMap.size;
        const capacity = atlas.layout.maxCapacity;

        return {
            used: used,
            capacity: capacity,
            utilization: (used / capacity * 100).toFixed(1) + '%',
            tilesPerRow: atlas.layout.tilesPerRow,
            rows: atlas.layout.rows
        };
    }

    getAtlasInfo(level) {
        const atlas = this.atlases.get(level);
        if (!atlas || !atlas.layout) return null;

        return {
            level: level,
            atlasSize: atlas.layout.atlasSize,
            textureSize: atlas.layout.textureSize,
            paddedTextureSize: atlas.layout.paddedTextureSize,
            padding: this.PADDING,
            layout: atlas.layout,
            utilization: this.getAtlasUtilization(level),
            seasonalTextures: atlas.seasonalTextureMap.size,
            totalTextures: atlas.textureMap.size
        };
    }

    getPropAtlasTexture() {
        return this.getAtlasTexture(TEXTURE_LEVELS.PROP);
    }

    getPropUV(propType) {
        const path = TextureConfigHelper.getPropTexturePath(propType);
        if (!path) return null;
        return this.getTextureUV(TEXTURE_LEVELS.PROP, path);
    }

    cleanup() {
        this.atlases.forEach(atlas => {
            if (atlas.texture) {
                atlas.texture.dispose();
            }
            if (atlas.canvas) {
                atlas.canvas = null;
                atlas.context = null;
            }
        });
        this.atlases.clear();

        if (this.lookupTables.tileTypeLookup) {
            this.lookupTables.tileTypeLookup.dispose();
        }
        if (this.lookupTables.macroTileTypeLookup) {
            this.lookupTables.macroTileTypeLookup.dispose();
        }
        if (this.lookupTables.numVariantsTex) {
            this.lookupTables.numVariantsTex.dispose();
        }

        this._uvCache.clear();
    }
}
