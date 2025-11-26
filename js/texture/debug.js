// debugAtlas.js - Add this to your project for testing

import { TextureAtlasManager } from './TextureManager.js';
import { TEXTURE_LEVELS, SEASONS, TILE_CONFIG } from './TileConfig.js';
import { TILE_TYPES } from '../types.js';

// Test configuration that matches between file-based and procedural
export const TEST_CONFIG = {
    tilesToTest: [
        TILE_TYPES.GRASS,
        TILE_TYPES.STONE,
        TILE_TYPES.TUNDRA,
        TILE_TYPES.ROCK
    ],
    seasonsToTest: Object.values(SEASONS),
    levelsToTest: [
        TEXTURE_LEVELS.MICRO,
        TEXTURE_LEVELS.MACRO_1024
    ]
};

export async function downloadAllAtlases(atlasManager, prefix = 'atlas') {
    for (const [level, atlas] of atlasManager.atlases.entries()) {
      const link = document.createElement('a');
      link.download = `${prefix}_${level}.png`;

      link.href = atlas.canvas.toDataURL('image/png');
      link.click();
      await new Promise(r => setTimeout(r, 200)); // give browser a moment
    }
  }

// Function 1: Render atlas to a visible canvas
export function renderAtlasToCanvas(atlasManager, level, canvasId = null) {
    const atlas = atlasManager.atlases.get(level);
    if (!atlas || !atlas.canvas) {
        console.error(`No atlas found for level: ${level}`);
        return null;
    }

    // Create or get canvas element
    let displayCanvas;
    if (canvasId) {
        displayCanvas = document.getElementById(canvasId);
        if (!displayCanvas) {
            displayCanvas = document.createElement('canvas');
            displayCanvas.id = canvasId;
            document.body.appendChild(displayCanvas);
        }
    } else {
        displayCanvas = document.createElement('canvas');
        document.body.appendChild(displayCanvas);
    }

    // Copy atlas to display canvas
    displayCanvas.width = atlas.canvas.width;
    displayCanvas.height = atlas.canvas.height;
    const ctx = displayCanvas.getContext('2d');
    ctx.drawImage(atlas.canvas, 0, 0);

    // Draw grid overlay to show tile boundaries
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    
    if (atlas.layout) {
        const { paddedTextureSize, tilesPerRow, rows } = atlas.layout;
        
        // Draw vertical lines
        for (let i = 0; i <= tilesPerRow; i++) {
            ctx.beginPath();
            ctx.moveTo(i * paddedTextureSize, 0);
            ctx.lineTo(i * paddedTextureSize, rows * paddedTextureSize);
            ctx.stroke();
        }
        
        // Draw horizontal lines
        for (let i = 0; i <= rows; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * paddedTextureSize);
            ctx.lineTo(tilesPerRow * paddedTextureSize, i * paddedTextureSize);
            ctx.stroke();
        }

        // Draw actual texture boundaries (inside padding)
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        const padding = atlasManager.PADDING;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < tilesPerRow; col++) {
                const x = col * paddedTextureSize + padding;
                const y = row * paddedTextureSize + padding;
                ctx.strokeRect(x, y, atlas.layout.textureSize, atlas.layout.textureSize);
            }
        }
    }

    // Add label
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.font = 'bold 16px Arial';
    const label = `Atlas: ${level}`;
    ctx.strokeText(label, 10, 25);
    ctx.fillText(label, 10, 25);

    displayCanvas.style.border = '2px solid blue';
    displayCanvas.style.margin = '10px';
    displayCanvas.style.maxWidth = '100%';
    displayCanvas.style.height = 'auto';

    console.log(`Rendered atlas for ${level} to canvas ${canvasId || '(auto)'}`);
    return displayCanvas;
}

