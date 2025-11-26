
export class GeometryGenerator {
    constructor() {

    }

    async buildGeometry(feature) {
        throw new Error("Call buildGeometry on a subclass!");
    }

}