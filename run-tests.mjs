import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:8765';

async function runTest(page, testUrl, testName) {
    console.log(`\n=== Running ${testName} ===`);

    try {
        await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 10000 });

        // Wait for tests to complete
        await page.waitForSelector('#summary', { timeout: 5000 });

        // Get results
        const summary = await page.$eval('#summary', el => el.textContent);
        const results = await page.$$eval('.test', els =>
            els.map(el => ({
                passed: el.classList.contains('pass'),
                text: el.textContent
            }))
        );

        console.log(summary);
        results.forEach(r => {
            console.log(`  ${r.passed ? 'PASS' : 'FAIL'}: ${r.text.substring(0, 80)}`);
        });

        const allPassed = results.every(r => r.passed);
        return { name: testName, passed: allPassed, summary };
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
        return { name: testName, passed: false, error: e.message };
    }
}

async function main() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // Collect console logs
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`  [Console Error] ${msg.text()}`);
        }
    });

    const tests = [
        { url: `${BASE_URL}/test-horizon-scattering.html`, name: 'Horizon Scattering (3.3)' },
        { url: `${BASE_URL}/test-altitude-fog.html`, name: 'Altitude Fog (3.2)' },
        { url: `${BASE_URL}/test-aerial-perspective.html`, name: 'Aerial Perspective (3.1)' },
        { url: `${BASE_URL}/test-lut-regeneration.html`, name: 'LUT Regeneration (2.4)' },
    ];

    const results = [];
    for (const test of tests) {
        const result = await runTest(page, test.url, test.name);
        results.push(result);
    }

    await browser.close();

    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    console.log(`${passed}/${results.length} test suites passed`);

    process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
