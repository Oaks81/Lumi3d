import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TEXTURE_LEVELS } from '../../texture/TileConfig.js';
import { Utils } from '../../utils.js';

export class TextureDataBuilder {




// 3. Update createDataTexture to default to ClampToEdge
static createDataTexture(data, width, height, format, repeat = false) {
    const texture = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
    texture.needsUpdate = true;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.flipY = false;
    return texture;
}


static buildLevel2Data(chunk, textureManager, offsetX, offsetZ, seasons, width, height) {
    const numSeasons = seasons.length;
    const level2Width = Math.ceil(width);
    const level2Height = Math.ceil(height);
    const level2SeasonData = new Float32Array(level2Width * numSeasons * level2Height * 4);

    const globalOffsetX = chunk.chunkX * chunk.size;
    const globalOffsetZ = chunk.chunkY * chunk.size;

    // DEBUG: Track if any macro data is set
    let macroDataSet = 0;

    for (let z = 0; z < level2Height; z++) {
        for (let x = 0; x < level2Width; x++) {
            const centreX = Math.min(x * 8 + 4, width - 1);
            const centreZ = Math.min(z * 8 + 4, height - 1);
            let tileId = chunk.getTile(centreX, centreZ) ?? 0;
            if (tileId >= 100) tileId -= 100;

            const worldTileX = globalOffsetX + centreX;
            const worldTileZ = globalOffsetZ + centreZ;

            const baseSeed = Utils.improvedHash(worldTileX, worldTileZ, tileId, 2);

            for (let s = 0; s < numSeasons; s++) {
                const baseIndex = z * (level2Width * numSeasons) + s * level2Width + x;
                const idx = baseIndex * 4;
                const season = seasons[s];

                const numVariants = textureManager.getNumVariants(tileId, season, TEXTURE_LEVELS.MACRO_1024) || 1;
                const variant = Math.abs((baseSeed >> 7) + s * 99991) % numVariants;

                const uvs = textureManager.getSeasonalTextureUV(tileId, season, variant, TEXTURE_LEVELS.MACRO_1024);
                if (uvs) {
                    level2SeasonData[idx + 0] = uvs.u1;
                    level2SeasonData[idx + 1] = uvs.v1;
                    level2SeasonData[idx + 2] = uvs.u2;
                    level2SeasonData[idx + 3] = uvs.v2;
                    macroDataSet++;
                } else {
                    level2SeasonData[idx + 0] = 0;
                    level2SeasonData[idx + 1] = 0;
                    level2SeasonData[idx + 2] = 1;
                    level2SeasonData[idx + 3] = 1;
                }
            }
        }
    }

    const texture = this.createDataTexture(level2SeasonData, level2Width * numSeasons, level2Height, THREE.RGBAFormat, true);
    
    // DEBUG: Check texture
    console.log(`📊 Level2 texture size: ${texture.image.width}x${texture.image.height}`);

    return {
        level2Width,
        level2Height,
        level2SeasonData,
        level2SeasonTexture: texture,
    };
}


static buildLevel1Data(chunk, textureManager, offsetX, offsetZ, seasons, width, height) {
const numSeasons = seasons.length;
const tileSeasonData = new Float32Array(width * numSeasons * height * 4);

// Use chunk coordinates for world position
const worldOffsetX = chunk.chunkX * chunk.size;
const worldOffsetZ = chunk.chunkY * chunk.size;

for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
        let tileId = chunk.getTile(x, z);
        if (tileId >= 100) tileId -= 100;
        
        // World tile position for seeding
        const worldTileX = worldOffsetX + x;
        const worldTileZ = worldOffsetZ + z;
        
        for (let s = 0; s < numSeasons; s++) {
            const baseIndex = z * (width * numSeasons) + s * width + x;
            const idx = baseIndex * 4;
            const season = seasons[s];
            
            const seed = Utils.improvedHash(worldTileX, worldTileZ, tileId, 1);
            const numVariants = textureManager.getNumVariants(tileId, season, TEXTURE_LEVELS.MICRO) || 1;
            const variant = Math.abs(seed + s * 1000) % numVariants;
            
            const uvs = textureManager.getSeasonalTextureUV(tileId, season, variant, TEXTURE_LEVELS.MICRO);
            if (uvs) {
                tileSeasonData[idx + 0] = uvs.u1;
                tileSeasonData[idx + 1] = uvs.v1;
                tileSeasonData[idx + 2] = uvs.u2;
                tileSeasonData[idx + 3] = uvs.v2;
            }
        }
    }
}
const tileTypeData = new Float32Array(width * numSeasons * height);
for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
        const tileId = chunk.getTile(x, z);
        for (let s = 0; s < numSeasons; s++) {
            const baseIndex = z * (width * numSeasons) + s * width + x;
            tileTypeData[baseIndex] = tileId;
        }
    }
}
// Create textures with ClampToEdge (NOT Repeat!)
return {
    width,
    height,
    tileSeasonData,
    tileSeasonDataTexture: this.createDataTexture(
        tileSeasonData, 
        width * numSeasons, 
        height, 
        THREE.RGBAFormat,
        false  // NOT repeat
    ),
    tileTypeDataTexture: this.createDataTexture(
        tileTypeData, 
        width * numSeasons, 
        height, 
        THREE.RedFormat,
        false  // NOT repeat
    )
};
}

    static buildMacroTileTypeLookup(
        textureManager,
        seasons,
        maxTileTypes = 256,
        maxVariants = 8 // or whatever MAX_VARIANTS you use for macro
    ) {
        const numSeasons = seasons.length;
        const width = numSeasons * maxVariants;
        const height = maxTileTypes;
        const lookupData = new Float32Array(width * height * 4);
    
        for (let tileId = 0; tileId < maxTileTypes; tileId++) {
            for (let s = 0; s < numSeasons; s++) {
                const season = seasons[s];
                // Use MACRO_1024 level here!
                const variantCount = textureManager.getNumVariants(tileId, season, TEXTURE_LEVELS.MACRO_1024);
                for (let v = 0; v < maxVariants; v++) {
                    let safeVar = 0;
                    if (variantCount && variantCount > 0) {
                        safeVar = Math.min(v, variantCount - 1);
                    }
                    // Get UVs for this macro variant
                    const uvs = textureManager.getSeasonalTextureUV(tileId, season, safeVar, TEXTURE_LEVELS.MACRO_1024);
                    const x = s * maxVariants + v;
                    const idx = (tileId * width + x) * 4;
                    if (uvs) {
                        lookupData[idx + 0] = uvs.u1;
                        lookupData[idx + 1] = uvs.v1;
                        lookupData[idx + 2] = uvs.u2;
                        lookupData[idx + 3] = uvs.v2;
                    } else {
                        // fallback: whole texture
                        lookupData[idx + 0] = 0.0;
                        lookupData[idx + 1] = 0.0;
                        lookupData[idx + 2] = 1.0;
                        lookupData[idx + 3] = 1.0;
                    }
                }
            }
        }
        // Build the DataTexture
        const tex = TextureDataBuilder.createDataTexture(lookupData, width, height, THREE.RGBAFormat);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }

    _buildTileTypeLookup(maxTileTypes, maxVariants, level, seasons) {
        const numSeasons = seasons.length;
        const width = numSeasons * maxVariants;
        const height = maxTileTypes;
        const lookupData = new Float32Array(width * height * 4);
    
        console.log(` Building ${level} lookup with seasons:`, seasons);
        console.log(`   Width: ${width} (${numSeasons} seasons × ${maxVariants} variants)`);
        console.log(`   Height: ${height} tile types`);
    
        let successCount = 0;
        let failCount = 0;
        
        for (let tileId = 0; tileId < maxTileTypes; tileId++) {
            for (let s = 0; s < numSeasons; s++) {
                const season = seasons[s];
                const variantCount = this.getNumVariants(tileId, season, level);
                
                if (tileId === 3) {
                    console.log(`  Tile 3, season ${s} (${season}): ${variantCount} variants`);
                }
    
                for (let v = 0; v < maxVariants; v++) {
                    const safeVar = (variantCount > 0) ? Math.min(v, variantCount - 1) : 0;
                    const uvs = this.getSeasonalTextureUV(tileId, season, safeVar, level);
                    
                    const x = s * maxVariants + v;
                    const idx = (tileId * width + x) * 4;
    
                    if (uvs) {
                        lookupData[idx + 0] = uvs.u1;
                        lookupData[idx + 1] = uvs.v1;
                        lookupData[idx + 2] = uvs.u2;
                        lookupData[idx + 3] = uvs.v2;
                        successCount++;
                        
                        if (tileId === 3 && v === 0) {
                            console.log(`    Season ${s} (${season}), v0: UVs (${uvs.u1.toFixed(3)}, ${uvs.v1.toFixed(3)}) → (${uvs.u2.toFixed(3)}, ${uvs.v2.toFixed(3)})`);
                        }
                    } else {
                        // Don't use fallback - use black/magenta to make it obvious
                        lookupData[idx + 0] = 1.0;  // Magenta
                        lookupData[idx + 1] = 0.0;
                        lookupData[idx + 2] = 1.0;
                        lookupData[idx + 3] = 0.0;
                        failCount++;
                        
                        if (tileId === 3 && v === 0) {
                            console.error(`     Season ${s} (${season}), v0: NO UVs! Using magenta marker`);
                        }
                    }
                }
            }
        }
    
        console.log(`   ${level}: ${successCount} valid, ${failCount} missing entries`);
    
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
    
}