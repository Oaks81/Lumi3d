/**
 * Debug module for verifying chunk edge height continuity
 * Tests that adjacent chunks have matching heights at their borders
 */
export class ChunkDebugger {
    constructor(worldGenerator) {
        this.worldGenerator = worldGenerator;
        this.chunks = new Map();
    }

    /**
     * Generate a 2x2 grid of chunks and verify edge continuity
     * @param {number} centerX - Center chunk X coordinate
     * @param {number} centerY - Center chunk Y coordinate
     * @returns {Object} Debug report with verification results
     */
    debug2x2Chunks(centerX = 0, centerY = 0) {
        console.log(`\n=== Debugging 2x2 chunks starting at (${centerX}, ${centerY}) ===`);
        
        const chunks = this.generate2x2Chunks(centerX, centerY);
        
        const report = {
            chunks: chunks,
            edgeChecks: [],
            summary: {
                totalChecks: 0,
                passed: 0,
                failed: 0,
                maxDifference: 0
            }
        };

        report.edgeChecks.push(
            this.verifyHorizontalEdge(chunks.topLeft, chunks.topRight, 'Top Row'),
            this.verifyHorizontalEdge(chunks.bottomLeft, chunks.bottomRight, 'Bottom Row')
        );

        report.edgeChecks.push(
            this.verifyVerticalEdge(chunks.topLeft, chunks.bottomLeft, 'Left Column'),
            this.verifyVerticalEdge(chunks.topRight, chunks.bottomRight, 'Right Column')
        );

        report.edgeChecks.push(
            this.verifyInternalCorner(chunks)
        );

        report.edgeChecks.forEach(check => {
            report.summary.totalChecks += check.pointsChecked;
            report.summary.passed += check.passed;
            report.summary.failed += check.failed;
            report.summary.maxDifference = Math.max(
                report.summary.maxDifference, 
                check.maxDifference
            );
        });

        this.printReport(report);
        
        return report;
    }

    /**
     * Generate a 2x2 grid of chunks
     */
    generate2x2Chunks(startX, startY) {
        const chunks = {
            topLeft: this.getOrGenerateChunk(startX, startY),
            topRight: this.getOrGenerateChunk(startX + 1, startY),
            bottomLeft: this.getOrGenerateChunk(startX, startY + 1),
            bottomRight: this.getOrGenerateChunk(startX + 1, startY + 1)
        };

        console.log(`Generated chunks:`);
        console.log(`  Top-Left: (${startX}, ${startY})`);
        console.log(`  Top-Right: (${startX + 1}, ${startY})`);
        console.log(`  Bottom-Left: (${startX}, ${startY + 1})`);
        console.log(`  Bottom-Right: (${startX + 1}, ${startY + 1})`);

        return chunks;
    }

    /**
     * Get chunk from cache or generate new one
     */
    getOrGenerateChunk(x, y) {
        const key = `${x},${y}`;
        if (!this.chunks.has(key)) {
            this.chunks.set(key, this.worldGenerator.generateChunk(x, y));
        }
        return this.chunks.get(key);
    }

    /**
     * Verify horizontal edge between two chunks
     */
    verifyHorizontalEdge(leftChunk, rightChunk, label) {
        const size = leftChunk.size;
        const result = {
            label: `Horizontal Edge - ${label}`,
            leftChunk: `(${leftChunk.chunkX}, ${leftChunk.chunkY})`,
            rightChunk: `(${rightChunk.chunkX}, ${rightChunk.chunkY})`,
            pointsChecked: size + 1,
            passed: 0,
            failed: 0,
            maxDifference: 0,
            failures: []
        };

        console.log(`\nChecking horizontal edge: ${label}`);

        for (let y = 0; y <= size; y++) {
            const leftHeight = leftChunk.getHeight(size, y);
            const rightHeight = rightChunk.getHeight(0, y);
            const difference = Math.abs(leftHeight - rightHeight);

            if (difference < 0.001) {
                result.passed++;
            } else {
                result.failed++;
                result.failures.push({
                    y: y,
                    leftHeight: leftHeight,
                    rightHeight: rightHeight,
                    difference: difference
                });
                console.error(`  MISMATCH at y=${y}: left=${leftHeight.toFixed(4)}, right=${rightHeight.toFixed(4)}, diff=${difference.toFixed(4)}`);
            }

            result.maxDifference = Math.max(result.maxDifference, difference);
        }

        console.log(`  Result: ${result.passed}/${result.pointsChecked} passed`);
        return result;
    }

    /**
     * Verify vertical edge between two chunks
     */
    verifyVerticalEdge(topChunk, bottomChunk, label) {
        const size = topChunk.size;
        const result = {
            label: `Vertical Edge - ${label}`,
            topChunk: `(${topChunk.chunkX}, ${topChunk.chunkY})`,
            bottomChunk: `(${bottomChunk.chunkX}, ${bottomChunk.chunkY})`,
            pointsChecked: size + 1,
            passed: 0,
            failed: 0,
            maxDifference: 0,
            failures: []
        };

        console.log(`\nChecking vertical edge: ${label}`);

        for (let x = 0; x <= size; x++) {
            const topHeight = topChunk.getHeight(x, size);
            const bottomHeight = bottomChunk.getHeight(x, 0);
            const difference = Math.abs(topHeight - bottomHeight);

            if (difference < 0.001) {
                result.passed++;
            } else {
                result.failed++;
                result.failures.push({
                    x: x,
                    topHeight: topHeight,
                    bottomHeight: bottomHeight,
                    difference: difference
                });
                console.error(`  MISMATCH at x=${x}: top=${topHeight.toFixed(4)}, bottom=${bottomHeight.toFixed(4)}, diff=${difference.toFixed(4)}`);
            }

            result.maxDifference = Math.max(result.maxDifference, difference);
        }

        console.log(`  Result: ${result.passed}/${result.pointsChecked} passed`);
        return result;
    }

