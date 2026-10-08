/**
 * The game's picture, outside the game: the same canvas, bloom and materials, so that anything
 * the promo stage stages looks the way the game draws it.
 *
 * Every number here is the game's. Where the game's code can be imported it is (the rim material,
 * the block flash, the board's instancing); where it lives inside a React component it is copied
 * with a pointer to the original, and `snapshot.mjs` + the `snapshot` scene check the copy against
 * a frame of the live game.
 */
import * as THREE from 'three';
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import {
  createRimMaterial,
  type RimMaterialOptions,
} from '../../src/client/components/board/rimMaterial';
import {
  attachBodyFlash,
  attachRimFlash,
  createFlashUniforms,
  createStoneUniforms,
  type FlashUniforms,
  type StoneUniforms,
} from '../../src/client/components/game/blockFlash';

/** App.tsx: `<color attach="background" args={['#000814']} />`. */
export const BACKGROUND = '#000814';
/** BoardScene.tsx FLOOR_TINT, and GameScene's floor colour. */
export const FLOOR_TINT = '#2a86a8';

export interface Pipeline {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: BloomEffect;
  render(): void;
}

/**
 * App.tsx's Canvas: `dpr={[0.7, 1.5]}`, `gl={{ antialias: false, alpha: false }}`, camera fov 30,
 * near 1, far 12000, and effects/EffectsRenderer.tsx's chain: an EffectComposer (8x multisampling,
 * half float, as @react-three/postprocessing sets it up; it also turns tone mapping off while it is
 * mounted) and one Bloom: intensity 1.2, threshold 0.1, smoothing 0.4, additive, every other
 * setting the library's default (Kawase blur, large kernel, half resolution).
 *
 * `cssWidth` x `cssHeight` is the canvas as the page lays it out and `dpr` the pixel ratio the
 * game would pick (1.5 on any phone or retina screen), so the drawing buffer -- and with it the
 * width of every rim and the reach of the glow -- is the game's at that size.
 */
