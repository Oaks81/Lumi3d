
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js';
import { TerrainMaterialFactory } from '../terrain/TerrainMaterialFactory.js';
import { TextureDataBuilder } from '../terrain/TextureDataBuilder.js';
import { TEXTURE_LEVELS } from '../../texture/TileConfig.js';
import { buildRockFragmentShader } from '../../renderer/prop/shaders/rockFragmentShaderBuilder.js';
import { buildRockVertexShader } from '../../renderer/prop/shaders/rockVertexShaderBuilder.js';
import { createEnvironmentUpdater } from '../../renderer/renderUtils.js';
import { buildBoulderFragmentShader } from '../../renderer/prop/shaders/boulderFragmentShaderBuilder.js';
import { buildBoulderVertexShader } from '../../renderer/prop/shaders/boulderVertexShaderBuilder.js';
import { buildGrassVertexShader } from '../../renderer/shaders/grass/grassVertexShader.js';
import { buildGrassFragmentShader } from '../../renderer/shaders/grass/grassFragmentShader.js';
import { buildTreeVertexShader } from '../../renderer/shaders/tree/treeVertexShader.js';
import { buildTreeFragmentShader } from '../../renderer/shaders/tree/treeFragmentShader.js';

export class PropMaterialFactory {
    constructor(textureManager, uniformManager, options = {}) {  // ADD uniformManager param
        this.textureManager = textureManager;
        this.uniformManager = uniformManager;  // NEW
        this.featureMaterialCache = new Map();
        this.dynamicMaterials = new WeakMap();
    }
    getMaterialForFeature(feature, heightTexture, terrainBounds, environmentState) {
        if (feature.isStatic) {
            return this.getSharedMaterial(feature, heightTexture, terrainBounds, environmentState);
        }
        return this.createUniqueMaterial(feature, environmentState);
    }
 
