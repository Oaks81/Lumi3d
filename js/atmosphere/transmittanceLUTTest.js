export class TransmittanceLUTTest {
    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async runAllTests(backend, atmosphereLUT, atmosphereSettings) {
        console.log('[TransmittanceLUTTest] Starting tests...');

        await this.testLUTInstantiation(atmosphereLUT);
        await this.testTextureDimensions(atmosphereLUT);
        await this.testTextureFormat(backend, atmosphereLUT);
        await this.testTexturePersistence(atmosphereLUT);
        await this.testSettingsInstantiation(atmosphereSettings);
        await this.testSettingsPresets();
        await this.testTextureCreationTime(backend);

        this.printResults();
        return this.testResults.failed === 0;
    }

    async testLUTInstantiation(atmosphereLUT) {
        const testName = 'AtmosphericScatteringLUT instantiates without errors';
        try {
            if (!atmosphereLUT) {
                throw new Error('atmosphereLUT is null or undefined');
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTextureDimensions(atmosphereLUT) {
        const testName = 'Transmittance LUT has correct dimensions (256x64)';
        try {
            const texture = atmosphereLUT.getTransmittanceLUT();
            if (!texture) {
                throw new Error('Transmittance LUT texture is null');
            }
            if (texture.width !== 256 || texture.height !== 64) {
                throw new Error(`Wrong dimensions: ${texture.width}x${texture.height}`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTextureFormat(backend, atmosphereLUT) {
        const testName = 'Transmittance LUT has correct format (RGBA16F)';
        try {
            const texture = atmosphereLUT.getTransmittanceLUT();
            if (texture.format !== 'rgba16f') {
                throw new Error(`Wrong format: ${texture.format}`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTexturePersistence(atmosphereLUT) {
        const testName = 'Texture persists until dispose() called';
        try {
            const texture1 = atmosphereLUT.getTransmittanceLUT();
            const texture2 = atmosphereLUT.getTransmittanceLUT();
            if (texture1 !== texture2) {
                throw new Error('Texture reference changed');
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testSettingsInstantiation(atmosphereSettings) {
        const testName = 'PlanetAtmosphereSettings instantiates without errors';
        try {
            if (!atmosphereSettings) {
                throw new Error('atmosphereSettings is null or undefined');
            }
            if (!atmosphereSettings.planetRadius) {
                throw new Error('Missing planetRadius');
            }
            if (!atmosphereSettings.atmosphereRadius) {
                throw new Error('Missing atmosphereRadius');
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testSettingsPresets() {
        const testName = 'PlanetAtmosphereSettings has presets (earth, mars, venus)';
        try {
            const { PlanetAtmosphereSettings } =
                await import('./PlanetAtmosphereSettings.js');

            const earth = PlanetAtmosphereSettings.createPreset('earth');
            const mars = PlanetAtmosphereSettings.createPreset('mars');
            const venus = PlanetAtmosphereSettings.createPreset('venus');

            if (!earth || !mars || !venus) {
                throw new Error('Missing preset(s)');
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTextureCreationTime(backend) {
        const testName = 'Texture creation < 50ms';
        try {
            const { Texture, TextureFormat } =
                await import('../renderer/resources/texture.js');

            const startTime = performance.now();

            const testTexture = new Texture({
                width: 256,
                height: 64,
                format: TextureFormat.RGBA16F,
                generateMipmaps: false
            });

            backend.createTexture(testTexture);

            const elapsed = performance.now() - startTime;

            if (testTexture._gpuTexture) {
                if (backend.getAPIName() === 'webgpu') {
                    testTexture._gpuTexture.texture.destroy();
                } else {
                    backend.gl.deleteTexture(testTexture._gpuTexture.glTexture);
                }
            }

            if (elapsed > 50) {
                throw new Error(`Creation took ${elapsed.toFixed(2)}ms`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    pass(testName) {
        this.testResults.passed++;
        this.testResults.tests.push({ name: testName, passed: true });
        console.log(`[PASS] ${testName}`);
    }

    fail(testName, message) {
        this.testResults.failed++;
        this.testResults.tests.push({
            name: testName,
            passed: false,
            message
        });
        console.error(`[FAIL] ${testName}: ${message}`);
    }

    printResults() {
        console.log('\n========================================');
        console.log('Transmittance LUT Test Results');
        console.log('========================================');
        console.log(`Passed: ${this.testResults.passed}`);
        console.log(`Failed: ${this.testResults.failed}`);
        console.log(`Total:  ${this.testResults.tests.length}`);
        console.log('========================================\n');
    }
}

window.testAtmosphereLUT = () => {
    console.log('LUT:', window.frontend.atmosphereLUT);
    console.log('Settings:', window.frontend.atmosphereSettings);

    const lut = window.frontend.atmosphereLUT;
    if (lut) {
        const texture = lut.getTransmittanceLUT();
        console.log('Texture valid:', texture !== null);
        console.log('Texture dimensions:', texture ?
            `${texture.width}x${texture.height}` : 'N/A');
        console.log('Texture format:', texture ? texture.format : 'N/A');
    }
    console.log('Backend:', window.frontend.backend.api);
};
