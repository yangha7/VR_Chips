/* global AFRAME */

window.DESKTOP_PREVIEW_VERSION = 2;

// A plain-HTML overlay (outside the A-Frame scene entirely) so this app can
// be reviewed from a normal desktop browser without ever putting on the
// headset -- WASD + mouse-drag to move/look are already free from A-Frame's
// wasd-controls/look-controls on the camera, but that's horizontal-plane
// movement only (no vertical component, unlike VR's point-and-fly which can
// climb). This adds the things that otherwise only exist as VR-controller
// actions: Q/E to scale the model (mirrors thumbstick zoom), Z/X to move
// vertically (mirrors pointing up/down + trigger), and a clickable dataset
// list. Harmless in the headset too -- this DOM overlay isn't part of the
// rendered WebXR view, only the flat pre-VR page.
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
    'Q / E: scale model down/up -- Z / X: move down/up.</div>' +
    '<div id="desktop-dataset-buttons"></div>';
  document.body.appendChild(panel);

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

  // Continuous while held, like the VR controls this mirrors -- a single
  // keydown-triggered step would feel nothing like holding a thumbstick.
  const pressedKeys = {};
  window.addEventListener('keydown', (evt) => { pressedKeys[evt.key.toLowerCase()] = true; });
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
