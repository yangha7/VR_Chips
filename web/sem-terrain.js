/* global AFRAME, THREE */

// Builds a walkable relief mesh from a grayscale heightmap: dark pixels
// stay at floor level (y=0), bright pixels (ridges/edges in the oblique
// SEM shot) rise up to become the walls of the comb structure.
AFRAME.registerComponent('sem-terrain', {
  schema: {
    heightmap: { type: 'string' },
    texture: { type: 'string' },
    width: { type: 'number', default: 34 },
    maxHeight: { type: 'number', default: 5 },
    resolution: { type: 'int', default: 1000 },
  },

  init() {
    this.loadDataset(this.data.heightmap, this.data.texture);
  },

  // Swaps in a different SEM image at runtime (used by the dataset-picker
  // menu). Depth is derived from the new image's aspect ratio each time,
  // so different source images don't come out stretched.
  loadDataset(heightmapSrc, textureSrc) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => this.build(img, textureSrc);
    img.onerror = (e) => console.error('sem-terrain: failed to load heightmap', heightmapSrc, e);
    img.src = heightmapSrc;
  },

  build(img, textureSrc) {
    // Bumps on every call -- if loadDataset() is called again before this
    // one's chunked loop finishes, the stale run's next requestAnimationFrame
    // tick sees its captured buildId no longer matches and quietly bails
    // instead of racing the newer build to finish the same mesh.
    const buildId = (this.buildId = (this.buildId || 0) + 1);

    const width = this.data.width;
    const maxHeight = this.data.maxHeight;
    const depth = width * (img.height / img.width);

    const resX = this.data.resolution;
    const resY = Math.max(2, Math.round(resX * (img.height / img.width)));

    const canvas = document.createElement('canvas');
    canvas.width = resX;
    canvas.height = resY;
    const ctx = canvas.getContext('2d');
    // Default smoothing blends source pixels when this draw scales the
    // heightmap down to the mesh's sample grid -- fine for continuous
    // grayscale data, but it reintroduces in-between gray values at the
    // edges of an intentionally-binary (0/max) source, undoing a strict
    // two-level height map. Nearest-neighbor keeps each sample a clean
    // pick from the source instead of a blend.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, resX, resY);
    const pixels = ctx.getImageData(0, 0, resX, resY).data;

    const geometry = new THREE.PlaneGeometry(width, depth, resX - 1, resY - 1);
    const positionArray = geometry.attributes.position.array;
    const totalVerts = resX * resY;

    // Filling every vertex height in one synchronous pass blocks the main
    // thread for as long as it takes -- fine before you're in VR, but once
    // an immersive session is running and reprojecting frames from live head
    // tracking, a single long JS stall (hundreds of ms at these resolutions
    // on Quest's mobile CPU) makes the compositor reproject stale frames
    // while you turn your head, which reads as tearing / a stuck old view.
    // This was invisible on the very first load (happens before VR entry)
    // and only showed up on a dataset switch triggered from inside VR --
    // matching exactly what was reported. Spreading the fill across many
    // small requestAnimationFrame chunks keeps every single frame's work
    // bounded, so the session never misses more than a sliver of a frame.
    const CHUNK_SIZE = 20000;
    let idx = 0;

    const finishBuild = () => {
      geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();

      const loader = new THREE.TextureLoader();
      const colorMap = loader.load(textureSrc);
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

      // Only now, with the new mesh fully built, swap it in -- the old one
      // (if any) stays visible for the whole chunked fill above instead of
      // leaving the terrain blanked out for the duration.
      const existing = this.el.getObject3D('mesh');
      if (existing) {
        existing.geometry.dispose();
        if (existing.material.map) existing.material.map.dispose();
        existing.material.dispose();
        this.el.removeObject3D('mesh');
      }
      this.el.setObject3D('mesh', mesh);

      // Keep the sampled grid around for cheap height lookups (collision),
      // so callers don't need to raycast against the full triangle mesh.
      this.heightPixels = pixels;
      this.heightResX = resX;
      this.heightResY = resY;
      this.currentDepth = depth;

      this.el.emit('sem-terrain-loaded');
    };

    // PlaneGeometry lays out vertices row-major, first row at +depth/2.
    // Our canvas row 0 is the top of the source image — sample directly,
    // matching row-for-row so the texture UVs line up with the height data.
    const processChunk = () => {
      if (buildId !== this.buildId) return; // superseded by a newer loadDataset() call
      const end = Math.min(idx + CHUNK_SIZE, totalVerts);
      for (; idx < end; idx++) {
        const brightness = pixels[idx * 4] / 255;
        positionArray[idx * 3 + 2] = brightness * maxHeight;
      }
      if (idx < totalVerts) {
        requestAnimationFrame(processChunk);
      } else {
        finishBuild();
      }
    };
    processChunk();
  },

  // Returns the terrain height at a world-space (x, z), or 0 if outside
  // this terrain's footprint. Cheap O(1) lookup — no raycasting, and no
  // matrix math (this entity has no rotation/scale, only a position
  // offset, so subtracting it directly is enough and avoids relying on
  // the object3D's matrixWorld being up to date on this exact tick).
  getHeightAt(worldX, worldZ) {
    if (!this.heightPixels) return 0;
    const pos = this.el.object3D.position;
    const localX = worldX - pos.x;
    const localZ = worldZ - pos.z;
    const width = this.data.width;
    const depth = this.currentDepth;
    const u = (localX + width / 2) / width;
    const v = (localZ + depth / 2) / depth;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const col = Math.min(this.heightResX - 1, Math.floor(u * this.heightResX));
    const row = Math.min(this.heightResY - 1, Math.floor(v * this.heightResY));
    const brightness = this.heightPixels[(row * this.heightResX + col) * 4] / 255;
    return brightness * this.data.maxHeight;
  },
});