    getSharedMaterial(feature, heightTexture, normalTexture, terrainBounds, environmentState) {
        let key = `${feature.type}_${feature.chunkX}_${feature.chunkY}`;

        if (this.featureMaterialCache.has(key)) {
            return this.featureMaterialCache.get(key);
        }

        const mat = this.buildMaterialFromFeature(feature, heightTexture, normalTexture, terrainBounds, environmentState);
        this.featureMaterialCache.set(key, mat);
        return mat;
    }

    
    createUniqueMaterial(feature, environmentState) {
        if (!feature?.heightmapData || !feature?.boundingBox) {
            throw new Error('feature must have .heightmapData and .boundingBox');
        }
        const bb = feature.boundingBox;
    
        // Step 1: Grid/tile sizes, splat map sizes
        const gridWidth = bb.maxX - bb.minX + 1;
        const gridHeight = bb.maxY - bb.minY + 1;
        
        // Since the mesh is inset by 1 on all sides, adjust tile counts
        const numTilesX = gridWidth - 3;  // was gridWidth - 1
        const numTilesY = gridHeight - 3; // was gridHeight - 1
        
        // Adjust splat dimensions too
        const splatWidth = feature.blendWidth || numTilesX * (feature.splatDensity || 4);
        const splatHeight = feature.blendHeight || numTilesY * (feature.splatDensity || 4);
    
        // Step 2: Build level1 and level2 textureData
        const bbox = feature.boundingBox;
        // Adjust offset since mesh starts at local position (1,1)
        const offsetX = feature.chunkX * feature.chunkSize + bbox.minX + 1;
        const offsetZ = feature.chunkY * feature.chunkSize + bbox.minY + 1;
    
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        const textureData = {
            level1Data: TextureDataBuilder.buildLevel1Data(
                feature, this.textureManager, offsetX, offsetZ, seasons, numTilesX, numTilesY, false, 1 // Add tileOffset = 1
            ),
            level2Data: TextureDataBuilder.buildLevel2Data(
                feature, this.textureManager, offsetX, offsetZ, seasons, numTilesX, numTilesY
            )
        };

        // Rest of the method remains the same...
        const splatMapData = TextureDataBuilder.buildSplatMap(
            feature, splatWidth, splatHeight
        );
        const macroMask = TextureDataBuilder.buildMacroMask(feature, splatWidth, splatHeight);
    
        const atlasTextures = {
            micro: this.textureManager.getAtlasTexture(TEXTURE_LEVELS.MICRO),
            macro1024: this.textureManager.getAtlasTexture(TEXTURE_LEVELS.MACRO_1024)
        };
    
        const material = TerrainMaterialFactory.createTerrainMaterial(
            textureData,
            atlasTextures,
            seasons,
            environmentState,
            offsetX,
            offsetZ,
            splatMapData,
            macroMask,
            this.textureManager,
            this.uniformManager  // NEW: pass uniform manager
        );
        if (material.uniforms.chunkWidth)  material.uniforms.chunkWidth.value  = numTilesX;
        if (material.uniforms.chunkHeight) material.uniforms.chunkHeight.value = numTilesY;
        material.needsUpdate = true;
        return material;
    }
   


    
    getTreeConfig(subtype) {
        const configs = {
            OAK: {
                barkTexture: 'BARK_OAK',
                leafTexture: 'LEAF_CLUSTER_OAK'
            },
            PINE: {
                barkTexture: 'BARK_PINE', 
                leafTexture: 'NEEDLES_PINE'
            },
            SPRUCE: {
                barkTexture: 'BARK_SPRUCE',
                leafTexture: 'NEEDLES_SPRUCE'
            },
            BIRCH: {
                barkTexture: 'BARK_BIRCH',
                leafTexture: 'LEAF_CLUSTER_BIRCH'
            }
        };
        return configs[subtype] || configs.OAK;
    }
    buildMaterialFromFeature(feature, heightTexture, normalTexture, terrainBounds, environmentState) {
        if (feature.type === 'tree') {
            const config = feature.treeConfig || this.getTreeConfig(feature.subtype);
            const atlasTex = this.textureManager.getAtlasTexture(TEXTURE_LEVELS.PROP);
            console.log('Looking up leafTexture', atlasTex, 'in level PROP?', TEXTURE_LEVELS.PROP );
            console.log([...this.textureManager.atlases.get(TEXTURE_LEVELS.PROP).textureMap.keys()]);
                        // ✅ Force keys to be strings
            const barkKey = config.barkTexture

            const leafKey = config.leafTexture 
  console.log('Looking up textures (keys):', barkKey, leafKey);
  console.log('PROP atlas keys:', [...this.textureManager.atlases.get(TEXTURE_LEVELS.PROP).textureMap.keys()]);

            if (!atlasTex) {
                console.warn('No PROP atlas, using basic material');
                const material = new THREE.MeshPhongMaterial({
                    color: 0x4a3c28,
                    shininess: 10
                });
                return material;
            }
    
            const barkIndex = this.textureManager.getTextureIndex(TEXTURE_LEVELS.PROP, config.barkTexture);
            const leafIndex = this.textureManager.getTextureIndex(TEXTURE_LEVELS.PROP, config.leafTexture);
    
            const barkUV = barkIndex >= 0 ?
                this.textureManager.calculateUVFromIndex(TEXTURE_LEVELS.PROP, barkIndex) :
                {u1: 0, v1: 0, u2: 0.5, v2: 0.5};
    
            const leafUV = leafIndex >= 0 ?
                this.textureManager.calculateUVFromIndex(TEXTURE_LEVELS.PROP, leafIndex) :
                {u1: 0.5, v1: 0, u2: 1, v2: 0.5};
    
            // Material-specific uniforms
            const materialUniforms = {
                map: { value: atlasTex },
                barkUVRect: { value: new THREE.Vector4(barkUV.u1, barkUV.v1, barkUV.u2, barkUV.v2) },
                leafUVRect: { value: new THREE.Vector4(leafUV.u1, leafUV.v1, leafUV.u2, leafUV.v2) }
            };

            let uniforms;
            if (this.uniformManager) {
                const lightingUniforms = this.uniformManager.getLightingUniforms();
                uniforms = { ...materialUniforms, ...lightingUniforms };
            } else {
       
                uniforms = {
                    ...materialUniforms,
                    sunLightColor: { value: new THREE.Color(0xffffff) },
                    sunLightIntensity: { value: 1.0 },
                    sunLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                    moonLightColor: { value: new THREE.Color(0x4444ff) },
                    moonLightIntensity: { value: 0.2 },
                    moonLightDirection: { value: new THREE.Vector3(-0.5, 1.0, -0.3).normalize() },
                    ambientLightColor: { value: new THREE.Color(0x404040) },
                    ambientLightIntensity: { value: 0.2 },
                    skyAmbientColor: { value: new THREE.Color(0x87baff) },
                    groundAmbientColor: { value: new THREE.Color(0x554630) },
                    fogColor: { value: new THREE.Color(0xcccccc) },
                    fogDensity: { value: 0.005 },
                    weatherIntensity: { value: 0.0 },
                    currentWeather: { value: 0 }
                };
            }
    
            const isInstanced = feature.isInstanced !== false;
    
            const material = new THREE.ShaderMaterial({
                uniforms: uniforms,
                vertexShader: buildTreeVertexShader(isInstanced),
                fragmentShader: buildTreeFragmentShader(),
                side: THREE.DoubleSide,
                fog: true,
                transparent: true,
                alphaTest: 0.15,
                depthWrite: true,
                vertexColors: true,  
                defines: isInstanced ? { USE_INSTANCING: '' } : {}
            });
    

            if (this.uniformManager) {
                this.uniformManager.registerMaterial(material);
            }
            
            const originalDispose = material.dispose.bind(material);
            material.dispose = function() {
                if (this.uniformManager) {
                    this.uniformManager.unregisterMaterial(material);
                }
                originalDispose();
            }.bind(this);
    
            return material;
        } else if (feature.type === 'grass') {
            console.log(`🌱 Creating grass material for ${feature.subtype}, variant ${feature.variant}`);
            const atlasTex = this.textureManager.getAtlasTexture(TEXTURE_LEVELS.PROP);
            
            if (!atlasTex) {
                console.warn('No PROP atlas, using basic material for grass');
                const material = new THREE.MeshPhongMaterial({
                    color: 0x4a7c2a,
                    transparent: true,
                    alphaTest: 0.3,
                    side: THREE.DoubleSide
                });
                return material;
            }
            
            // Get texture for grass type
            const diffuseKey = `GRASS_${feature.subtype}_DIFFUSE`;
            const billboardKey = `GRASS_${feature.subtype}_BILLBOARD`;
            
            const diffuseIndex = this.textureManager.getTextureIndex(TEXTURE_LEVELS.PROP, diffuseKey);
            const billboardIndex = this.textureManager.getTextureIndex(TEXTURE_LEVELS.PROP, billboardKey);
            
            console.log(`🌱 Grass texture lookup: ${diffuseKey} -> index ${diffuseIndex}, ${billboardKey} -> index ${billboardIndex}`);
            
            const diffuseUV = diffuseIndex >= 0 ?
                this.textureManager.calculateUVFromIndex(TEXTURE_LEVELS.PROP, diffuseIndex) :
                {u1: 0, v1: 0, u2: 0.25, v2: 0.25};
            
            const billboardUV = billboardIndex >= 0 ?
                this.textureManager.calculateUVFromIndex(TEXTURE_LEVELS.PROP, billboardIndex) :
                {u1: 0.25, v1: 0, u2: 0.5, v2: 0.25};
            
            // Material-specific uniforms
            const materialUniforms = {
                map: { value: atlasTex },
                grassUVRect: { value: new THREE.Vector4(diffuseUV.u1, diffuseUV.v1, diffuseUV.u2, diffuseUV.v2) },
                billboardUVRect: { value: new THREE.Vector4(billboardUV.u1, billboardUV.v1, billboardUV.u2, billboardUV.v2) },
                time: { value: 0.0 },
                windStrength: { value: 1.0 },
                windDirection: { value: new THREE.Vector2(1.0, 0.0) }
            };
            
            let uniforms;
            if (this.uniformManager) {
                const lightingUniforms = this.uniformManager.getLightingUniforms();
                uniforms = { ...materialUniforms, ...lightingUniforms };
            } else {
                uniforms = {
                    ...materialUniforms,
                    sunLightColor: { value: new THREE.Color(0xffffff) },
                    sunLightIntensity: { value: 1.0 },
                    sunLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                    ambientLightColor: { value: new THREE.Color(0x404040) },
                    ambientLightIntensity: { value: 0.2 },
                    fogColor: { value: new THREE.Color(0xcccccc) },
                    fogDensity: { value: 0.005 }
                };
            }
            
            const isInstanced = feature.isInstanced !== false;
            
            const material = new THREE.ShaderMaterial({
                uniforms: uniforms,
                vertexShader: buildGrassVertexShader(isInstanced),
                fragmentShader: buildGrassFragmentShader(),
                side: THREE.DoubleSide,
                transparent: true,
                alphaTest: 0.3,
                vertexColors: true,
                defines: isInstanced ? { USE_INSTANCING: '' } : {}
            });
            
            if (this.uniformManager) {
                this.uniformManager.registerMaterial(material);
            }
            
            const originalDispose = material.dispose.bind(material);
            material.dispose = function() {
                if (this.uniformManager) {
                    this.uniformManager.unregisterMaterial(material);
                }
                originalDispose();
            }.bind(this);
            
            return material;
        } else if (feature.type === 'shrub') {
            console.log(`🌿 Creating shrub material for ${feature.subtype}, variant ${feature.variant}`);
            
            // Use basic material for shrubs (can be enhanced later)
            const material = new THREE.MeshPhongMaterial({
                color: feature.subtype === 'FERN' ? 0x2d5020 : 0x3a5a25,
                transparent: true,
                alphaTest: 0.3,
                side: THREE.DoubleSide
            });
            
            return material;
        }
    
        // Handle other feature types...
        return null;
    }
    
    // Create default height texture if none provided
createDefaultTexture() {
    const data = new Float32Array([0]);
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RedFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
}
    buildTerrainMaterial(feature, options = {}) {
        const { seasons = ['Spring', 'Summer', 'Autumn', 'Winter'], environmentState } = options;

        return TerrainMaterialFactory.createTerrainMaterialForFeature(feature, this.textureManager, seasons, environmentState);
    }
    cleanup() {
        for (const mat of this.featureMaterialCache.values()) {
            mat.dispose();
        }
        this.featureMaterialCache.clear();
    }
}