// Function 2: Comprehensive atlas debug logger
export function debugAtlasDetails(atlasManager, level) {
    const atlas = atlasManager.atlases.get(level);
    
    if (!atlas) {
        console.error(`❌ No atlas found for level: ${level}`);
        return;
    }

    console.group(`📊 ATLAS DEBUG: ${level}`);
    
    // Basic info
    console.group('📐 Basic Properties');
    console.log('Canvas exists:', !!atlas.canvas);
    console.log('Canvas dimensions:', atlas.canvas ? `${atlas.canvas.width}x${atlas.canvas.height}` : 'N/A');
    console.log('Context exists:', !!atlas.context);
    console.log('Texture exists:', !!atlas.texture);
    console.log('Texture needsUpdate:', atlas.texture?.needsUpdate);
    console.groupEnd();

    // Layout info
    console.group('📏 Layout Configuration');
    if (atlas.layout) {
        console.table({
            'Atlas Size': atlas.layout.atlasSize,
            'Texture Size': atlas.layout.textureSize,
            'Padded Texture Size': atlas.layout.paddedTextureSize,
            'Padding': atlas.layout.padding || atlasManager.PADDING,
            'Tiles Per Row': atlas.layout.tilesPerRow,
            'Rows': atlas.layout.rows,
            'Total Textures': atlas.layout.totalTextures,
            'Max Capacity': atlas.layout.maxCapacity
        });
    } else {
        console.log('❌ No layout defined');
    }
    console.groupEnd();

    // Texture mappings
    console.group('🗺️ Texture Mappings');
    console.log('textureMap size:', atlas.textureMap.size);
    console.log('seasonalTextureMap size:', atlas.seasonalTextureMap.size);
    
    // Sample some mappings
    if (atlas.seasonalTextureMap.size > 0) {
        console.group('Sample Seasonal Mappings (first 10):');
        let count = 0;
        for (const [key, index] of atlas.seasonalTextureMap.entries()) {
            if (count++ >= 10) break;
            const [tileType, season, variant] = key.split(':');
            const tileName = TILE_CONFIG.find(t => t.id == tileType)?.name || 'Unknown';
            console.log(`  ${tileName} (${tileType}) ${season} v${variant} → index ${index}`);
        }
        console.groupEnd();
    }

    if (atlas.textureMap.size > 0) {
        console.group('Sample Path Mappings (first 5):');
        let count = 0;
        for (const [path, index] of atlas.textureMap.entries()) {
            if (count++ >= 5) break;
            console.log(`  ${path} → index ${index}`);
        }
        console.groupEnd();
    }
    console.groupEnd();

    // UV Calculations verification
    console.group('📍 UV Calculation Test');
    for (let testIndex of [0, 1, 2]) {
        const uv = atlasManager.calculateUVFromIndex(level, testIndex);
        if (uv) {
            console.log(`Index ${testIndex}:`, {
                u1: uv.u1.toFixed(4),
                v1: uv.v1.toFixed(4),
                u2: uv.u2.toFixed(4),
                v2: uv.v2.toFixed(4),
                width: (uv.u2 - uv.u1).toFixed(4),
                height: (uv.v2 - uv.v1).toFixed(4)
            });
        }
    }
    console.groupEnd();

    // Test specific tile lookups
    console.group('🔍 Tile Lookup Tests');
    for (const tileType of TEST_CONFIG.tilesToTest) {
        const tileName = TILE_CONFIG.find(t => t.id === tileType)?.name || 'Unknown';
        console.group(`${tileName} (${tileType})`);
        
        for (const season of TEST_CONFIG.seasonsToTest) {
            // Try variant 0
            const key = `${tileType}:${season}:0`;
            const index = atlas.seasonalTextureMap.get(key);
            const uv = index !== undefined ? atlasManager.calculateUVFromIndex(level, index) : null;
            
            console.log(`${season}:`, {
                key: key,
                atlasIndex: index !== undefined ? index : 'MISSING',
                uvExists: !!uv,
                uv: uv ? `(${uv.u1.toFixed(3)},${uv.v1.toFixed(3)})-(${uv.u2.toFixed(3)},${uv.v2.toFixed(3)})` : 'N/A'
            });
        }
        console.groupEnd();
    }
    console.groupEnd();

    // Canvas pixel sampling
    console.group('🎨 Canvas Pixel Sampling');
    if (atlas.canvas && atlas.context && atlas.layout) {
        const { paddedTextureSize, textureSize } = atlas.layout;
        const padding = atlas.layout.padding || atlasManager.PADDING;
        
        // Sample first 3 tiles
        for (let i = 0; i < Math.min(3, atlas.layout.totalTextures); i++) {
            const row = Math.floor(i / atlas.layout.tilesPerRow);
            const col = i % atlas.layout.tilesPerRow;
            
            const x = col * paddedTextureSize + padding;
            const y = row * paddedTextureSize + padding;
            
            // Sample center pixel
            const centerX = x + Math.floor(textureSize / 2);
            const centerY = y + Math.floor(textureSize / 2);
            const centerPixel = atlas.context.getImageData(centerX, centerY, 1, 1).data;
            
            // Sample corner pixels
            const tlPixel = atlas.context.getImageData(x, y, 1, 1).data;
            const trPixel = atlas.context.getImageData(x + textureSize - 1, y, 1, 1).data;
            
            console.log(`Tile ${i} (${col},${row}):`, {
                position: `(${x},${y})`,
                center: `rgb(${centerPixel[0]},${centerPixel[1]},${centerPixel[2]})`,
                topLeft: `rgb(${tlPixel[0]},${tlPixel[1]},${tlPixel[2]})`,
                topRight: `rgb(${trPixel[0]},${trPixel[1]},${trPixel[2]})`
            });
        }
    }
    console.groupEnd();

    // Three.js texture properties
    console.group('🎮 Three.js Texture Properties');
    if (atlas.texture) {
        console.table({
            'UUID': atlas.texture.uuid,
            'Format': atlas.texture.format,
            'Type': atlas.texture.type,
            'Encoding': atlas.texture.encoding,
            'MinFilter': atlas.texture.minFilter,
            'MagFilter': atlas.texture.magFilter,
            'WrapS': atlas.texture.wrapS,
            'WrapT': atlas.texture.wrapT,
            'GenerateMipmaps': atlas.texture.generateMipmaps,
            'Anisotropy': atlas.texture.anisotropy,
            'NeedsUpdate': atlas.texture.needsUpdate
        });
    }
    console.groupEnd();

    console.groupEnd(); // End main group
}

