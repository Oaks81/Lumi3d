/**
 * Grass System Debugger
 * Provides console testing functions for the grass rendering system
 */

export class GrassDebugger {
    constructor() {
        this.testResults = {};
    }

    /**
     * Test grass feature generation
     */
    testGrassGeneration() {
        console.log('🧪 Testing Grass Generation...');
        
        try {
            // Import grass feature
            import('../world/features/grassFeature.js').then(({ GrassFeature }) => {
                // Test grass feature creation
                const testGrass = new GrassFeature({
                    subtype: 'MEADOW_GRASS',
                    variant: 0,
                    position: { x: 100, y: 10, z: 200 },
                    rotation: Math.PI * 0.25,
                    scale: 1.2,
                    shapeSeed: 12345,
                    clumpIndex: 0
                });
                
                console.log('✅ Single grass feature created:', testGrass);
                console.log('   - Type:', testGrass.type);
                console.log('   - Subtype:', testGrass.subtype);
                console.log('   - Position:', testGrass.position);
                console.log('   - Shape seed:', testGrass.shapeSeed);
                console.log('   - Global ID:', testGrass.getGlobalId());
                
                // Test grass clump creation
                const testClump = GrassFeature.createGrassClump({
                    centerPosition: { x: 150, y: 10, z: 250 },
                    grassType: 'TALL_GRASS',
                    clumpSize: 7,
                    clumpRadius: 0.5,
                    baseSeed: 54321
                });
                
                console.log('✅ Grass clump created:', testClump);
                console.log(`   - Clump size: ${testClump.length} blades`);
                console.log('   - First blade position:', testClump[0].position);
                console.log('   - Last blade position:', testClump[testClump.length - 1].position);
                
                // Test deterministic generation
                const testClump2 = GrassFeature.createGrassClump({
                    centerPosition: { x: 150, y: 10, z: 250 },
                    grassType: 'TALL_GRASS',
                    clumpSize: 7,
                    clumpRadius: 0.5,
                    baseSeed: 54321 // Same seed
                });
                
                const isDeterministic = testClump.length === testClump2.length &&
                    testClump[0].position.x === testClump2[0].position.x &&
                    testClump[0].position.z === testClump2[0].position.z;
                
                console.log('✅ Deterministic test:', isDeterministic ? 'PASSED' : 'FAILED');
                
                this.testResults.grassGeneration = true;
            });
            
        } catch (error) {
            console.error('❌ Grass generation test failed:', error);
            this.testResults.grassGeneration = false;
        }
    }

    /**
     * Test grass geometry generation
     */
    testGrassGeometry() {
        console.log('🧪 Testing Grass Geometry...');
        
        try {
            Promise.all([
                import('../world/features/grassFeature.js'),
                import('../mesh/props/grassGenerator.js')
            ]).then(([{ GrassFeature }, { GrassGeometryGenerator }]) => {
                
                const generator = new GrassGeometryGenerator();
                const testGrass = new GrassFeature({
                    subtype: 'MEADOW_GRASS',
                    variant: 0,
                    position: { x: 0, y: 0, z: 0 },
                    rotation: 0,
                    scale: 1,
                    shapeSeed: 12345
                });
                
                generator.buildGeometry(testGrass).then(result => {
                    console.log('✅ Grass geometry generated:', result);
                    console.log('   - LOD map created:', !!result.lodMap);
                    console.log('   - Available LODs:', Array.from(result.lodMap.lodMap.keys()));
                    
                    // Test each LOD level
                    for (const [lod, info] of result.lodMap.lodMap.entries()) {
                        console.log(`   - LOD ${lod}:`, info.type, info.geometry ? `${info.geometry.attributes.position.count} vertices` : 'no geometry');
                    }
                    
                    this.testResults.grassGeometry = true;
                });
            });
            
        } catch (error) {
            console.error('❌ Grass geometry test failed:', error);
            this.testResults.grassGeometry = false;
        }
    }

    /**
     * Debug current grass instances in scene
     */
    debugSceneGrass() {
        console.log('🔍 Debugging Scene Grass...');
        
        const grassObjects = [];
        
        // Find grass objects in scene
        if (window.scene) {
            window.scene.traverse((object) => {
                if (object.userData && object.userData.featureGroup) {
                    const grassFeatures = object.userData.featureGroup.filter(f => f.type === 'grass');
                    if (grassFeatures.length > 0) {
                        grassObjects.push({
                            object: object,
                            grassCount: grassFeatures.length,
                            material: object.material,
                            geometry: object.geometry,
                            visible: object.visible,
                            position: object.position
                        });
                    }
                }
            });
        }
        
        console.log(`🌱 Found ${grassObjects.length} grass mesh objects in scene`);
        
        grassObjects.forEach((grassObj, index) => {
            console.log(`   Grass Object ${index + 1}:`);
            console.log(`   - Instances: ${grassObj.grassCount}`);
            console.log(`   - Visible: ${grassObj.visible}`);
            console.log(`   - Position: ${grassObj.position.x.toFixed(2)}, ${grassObj.position.y.toFixed(2)}, ${grassObj.position.z.toFixed(2)}`);
            console.log(`   - Material: ${grassObj.material?.type || 'unknown'}`);
            console.log(`   - Vertices: ${grassObj.geometry?.attributes?.position?.count || 'unknown'}`);
            
            if (grassObj.material && grassObj.material.uniforms) {
                console.log(`   - Uniforms: time=${grassObj.material.uniforms.time?.value}, windStrength=${grassObj.material.uniforms.windStrength?.value}`);
            }
        });
        
        return grassObjects;
    }

