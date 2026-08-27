/* global AFRAME, THREE */

// Bump this on every change to fly-controls.js or sem-terrain.js, and bump
// the matching ?v= query param in index.html. The debug overlay reports
// this so a stale cached script is immediately obvious instead of looking
// like a mystery regression.
window.FLY_CONTROLS_VERSION = 14;

// Point-and-fly locomotion:
// - Hold the A/X button: glide continuously toward wherever the controller
//   points (so pointing up and holding it climbs above the structure).
//   Deliberately NOT the trigger -- something in A-Frame's own per-frame
//   processing of the trigger button crashes on this app's Quest 3 WebXR
//   session regardless of whether our code listens for it at all (confirmed
//   by bypassing the triggerdown/triggerup events entirely and polling the
//   raw Gamepad state instead, which did not help). Grip and thumbstick
//   both work reliably, so the fly action moved to another ordinary button
//   (index 4 -- A/X) rather than continuing to chase the trigger bug.
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
    // Only blocks going strictly below the surface (i.e. underground/inside
    // a wall) -- not a "stand this high above the ground" requirement.
    // This was 0.3 before, which silently blocked ALL ground-level
    // movement, since you spawn AT surfaceHeight (0) and a natural
    // slightly-downward look angle keeps candidate.y at or below that too.
    clearance: { type: 'number', default: 0 },
  },

  init() {
    this.axisY = 0;
    this.direction = new THREE.Vector3();
    this.candidate = new THREE.Vector3();

    // Deliberately NOT using triggerdown/triggerup events -- something in
    // A-Frame's button-event dispatch for trigger specifically (not grip,
    // not thumbstick) has been an unresolved source of "reading
    // 'quaternion'" crashes on this app's Quest 3 WebXR session, even
    // after removing laser-controls' auto-attached cursor component (which
    // was the other trigger-bound consumer). Reading the raw WebXR Gamepad
    // button state directly bypasses that event system entirely.
    this.onAxisMove = (evt) => {
      const axes = evt.detail.axis;
      // Thumbstick Y is axis[3] on Quest Touch controllers (axis[0..1] are an
      // unused touchpad slot in the standard mapping); fall back to axis[1]
      // for simpler two-axis gamepads.
      this.axisY = axes.length >= 4 ? axes[3] : (axes.length >= 2 ? axes[1] : 0);
    };

    this.el.addEventListener('axismove', this.onAxisMove);
  },

  isFlyButtonPressed() {
    const trackedControls = this.el.components['tracked-controls'];
    const gamepad = trackedControls && trackedControls.controller && trackedControls.controller.gamepad;
    // Button index 4 is the A/X button on Quest Touch controllers (0=trigger,
    // 1=grip, 2=unused touchpad slot, 3=thumbstick click, 4=A/X, 5=B/Y).
    return !!(gamepad && gamepad.buttons[4] && gamepad.buttons[4].pressed);
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
    }
  },

  tickMove(deltaTime) {
    // While the menu is open, the trigger and thumbstick are repurposed for
    // menu selection/paging (see menu-controller.js) -- don't also fly/zoom.
    if (window.menuOpen) return;

    const dt = deltaTime / 1000;
    const rig = this.data.cameraRig.object3D;

    if (this.isFlyButtonPressed()) {
      // Deliberately not using getWorldDirection() -- it calls
      // updateWorldMatrix(), which walks the parent chain and has been the
      // repeated source of "cannot read properties of undefined (reading
      // 'quaternion')" crashes on this app's Quest 3 WebXR session. Both
      // this controller entity and the camera sit directly under cameraRig,
      // which is never rotated, so local quaternion == world quaternion
      // here -- applying it directly avoids that code path entirely.
      this.direction.set(0, 0, -1).applyQuaternion(this.el.object3D.quaternion);
      const d = this.direction.multiplyScalar(-this.data.flySpeed * dt);
      this.tryMove(rig, d.x, d.y, d.z);
    }

    if (Math.abs(this.axisY) > 0.05) {
      // Flattened to horizontal-only: a natural, slightly-downward gaze
      // while walking would otherwise add a small negative Y component
      // every frame, which the ground-collision check in tryMove would
      // then block -- looking like "zoom barely moves" rather than an
      // outright failure. Climbing/descending is what fly (trigger +
      // pointing up/down) is for; zoom is just a horizontal dolly.
      this.direction.set(0, 0, -1).applyQuaternion(this.data.camera.object3D.quaternion);
      this.direction.y = 0;
      if (this.direction.lengthSq() > 1e-6) this.direction.normalize();
      const d = this.direction.multiplyScalar(-this.axisY * this.data.zoomSpeed * dt);
      this.tryMove(rig, d.x, d.y, d.z);
    }
  },

  remove() {
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
