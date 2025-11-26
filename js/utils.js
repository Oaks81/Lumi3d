export class Utils {
    static improvedHash(x, z, tileId, seed = 0) {
        let h = (x * 374761393 + z * 668265263 + tileId * 1274126177 + seed * 982451653) & 0xffffffff;
        h = (h ^ 61) ^ (h >>> 16);
        h = h + (h << 3);
        h = h ^ (h >>> 4);
        h = h * 0x27d4eb2d;
        h = h ^ (h >>> 15);
        return h & 0xffffffff;
    }
}