// Add to debugAtlas.js - Detailed comparison function
export function compareAtlasImplementations(fileAtlas, procAtlas, level) {
    console.group(`🔬 DETAILED COMPARISON: ${level}`);
    
    const fileAtlasData = fileAtlas.atlases.get(level);
    const procAtlasData = procAtlas.atlases.get(level);
    
    // 1. Canvas Properties
    console.group('🖼️ Canvas Properties');
    console.table({
        'Canvas Width': {
            file: fileAtlasData.canvas?.width,
            proc: procAtlasData.canvas?.width,
            match: fileAtlasData.canvas?.width === procAtlasData.canvas?.width
        },
        'Canvas Height': {
            file: fileAtlasData.canvas?.height,
            proc: procAtlasData.canvas?.height,
            match: fileAtlasData.canvas?.height === procAtlasData.canvas?.height
        }
    });
    console.groupEnd();
    
    // 2. Layout Properties
    console.group('📐 Layout Properties');
    const layoutProps = ['atlasSize', 'textureSize', 'paddedTextureSize', 'padding', 'tilesPerRow', 'rows', 'totalTextures', 'maxCapacity'];
    const layoutComparison = {};
    
    for (const prop of layoutProps) {
        const fileVal = fileAtlasData.layout?.[prop];
        const procVal = procAtlasData.layout?.[prop];
        layoutComparison[prop] = {
            file: fileVal,
            proc: procVal,
            match: fileVal === procVal
        };
    }
    console.table(layoutComparison);
    console.groupEnd();
    
    // 3. Three.js Texture Properties
    console.group('🎮 Three.js Texture Properties');
    const textureProps = ['minFilter', 'magFilter', 'wrapS', 'wrapT', 'generateMipmaps', 'anisotropy', 'format', 'type', 'encoding'];
    const textureComparison = {};
    
    for (const prop of textureProps) {
        const fileVal = fileAtlasData.texture?.[prop];
        const procVal = procAtlasData.texture?.[prop];
        textureComparison[prop] = {
            file: fileVal,
            proc: procVal,
            match: fileVal === procVal
        };
    }
    console.table(textureComparison);
    console.groupEnd();
    
    // 4. UV Coordinate Comparison for same tiles
    console.group('📍 UV Coordinate Comparison');
    const testIndices = [0, 1, 2, 3];
    
    for (const index of testIndices) {
        if (index >= fileAtlasData.layout.totalTextures || index >= procAtlasData.layout.totalTextures) {
            continue;
        }
        
        const fileUV = fileAtlas.calculateUVFromIndex(level, index);
        const procUV = procAtlas.calculateUVFromIndex(level, index);
        
        console.log(`Index ${index}:`);
        console.table({
            'u1': { file: fileUV.u1.toFixed(6), proc: procUV.u1.toFixed(6), diff: Math.abs(fileUV.u1 - procUV.u1).toFixed(8) },
            'v1': { file: fileUV.v1.toFixed(6), proc: procUV.v1.toFixed(6), diff: Math.abs(fileUV.v1 - procUV.v1).toFixed(8) },
            'u2': { file: fileUV.u2.toFixed(6), proc: procUV.u2.toFixed(6), diff: Math.abs(fileUV.u2 - procUV.u2).toFixed(8) },
            'v2': { file: fileUV.v2.toFixed(6), proc: procUV.v2.toFixed(6), diff: Math.abs(fileUV.v2 - procUV.v2).toFixed(8) },
            'width': { file: (fileUV.u2 - fileUV.u1).toFixed(6), proc: (procUV.u2 - procUV.u1).toFixed(6), diff: Math.abs((fileUV.u2 - fileUV.u1) - (procUV.u2 - procUV.u1)).toFixed(8) },
            'height': { file: (fileUV.v2 - fileUV.v1).toFixed(6), proc: (procUV.v2 - procUV.v1).toFixed(6), diff: Math.abs((fileUV.v2 - fileUV.v1) - (procUV.v2 - procUV.v1)).toFixed(8) }
        });
    }
    console.groupEnd();
    
    // 5. Tile Position Comparison
    console.group('🎯 Tile Position Comparison (Pixel Coordinates)');
    const layout = fileAtlasData.layout;
    
    for (const index of testIndices) {
        if (index >= layout.totalTextures) continue;
        
        const row = Math.floor(index / layout.tilesPerRow);
        const col = index % layout.tilesPerRow;
        
        const filePadding = fileAtlasData.layout.padding || fileAtlas.PADDING;
        const procPadding = procAtlasData.layout.padding || procAtlas.PADDING;
        
        const fileX = col * fileAtlasData.layout.paddedTextureSize + filePadding;
        const fileY = row * fileAtlasData.layout.paddedTextureSize + filePadding;
        
        const procX = col * procAtlasData.layout.paddedTextureSize + procPadding;
        const procY = row * procAtlasData.layout.paddedTextureSize + procPadding;
        
        console.log(`Index ${index} (${col}, ${row}):`);
        console.table({
            'X Position': { file: fileX, proc: procX, match: fileX === procX },
            'Y Position': { file: fileY, proc: procY, match: fileY === procY },
            'Padding Used': { file: filePadding, proc: procPadding, match: filePadding === procPadding },
            'Padded Size': { 
                file: fileAtlasData.layout.paddedTextureSize, 
                proc: procAtlasData.layout.paddedTextureSize, 
                match: fileAtlasData.layout.paddedTextureSize === procAtlasData.layout.paddedTextureSize 
            }
        });
    }
    console.groupEnd();
    
    // 6. Pixel Sampling Comparison
    console.group('🎨 Pixel Sampling Comparison');
    if (fileAtlasData.canvas && procAtlasData.canvas && fileAtlasData.context && procAtlasData.context) {
        for (const index of testIndices.slice(0, 2)) { // Just check first 2 to avoid clutter
            if (index >= layout.totalTextures) continue;
            
            const row = Math.floor(index / layout.tilesPerRow);
            const col = index % layout.tilesPerRow;
            
            const filePadding = fileAtlasData.layout.padding || fileAtlas.PADDING;
            const procPadding = procAtlasData.layout.padding || procAtlas.PADDING;
            
            const fileX = col * fileAtlasData.layout.paddedTextureSize + filePadding;
            const fileY = row * fileAtlasData.layout.paddedTextureSize + filePadding;
            const procX = col * procAtlasData.layout.paddedTextureSize + procPadding;
            const procY = row * procAtlasData.layout.paddedTextureSize + procPadding;
            
            // Sample corners and center
            const samplePoints = [
                { name: 'Top-Left', dx: 0, dy: 0 },
                { name: 'Top-Right', dx: layout.textureSize - 1, dy: 0 },
                { name: 'Bottom-Left', dx: 0, dy: layout.textureSize - 1 },
                { name: 'Bottom-Right', dx: layout.textureSize - 1, dy: layout.textureSize - 1 },
                { name: 'Center', dx: Math.floor(layout.textureSize / 2), dy: Math.floor(layout.textureSize / 2) }
            ];
            
            console.log(`Tile ${index}:`);
            for (const point of samplePoints) {
                const filePixel = fileAtlasData.context.getImageData(fileX + point.dx, fileY + point.dy, 1, 1).data;
                const procPixel = procAtlasData.context.getImageData(procX + point.dx, procY + point.dy, 1, 1).data;
                
                console.log(`  ${point.name} (${point.dx}, ${point.dy}):`, {
                    file: `rgba(${filePixel[0]},${filePixel[1]},${filePixel[2]},${filePixel[3]})`,
                    proc: `rgba(${procPixel[0]},${procPixel[1]},${procPixel[2]},${procPixel[3]})`
                });
            }
        }
    }
    console.groupEnd();
    
    // 7. Padding Region Comparison
    console.group('🔲 Padding Region Comparison');
    if (fileAtlasData.canvas && procAtlasData.canvas && fileAtlasData.context && procAtlasData.context) {
        const index = 1; // Check second tile's padding
        if (index < layout.totalTextures) {
            const row = Math.floor(index / layout.tilesPerRow);
            const col = index % layout.tilesPerRow;
            
            const filePadding = fileAtlasData.layout.padding || fileAtlas.PADDING;
            const procPadding = procAtlasData.layout.padding || procAtlas.PADDING;
            
            const fileX = col * fileAtlasData.layout.paddedTextureSize + filePadding;
            const fileY = row * fileAtlasData.layout.paddedTextureSize + filePadding;
            const procX = col * procAtlasData.layout.paddedTextureSize + procPadding;
            const procY = row * procAtlasData.layout.paddedTextureSize + procPadding;
            
            // Check left padding edge
            const filePaddingPixel = fileAtlasData.context.getImageData(fileX - 1, fileY, 1, 1).data;
            const procPaddingPixel = procAtlasData.context.getImageData(procX - 1, procY, 1, 1).data;
            
            // Check first pixel of actual texture
            const fileTexturePixel = fileAtlasData.context.getImageData(fileX, fileY, 1, 1).data;
            const procTexturePixel = procAtlasData.context.getImageData(procX, procY, 1, 1).data;
            
            console.log(`Tile ${index} Padding Check:`);
            console.table({
                'Left Padding Edge': {
                    file: `rgba(${filePaddingPixel[0]},${filePaddingPixel[1]},${filePaddingPixel[2]},${filePaddingPixel[3]})`,
                    proc: `rgba(${procPaddingPixel[0]},${procPaddingPixel[1]},${procPaddingPixel[2]},${procPaddingPixel[3]})`
                },
                'Left Texture Edge': {
                    file: `rgba(${fileTexturePixel[0]},${fileTexturePixel[1]},${fileTexturePixel[2]},${fileTexturePixel[3]})`,
                    proc: `rgba(${procTexturePixel[0]},${procTexturePixel[1]},${procTexturePixel[2]},${procTexturePixel[3]})`
                }
            });
        }
    }
    console.groupEnd();
    
    // 8. Check for any mismatches
    console.group('⚠️ Summary of Differences');
    const differences = [];
    
    if (fileAtlasData.canvas?.width !== procAtlasData.canvas?.width) {
        differences.push('Canvas width differs');
    }
    if (fileAtlasData.canvas?.height !== procAtlasData.canvas?.height) {
        differences.push('Canvas height differs');
    }
    
    for (const prop of layoutProps) {
        if (fileAtlasData.layout?.[prop] !== procAtlasData.layout?.[prop]) {
            differences.push(`Layout.${prop} differs: file=${fileAtlasData.layout?.[prop]}, proc=${procAtlasData.layout?.[prop]}`);
        }
    }
    
    for (const prop of textureProps) {
        if (fileAtlasData.texture?.[prop] !== procAtlasData.texture?.[prop]) {
            differences.push(`Texture.${prop} differs: file=${fileAtlasData.texture?.[prop]}, proc=${procAtlasData.texture?.[prop]}`);
        }
    }
    
    if (differences.length === 0) {
        console.log('✅ No structural differences found between file-based and procedural atlases!');
        console.log('🔍 If seams are still visible, the issue may be in:');
        console.log('   - Texture content quality (procedural generation artifacts)');
        console.log('   - Padding implementation (check addTexturePadding method)');
        console.log('   - GPU texture filtering at runtime');
    } else {
        console.log('❌ Differences found:');
        differences.forEach(diff => console.log(`   - ${diff}`));
    }
    console.groupEnd();
    
    console.groupEnd(); // End main group
}

