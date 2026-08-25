/* global AFRAME, THREE */

// Builds a walkable relief mesh from a grayscale heightmap: dark pixels
// stay at floor level (y=0), bright pixels (ridges/edges in the oblique
// SEM shot) rise up to become the walls of the comb structure.
AFRAME.registerComponent('sem-terrain', {
  schema: {
    heightmap: { type: 'string' },
    texture: { type: 'string' },
    width: { type: 'number', default: 30 },
    depth: { type: 'number', default: 24 },
    maxHeight: { type: 'number', default: 5 },
    resolution: { type: 'int', default: 260 },
  },

  init() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => this.build(img);
    img.onerror = (e) => console.error('sem-terrain: failed to load heightmap', e);
    img.src = this.data.heightmap;
  },

  build(img) {
    const { width, depth, maxHeight } = this.data;
    const resX = this.data.resolution;
    const resY = Math.max(2, Math.round(resX * (img.height / img.width)));

    const canvas = document.createElement('canvas');
    canvas.width = resX;
    canvas.height = resY;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, resX, resY);
    const pixels = ctx.getImageData(0, 0, resX, resY).data;

    const geometry = new THREE.PlaneGeometry(width, depth, resX - 1, resY - 1);
    const position = geometry.attributes.position;

    // PlaneGeometry lays out vertices row-major, first row at +depth/2.
    // Our canvas row 0 is the top of the source image — sample directly,
    // matching row-for-row so the texture UVs line up with the height data.
    for (let row = 0; row < resY; row++) {
      for (let col = 0; col < resX; col++) {
        const vertexIndex = row * resX + col;
        const pixelIndex = (row * resX + col) * 4;
        const brightness = pixels[pixelIndex] / 255;
        position.setZ(vertexIndex, brightness * maxHeight);
      }
    }
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();

    const loader = new THREE.TextureLoader();
    const colorMap = loader.load(this.data.texture);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    // Steep walls in the relief can face almost any direction once you're
    // walking among them and looking up/around — single-sided faces would
    // disappear from certain angles, so render both sides.
    const material = new THREE.MeshStandardMaterial({
      map: colorMap,
      roughness: 0.95,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    // No shadow casting on this mesh for v1 — keeping the standalone Quest 3
    // GPU headroom for comfortable frame rate takes priority over lighting fidelity.
    const mesh = new THREE.Mesh(geometry, material);
    this.el.setObject3D('mesh', mesh);
    this.el.emit('sem-terrain-loaded');
  },
});
