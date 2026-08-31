/* global AFRAME, THREE */

window.MENU_CONTROLLER_VERSION = 15;

// Selectable SEM datasets for the terrain. Add more here as they're
// processed via scripts/sem_to_heightmap.py -- no other code changes needed.
// Exposed on window so desktop-preview.js's plain HTML panel can reuse the
// same list and loader without duplicating them.
const SEM_DATASETS = [
  { label: 'ALS 40nm line/space grating (real data)', heightmap: '../assets/processed/als_grating_height.png?v=5', texture: '../assets/processed/als_grating_texture.jpg?v=5' },
  { label: 'MEMS comb-drive actuator', heightmap: '../assets/processed/comb_height.png', texture: '../assets/processed/comb_texture.jpg' },
  { label: 'Deprocessed die -- routing', heightmap: '../assets/processed/fig3_height.png', texture: '../assets/processed/fig3_texture.jpg' },
  { label: 'Deprocessed die -- via lattice', heightmap: '../assets/processed/fig4_height.png', texture: '../assets/processed/fig4_texture.jpg' },
  { label: 'Deprocessed die -- mixed array', heightmap: '../assets/processed/fig6_height.png', texture: '../assets/processed/fig6_texture.jpg' },
];
window.SEM_DATASETS = SEM_DATASETS;
window.loadSemDataset = function (index) {
  const ds = SEM_DATASETS[index];
  if (!ds) return;
  const terrainComp = document.getElementById('terrain').components['sem-terrain'];
  terrainComp.loadDataset(ds.heightmap, ds.texture);
  const imgPlane = document.getElementById('menuImagePlane');
  if (imgPlane) imgPlane.setAttribute('material', 'src', ds.texture);
};

const HELP_TEXT = "Real ALS beamline image: a 40nm-pitch line/space grating, magnified for walking among its rows.\n\nCONTROLS\nHold trigger: fly toward where you're pointing\nThumbstick up/down: zoom the model larger/smaller (doesn't move you)\nGrip: open/close this menu\nThumbstick left/right: switch this menu's page\nOn sample picker: thumbstick up/down to highlight, trigger to load";

// Standalone rounded-rect path -- avoids relying on the newer
// CanvasRenderingContext2D.prototype.roundRect() convenience method that
// isn't guaranteed on every WebXR browser; arcTo() is long-established.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

