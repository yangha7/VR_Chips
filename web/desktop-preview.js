/* global AFRAME */

window.DESKTOP_PREVIEW_VERSION = 1;

// A plain-HTML overlay (outside the A-Frame scene entirely) so this app can
// be reviewed from a normal desktop browser without ever putting on the
// headset -- WASD + mouse-drag to move/look are already free from A-Frame's
// wasd-controls/look-controls on the camera; this adds the two things that
// otherwise only exist as VR-controller actions (grip menu, thumbstick
// zoom): a clickable dataset list, and scroll-wheel to scale the model.
// Harmless in the headset too -- this DOM overlay isn't part of the
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
    'Click the scene, then WASD + mouse-drag to move/look. Scroll wheel: scale the model.</div>' +
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

  const sceneEl = document.querySelector('a-scene');
  sceneEl.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    const terrainEl = document.getElementById('terrain');
    if (!terrainEl) return;
    const scaleObj = terrainEl.object3D.scale;
    const factor = evt.deltaY < 0 ? 1.08 : 0.93;
    const next = Math.min(4, Math.max(0.2, scaleObj.x * factor));
    scaleObj.set(next, next, next);
  }, { passive: false });
});
