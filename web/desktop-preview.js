/* global AFRAME, THREE */

window.DESKTOP_PREVIEW_VERSION = 3;

// A plain-HTML overlay (outside the A-Frame scene entirely) so this app can
// be reviewed from a normal desktop browser without ever putting on the
// headset -- WASD + mouse-drag to move/look are already free from A-Frame's
// wasd-controls/look-controls on the camera, but that's horizontal-plane
// movement only (no vertical component, unlike VR's point-and-fly which can
// climb). This adds the things that otherwise only exist as VR-controller
// actions: Q/E to scale the model (mirrors thumbstick zoom), Z/X to move
// vertically (mirrors pointing up/down + trigger), M to open/close the
// floating menu (mirrors grip), and a clickable dataset list both in this
// panel and directly on the in-scene menu itself. Harmless in the headset
// too -- this DOM overlay isn't part of the rendered WebXR view, only the
// flat pre-VR page.
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.createElement('div');
  panel.id = 'desktop-preview-panel';
  panel.style.cssText = [
    'position:fixed', 'bottom:12px', 'left:12px', 'z-index:9998',
    'background:rgba(0,0,0,0.78)', 'color:#fff', 'font-family:sans-serif',
    'padding:12px 14px', 'border-radius:8px', 'max-width:280px', 'font-size:13px',
  ].join(';');
  panel.innerHTML =
    '<div style="font-weight:bold; margin-bottom:6px;">Desktop preview</div>' +
    '<div style="opacity:0.85; margin-bottom:8px; line-height:1.4;">' +
    'Click the scene, then WASD + mouse-drag to move/look.<br>' +
    'Q / E: scale model down/up -- Z / X: move down/up.<br>' +
    'M: open/close menu. While open: [ / ] switch page, I / K highlight,<br>' +
    'Enter to load -- or just click a row directly on the menu panel.</div>' +
    '<div id="desktop-dataset-buttons"></div>';
  document.body.appendChild(panel);

  function getMenuComponent() {
    const el = document.querySelector('[menu-controller]');
    return el && el.components['menu-controller'];
  }

  const buttonContainer = panel.querySelector('#desktop-dataset-buttons');
  (window.SEM_DATASETS || []).forEach((ds, i) => {
    const btn = document.createElement('button');
    btn.textContent = ds.label;
    btn.style.cssText = [
      'display:block', 'width:100%', 'margin-bottom:4px', 'padding:6px 8px',
      'font-size:12px', 'cursor:pointer', 'text-align:left',
    ].join(';');
    btn.addEventListener('click', () => window.loadSemDataset && window.loadSemDataset(i));
    buttonContainer.appendChild(btn);
  });

  function scaleTerrain(factor) {
    const terrainEl = document.getElementById('terrain');
    if (!terrainEl) return;
    const scaleObj = terrainEl.object3D.scale;
    const next = Math.min(4, Math.max(0.2, scaleObj.x * factor));
    scaleObj.set(next, next, next);
  }

  const sceneEl = document.querySelector('a-scene');
  sceneEl.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    scaleTerrain(evt.deltaY < 0 ? 1.08 : 0.93);
  }, { passive: false });

  // Point-and-select directly on the menu panel, the same "point and pick"
  // interaction the VR laser gives you against the world -- raycast the
  // click against the dataset-picker mesh, map the hit UV back to a row
  // index using the exact same layout constants drawDatasetPanel() used to
  // draw it, then select AND confirm in one click.
  sceneEl.addEventListener('click', (evt) => {
    const menuComp = getMenuComponent();
    if (!menuComp || !menuComp.isOpen() || menuComp.page !== 2 || !menuComp.datasetCanvas) return;
    const cameraObj = document.getElementById('camera').getObject3D('camera');
    const mesh = document.getElementById('menuPageDatasets').getObject3D('mesh');
    if (!cameraObj || !mesh) return;

    const mouse = new THREE.Vector2(
      (evt.clientX / window.innerWidth) * 2 - 1,
      -(evt.clientY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraObj);
    const hits = raycaster.intersectObject(mesh, false);
    if (!hits.length || !hits[0].uv) return;

    const canvas = menuComp.datasetCanvas;
    const px = hits[0].uv.x * canvas.width;
    const py = (1 - hits[0].uv.y) * canvas.height; // PlaneGeometry UV.y=0 is the bottom; canvas rows are drawn top-down.

    const n = window.SEM_DATASETS.length;
    const top = 52, gap = 12;
    const rowH = (canvas.height - top - gap * (n - 1)) / n;
    if (py < top) return;
    const idx = Math.floor((py - top) / (rowH + gap));
    const withinRow = (py - top) - idx * (rowH + gap);
    if (idx < 0 || idx >= n || withinRow > rowH) return; // clicked the gap between rows

    menuComp.selectIndex = idx;
    menuComp.confirmSelection();
  });

  // Continuous while held, like the VR controls this mirrors -- a single
  // keydown-triggered step would feel nothing like holding a thumbstick.
  const pressedKeys = {};
  window.addEventListener('keydown', (evt) => {
    const key = evt.key.toLowerCase();
    pressedKeys[key] = true;

    if (key === 'm') {
      const menuComp = getMenuComponent();
      if (menuComp) menuComp.toggleMenu();
      return;
    }

    // Menu navigation while open -- deliberately NOT arrow keys or WASD,
    // both already bound to camera movement by A-Frame's wasd-controls
    // (which also binds arrows), so reusing them here would also drag the
    // camera around while browsing the menu.
    const menuComp = getMenuComponent();
    if (menuComp && menuComp.isOpen()) {
      if (key === '[') menuComp.changePage(-1);
      else if (key === ']') menuComp.changePage(1);
      else if (menuComp.page === 2 && key === 'i') menuComp.moveSelection(-1);
      else if (menuComp.page === 2 && key === 'k') menuComp.moveSelection(1);
      else if (menuComp.page === 2 && key === 'enter') menuComp.confirmSelection();
    }
  });
  window.addEventListener('keyup', (evt) => { pressedKeys[evt.key.toLowerCase()] = false; });

  const VERTICAL_SPEED = 3; // m/s, matches fly-controls' flySpeed
  const ZOOM_RATE = 0.8; // per second, matches fly-controls' zoomSpeed feel
  let lastTime = null;
  function tick(time) {
    if (lastTime !== null) {
      const dt = (time - lastTime) / 1000;
      const cameraRig = document.getElementById('cameraRig');
      if (cameraRig) {
        if (pressedKeys['z']) cameraRig.object3D.position.y -= VERTICAL_SPEED * dt;
        if (pressedKeys['x']) cameraRig.object3D.position.y += VERTICAL_SPEED * dt;
      }
      if (pressedKeys['q']) scaleTerrain(1 - ZOOM_RATE * dt);
      if (pressedKeys['e']) scaleTerrain(1 + ZOOM_RATE * dt);
    }
    lastTime = time;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
