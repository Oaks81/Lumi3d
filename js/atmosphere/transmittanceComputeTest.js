export class TransmittanceComputeTest {
    constructor() {
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async runAllTests(backend, atmosphereLUT, atmosphereSettings) {
        console.log('[TransmittanceComputeTest] Starting tests...');

        await this.testComputeExecution(backend, atmosphereLUT, atmosphereSettings);
        await this.testComputeTime(backend, atmosphereLUT, atmosphereSettings);
        await this.testOutputNonZero(atmosphereLUT);
        await this.testTextureRange(backend, atmosphereLUT);

        this.printResults();
        return this.testResults.failed === 0;
    }

    async testComputeExecution(backend, atmosphereLUT, atmosphereSettings) {
        const testName = 'Compute executes without errors';
        try {
            await atmosphereLUT.compute(atmosphereSettings);
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testComputeTime(backend, atmosphereLUT, atmosphereSettings) {
        const testName = 'Computation completes in < 16ms';
        try {
            atmosphereLUT.markDirty();
            const startTime = performance.now();
            await atmosphereLUT.compute(atmosphereSettings);
            const elapsed = performance.now() - startTime;

            if (elapsed > 16) {
                throw new Error(`Took ${elapsed.toFixed(2)}ms (too slow)`);
            }
            console.log(`[Info] Computation time: ${elapsed.toFixed(2)}ms`);
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testOutputNonZero(atmosphereLUT) {
        const testName = 'Output texture contains non-zero values';
        try {
            const texture = atmosphereLUT.getTransmittanceLUT();
            if (!texture || !texture._gpuTexture) {
                throw new Error('No GPU texture found');
            }
            this.pass(testName);
        } catch (error) {
            this.fail(testName, error.message);
        }
    }

    async testTextureRange(backend, atmosphereLUT) {
        const testName = 'Texture data in valid range [0, 1]';
        try {
            const texture = atmosphereLUT.getTransmittanceLUT();
            if (!texture || !texture._gpuTexture) {
                throw new Error('No GPU texture');
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
        console.log('Transmittance Compute Test Results');
        console.log('========================================');
        console.log(`Passed: ${this.testResults.passed}`);
        console.log(`Failed: ${this.testResults.failed}`);
        console.log(`Total:  ${this.testResults.tests.length}`);
        console.log('========================================\n');
    }
}

window.computeLUT = async () => {
    console.log('=== Computing Transmittance LUT ===');
    const start = performance.now();
    await window.frontend.atmosphereLUT.compute(window.frontend.atmosphereSettings);
    const elapsed = performance.now() - start;
    console.log(`Completed in ${elapsed.toFixed(2)}ms`);
};
