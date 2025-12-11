export class HierarchicalAtlasManager {
    constructor(config) {
        this.lodConfigs = []; // Array of DataTextureConfig per LOD level
        this.atlasPools = new Map(); // LOD -> Set of active atlases
    }
    
    getAtlasConfigForDistance(distance) { }
    requestAtlas(chunkX, chunkY, face, distance) { }
}


