export class FeatureGeneratorUtils {
    static async computeSlopes(device, pipeline, chunkData, chunkSize) {
      const N = chunkSize + 1;
      const gridBytes = N * N * 4;
      const slopeBytes = chunkSize * chunkSize * 4;
      
      const heightBuf = device.createBuffer({
        size: gridBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
      const slopeBuf = device.createBuffer({
        size: slopeBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      });
      const paramBuf = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      
      device.queue.writeBuffer(heightBuf, 0, chunkData.heights);
      const dv = new DataView(new ArrayBuffer(8));
      dv.setUint32(0, chunkSize, true);
      dv.setUint32(4, 0, true);
      device.queue.writeBuffer(paramBuf, 0, dv.buffer);
      
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: heightBuf } },
          { binding: 1, resource: { buffer: slopeBuf } },
          { binding: 2, resource: { buffer: paramBuf } }
        ]
      });
  
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(
        Math.ceil(chunkSize / 8),
        Math.ceil(chunkSize / 8)
      );
      pass.end();
      
      const readBuf = device.createBuffer({
        size: slopeBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      enc.copyBufferToBuffer(slopeBuf, 0, readBuf, 0, slopeBytes);
      device.queue.submit([enc.finish()]);
  
      await readBuf.mapAsync(GPUMapMode.READ);
      const copy = new Float32Array(readBuf.getMappedRange()).slice();
      readBuf.unmap();
      return copy;
    }
  
    static async detectFeatureCandidates(
      device, pipeline, slopeData, noiseData, chunkX, chunkY, chunkSize,
      features, typeNamesById
    ) {
      const pix = chunkSize * chunkSize;
      const bytes = pix * 4;
  
      const slopeBuf = device.createBuffer({ 
        size: bytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const noiseBuf = device.createBuffer({ 
        size: bytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const candBuf = device.createBuffer({ 
        size: bytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC 
      });
  
      const nFeat = features.length;
      const fBytes = Math.max(4, nFeat * 4);
      
      const minBuf = device.createBuffer({ 
        size: fBytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const maxBuf = device.createBuffer({ 
        size: fBytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const noiBuf = device.createBuffer({ 
        size: fBytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const rarBuf = device.createBuffer({ 
        size: fBytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
      const typBuf = device.createBuffer({ 
        size: fBytes, 
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST 
      });
  
      const minSlopeArray = features.map(f => f.minSlope ?? 0.0);
      const maxSlopeArray = features.map(f => f.maxSlope ?? 99999.0);
      const noiseArray = features.map(f => f.noise ?? 0.0);
      const rarityArray = features.map(f => f.rarity ?? 1.0);
      const typeMapArray = features.map(f => f.typeId);
  
      device.queue.writeBuffer(slopeBuf, 0, slopeData);
      device.queue.writeBuffer(noiseBuf, 0, noiseData);
      device.queue.writeBuffer(minBuf, 0, new Float32Array(minSlopeArray));
      device.queue.writeBuffer(maxBuf, 0, new Float32Array(maxSlopeArray));
      device.queue.writeBuffer(noiBuf, 0, new Float32Array(noiseArray));
      device.queue.writeBuffer(rarBuf, 0, new Float32Array(rarityArray));
      device.queue.writeBuffer(typBuf, 0, new Uint32Array(typeMapArray));
  
      const uniBuf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const dv = new DataView(new ArrayBuffer(16));
      dv.setUint32(0, chunkSize, true);
      dv.setUint32(4, chunkX, true);
      dv.setUint32(8, chunkY, true);
      dv.setUint32(12, nFeat, true);
      device.queue.writeBuffer(uniBuf, 0, dv.buffer);
  
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: slopeBuf } },
          { binding: 1, resource: { buffer: noiseBuf } },
          { binding: 2, resource: { buffer: candBuf } },
          { binding: 3, resource: { buffer: minBuf } },
          { binding: 4, resource: { buffer: maxBuf } },
          { binding: 5, resource: { buffer: noiBuf } },
          { binding: 6, resource: { buffer: rarBuf } },
          { binding: 7, resource: { buffer: typBuf } },
          { binding: 8, resource: { buffer: uniBuf } },
        ]
      });
  
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(
        Math.ceil(chunkSize / 8),
        Math.ceil(chunkSize / 8)
      );
      pass.end();
  
      const readBuf = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      enc.copyBufferToBuffer(candBuf, 0, readBuf, 0, bytes);
      device.queue.submit([enc.finish()]);
  
      await readBuf.mapAsync(GPUMapMode.READ);
      const raw = new Uint32Array(readBuf.getMappedRange()).slice();
      readBuf.unmap();
  
      const cand = [];
      for (let y = 0; y < chunkSize; y++) {
        for (let x = 0; x < chunkSize; x++) {
          const idx = y * chunkSize + x;
          const dat = raw[idx];
          const type = (dat >> 24) & 0xff;
          if (type) {
            cand.push({
              x, y,
              type: typeNamesById[type] ?? "unknown",
              priority: dat & 0xffffff
            });
          }
        }
      }
      return cand;
    }
  
    static simpleNoise(x, y, seed) {
      let h = Math.floor(x * 1000) ^ (Math.floor(y * 1000) << 16) ^ seed;
      h = ((h >> 13) ^ h) * 15731;
      h = (h * h * 15731 + 789221) & 0x7fffffff;
      return (h / 0x7fffffff) * 2 - 1;
    }
  
    static generateShapeSeed(wx, wy, type, seed) {
      const th = this.hashString(type);
      let h = wx;
      h = ((h << 5) + h) + wy;
      h = ((h << 5) + h) + th;
      h = ((h << 5) + h) + seed;
      return Math.abs(h) % 0x7fffffff;
    }
  
    static hashString(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return h;
    }
  
    static isFeatureAwayFromEdge(cand, bounds, chunkSize) {
      return (
        bounds.minX > 0 &&
        bounds.maxX < chunkSize - 1 &&
        bounds.minY > 0 &&
        bounds.maxY < chunkSize - 1
      );
    }
  
    static boundingBoxesOverlap(boundsA, boundsB) {
      return !(boundsA.maxX < boundsB.minX || boundsA.minX > boundsB.maxX ||
              boundsA.maxY < boundsB.minY || boundsA.minY > boundsB.maxY);
    }
  
    static extractHeightmapRegion(chunkData, bounds, chunkSize) {
      const regionWidth = bounds.maxX - bounds.minX + 1;
      const regionHeight = bounds.maxY - bounds.minY + 1;
      const arr = new Float32Array(regionWidth * regionHeight);
  
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const src = y * chunkSize + x;
          const dst = (y - bounds.minY) * regionWidth + (x - bounds.minX);
          arr[dst] = chunkData.getHeight(x, y);
        }
      }
      return {
        heights: arr,
        minX: bounds.minX,
        minY: bounds.minY,
        width: regionWidth,
        height: regionHeight
      };
    }
  
    static extractTiles(chunkData, bounds) {
      const width = bounds.maxX - bounds.minX + 1;
      const height = bounds.maxY - bounds.minY + 1;
      const tiles = new Uint32Array(width * height);
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const chunkX = bounds.minX + x;
          const chunkY = bounds.minY + y;
          tiles[y * width + x] = chunkData.getTile(chunkX, chunkY);
        }
      }
      
      return tiles;
    }
  
    static extractBlendMapRegion(chunkData, bounds, chunkSize, splatDensity) {
      const chunkSplatWidth = chunkSize * splatDensity;
      const chunkSplatHeight = chunkSize * splatDensity;
      
      const vertexWidth = bounds.maxX - bounds.minX + 1;
      const vertexHeight = bounds.maxY - bounds.minY + 1;
      const featureSplatWidth = (vertexWidth - 1) * splatDensity;
      const featureSplatHeight = (vertexHeight - 1) * splatDensity;
      
      const blendWeightsArr = new Float32Array(featureSplatWidth * featureSplatHeight * 4);
      const blendTypesArr = new Float32Array(featureSplatWidth * featureSplatHeight * 4);
      const macroArray = new Float32Array(featureSplatWidth * featureSplatHeight);
      
      for (let sy = 0; sy < featureSplatHeight; sy++) {
        for (let sx = 0; sx < featureSplatWidth; sx++) {
          const chunkSplatX = bounds.minX * splatDensity + sx;
          const chunkSplatY = bounds.minY * splatDensity + sy;
          
          if (chunkSplatX >= 0 && chunkSplatX < chunkSplatWidth && 
              chunkSplatY >= 0 && chunkSplatY < chunkSplatHeight) {
            
            const srcIdx = chunkSplatY * chunkSplatWidth + chunkSplatX;
            const dstIdx = sy * featureSplatWidth + sx;
            
            for (let ch = 0; ch < 4; ch++) {
              blendWeightsArr[dstIdx * 4 + ch] = chunkData.blendWeights[srcIdx * 4 + ch] || 0;
              blendTypesArr[dstIdx * 4 + ch] = chunkData.blendTypes[srcIdx * 4 + ch] || 0;
            }
            macroArray[dstIdx] = chunkData.macroData[srcIdx] ?? 0;
          } else {
            const dstIdx = sy * featureSplatWidth + sx;
            blendWeightsArr[dstIdx * 4] = 1.0;
            blendWeightsArr[dstIdx * 4 + 1] = 0.0;
            blendWeightsArr[dstIdx * 4 + 2] = 0.0;
            blendWeightsArr[dstIdx * 4 + 3] = 0.0;
            blendTypesArr[dstIdx * 4] = 3; // grass
            blendTypesArr[dstIdx * 4 + 1] = 0;
            blendTypesArr[dstIdx * 4 + 2] = 0;
            blendTypesArr[dstIdx * 4 + 3] = 0;
          }
        }
      }
  
      return { 
        blendWeights: blendWeightsArr, 
        blendTypes: blendTypesArr,
        width: featureSplatWidth,
        height: featureSplatHeight,
        macroData: macroArray,
      };
    }
    static selectBestCandidates(candidates, maxFeatures, minDistanceMap, getFeatureBounds) {
        candidates.sort((a, b) => b.priority - a.priority);
        const selected = [];
        
        for (const cand of candidates) {
          if (selected.length >= maxFeatures) break;
          
          let clash = false;
          const minDist = minDistanceMap[cand.type] || 4;
          const minDist2 = minDist * minDist;
          
          for (const chosen of selected) {
            const dx = cand.x - chosen.x;
            const dy = cand.y - chosen.y;
            const dist2 = dx * dx + dy * dy;
            
            if (dist2 < minDist2) {
              clash = true;
              break;
            }
            
            // Also check bounding box overlap
            const boundsA = getFeatureBounds(cand);
            const boundsB = getFeatureBounds(chosen);
            if (this.boundingBoxesOverlap(boundsA, boundsB)) {
              clash = true;
              break;
            }
          }
          
          if (!clash) selected.push(cand);
        }
        
        return selected;
      }
    
      static markAffectedTiles(feature, chunkData, chunkSize) {
        if (!feature?.boundingBox) return;
    
        const { minX, minY, maxX, maxY } = feature.boundingBox;
        const tiles = chunkData.tiles;
    
        for (let y = minY + 1; y < maxY - 1; y++) {
          if (y < 0 || y >= chunkSize) continue;
          const row = y * chunkSize;
          for (let x = minX + 1; x < maxX - 1; x++) {
            if (x < 0 || x >= chunkSize) continue;
            const idx = row + x;
            if (tiles[idx] < 100) tiles[idx] += 100;
            feature.affectedTiles.push({ x, y });
          }
        }
      }
    
      static isLocalMax(x, y, chunkData, chunkSize) {
        const h = chunkData.getHeight(x, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
              if (chunkData.getHeight(nx, ny) >= h)
                return false;
            }
          }
        }
        return true;
      }
    
      static generateGlobalId(prefix, seed, counter) {
        return `${prefix}_${seed}_${counter}`;
      }
    }