AFRAME.registerComponent('menu-controller', {
  schema: {
    menu: { type: 'selector' },
    camera: { type: 'selector' },
    cameraRig: { type: 'selector' },
    terrain: { type: 'selector' },
  },

  init() {
    this.page = 0;
    this.selectIndex = 0;
    this.prevAxisX = 0;
    this.prevAxisY = 0;
    this.prevTriggerPressed = false;

    this.onGripDown = () => this.safely('gripdown', () => this.toggleMenu());
    this.onAxisMove = (evt) => this.safely('axismove', () => this.handleAxisMove(evt.detail.axis));

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('axismove', this.onAxisMove);

    this.renderHelpPage();
  },

  // Trigger, via raw Gamepad polling for the rising edge -- menu-controller
  // never touched the terrain-collision code that turned out to be the
  // actual source of the trigger-adjacent crashes in fly-controls, so
  // trigger itself is fine here.
  tick() {
    this.safely('tick', () => {
      const trackedControls = this.el.components['tracked-controls'];
      const gamepad = trackedControls && trackedControls.controller && trackedControls.controller.gamepad;
      const pressed = !!(gamepad && gamepad.buttons[0] && gamepad.buttons[0].pressed);
      if (pressed && !this.prevTriggerPressed && this.isOpen() && this.page === 2) {
        this.confirmSelection();
      }
      this.prevTriggerPressed = pressed;
    });
  },

  // Every controller-event handler runs outside A-Frame's own try/catch, so
  // one bug here has previously frozen all controller input silently (twice
  // now, with fly-controls). Never let that happen again -- log and move on.
  safely(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error('menu-controller ' + label + ' error:', err);
      if (window.reportDebug) window.reportDebug('menu-controller ' + label + ' ERROR: ' + err.message);
    }
  },

  isOpen() {
    return this.data.menu.object3D.visible;
  },

  toggleMenu() {
    const willOpen = !this.data.menu.object3D.visible;
    this.data.menu.object3D.visible = willOpen;
    window.menuOpen = willOpen;
    if (willOpen) {
      this.page = 0;
      this.positionInFrontOfCamera();
      this.updatePageVisibility();
    }
  },

  // Deliberately avoids THREE.Object3D.getWorldPosition/lookAt/rotateY --
  // those touch matrixWorld/quaternion internals that have twice now thrown
  // "cannot read properties of undefined (reading 'quaternion')" and frozen
  // all controller input. This uses only plain vector math and setting
  // .rotation directly (the same pattern already used safely throughout
  // this scene's static entities), which never touches those code paths.
  positionInFrontOfCamera() {
    const rigPos = this.data.cameraRig.object3D.position;
    const camLocalPos = this.data.camera.object3D.position;
    const camWorldX = rigPos.x + camLocalPos.x;
    const camWorldY = rigPos.y + camLocalPos.y;
    const camWorldZ = rigPos.z + camLocalPos.z;

    // Full 3D gaze direction (not flattened) -- the menu should appear
    // exactly where you're looking, up/down included, not just "in front
    // and level" while you have to tilt your head to find it.
    const dir = new THREE.Vector3();
    this.data.camera.object3D.getWorldDirection(dir); // already proven safe elsewhere in this app
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();

    const distance = 1.0; // closer than before, matching the smaller panel
    const menuObj = this.data.menu.object3D;
    menuObj.position.set(camWorldX + dir.x * distance, camWorldY + dir.y * distance, camWorldZ + dir.z * distance);

    // Keep the panel itself upright (only yaw, no pitch/roll) so text
    // doesn't render at an odd angle -- face its front (+Z) back toward
    // the camera's horizontal position.
    const dx = camWorldX - menuObj.position.x;
    const dz = camWorldZ - menuObj.position.z;
    menuObj.rotation.set(0, Math.atan2(dx, dz), 0);
  },

  handleAxisMove(axes) {
    if (!this.isOpen()) return;
    const axisX = axes.length >= 4 ? axes[2] : (axes.length >= 1 ? axes[0] : 0);
    const axisY = axes.length >= 4 ? axes[3] : (axes.length >= 2 ? axes[1] : 0);

    if (this.prevAxisX <= 0.6 && axisX > 0.6) this.changePage(1);
    if (this.prevAxisX >= -0.6 && axisX < -0.6) this.changePage(-1);
    this.prevAxisX = axisX;

    if (this.page === 2) {
      // axisY negative = stick pushed up (standard convention) -- that
      // should move the highlight to the PREVIOUS (higher-up) row, not
      // the next one. Was backwards.
      if (this.prevAxisY <= 0.6 && axisY > 0.6) this.moveSelection(1);
      if (this.prevAxisY >= -0.6 && axisY < -0.6) this.moveSelection(-1);
    }
    this.prevAxisY = axisY;
  },

  changePage(delta) {
    this.page = (this.page + delta + 3) % 3;
    this.updatePageVisibility();
  },

  updatePageVisibility() {
    document.getElementById('menuPageHelp').setAttribute('visible', this.page === 0);
    document.getElementById('menuPageImage').setAttribute('visible', this.page === 1);
    document.getElementById('menuPageDatasets').setAttribute('visible', this.page === 2);
    if (this.page === 2) this.drawDatasetPanel();
  },

  renderHelpPage() {
    document.getElementById('menuPageHelp').setAttribute('text', 'value', HELP_TEXT);
  },

  // Canvas-drawn chip list instead of a plain "> "-prefixed text block --
  // rounded rows, a highlighted fill for the current selection, and a
  // checkbox-style indicator, roughly matching the look of this project's
  // other floating VR menu (X-ray_Diffraction_Simulator/phone_vr.html).
  drawDatasetPanel() {
    if (!this.datasetCanvas) {
      this.datasetCanvas = document.createElement('canvas');
      this.datasetCanvas.width = 720;
      this.datasetCanvas.height = 460;
      this.datasetTexture = new THREE.CanvasTexture(this.datasetCanvas);
      this.datasetTexture.colorSpace = THREE.SRGBColorSpace;
    }

    const canvas = this.datasetCanvas;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#333333';
    ctx.font = '22px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Thumbstick up/down: highlight  --  Trigger: load', 16, 22);

    const top = 52;
    const gap = 12;
    const n = SEM_DATASETS.length;
    const rowH = (H - top - gap * (n - 1)) / n;

    SEM_DATASETS.forEach((ds, i) => {
      const y = top + i * (rowH + gap);
      const selected = i === this.selectIndex;

      roundRectPath(ctx, 12, y, W - 24, rowH, 14);
      ctx.fillStyle = selected ? '#1f6feb' : '#e9e9e9';
      ctx.fill();

      // Checkbox-style indicator.
      const cx = 12 + 26;
      const cy = y + rowH / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = selected ? '#1f6feb' : '#999999';
      ctx.stroke();
      if (selected) {
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1f6feb';
        ctx.fill();
      }

      ctx.fillStyle = selected ? '#ffffff' : '#222222';
      ctx.font = selected ? 'bold 22px sans-serif' : '22px sans-serif';
      ctx.fillText(ds.label, cx + 26, cy);
    });

    this.datasetTexture.needsUpdate = true;
    const mesh = document.getElementById('menuPageDatasets').getObject3D('mesh');
    if (mesh) {
      mesh.material.map = this.datasetTexture;
      mesh.material.needsUpdate = true;
    }
  },

  moveSelection(delta) {
    this.selectIndex = (this.selectIndex + delta + SEM_DATASETS.length) % SEM_DATASETS.length;
    this.drawDatasetPanel();
  },

  confirmSelection() {
    window.loadSemDataset(this.selectIndex);
    this.toggleMenu();
  },

  remove() {
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
