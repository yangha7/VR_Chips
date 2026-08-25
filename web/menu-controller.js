/* global AFRAME, THREE */

window.MENU_CONTROLLER_VERSION = 1;

// Selectable SEM datasets for the terrain. Add more here as they're
// processed via scripts/sem_to_heightmap.py -- no other code changes needed.
const SEM_DATASETS = [
  { label: 'MEMS comb-drive actuator', heightmap: '../assets/processed/comb_height.png', texture: '../assets/processed/comb_texture.jpg' },
  { label: 'Deprocessed die -- routing', heightmap: '../assets/processed/fig3_height.png', texture: '../assets/processed/fig3_texture.jpg' },
  { label: 'Deprocessed die -- via lattice', heightmap: '../assets/processed/fig4_height.png', texture: '../assets/processed/fig4_texture.jpg' },
  { label: 'Deprocessed die -- mixed array', heightmap: '../assets/processed/fig6_height.png', texture: '../assets/processed/fig6_texture.jpg' },
];

const HELP_TEXT = "SEM image of a MEMS comb-drive actuator, magnified ~1000x.\n\nCONTROLS\nHold trigger: fly toward where you're pointing\nThumbstick up/down: zoom in / out (moves along where you look)\nGrip: open/close this menu\nThumbstick left/right: switch this menu's page";

AFRAME.registerComponent('menu-controller', {
  schema: {
    menu: { type: 'selector' },
    camera: { type: 'selector' },
    terrain: { type: 'selector' },
  },

  init() {
    this.page = 0;
    this.selectIndex = 0;
    this.prevAxisX = 0;
    this.prevAxisY = 0;
    this.tmpPos = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();

    this.onGripDown = () => this.toggleMenu();
    this.onTriggerDown = () => {
      if (this.isOpen() && this.page === 2) this.confirmSelection();
    };
    this.onAxisMove = (evt) => this.handleAxisMove(evt.detail.axis);

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('triggerdown', this.onTriggerDown);
    this.el.addEventListener('axismove', this.onAxisMove);

    this.renderHelpPage();
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

  positionInFrontOfCamera() {
    const camObj = this.data.camera.object3D;
    camObj.getWorldPosition(this.tmpPos);
    camObj.getWorldDirection(this.tmpDir);
    this.tmpDir.y = 0;
    if (this.tmpDir.lengthSq() < 1e-6) this.tmpDir.set(0, 0, -1);
    this.tmpDir.normalize();

    const menuObj = this.data.menu.object3D;
    menuObj.position.copy(this.tmpPos).addScaledVector(this.tmpDir, 1.6);
    menuObj.position.y = this.tmpPos.y;
    menuObj.lookAt(this.tmpPos.x, menuObj.position.y, this.tmpPos.z);
    menuObj.rotateY(Math.PI); // lookAt points -Z at the target; the plane's front is +Z.
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
    const lines = SEM_DATASETS.map((d, i) => (i === this.selectIndex ? '> ' : '   ') + d.label);
    lines.push('', '(point + trigger to load)');
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
    this.el.removeEventListener('triggerdown', this.onTriggerDown);
    this.el.removeEventListener('axismove', this.onAxisMove);
  },
});
