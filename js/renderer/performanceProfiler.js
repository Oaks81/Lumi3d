export class PerformanceProfiler {
    constructor() {
        this.enabled = false;
        this.frameData = {};
        this.currentFrame = 0;
        this.history = [];
        this.maxHistoryFrames = 60;
        this.accumulators = {};
        this.timers = new Map();
        this.gpuQueries = new Map();
        this.hasWebGL2 = false;
        
        // Check for WebGL2 timer queries
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (gl) {
            this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            this.hasWebGL2 = !!this.ext;
            this.gl = gl;
        }
        
        // Categories
        this.categories = {
            'frame': { color: '#FF6B6B', parent: null },
            'update': { color: '#4ECDC4', parent: 'frame' },
            'render': { color: '#45B7D1', parent: 'frame' },
            'chunks': { color: '#96E6B3', parent: 'update' },
            'lighting': { color: '#F7DC6F', parent: 'render' },
            'shadows': { color: '#BB8FCE', parent: 'render' },
            'terrain': { color: '#85C1E2', parent: 'render' },
            'water': { color: '#F8C471', parent: 'render' },
            'postprocess': { color: '#AED6F1', parent: 'render' },
            'gpu': { color: '#FF9999', parent: null }
        };
        
        this.reset();
    }

    reset() {
        this.frameData = {
            frameNumber: this.currentFrame,
            timestamp: performance.now(),
            timings: {},
            gpuTimings: {},
            counts: {},
            memory: {}
        };
        this.timers.clear();
    }

    // CPU timing
    startTimer(name, category = null) {
        if (!this.enabled) return;
        
        const timer = {
            name,
            category: category || this.guessCategory(name),
            startTime: performance.now(),
            children: []
        };
        
        this.timers.set(name, timer);
        return timer;
    }

    endTimer(name) {
        if (!this.enabled) return;
        
        const timer = this.timers.get(name);
        if (!timer) return;
        
        timer.endTime = performance.now();
        timer.duration = timer.endTime - timer.startTime;
        
        if (!this.frameData.timings[timer.category]) {
            this.frameData.timings[timer.category] = {};
        }
        
        this.frameData.timings[timer.category][name] = {
            duration: timer.duration,
            startTime: timer.startTime - this.frameData.timestamp,
            endTime: timer.endTime - this.frameData.timestamp
        };
        
        // Update accumulator
        const key = `${timer.category}.${name}`;
        if (!this.accumulators[key]) {
            this.accumulators[key] = {
                total: 0,
                count: 0,
                min: Infinity,
                max: 0,
                avg: 0
            };
        }
        
        const acc = this.accumulators[key];
        acc.total += timer.duration;
        acc.count++;
        acc.min = Math.min(acc.min, timer.duration);
        acc.max = Math.max(acc.max, timer.duration);
        acc.avg = acc.total / acc.count;
        
        return timer.duration;
    }

    // GPU timing (WebGL2 only)
    startGPUTimer(name, gl = null) {
        if (!this.enabled || !this.hasWebGL2) return null;
        
        const glContext = gl || this.gl;
        if (!glContext) return null;
        
        const query = glContext.createQuery();
        glContext.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
        
        this.gpuQueries.set(name, {
            query,
            name,
            startTime: performance.now()
        });
        
        return query;
    }

    endGPUTimer(name, gl = null) {
        if (!this.enabled || !this.hasWebGL2) return;
        
        const glContext = gl || this.gl;
        if (!glContext) return;
        
        const queryData = this.gpuQueries.get(name);
        if (!queryData) return;
        
        glContext.endQuery(this.ext.TIME_ELAPSED_EXT);
        
        // Check result asynchronously
        setTimeout(() => {
            const available = glContext.getQueryParameter(queryData.query, glContext.QUERY_RESULT_AVAILABLE);
            if (available) {
                const timeElapsed = glContext.getQueryParameter(queryData.query, glContext.QUERY_RESULT);
                const timeMs = timeElapsed / 1000000; // Convert nanoseconds to milliseconds
                
                if (!this.frameData.gpuTimings[name]) {
                    this.frameData.gpuTimings[name] = [];
                }
                this.frameData.gpuTimings[name].push(timeMs);
                
                glContext.deleteQuery(queryData.query);
                this.gpuQueries.delete(name);
            }
        }, 0);
    }

    // Counting operations
    count(name, value = 1) {
        if (!this.enabled) return;
        
        if (!this.frameData.counts[name]) {
            this.frameData.counts[name] = 0;
        }
        this.frameData.counts[name] += value;
    }

    // Memory tracking
    trackMemory() {
        if (!this.enabled) return;
        
        if (performance.memory) {
            this.frameData.memory = {
                used: performance.memory.usedJSHeapSize / 1048576, // Convert to MB
                total: performance.memory.totalJSHeapSize / 1048576,
                limit: performance.memory.jsHeapSizeLimit / 1048576
            };
        }
    }

    // Frame management
    endFrame() {
        if (!this.enabled) return;
        
        this.trackMemory();
        
        // Calculate frame time
        const now = performance.now();
        this.frameData.frameTime = now - this.frameData.timestamp;
        this.frameData.fps = 1000 / this.frameData.frameTime;
        
        // Add to history
        this.history.push(this.frameData);
        if (this.history.length > this.maxHistoryFrames) {
            this.history.shift();
        }
        
        this.currentFrame++;
        
        // Auto-log every 60 frames
        if (this.currentFrame % 60 === 0) {
            this.logSummary();
        }
        
        // Reset for next frame
        this.reset();
    }

    // Analysis functions
    getHierarchicalReport() {
        const report = {
            name: 'Frame',
            duration: this.frameData.frameTime,
            children: []
        };
        
        // Build hierarchy
        for (const [category, timings] of Object.entries(this.frameData.timings)) {
            const categoryData = {
                name: category,
                duration: 0,
                children: []
            };
            
            for (const [name, data] of Object.entries(timings)) {
                categoryData.children.push({
                    name,
                    duration: data.duration,
                    percentage: (data.duration / this.frameData.frameTime) * 100
                });
                categoryData.duration += data.duration;
            }
            
            categoryData.percentage = (categoryData.duration / this.frameData.frameTime) * 100;
            report.children.push(categoryData);
        }
        
        return report;
    }

    getAverages() {
        if (this.history.length === 0) return null;
        
        const avgData = {
            fps: 0,
            frameTime: 0,
            categories: {},
            gpu: {},
            memory: { used: 0, total: 0 }
        };
        
        // Calculate averages
        for (const frame of this.history) {
            avgData.fps += frame.fps;
            avgData.frameTime += frame.frameTime;
            
            for (const [category, timings] of Object.entries(frame.timings)) {
                if (!avgData.categories[category]) {
                    avgData.categories[category] = {};
                }
                
                for (const [name, data] of Object.entries(timings)) {
                    if (!avgData.categories[category][name]) {
                        avgData.categories[category][name] = 0;
                    }
                    avgData.categories[category][name] += data.duration;
                }
            }
            
            if (frame.memory.used) {
                avgData.memory.used += frame.memory.used;
                avgData.memory.total += frame.memory.total;
            }
        }
        
        // Normalize
        const count = this.history.length;
        avgData.fps /= count;
        avgData.frameTime /= count;
        avgData.memory.used /= count;
        avgData.memory.total /= count;
        
        for (const category of Object.keys(avgData.categories)) {
            for (const name of Object.keys(avgData.categories[category])) {
                avgData.categories[category][name] /= count;
            }
        }
        
        return avgData;
    }

    // Logging
    logSummary() {
        const avg = this.getAverages();
        if (!avg) return;
        
        console.group(`🎮 Performance Summary (last ${this.history.length} frames)`);
        console.log(`📊 Average FPS: ${avg.fps.toFixed(1)}`);
        console.log(`⏱️ Average Frame Time: ${avg.frameTime.toFixed(2)}ms`);
        console.log(`💾 Memory: ${avg.memory.used.toFixed(1)}MB / ${avg.memory.total.toFixed(1)}MB`);
        
        console.group('📈 Timing Breakdown:');
        for (const [category, timings] of Object.entries(avg.categories)) {
            const categoryTotal = Object.values(timings).reduce((a, b) => a + b, 0);
            const percentage = (categoryTotal / avg.frameTime) * 100;
            
            console.group(`${category}: ${categoryTotal.toFixed(2)}ms (${percentage.toFixed(1)}%)`);
            
            const sorted = Object.entries(timings).sort((a, b) => b[1] - a[1]);
            for (const [name, time] of sorted) {
                const pct = (time / avg.frameTime) * 100;
                console.log(`  ${name}: ${time.toFixed(2)}ms (${pct.toFixed(1)}%)`);
            }
            console.groupEnd();
        }
        console.groupEnd();
        
        // Log GPU timings if available
        if (Object.keys(this.frameData.gpuTimings).length > 0) {
            console.group('🎨 GPU Timings:');
            for (const [name, times] of Object.entries(this.frameData.gpuTimings)) {
                const avg = times.reduce((a, b) => a + b, 0) / times.length;
                console.log(`  ${name}: ${avg.toFixed(2)}ms`);
            }
            console.groupEnd();
        }
        
        // Log counts
        if (Object.keys(this.frameData.counts).length > 0) {
            console.group('📊 Counts:');
            for (const [name, count] of Object.entries(this.frameData.counts)) {
                console.log(`  ${name}: ${count}`);
            }
            console.groupEnd();
        }
        
        console.groupEnd();
    }

    // Visualization
    getFlameGraphData() {
        const hierarchy = this.getHierarchicalReport();
        
        const flatten = (node, level = 0, start = 0) => {
            const result = [{
                name: node.name,
                value: node.duration,
                level,
                start,
                color: this.categories[node.name]?.color || '#888888'
            }];
            
            let childStart = start;
            if (node.children) {
                for (const child of node.children) {
                    result.push(...flatten(child, level + 1, childStart));
                    childStart += child.duration;
                }
            }
            
            return result;
        };
        
        return flatten(hierarchy);
    }

    // Helper
    guessCategory(name) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('chunk')) return 'chunks';
        if (lowerName.includes('light')) return 'lighting';
        if (lowerName.includes('shadow')) return 'shadows';
        if (lowerName.includes('terrain')) return 'terrain';
        if (lowerName.includes('water')) return 'water';
        if (lowerName.includes('post')) return 'postprocess';
        if (lowerName.includes('update')) return 'update';
        if (lowerName.includes('render')) return 'render';
        return 'frame';
    }

    // Export data
    exportCSV() {
        const csv = [];
        csv.push('Frame,FPS,FrameTime,Category,Operation,Duration,Percentage');
        
        for (const frame of this.history) {
            for (const [category, timings] of Object.entries(frame.timings)) {
                for (const [name, data] of Object.entries(timings)) {
                    csv.push([
                        frame.frameNumber,
                        frame.fps.toFixed(1),
                        frame.frameTime.toFixed(2),
                        category,
                        name,
                        data.duration.toFixed(3),
                        ((data.duration / frame.frameTime) * 100).toFixed(2)
                    ].join(','));
                }
            }
        }
        
        return csv.join('\n');
    }
}

// Singleton instance
export const profiler = new PerformanceProfiler();