    /**
     * Test grass texture loading
     */
    testGrassTextures() {
        console.log('🧪 Testing Grass Textures...');
        
        try {
            // Check if texture manager exists
            if (window.textureManager || window.game?.textureManager) {
                const textureManager = window.textureManager || window.game.textureManager;
                
                const grassTextures = [
                    'GRASS_MEADOW_GRASS_DIFFUSE',
                    'GRASS_TALL_GRASS_DIFFUSE',
                    'GRASS_SHORT_GRASS_DIFFUSE',
                    'GRASS_WILD_GRASS_DIFFUSE',
                    'GRASS_MEADOW_GRASS_BILLBOARD',
                    'GRASS_TALL_GRASS_BILLBOARD',
                    'GRASS_SHORT_GRASS_BILLBOARD',
                    'GRASS_WILD_GRASS_BILLBOARD'
                ];
                
                console.log('🎨 Checking grass textures in PROP atlas...');
                
                grassTextures.forEach(textureName => {
                    const index = textureManager.getTextureIndex('PROP', textureName);
                    const exists = index >= 0;
                    console.log(`   ${textureName}: ${exists ? `✅ Index ${index}` : '❌ Missing'}`);
                });
                
                const propAtlas = textureManager.getAtlasTexture('PROP');
                console.log('📋 PROP Atlas:', propAtlas ? '✅ Loaded' : '❌ Missing');
                
                this.testResults.grassTextures = true;
            } else {
                console.warn('⚠️ TextureManager not found. Check window.textureManager or window.game.textureManager');
                this.testResults.grassTextures = false;
            }
            
        } catch (error) {
            console.error('❌ Grass texture test failed:', error);
            this.testResults.grassTextures = false;
        }
    }

    /**
     * Performance test - measure grass generation speed
     */
    performanceTest() {
        console.log('🚀 Running Grass Performance Test...');
        
        const startTime = performance.now();
        
        import('../world/features/grassFeature.js').then(({ GrassFeature }) => {
            const grassInstances = [];
            const clumpCount = 100;
            
            for (let i = 0; i < clumpCount; i++) {
                const clump = GrassFeature.createGrassClump({
                    centerPosition: { x: i * 5, y: 0, z: i * 3 },
                    grassType: 'MEADOW_GRASS',
                    clumpSize: 6,
                    clumpRadius: 0.4,
                    baseSeed: i * 1000
                });
                grassInstances.push(...clump);
            }
            
            const endTime = performance.now();
            const duration = endTime - startTime;
            
            console.log(`⚡ Performance Results:`);
            console.log(`   - Generated ${grassInstances.length} grass instances`);
            console.log(`   - Time taken: ${duration.toFixed(2)}ms`);
            console.log(`   - Instances per second: ${(grassInstances.length / (duration / 1000)).toFixed(0)}`);
            
            this.testResults.performance = {
                instanceCount: grassInstances.length,
                duration: duration,
                instancesPerSecond: grassInstances.length / (duration / 1000)
            };
        });
    }

    /**
     * Run all tests
     */
    runAllTests() {
        console.log('🧪 Running Complete Grass System Test Suite...');
        console.log('================================================');
        
        this.testGrassGeneration();
        setTimeout(() => this.testGrassGeometry(), 1000);
        setTimeout(() => this.testGrassTextures(), 2000);
        setTimeout(() => this.debugSceneGrass(), 3000);
        setTimeout(() => this.performanceTest(), 4000);
        
        setTimeout(() => {
            console.log('================================================');
            console.log('🏁 Test Suite Complete. Results:', this.testResults);
        }, 5000);
    }
}

// Make debugger globally available
window.GrassDebugger = GrassDebugger;
window.grassDebug = new GrassDebugger();

console.log('🌱 Grass Debugger loaded! Available commands:');
console.log('- grassDebug.runAllTests() - Run complete test suite');
console.log('- grassDebug.testGrassGeneration() - Test feature creation');
console.log('- grassDebug.testGrassGeometry() - Test geometry generation');
console.log('- grassDebug.testGrassTextures() - Test texture loading');
console.log('- grassDebug.debugSceneGrass() - Debug current scene grass');
console.log('- grassDebug.performanceTest() - Performance benchmark');