    /**
     * Verify the internal corner where all 4 chunks meet
     */
    verifyInternalCorner(chunks) {
        const size = chunks.topLeft.size;
        const result = {
            label: 'Internal Corner (4-way intersection)',
            pointsChecked: 1,
            passed: 0,
            failed: 0,
            maxDifference: 0,
            failures: []
        };

        console.log(`\nChecking internal corner where all 4 chunks meet`);

        const heights = {
            topLeft: chunks.topLeft.getHeight(size, size),
            topRight: chunks.topRight.getHeight(0, size),
            bottomLeft: chunks.bottomLeft.getHeight(size, 0),
            bottomRight: chunks.bottomRight.getHeight(0, 0)
        };

        const avgHeight = (heights.topLeft + heights.topRight + heights.bottomLeft + heights.bottomRight) / 4;
        let maxDiff = 0;

        Object.entries(heights).forEach(([corner, height]) => {
            const diff = Math.abs(height - avgHeight);
            maxDiff = Math.max(maxDiff, diff);
            console.log(`  ${corner}: ${height.toFixed(4)} (diff from avg: ${diff.toFixed(4)})`);
        });

        if (maxDiff < 0.001) {
            result.passed = 1;
            console.log('  All corners match!');
        } else {
            result.failed = 1;
            result.failures.push({
                heights: heights,
                maxDifference: maxDiff
            });
            console.error(`  Corner mismatch! Max difference: ${maxDiff.toFixed(4)}`);
        }

        result.maxDifference = maxDiff;
        return result;
    }

    /**
     * Print a formatted debug report
     */
    printReport(report) {
        console.log('\n' + '='.repeat(60));
        console.log('CHUNK EDGE VERIFICATION REPORT');
        console.log('='.repeat(60));
        
        console.log('\nSUMMARY:');
        console.log(`  Total Points Checked: ${report.summary.totalChecks}`);
        console.log(`  Passed: ${report.summary.passed} (${(report.summary.passed / report.summary.totalChecks * 100).toFixed(1)}%)`);
        console.log(`  Failed: ${report.summary.failed} (${(report.summary.failed / report.summary.totalChecks * 100).toFixed(1)}%)`);
        console.log(`  Maximum Height Difference: ${report.summary.maxDifference.toFixed(6)}`);

        if (report.summary.failed > 0) {
            console.log('\nFAILED CHECKS:');
            report.edgeChecks.forEach(check => {
                if (check.failed > 0) {
                    console.log(`\n  ${check.label}:`);
                    console.log(`    Failed: ${check.failed}/${check.pointsChecked}`);
                    console.log(`    Max Difference: ${check.maxDifference.toFixed(6)}`);
                    
                    // Show first few failures
                    const showCount = Math.min(3, check.failures.length);
                    console.log(`    First ${showCount} failures:`);
                    check.failures.slice(0, showCount).forEach(failure => {
                        console.log(`      ${JSON.stringify(failure)}`);
                    });
                    if (check.failures.length > showCount) {
                        console.log(`      ... and ${check.failures.length - showCount} more`);
                    }
                }
            });
        } else {
            console.log('\nALL EDGE HEIGHTS MATCH PERFECTLY!');
        }

        console.log('\n' + '='.repeat(60));
    }

    /**
     * Visual debug - create a simple ASCII representation of height differences
     */
    visualizeEdges(chunks) {
        const size = chunks.topLeft.size;
        console.log('\nVISUAL HEIGHT MAP (edges only):');
        console.log('Legend: . = match, X = mismatch\n');

        // Top edge
        process.stdout.write('     ');
        for (let x = 0; x <= size; x++) {
            const match = Math.abs(
                chunks.topLeft.getHeight(x, 0) - 
                chunks.topLeft.getHeight(x, 0)
            ) < 0.001;
            process.stdout.write(match ? '.' : 'X');
        }
        console.log();

        // Vertical edges and corners
        for (let y = 0; y <= size; y++) {
            // Left edge
            const leftMatch = y === 0 || y === size || Math.abs(
                chunks.topLeft.getHeight(0, y) - 
                chunks.topLeft.getHeight(0, y)
            ) < 0.001;
            process.stdout.write(leftMatch ? '.' : 'X');

            // Middle spaces
            process.stdout.write('   '.repeat(size));

            // Right edge
            const rightMatch = Math.abs(
                chunks.topLeft.getHeight(size, y) - 
                chunks.topRight.getHeight(0, y)
            ) < 0.001;
            process.stdout.write(rightMatch ? '.' : 'X');

            console.log();

            // Show horizontal divider at middle
            if (y === size) {
                process.stdout.write('     ');
                for (let x = 0; x <= size; x++) {
                    const match = Math.abs(
                        chunks.topLeft.getHeight(x, size) - 
                        chunks.bottomLeft.getHeight(x, 0)
                    ) < 0.001;
                    process.stdout.write(match ? '.' : 'X');
                }
                console.log();
            }
        }
    }
}
