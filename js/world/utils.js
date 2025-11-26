export function createPipeline(device, shaderCode, entryPoint = "main") {
    return device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: shaderCode }),
            entryPoint: entryPoint
        }
    });
}