// Update the test runner to use this comparison
export async function runAtlasComparison() {
    console.log('🧪 Starting Atlas Comparison Test');
    console.log('================================');
    
    // Create file-based atlas
    console.log('\n📁 Creating FILE-BASED atlas...');
    const fileAtlas = new TextureAtlasManager();
    await fileAtlas.initializeAtlases(false);
    
    // Create procedural atlas
    console.log('\n🎨 Creating PROCEDURAL atlas...');
    const procAtlas = new TextureAtlasManager();
    await procAtlas.initializeAtlases(true);
    
    // Clear any existing test canvases
    const existingCanvases = document.querySelectorAll('canvas[id^="atlas-"]');
    existingCanvases.forEach(c => c.remove());
    
    // Test each level
    for (const level of TEST_CONFIG.levelsToTest) {
        console.log(`\n\n🔬 Testing Level: ${level}`);
        console.log('━'.repeat(50));
        
        // Render both atlases
        console.log('\n📊 Rendering atlases...');
        renderAtlasToCanvas(fileAtlas, level, `atlas-file-${level}`);
        renderAtlasToCanvas(procAtlas, level, `atlas-proc-${level}`);
        
        // Debug file-based atlas
        console.log('\n📁 FILE-BASED Atlas Details:');
        debugAtlasDetails(fileAtlas, level);
        
        // Debug procedural atlas
        console.log('\n🎨 PROCED URAL Atlas Details:');
        debugAtlasDetails(procAtlas, level);
        
        // NEW: Detailed comparison
        console.log('\n🔍 DETAILED COMPARISON:');
        compareAtlasImplementations(fileAtlas, procAtlas, level);
    }
    
    console.log('\n\n🏁 Atlas Comparison Complete!');
    console.log('Check the rendered canvases and comparison details above.');
    
    return { fileAtlas, procAtlas };
}

