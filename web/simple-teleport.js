/* global AFRAME */

// Minimal teleport-on-trigger, built directly on A-Frame's core
// laser-controls + raycaster instead of the unmaintained
// aframe-teleport-controls package (which throws on modern Three.js).
AFRAME.registerComponent('simple-teleport', {
  schema: {
    cameraRig: { type: 'selector' },
  },

  init() {
    this.intersection = null;
    this.onIntersection = (evt) => {
      this.intersection = evt.detail.intersections[0] || null;
    };
    this.onIntersectionCleared = () => {
      this.intersection = null;
    };
    this.onTriggerDown = () => this.teleport();

    this.el.addEventListener('raycaster-intersection', this.onIntersection);
    this.el.addEventListener('raycaster-intersection-cleared', this.onIntersectionCleared);
    this.el.addEventListener('triggerdown', this.onTriggerDown);
  },

  teleport() {
    if (!this.intersection) return;
    const rig = this.data.cameraRig.object3D;
    const point = this.intersection.point;
    rig.position.set(point.x, point.y, point.z);
  },

  remove() {
    this.el.removeEventListener('raycaster-intersection', this.onIntersection);
    this.el.removeEventListener('raycaster-intersection-cleared', this.onIntersectionCleared);
    this.el.removeEventListener('triggerdown', this.onTriggerDown);
  },
});
