/* global AFRAME, THREE */

// Point-and-fly locomotion instead of teleport:
// - Hold trigger: glide continuously toward wherever the controller points.
// - Thumbstick up/down: rise/descend (independent of look/point direction),
//   so you can climb above the structure for a top-down overview, or
//   descend into it, without needing to re-aim.
AFRAME.registerComponent('fly-controls', {
  schema: {
    cameraRig: { type: 'selector' },
    flySpeed: { type: 'number', default: 3 },
    zoomSpeed: { type: 'number', default: 3 },
  },

  init() {
    this.flying = false;
    this.axisY = 0;
    this.forward = new THREE.Vector3();

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
      // getWorldDirection() returns the object's world -Z direction, which
      // is the same "forward" laser-controls uses for its pointing ray.
      this.el.object3D.getWorldDirection(this.forward);
      rig.position.addScaledVector(this.forward, this.data.flySpeed * dt);
    }

    if (Math.abs(this.axisY) > 0.05) {
      rig.position.y -= this.axisY * this.data.zoomSpeed * dt;
    }
  },

  remove() {
    this.el.removeEventListener('triggerdown', this.onTriggerDown);
    this.el.removeEventListener('triggerup', this.onTriggerUp);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
