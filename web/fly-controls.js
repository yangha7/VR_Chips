/* global AFRAME, THREE */

// Bump this on every change to fly-controls.js or sem-terrain.js, and bump
// the matching ?v= query param in index.html. The debug overlay reports
// this so a stale cached script is immediately obvious instead of looking
// like a mystery regression.
window.FLY_CONTROLS_VERSION = 8;

// Point-and-fly locomotion:
// - Hold trigger: glide continuously toward wherever the controller points
//   (so pointing up and holding trigger climbs above the structure).
// - Thumbstick up/down: dolly forward/back along where you're looking
//   ("zoom" — get closer to inspect detail, or pull back for the big
//   picture) — independent of which way the controller is pointed.
//
// Collision: rather than modeling the terrain as solid volume (which would
// need real thickness geometry — more triangles, more GPU cost — and Quest
// 3's mobile GPU would feel that), movement is simply blocked from crossing
// below the terrain's local height. That avoids the confusing "inside the
// hollow wall" view for the cost of one cheap height lookup per frame,
// not any extra rendering work.
AFRAME.registerComponent('fly-controls', {
  schema: {
    cameraRig: { type: 'selector' },
    camera: { type: 'selector' },
    terrain: { type: 'selector' },
    flySpeed: { type: 'number', default: 3 },
    zoomSpeed: { type: 'number', default: 4 },
    clearance: { type: 'number', default: 0.3 },
  },

  init() {
    this.flying = false;
    this.axisY = 0;
    this.direction = new THREE.Vector3();
    this.candidate = new THREE.Vector3();

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

  // Applies (dx, dy, dz) to the rig only if the destination isn't below the
  // terrain surface at that (x, z) — i.e. lets you fly freely above/around
  // the structure, but stops you at its surface instead of clipping inside.
  tryMove(rig, dx, dy, dz) {
    this.candidate.set(rig.position.x + dx, rig.position.y + dy, rig.position.z + dz);
    const terrainComp = this.data.terrain && this.data.terrain.components['sem-terrain'];
    const surfaceHeight = terrainComp ? terrainComp.getHeightAt(this.candidate.x, this.candidate.z) : 0;
    if (this.candidate.y < surfaceHeight + this.data.clearance) return;
    rig.position.copy(this.candidate);
  },

  tick(time, deltaTime) {
    if (!deltaTime) return;
    // A component's tick() runs inside the render loop with no surrounding
    // try/catch from A-Frame -- one uncaught error here previously broke
    // all controller input silently. Never let that happen again.
    try {
      this.tickMove(deltaTime);
    } catch (err) {
      console.error('fly-controls tick error:', err);
      if (window.reportDebug) window.reportDebug('fly-controls ERROR: ' + err.message);
      this.flying = false;
    }
  },

  tickMove(deltaTime) {
    // While the menu is open, the trigger and thumbstick are repurposed for
    // menu selection/paging (see menu-controller.js) -- don't also fly/zoom.
    if (window.menuOpen) return;

    const dt = deltaTime / 1000;
    const rig = this.data.cameraRig.object3D;

    if (this.flying) {
      this.el.object3D.getWorldDirection(this.direction);
      const d = this.direction.multiplyScalar(-this.data.flySpeed * dt);
      this.tryMove(rig, d.x, d.y, d.z);
    }

    if (Math.abs(this.axisY) > 0.05) {
      this.data.camera.object3D.getWorldDirection(this.direction);
      const d = this.direction.multiplyScalar(-this.axisY * this.data.zoomSpeed * dt);
      this.tryMove(rig, d.x, d.y, d.z);
    }
  },

  remove() {
    this.el.removeEventListener('triggerdown', this.onTriggerDown);
    this.el.removeEventListener('triggerup', this.onTriggerUp);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
