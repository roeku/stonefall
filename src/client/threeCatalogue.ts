import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three';

/**
 * The three.js classes the game creates by tag: `<mesh>`, `<boxGeometry>`, and so on.
 *
 * R3F's <Canvas> registers the whole of three so that any tag works, and that keeps every class
 * in the bundle, about 60 KB gzipped that nothing draws. vite.config.ts has <Canvas> register
 * this instead. A tag that is not here throws "... is not part of the THREE namespace" the first
 * time it renders, in `npm run play` and on Reddit alike; threeCatalogue.test.ts reads every tag
 * in the client's JSX so that it fails in `npm test` first.
 *
 * Group, Mesh, PlaneGeometry and ShaderMaterial are also what drei's <Html> and the bloom's
 * <EffectComposer> create inside themselves. <Grid> and <Bloom> register their own.
 */
export const THREE_CATALOGUE = {
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
};
