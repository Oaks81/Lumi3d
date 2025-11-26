export class PlanetAtmosphereSettings {
    constructor(options = {}) {
        this.planetRadius = options.planetRadius || 6371000;
        this.atmosphereHeight = options.atmosphereHeight || 100000;
        // ... more properties
    }
}