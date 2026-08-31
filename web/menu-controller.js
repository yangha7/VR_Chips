/* global AFRAME, THREE */

window.MENU_CONTROLLER_VERSION = 13;

// Selectable SEM datasets for the terrain. Add more here as they're
// processed via scripts/sem_to_heightmap.py -- no other code changes needed.
const SEM_DATASETS = [
  { label: 'ALS 40nm line/space grating (real data)', heightmap: '../assets/processed/als_grating_height.png?v=4', texture: '../assets/processed/als_grating_texture.jpg?v=4' },
  { label: 'MEMS comb-drive actuator', heightmap: '../assets/processed/comb_height.png', texture: '../assets/processed/comb_texture.jpg' },
  { label: 'Deprocessed die -- routing', heightmap: '../assets/processed/fig3_height.png', texture: '../assets/processed/fig3_texture.jpg' },
  { label: 'Deprocessed die -- via lattice', heightmap: '../assets/processed/fig4_height.png', texture: '../assets/processed/fig4_texture.jpg' },
  { label: 'Deprocessed die -- mixed array', heightmap: '../assets/processed/fig6_height.png', texture: '../assets/processed/fig6_texture.jpg' },
];

const HELP_TEXT = "Real ALS beamline image: a 40nm-pitch line/space grating, magnified for walking among its rows.\n\nCONTROLS\nHold trigger: fly toward where you're pointing\nThumbstick up/down: zoom the model larger/smaller (doesn't move you)\nGrip: open/close this menu\nThumbstick left/right: switch this menu's page\nOn sample picker: thumbstick up/down to highlight, trigger to load";

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

    const dir = new THREE.Vector3();
    this.data.camera.object3D.getWorldDirection(dir); // already proven safe elsewhere in this app
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();

    const menuObj = this.data.menu.object3D;
    menuObj.position.set(camWorldX + dir.x * 1.6, camWorldY, camWorldZ + dir.z * 1.6);

    // Face the plane's front (+Z) back toward the camera.
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
      if (this.prevAxisY <= 0.6 && axisY > 0.6) this.moveSelection(-1);
      if (this.prevAxisY >= -0.6 && axisY < -0.6) this.moveSelection(1);
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
    if (this.page === 2) this.renderDatasetList();
  },

  renderHelpPage() {
    document.getElementById('menuPageHelp').setAttribute('text', 'value', HELP_TEXT);
  },

  renderDatasetList() {
    const lines = ['Thumbstick up/down: highlight -- Trigger: load', ''];
    lines.push(...SEM_DATASETS.map((d, i) => (i === this.selectIndex ? '> ' : '   ') + d.label));
    document.getElementById('menuPageDatasets').setAttribute('text', 'value', lines.join('\n'));
  },

  moveSelection(delta) {
    this.selectIndex = (this.selectIndex + delta + SEM_DATASETS.length) % SEM_DATASETS.length;
    this.renderDatasetList();
  },

  confirmSelection() {
    const ds = SEM_DATASETS[this.selectIndex];
    const terrainComp = this.data.terrain.components['sem-terrain'];
    terrainComp.loadDataset(ds.heightmap, ds.texture);
    document.getElementById('menuImagePlane').setAttribute('material', 'src', ds.texture);
    this.toggleMenu();
  },

  remove() {
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
