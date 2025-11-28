// js/world/shaders/webgpu/terrainCompute.wgsl.js

export function createTerrainComputeShader() {
    return `
    struct Uniforms {
        chunkX: i32,
        chunkY: i32,
        chunkSize: i32,
        seed: i32,
        elevationScale: f32,
        heightScale: f32,
        biomeScale: f32,
        regionScale: f32,
        detailScale: f32,
        ridgeScale: f32,
        valleyScale: f32,
        plateauScale: f32,
        worldScale: f32,
        outputType: i32, 
        face: i32,      // <--- THIS IS THE NEW FIELD
    };
    
    @group(0) @binding(0) var<uniform> u: Uniforms;
    @group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
    

    fn hash(p: vec3<f32>) -> f32 {
        var p3 = fract(p * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    
    fn snoise(v: vec3<f32>) -> f32 { return hash(v) * 2.0 - 1.0; }
    
    fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
        var value: f32 = 0.0;
        var amplitude: f32 = 0.5;
        var frequency: f32 = 1.0;
        for (var i = 0; i < octaves; i = i + 1) {
            value = value + snoise(p * frequency) * amplitude;
            frequency = frequency * 2.0;
            amplitude = amplitude * 0.5;
        }
        return value;
    }
    
    fn getSpherePoint(face: i32, u: f32, v: f32) -> vec3<f32> {
        var cubePos: vec3<f32>;
        let x = u * 2.0 - 1.0;
        let y = v * 2.0 - 1.0;
        
        if (face == 0) { cubePos = vec3<f32>(1.0, -y, -x); }      // +X
        else if (face == 1) { cubePos = vec3<f32>(-1.0, -y, x); } // -X
        else if (face == 2) { cubePos = vec3<f32>(x, 1.0, y); }   // +Y
        else if (face == 3) { cubePos = vec3<f32>(x, -1.0, -y); } // -Y
        else if (face == 4) { cubePos = vec3<f32>(x, -y, 1.0); }  // +Z
        else { cubePos = vec3<f32>(-x, -y, -1.0); }               // -Z
    
        let x2 = cubePos.x * cubePos.x;
        let y2 = cubePos.y * cubePos.y;
        let z2 = cubePos.z * cubePos.z;
        let sx = cubePos.x * sqrt(1.0 - y2 * 0.5 - z2 * 0.5 + y2 * z2 / 3.0);
        let sy = cubePos.y * sqrt(1.0 - z2 * 0.5 - x2 * 0.5 + z2 * x2 / 3.0);
        let sz = cubePos.z * sqrt(1.0 - x2 * 0.5 - y2 * 0.5 + x2 * y2 / 3.0);
        return vec3<f32>(sx, sy, sz);
    }
    
    fn sampleHeight(worldX: f32, worldY: f32) -> f32 {
        var pos: vec3<f32>;
        if (u.face >= 0) {
            let normalizedU = worldX / (f32(u.chunkSize) * 16.0);
            let normalizedV = worldY / (f32(u.chunkSize) * 16.0);
            pos = getSpherePoint(u.face, normalizedU, normalizedV) * 50000.0;
        } else {
            pos = vec3<f32>(worldX, 0.0, worldY);
        }
        let noiseVal = fbm(pos * u.elevationScale * 0.01, 4);
        return noiseVal * u.heightScale + u.heightScale;
    }
    
    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let dims = textureDimensions(outTex);
        if (global_id.x >= dims.x || global_id.y >= dims.y) { return; }
    
        let worldX = f32(u.chunkX * u.chunkSize) + f32(global_id.x);
        let worldY = f32(u.chunkY * u.chunkSize) + f32(global_id.y);
    
        let height = sampleHeight(worldX, worldY);
    
        var result = vec4<f32>(0.0);
        if (u.outputType == 0) {
            // Height
            result = vec4<f32>(height, 0.0, 0.0, 1.0);
        } else if (u.outputType == 1) {
            // Normal from height derivatives (central differences)
            let e = 1.0;
            let hL = sampleHeight(worldX - e, worldY);
            let hR = sampleHeight(worldX + e, worldY);
            let hD = sampleHeight(worldX, worldY - e);
            let hU = sampleHeight(worldX, worldY + e);
            let dx = (hR - hL) * 0.5;
            let dy = (hU - hD) * 0.5;
            let n = normalize(vec3<f32>(-dx, 1.0, -dy));
            result = vec4<f32>(n * 0.5 + 0.5, 1.0);
        } else if (u.outputType == 2) { 
            var tile = 3.0; 
            if (height < 5.0) { tile = 1.0; }
            else if (height > 60.0) { tile = 5.0; }
            result = vec4<f32>(tile / 255.0, 0.0, 0.0, 1.0); 
        }
        else if (u.outputType == 3) { result = vec4<f32>(snoise(vec3<f32>(worldX, 0.0, worldY) * u.biomeScale), 0.0, 0.0, 1.0); }
    
        textureStore(outTex, vec2<i32>(global_id.xy), result);
    }
    `;
    }