// Update window exports
window.debugAtlas = {
    renderAtlasToCanvas,
    debugAtlasDetails,
    compareAtlasImplementations,
    runAtlasComparison,
    TEST_CONFIG
};
export function setup() {
// Add to window for easy access
window.debugAtlas = {
    renderAtlasToCanvas,
    debugAtlasDetails,
    runAtlasComparison,
    TEST_CONFIG
};

console.log('Atlas debug functions loaded. Run: window.debugAtlas.runAtlasComparison()');
}

export async function downloadCpuAndGpuAtlases(options = {}) {
    const {
      prefix = 'atlas',
      levels = null,
      showInPage = true,
      delayBetweenDownloadsMs = 150
    } = options;
  
    console.group('🔁 Generating CPU vs GPU procedural atlases (debug)');
    try {
      // 1) CPU procedural atlas manager

      // 2) GPU procedural atlas manager
      console.log('⏳ Creating GPU procedural atlas manager...');
      const gpuAtlasMgr = new TextureAtlasManager();
      // initializeAtlases(procedural = true, cpu = false)
      await gpuAtlasMgr.initializeAtlases(true, false);
      console.log('✅ GPU procedural atlases generated.');
  
      // Determine which levels to operate on
      const levelsToProcess = levels || Array.from(gpuAtlasMgr.atlases.keys());
  
      // Optionally render to page for quick visual comparison
      if (showInPage) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexWrap = 'wrap';
        wrapper.style.gap = '16px';
        wrapper.style.padding = '12px';
        wrapper.style.background = '#111';
        wrapper.style.color = '#fff';
        wrapper.id = 'proc-atlas-debug-wrapper';
        document.body.appendChild(wrapper);
  
        const makeLabel = (title) => {
          const el = document.createElement('div');
          el.style.width = '100%';
          el.style.textAlign = 'left';
          el.style.font = '14px/1.2 monospace';
          el.style.margin = '6px 0';
          el.textContent = title;
          return el;
        };
  
        for (const level of levelsToProcess) {
          // CPU canvas
 
  
          // GPU canvas
          const gpuAtlas = gpuAtlasMgr.atlases.get(level);
          if (gpuAtlas?.canvas) {
            const container = document.createElement('div');
            container.style.border = '1px solid #333';
            container.style.padding = '6px';
            container.style.background = '#222';
            const label = makeLabel(`GPU procedural — level: ${level}`);
            container.appendChild(label);
  
            const c = document.createElement('canvas');
            c.width = gpuAtlas.canvas.width;
            c.height = gpuAtlas.canvas.height;
            c.style.maxWidth = '48vw';
            c.style.height = 'auto';
            const ctx = c.getContext('2d');
            ctx.drawImage(gpuAtlas.canvas, 0, 0);
            container.appendChild(c);
            wrapper.appendChild(container);
          }
        }
        console.log('Rendered CPU/GPU atlases to page for visual comparison.');
      }
  
      // Download canvases (CPU then GPU) for each level
      console.log('📥 Downloading atlas PNGs (CPU then GPU)...');
  
      for (const level of levelsToProcess) {
        const gpuAtlas = gpuAtlasMgr.atlases.get(level);
  
  
        if (gpuAtlas?.canvas) {
          const gpuLink = document.createElement('a');
          gpuLink.href = gpuAtlas.canvas.toDataURL('image/png');
          gpuLink.download = `${prefix}_procedural_gpu_${level}.png`;
          gpuLink.style.display = 'none';
          document.body.appendChild(gpuLink);
          gpuLink.click();
          gpuLink.remove();
          await new Promise(r => setTimeout(r, delayBetweenDownloadsMs));
        } else {
          console.warn(`GPU atlas canvas missing for level: ${level}`);
        }
      }
  
      console.log('✅ Downloads queued for CPU and GPU atlases.');
      console.groupEnd();
  
      // Return atlas managers for further inspection in the console if caller wants them
      return { gpuAtlasMgr };
  
    } catch (err) {
      console.error('Error generating/downloading CPU vs GPU atlases:', err);
      console.groupEnd();
      throw err;
    }
  }

  downloadCpuAndGpuAtlases();