export const createPipeline = (o: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  container: HTMLElement;
}): Pipeline => {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(1.5, Math.max(0.7, o.dpr)));
  renderer.setSize(o.cssWidth, o.cssHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  o.container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(30, o.cssWidth / o.cssHeight, 1, 12000);

  const composer = new EffectComposer(renderer, {
    multisampling: 8,
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD,
    intensity: 1.2,
    luminanceThreshold: 0.1,
    luminanceSmoothing: 0.4,
  });
  composer.addPass(new EffectPass(camera, bloom));
  composer.setSize(o.cssWidth, o.cssHeight);

  return {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    render() {
      composer.render();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// The floor: drei's <Grid> as BoardFloor.tsx sets it up
// ---------------------------------------------------------------------------------------------

/**
 * drei's GridMaterial (core/Grid.js), unchanged. Note that BoardFloor's `material-opacity` has no
 * effect on it: the shader writes its own alpha.
 */
const GRID_VERTEX = /* glsl */ `
  varying vec3 localPosition;
  varying vec4 worldPosition;
  uniform vec3 worldCamProjPosition;
  uniform vec3 worldPlanePosition;
  uniform float fadeDistance;
  uniform bool infiniteGrid;
  uniform bool followCamera;
  void main() {
    localPosition = position.xzy;
    if (infiniteGrid) localPosition *= 1.0 + fadeDistance;
    worldPosition = modelMatrix * vec4(localPosition, 1.0);
    if (followCamera) {
      worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
      localPosition = (inverse(modelMatrix) * worldPosition).xyz;
    }
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;
const GRID_FRAGMENT = /* glsl */ `
  varying vec3 localPosition;
  varying vec4 worldPosition;
  uniform vec3 worldCamProjPosition;
  uniform float cellSize;
  uniform float sectionSize;
  uniform vec3 cellColor;
  uniform vec3 sectionColor;
  uniform float fadeDistance;
  uniform float fadeStrength;
  uniform float fadeFrom;
  uniform float cellThickness;
  uniform float sectionThickness;
  float getGrid(float size, float thickness) {
    vec2 r = localPosition.xz / size;
    vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
    float line = min(grid.x, grid.y) + 1.0 - thickness;
    return 1.0 - min(line, 1.0);
  }
  void main() {
    float g1 = getGrid(cellSize, cellThickness);
    float g2 = getGrid(sectionSize, sectionThickness);
    vec3 from = worldCamProjPosition*vec3(fadeFrom);
    float dist = distance(from, worldPosition.xyz);
    float d = 1.0 - min(dist / fadeDistance, 1.0);
    vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));
    gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
    gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
    if (gl_FragColor.a <= 0.0) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Floor {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** drei updates these from the camera every frame; call before rendering. */
  update(camera: THREE.Camera): void;
}

/**
 * BoardFloor.tsx: `<Grid args={[10, 10]} cellSize={8} cellThickness={0.55} sectionSize={64}
 * sectionThickness={1} fadeStrength={1.4} infiniteGrid followCamera={false} />` at the plot edge
 * (or the given origin), `renderOrder={-100}`, depthWrite off. `fadeDistance` is the board's
 * camera distance x 1.7 (BoardScene) or 260 x the run's floor reach (GameScene).
 */
export const createFloor = (o: {
  color?: string;
  fadeDistance: number;
  originX?: number;
  originZ?: number;
}): Floor => {
  const color = new THREE.Color(o.color ?? FLOOR_TINT);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cellSize: { value: 8 },
      sectionSize: { value: 64 },
      fadeDistance: { value: o.fadeDistance },
      fadeStrength: { value: 1.4 },
      fadeFrom: { value: 1 },
      cellThickness: { value: 0.55 },
      sectionThickness: { value: 1 },
      cellColor: { value: color.clone() },
      sectionColor: { value: color.clone() },
      infiniteGrid: { value: true },
      followCamera: { value: false },
      worldCamProjPosition: { value: new THREE.Vector3() },
      worldPlanePosition: { value: new THREE.Vector3() },
    },
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
  // REGION_RADIUS * DEFAULT_TOWER_GRID_SIZE below the origin: the plot's edge.
  mesh.position.set(o.originX ?? -24, 0, o.originZ ?? -24);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  const plane = new THREE.Plane();
  const up = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Vector3();
  return {
    mesh,
    material,
    update(camera) {
      mesh.updateMatrixWorld();
      plane.setFromNormalAndCoplanarPoint(up, zero).applyMatrix4(mesh.matrixWorld);
      plane.projectPoint(camera.position, material.uniforms.worldCamProjPosition!.value);
      material.uniforms.worldPlanePosition!.value.set(0, 0, 0).applyMatrix4(mesh.matrixWorld);
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Towers on the board: BoardTowers.tsx
// ---------------------------------------------------------------------------------------------

/** The board's rim material, unchanged (rimMaterial.ts). */
export const towerMaterial = (options: RimMaterialOptions): THREE.MeshBasicMaterial =>
  createRimMaterial(options);

// ---------------------------------------------------------------------------------------------
// Territory tiles: TerritoryTiles.tsx
// ---------------------------------------------------------------------------------------------

/** TerritoryTiles.tsx `createTileMaterial`, copied (it is not exported). */
export const tileMaterial = (
  fill: number,
  edge: number,
  time: { value: number },
  breathe: boolean
): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vTileUv;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTileUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 vTileUv;\nuniform float uTime;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dEdge = min(min(vTileUv.x, 1.0 - vTileUv.x), min(vTileUv.y, 1.0 - vTileUv.y));
        float wEdge = fwidth(dEdge) * 1.6;
        float rim = 1.0 - smoothstep(wEdge, wEdge * 2.6, dEdge);
        float pulse = ${breathe ? '0.8 + 0.2 * sin(uTime * 2.2)' : '1.0'};
        float a = (${fill.toFixed(3)} + rim * ${edge.toFixed(3)}) * pulse;
        diffuseColor.rgb *= a;
        diffuseColor.a = 1.0;`
      );
  };
  material.customProgramCacheKey = () => `tile-${fill}-${edge}-${breathe}`;
  return material;
};

/** The three tile layers TerritoryTiles draws: [fill, edge, y]. */
export const TILE_LAYERS = {
  keep: { fill: 0.16, edge: 0.55, y: 0.03 },
  land: { fill: 0.11, edge: 0.5, y: 0.025 },
  reach: { fill: 0.035, edge: 0.12, y: 0.02 },
} as const;

/** TerritoryTiles' INSET: a tile is a cell less this much on each side. */
export const TILE_INSET = 0.7;

// ---------------------------------------------------------------------------------------------
// A block of the run: GameBlock_Simple.tsx
// ---------------------------------------------------------------------------------------------

/**
 * One block as GameBlock draws it: a dark metal box lit only by its emissive (the game has no
 * lights), the seam flash and the stone on its body, and its edges as one-pixel lines that flash
 * with it. Plus, for the block in hand, the translucent shell around it.
 */
export class GameBlockLook {
  readonly flash: FlashUniforms = createFlashUniforms();
  readonly stone: StoneUniforms = createStoneUniforms();
  readonly body: THREE.MeshStandardMaterial;
  readonly edges: THREE.LineBasicMaterial;
  readonly mesh: THREE.Mesh;
  readonly lines: THREE.LineSegments;
  readonly group = new THREE.Group();
  shell: THREE.Mesh | null = null;
  private dims = '';

  constructor(active = false) {
    this.body = new THREE.MeshStandardMaterial({
      color: '#1a1a2e',
      roughness: 0.3,
      metalness: 0.7,
      emissive: '#00f2fe',
      emissiveIntensity: 0.3,
      toneMapped: false,
    });
    attachBodyFlash(this.body, this.flash, this.stone);
    this.edges = new THREE.LineBasicMaterial({
      color: '#00f2fe',
      opacity: 1,
      transparent: true,
      toneMapped: false,
    });
    attachRimFlash(this.edges, this.flash);
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.body);
    this.lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      this.edges
    );
    this.group.add(this.mesh, this.lines);
    if (active) {
      this.shell = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: '#00f2fe',
          toneMapped: false,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        })
      );
      this.shell.scale.setScalar(1.05);
      this.shell.renderOrder = 999;
      this.group.add(this.shell);
    }
  }

  /** Geometry in world units. GameBlock builds a box and its edges at the block's size. */
  setSize(w: number, h: number, d: number): void {
    const key = `${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}`;
    if (key === this.dims) return;
    this.dims = key;
    this.mesh.geometry.dispose();
    this.lines.geometry.dispose();
    this.mesh.geometry = new THREE.BoxGeometry(w, h, d);
    const box = new THREE.BoxGeometry(w, h, d);
    this.lines.geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    if (this.shell) {
      this.shell.geometry.dispose();
      this.shell.geometry = new THREE.BoxGeometry(w, h, d);
    }
    this.flash.uFlashHeight.value = Math.max(h, 0.0001);
  }

  /**
   * GameBlock's colours: the body and rim in the block's own colour; the emissive in the accent,
   * or the accent pushed toward white at 0.3 while the run has a perfect streak going.
   */
  setLook(o: {
    color: string;
    accentHex: string;
    accentSecondaryHex: string;
    streaking: boolean;
    stone: number;
  }): void {
    this.body.color.set(o.color);
    this.body.emissive.set(o.streaking ? o.accentSecondaryHex : o.accentHex);
    this.body.emissiveIntensity = o.streaking ? 0.3 : 0.1;
    this.body.roughness = 0.2;
    this.body.metalness = 0.65;
    const edge = new THREE.Color(o.color);
    this.edges.color.copy(edge);
    this.flash.uFlashColor.value.copy(edge).lerp(new THREE.Color('#ffffff'), 0.6);
    this.stone.uStone.value = o.stone;
    this.stone.uStoneColor.value.copy(edge);
    // The shell is lit in the accent, not the block's colour (GameBlock's tronColors.edgeColor).
    if (this.shell) {
      (this.shell.material as THREE.MeshBasicMaterial).color.set(
        o.streaking ? o.accentSecondaryHex : o.accentHex
      );
    }
  }
}

/** LandingRings.tsx: a block-sized square loop, white for a perfect and pale cyan otherwise. */
export const ringGeometry = (): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3)
  );
  return g;
};

/** CutDebris.tsx's sparks material. */
export const sparkMaterial = (): THREE.PointsMaterial =>
  new THREE.PointsMaterial({
    size: 0.55,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

// ---------------------------------------------------------------------------------------------
// The viewer's plot on the map: PlotBeacon.tsx and PlotPlatform.tsx
// ---------------------------------------------------------------------------------------------

/** PlotBeacon.tsx: a soft additive shaft of light over the viewer's plot, in the Map view. */
export const plotBeacon = (x: number, z: number, color: string): THREE.Mesh => {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.34 } },
    vertexShader: `
      varying float vH;
      void main() {
        vH = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vH;
      void main() {
        float a = (1.0 - vH) * (1.0 - vH) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(6, 11, 600, 16, 1, true), material);
  mesh.position.set(x, 300, z);
  return mesh;
};

/** PlotPlatform.tsx at rest: the viewer's keep outlined in their colour at 40%. */
export const keepOutline = (
  x: number,
  z: number,
  radius: number,
  color: string
): THREE.LineLoop => {
  const half = (radius * 2 + 1) * 4;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half],
      3
    )
  );
  const line = new THREE.LineLoop(
    g,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, toneMapped: false })
  );
  line.position.set(x, 0.06, z);
  return line;
};
