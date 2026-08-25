/* global AFRAME, THREE */

// Bump this on every change to fly-controls.js or sem-terrain.js, and bump
// the matching ?v= query param in index.html. The debug overlay reports
// this so a stale cached script is immediately obvious instead of looking
// like a mystery regression.
window.FLY_CONTROLS_VERSION = 4;

// Point-and-fly locomotion:
// - Hold trigger: glide continuously toward wherever the controller points
//   (so pointing up and holding trigger climbs above the structure).
// - Thumbstick up/down: dolly forward/back along where you're looking
//   ("zoom" — get closer to inspect detail, or pull back for the big
//   picture) — independent of which way the controller is pointed.
AFRAME.registerComponent('fly-controls', {
  schema: {
    cameraRig: { type: 'selector' },
    camera: { type: 'selector' },
    flySpeed: { type: 'number', default: 3 },
    zoomSpeed: { type: 'number', default: 4 },
  },

  init() {
    this.flying = false;
    this.axisY = 0;
    this.direction = new THREE.Vector3();

    this.onTriggerDown = () => { this.flying = true; };
    this.onTriggerUp = () => { this.flying = false; };
    this.onAxisMove = (evt) => {
      const axes = evt.detail.axis;
      // Thumbstick Y is axis[3] on Quest Touch controllers (axis[0..1] are an
      // unused touchpad slot in the standard mapping); fall back to axis[1]
      // for simpler two-axis gamepads.
      this.axisY = axes.length >= 4 ? axes[3] : (axes.length >= 2 ? axes[1] : 0);
    };

    this.el.addEventListener('triggerdown', this.onTriggerDown);
    this.el.addEventListener('triggerup', this.onTriggerUp);
    this.el.addEventListener('axismove', this.onAxisMove);
  },

  tick(time, deltaTime) {
    if (!deltaTime) return;
    const dt = deltaTime / 1000;
    const rig = this.data.cameraRig.object3D;

    if (this.flying) {
      this.el.object3D.getWorldDirection(this.direction);
      rig.position.addScaledVector(this.direction, -this.data.flySpeed * dt);
    }

    if (Math.abs(this.axisY) > 0.05) {
      this.data.camera.object3D.getWorldDirection(this.direction);
      rig.position.addScaledVector(this.direction, -this.axisY * this.data.zoomSpeed * dt);
    }
  },

  remove() {
    this.el.removeEventListener('triggerdown', this.onTriggerDown);
    this.el.removeEventListener('triggerup', this.onTriggerUp);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
