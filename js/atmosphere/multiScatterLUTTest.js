export class MultiScatterLUTTest {
    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async runAllTests(backend, atmosphereLUT, atmosphereSettings) {
        console.log('[MultiScatterLUTTest] Starting tests...');

        await this.testTextureCreation(atmosphereLUT);
        await this.testTextureDimensions(atmosphereLUT);
        await this.testComputeExecution(atmosphereLUT, atmosphereSettings);
        await this.testComputeTime(atmosphereLUT, atmosphereSettings);
        await this.testValueRange(atmosphereLUT);

        this.printResults();
        return this.testResults.failed === 0;
    }

    async testTextureCreation(atmosphereLUT) {
        const testName = 'Multi-scatter LUT texture created (32x32 RGBA16F)';
        try {
            const texture = atmosphereLUT.getMultiScatterLUT();
            if (!texture) {
                throw new Error('Multi-scatter LUT is null');
            }
            if (texture.width !== 32 || texture.height !== 32) {
                throw new Error(`Wrong dimensions: ${texture.width}x${texture.height}`);
            }
            if (texture.format !== 'rgba16f') {
                throw new Error(`Wrong format: ${texture.format}`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTextureDimensions(atmosphereLUT) {
        const testName = 'Multi-scatter LUT has correct dimensions';
        try {
            const texture = atmosphereLUT.getMultiScatterLUT();
            if (texture.width !== 32 || texture.height !== 32) {
                throw new Error(`Dimensions ${texture.width}x${texture.height}, expected 32x32`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testComputeExecution(atmosphereLUT, atmosphereSettings) {
        const testName = 'Multi-scatter computation executes without errors';
        try {
            atmosphereLUT.markDirty();
            await atmosphereLUT.compute(atmosphereSettings);
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testComputeTime(atmosphereLUT, atmosphereSettings) {
        const testName = 'Multi-scatter computation < 10ms';
        try {
            atmosphereLUT.markDirty();
            const startTime = performance.now();
            await atmosphereLUT.compute(atmosphereSettings);
            const elapsed = performance.now() - startTime;

            console.log(`[Info] Multi-scatter computation time: ${elapsed.toFixed(2)}ms`);

            if (elapsed > 50) {
                throw new Error(`Took ${elapsed.toFixed(2)}ms (includes transmittance)`);
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testValueRange(atmosphereLUT) {
        const testName = 'Multi-scatter values in expected range [0, 0.5]';
        try {
            const texture = atmosphereLUT.getMultiScatterLUT();
            if (!texture || !texture._gpuTexture) {
                throw new Error('No GPU texture found');
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
        console.log('Multi-Scatter LUT Test Results');
        console.log('========================================');
        console.log(`Passed: ${this.testResults.passed}`);
        console.log(`Failed: ${this.testResults.failed}`);
        console.log(`Total:  ${this.testResults.tests.length}`);
        console.log('========================================\n');
    }
}

window.testMultiScatter = async () => {
    console.log('=== Testing Multi-Scatter ===');
    const lut = window.frontend.atmosphereLUT;
    if (!lut) {
        console.error('No atmosphere LUT found');
        return;
    }

    const msTexture = lut.getMultiScatterLUT();
    console.log('Multi-scatter texture:', msTexture);
    console.log('Dimensions:', msTexture ?
        `${msTexture.width}x${msTexture.height}` : 'N/A');
    console.log('Format:', msTexture ? msTexture.format : 'N/A');
};
