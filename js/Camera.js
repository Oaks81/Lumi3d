export class Camera {
    constructor(config = {}) {
        this.position = { x: 0, y: 50, z: 0 };
        this.target = { x: 0, y: 0, z: 0 };
        this.up = { x: 0, y: 1, z: 0 };
        
        this.aspect = config.aspect || 16 / 9;
        this.fov = config.fov || 75;
        this.near = config.near || 0.1;
        this.far = config.far || 50000;
        
        this.following = null;
        
        this.cameraDistance = config.cameraDistance || 15;
        this.cameraHeight = config.cameraHeight || 6;
        this.baseLookAtSmoothing = config.lookAtSmoothing || 0.15;
        this.lookAheadDistance = config.lookAheadDistance || 10;
        this.lookAheadHeight = config.lookAheadHeight || 2;
        
        this.orbitYaw = 0;
        this.orbitPitch = 0.3;
        this.orbitPitchMin = -Math.PI / 2 + 0.1;
        this.orbitPitchMax = Math.PI / 2 - 0.1;
        
        this.manualYaw = 0;
        this.manualPitch = 0;
    }

    follow(entity) {
        this.following = entity;
        if (entity) {
            this._snapToEntity(entity);
        }
    }

    unfollow() {
        this.following = null;
    }
    
    /**
     * Snap camera to entity position
     * Converts from game coords (x, y, z) to Three.js coords (x, y, z)
     */
    _snapToEntity(entity) {
        const fwd = entity.getForwardVector2D();

        const offsetX = -fwd.x * this.cameraDistance;
        const offsetZ = -fwd.y * this.cameraDistance;
        
        this.position.x = entity.position.x + offsetX;
        this.position.y = entity.position.z + this.cameraHeight;
        this.position.z = entity.position.y + offsetZ;
        
        const targetOffsetX = fwd.x * this.lookAheadDistance;
        const targetOffsetZ = fwd.y * this.lookAheadDistance;
        
        this.target.x = entity.position.x + targetOffsetX;
        this.target.y = entity.position.z + this.lookAheadHeight;
        this.target.z = entity.position.y + targetOffsetZ;
    }

    
    handleOrbitInput(deltaX, deltaY, sensitivity = 0.005) {
        this.orbitYaw -= deltaX * sensitivity;
        this.orbitPitch += deltaY * sensitivity;
        this.orbitPitch = Math.max(this.orbitPitchMin, Math.min(this.orbitPitchMax, this.orbitPitch));
    }
    
    resetOrbit() {
        this.orbitYaw = 0;
        this.orbitPitch = 0.3;
    }
    
    /**
     * Move camera relative to look direction
     * Camera is already in Three.js coords, so movement is straightforward
     */
    moveRelative(forward, right, up) {
        const dx = this.target.x - this.position.x;
        const dy = this.target.y - this.position.y;
        const dz = this.target.z - this.position.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (len < 0.001) return;
        
        const fwdX = dx / len;
        const fwdY = dy / len;
        const fwdZ = dz / len;
        
        const horizLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ);
        let rightX = 0, rightZ = 0;
        if (horizLen > 0.001) {
            rightX = -fwdZ / horizLen;
            rightZ = fwdX / horizLen;
        }
        
        const moveX = fwdX * forward + rightX * right;
        const moveY = fwdY * forward + up;
        const moveZ = fwdZ * forward + rightZ * right;
        
        this.position.x += moveX;
        this.position.y += moveY;
        this.position.z += moveZ;
        
        this.target.x += moveX;
        this.target.y += moveY;
        this.target.z += moveZ;
    }
    
    /**
     * Manual look controls (for free camera mode)
     */
    handleManualLook(deltaX, deltaY, sensitivity = 0.003) {
        this.manualYaw -= deltaX * sensitivity;
        this.manualPitch -= deltaY * sensitivity;
        this.manualPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.manualPitch));
        
        const distance = 10;
        const dx = Math.cos(this.manualPitch) * Math.cos(this.manualYaw);
        const dy = Math.sin(this.manualPitch);
        const dz = Math.cos(this.manualPitch) * Math.sin(this.manualYaw);
        
        this.target.x = this.position.x + dx * distance;
        this.target.y = this.position.y + dy * distance;
        this.target.z = this.position.z + dz * distance;
    }
    
    handleZoom(delta, zoomSpeed = 0.001) {
        const zoomFactor = 1.0 + delta * zoomSpeed;
        this.cameraDistance *= zoomFactor;
        this.cameraDistance = Math.max(5, Math.min(100, this.cameraDistance));
    }

    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
    }

    lookAt(x, y, z) {
        this.target.x = x;
        this.target.y = y;
        this.target.z = z;
    }
}
