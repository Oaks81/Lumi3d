export function createEnvironmentUpdater(uniforms, seasons, environmentState) {
    const numSeasons = seasons.length;
    return function () {
        if (!environmentState) {
            return;
        }
        uniforms.fogColor.value.copy(environmentState.fogColor);
        uniforms.fogDensity.value = environmentState.fogDensity;
        uniforms.sunLightColor.value.copy(environmentState.sunLightColor);
        uniforms.sunLightIntensity.value = environmentState.sunLightIntensity;
        uniforms.sunLightDirection.value.copy(environmentState.sunLightDirection);
        uniforms.moonLightColor.value.copy(environmentState.moonLightColor);
        uniforms.moonLightIntensity.value = environmentState.moonLightIntensity;
        uniforms.moonLightDirection.value.copy(environmentState.moonLightDirection);
        uniforms.ambientLightColor.value.copy(environmentState.ambientLightColor);
        uniforms.ambientLightIntensity.value = environmentState.ambientLightIntensity;
        uniforms.weatherIntensity.value = environmentState.weatherIntensity;
        uniforms.thunderLightIntensity.value = environmentState.thunderLightIntensity;
        uniforms.thunderLightColor.value.copy(environmentState.thunderLightColor);
// In your MaterialBuilder/environment each frame:
uniforms.skyAmbientColor.value.copy(environmentState.getSkyAmbientColor());
uniforms.groundAmbientColor.value.copy(environmentState.getGroundAmbientColor());
uniforms.ambientLightIntensity.value = environmentState.ambientLightIntensity;
        // Update seasonal data
        if (environmentState.gameTime) {
            const [daysUntilNext, season] = environmentState.gameTime.getRunningSeasonInfo();
            const sidx = seasons.indexOf(season.name);
            uniforms.currentSeason.value = sidx;
            uniforms.nextSeason.value = (sidx + 1) % numSeasons;
            const transitionDays = 10;
            uniforms.seasonTransition.value = daysUntilNext < transitionDays
                ? 1.0 - (daysUntilNext / transitionDays)
                : 0.0;
        }
    };
}

export function computeVertexNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
    const cb = new THREE.Vector3(), ab = new THREE.Vector3();

    for (let i = 0; i < indices.length; i += 3) {
        const ia = indices[i] * 3;
        const ib = indices[i + 1] * 3;
        const ic = indices[i + 2] * 3;

        pA.set(positions[ia], positions[ia + 1], positions[ia + 2]);
        pB.set(positions[ib], positions[ib + 1], positions[ib + 2]);
        pC.set(positions[ic], positions[ic + 1], positions[ic + 2]);

        cb.subVectors(pC, pB);
        ab.subVectors(pA, pB);
        cb.cross(ab).normalize();

        normals[ia]     += cb.x;
        normals[ia + 1] += cb.y;
        normals[ia + 2] += cb.z;
        normals[ib]     += cb.x;
        normals[ib + 1] += cb.y;
        normals[ib + 2] += cb.z;
        normals[ic]     += cb.x;
        normals[ic + 1] += cb.y;
        normals[ic + 2] += cb.z;
    }

    // Normalize the normals
    for (let i = 0; i < normals.length; i += 3) {
        const nx = normals[i];
        const ny = normals[i + 1];
        const nz = normals[i + 2];

        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) {
            normals[i]     = nx / len;
            normals[i + 1] = ny / len;
            normals[i + 2] = nz / len;
        }
    }

    return normals;
}