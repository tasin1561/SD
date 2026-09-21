import * as THREE from 'three';
import { BD_RINGS, GEO_NODES, LAND_RINGS } from '@/components/landing/map-geometry';
import { readTokens, subscribeThemeTokens } from '@/lib/theme-tokens';

/**
 * The hero scene, in raw three.js — no React inside this file.
 *
 * NOT MOUNTED (2026-09-21): the owner chose the existing 2D corridor map
 * for the hero (`HeroArt`). Kept compiling, unreferenced, so it is never
 * bundled; delete or revive by decision, not by accident.
 *
 * ── The signature, as a list so it cannot be quietly trimmed ─────────
 * extruded Bangladesh + India on a tilted plate · corridor-gradient route
 * arcs Dhaka → the Indian metros · a cargo plane travelling the arc ·
 * parcels descending under parachutes onto the destination pins · a van
 * at the destination that drives off when the plane lands · city pins as
 * pillars · pointer-driven camera parallax (off on touch). The direction
 * toggle reverses the flight, the parachutes and the van, and swaps the
 * arcs' dominant colour (saffron = Send to India, green = Send to
 * Bangladesh).
 *
 * ── Budget ───────────────────────────────────────────────────────────
 * Ten draw calls: plate, grid, land, Bangladesh, arcs, arc glow, pins,
 * parcels, parachutes, plane + van (the last two are separate meshes, so
 * eleven at most). One Lambert per solid, one hemisphere + one
 * directional light, no shadows, no post-processing. Every piece of
 * geometry that repeats is an InstancedMesh; every compound (plane, van)
 * is ONE BufferGeometry built by `concat`.
 *
 * ── Discipline copied from the 2D console ────────────────────────────
 * DPR clamped to [1, 1.5]; the loop runs only while the host is on
 * screen and the tab is visible; theme tokens are read off `:root` and
 * re-applied in place on change (no remount); everything is disposed and
 * the context is force-lost on unmount. The FPS governor drops DPR to 1
 * under 40 fps and hands the hero back to the poster under 24, writing
 * `sessionStorage[sd-hero-3d]=off` so the next visit does not try again.
 */

export type Direction = 'out' | 'in';

export interface SceneOptions {
  direction: Direction;
  /** Render exactly one deterministic frame (the poster renderer). */
  poster?: boolean;
  /** Called once, after the first real frame, with that frame's renderer.info. */
  onReady?: (stats: { calls: number; triangles: number }) => void;
  onFallback?: (reason: 'fps') => void;
}

export interface SceneHandle {
  setDirection(d: Direction): void;
  setActive(active: boolean): void;
  stats(): { calls: number; triangles: number };
  dispose(): void;
}

const SCENE_TOKENS = [
  '--scene-land',
  '--scene-bd',
  '--scene-grid',
  '--scene-pin',
  '--scene-arc-out',
  '--scene-arc-in',
  '--scene-haze',
  '--scene-plate',
  '--scene-plane',
  '--scene-van',
  '--scene-parcel',
  '--scene-chute',
] as const;
type SceneToken = (typeof SCENE_TOKENS)[number];
const FALLBACK: Record<SceneToken, string> = {
  '--scene-land': '#16223a',
  '--scene-bd': '#b45309',
  '--scene-grid': 'rgba(180,197,255,0.07)',
  '--scene-pin': '#7bafea',
  '--scene-arc-out': '#fbbf24',
  '--scene-arc-in': '#34d399',
  '--scene-haze': '#090d16',
  '--scene-plate': '#0f1729',
  '--scene-plane': '#e8edf7',
  '--scene-van': '#7bafea',
  '--scene-parcel': '#fbbf24',
  '--scene-chute': '#b4c5ff',
};

/** sessionStorage key the FPS governor writes so a reload does not retry the scene. */
const HERO_3D_KEY = 'sd-hero-3d';

/** World size of the [0..1]² map. */
const S = 4.4;
const ORIGIN = 'DAC';
const DESTS = [
  'DEL',
  'JAI',
  'LKO',
  'GAU',
  'PAT',
  'BBI',
  'AMD',
  'CCU',
  'NAG',
  'BOM',
  'PNQ',
  'HYD',
  'MAA',
  'BLR',
] as const;
const LAND_H = 0.06;
const BD_H = 0.09;
const PIN_H = 0.16;
const PARCELS = 10;
const FLIGHT_S = 3.4;

function world(id: string): THREE.Vector3 {
  const [u, v] = GEO_NODES[id] ?? [0.5, 0.5];
  return new THREE.Vector3((u - 0.5) * S, 0, (v - 0.5) * S);
}

/** `rgba(r,g,b,a)` or `#rrggbbaa` → colour + alpha; anything else is opaque. */
function parseColor(css: string): { color: THREE.Color; alpha: number } {
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(css.trim());
  if (hex8)
    return { color: new THREE.Color(`#${hex8[1]}`), alpha: parseInt(hex8[2] ?? 'ff', 16) / 255 };
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(css);
  if (m) {
    const c = new THREE.Color(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255);
    return { color: c, alpha: m[4] === undefined ? 1 : Number(m[4]) };
  }
  return { color: new THREE.Color(css), alpha: 1 };
}

/** Concatenate indexed BufferGeometries (position + normal) into one. */
function concat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  const posOf = (g: THREE.BufferGeometry): THREE.BufferAttribute =>
    g.getAttribute('position') as THREE.BufferAttribute;
  for (const g of parts) {
    vCount += posOf(g).count;
    iCount += g.index ? g.index.count : posOf(g).count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of parts) {
    const p = posOf(g);
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    const n3 = p.count;
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) idx[io + i] = (src[i] as number) + vo;
      io += src.length;
    } else {
      for (let i = 0; i < n3; i++) idx[io + i] = vo + i;
      io += n3;
    }
    vo += n3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function landGeometry(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  depth: number,
): THREE.BufferGeometry {
  const shapes = rings
    .filter((r) => r.length >= 3)
    .map(
      (r) => new THREE.Shape(r.map(([u, v]) => new THREE.Vector2((u - 0.5) * S, -(v - 0.5) * S))),
    );
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.clearGroups();
  return g;
}

function arcCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = 0.32 + 0.26 * a.distanceTo(b);
  return new THREE.QuadraticBezierCurve3(a.clone().setY(BD_H), mid, b.clone().setY(LAND_H));
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function mountHeroScene(host: HTMLElement, opts: SceneOptions): SceneHandle {
  let direction: Direction = opts.direction;
  const poster = opts.poster === true;

  const renderer = new THREE.WebGLRenderer({
    antialias: poster,
    alpha: true,
    powerPreference: 'low-power',
    preserveDrawingBuffer: poster,
  });
  let dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'hero-canvas';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  const camBase = new THREE.Vector3(0.35, 3.1, 3.7);
  const lookAt = new THREE.Vector3(0.2, 0, -0.25);
  const par = new THREE.Vector2(0, 0);
  const parTarget = new THREE.Vector2(0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.85);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(3, 6, 2.5);
  scene.add(hemi, sun);

  // ── Solids ─────────────────────────────────────────────────────────
  const matPlate = new THREE.MeshLambertMaterial();
  const matLand = new THREE.MeshLambertMaterial();
  const matBd = new THREE.MeshLambertMaterial();
  const matPin = new THREE.MeshLambertMaterial();
  const matPlane = new THREE.MeshLambertMaterial();
  const matVan = new THREE.MeshLambertMaterial();
  const matParcel = new THREE.MeshLambertMaterial();
  const matChute = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const matArc = new THREE.MeshBasicMaterial({ vertexColors: true });
  const matGlow = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  const plate = new THREE.Mesh(new THREE.BoxGeometry(S * 1.18, 0.14, S * 1.18), matPlate);
  plate.position.y = -0.07;
  const grid = new THREE.GridHelper(S * 1.18, 24);
  grid.position.y = 0.002;
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  const land = new THREE.Mesh(landGeometry(LAND_RINGS, LAND_H), matLand);
  const bd = new THREE.Mesh(landGeometry(BD_RINGS, BD_H), matBd);
  scene.add(plate, grid, land, bd);

  // ── Pins ───────────────────────────────────────────────────────────
  const nodes = [ORIGIN, ...DESTS];
  const pins = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.018, 0.03, PIN_H, 8),
    matPin,
    nodes.length,
  );
  {
    const m = new THREE.Matrix4();
    nodes.forEach((id, i) => {
      const p = world(id);
      const base = id === ORIGIN ? BD_H : LAND_H;
      pins.setMatrixAt(i, m.makeTranslation(p.x, base + PIN_H / 2, p.z));
    });
  }
  scene.add(pins);

  // ── Arcs ───────────────────────────────────────────────────────────
  const origin = world(ORIGIN);
  const curves = DESTS.map((id) => arcCurve(origin, world(id)));
  const TUB = 26;
  const RAD = 5;
  const buildArcs = (radius: number): THREE.BufferGeometry => {
    const parts = curves.map((c) => new THREE.TubeGeometry(c, TUB, radius, RAD, false));
    const g = concat(parts);
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(
        new Float32Array((g.getAttribute('position') as THREE.BufferAttribute).count * 3),
        3,
      ),
    );
    return g;
  };
  const arcs = new THREE.Mesh(buildArcs(0.011), matArc);
  const glow = new THREE.Mesh(buildArcs(0.034), matGlow);
  scene.add(arcs, glow);
  const cArcOut = new THREE.Color();
  const cArcIn = new THREE.Color();
  const tint = (g: THREE.BufferGeometry): void => {
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const perArc = (TUB + 1) * (RAD + 1);
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      const t = Math.floor((i % perArc) / (RAD + 1)) / TUB; // 0 at Dhaka → 1 at the metro
      if (direction === 'out') c.copy(cArcIn).lerp(cArcOut, smooth(t * 2.4));
      else c.copy(cArcOut).lerp(cArcIn, smooth(t * 2.4));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };

  // ── Plane ──────────────────────────────────────────────────────────
  const plane = new THREE.Mesh(
    concat([
      box(0.05, 0.045, 0.34, 0, 0, 0),
      box(0.3, 0.012, 0.06, 0, -0.005, 0.01),
      box(0.12, 0.01, 0.04, 0, 0.01, 0.15),
      box(0.01, 0.06, 0.05, 0, 0.035, 0.15),
    ]),
    matPlane,
  );
  scene.add(plane);

  // ── Van ────────────────────────────────────────────────────────────
  const van = new THREE.Mesh(
    concat([
      box(0.085, 0.05, 0.16, 0, 0.05, 0.01),
      box(0.085, 0.032, 0.05, 0, 0.041, -0.09),
      box(0.02, 0.02, 0.02, -0.045, 0.012, -0.06),
      box(0.02, 0.02, 0.02, 0.045, 0.012, -0.06),
      box(0.02, 0.02, 0.02, -0.045, 0.012, 0.06),
      box(0.02, 0.02, 0.02, 0.045, 0.012, 0.06),
    ]),
    matVan,
  );
  scene.add(van);

  // ── Parcels + parachutes ───────────────────────────────────────────
  const parcels = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.055, 0.05, 0.055),
    matParcel,
    PARCELS,
  );
  const chutes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    matChute,
    PARCELS,
  );
  scene.add(parcels, chutes);
  interface Drop {
    dest: number;
    t: number; // 0 top → 1 landed
    speed: number;
    wait: number; // seconds until (re)spawn
    ox: number;
    oz: number;
  }
  const drops: Drop[] = Array.from({ length: PARCELS }, (_, i) => ({
    dest: i % DESTS.length,
    t: (i * 0.37) % 1,
    speed: 0.16 + (i % 3) * 0.03,
    wait: i < 4 ? 0 : 0.6 * i,
    ox: 0,
    oz: 0,
  }));
  const respawn = (d: Drop, i: number, first: boolean): void => {
    d.dest = (d.dest + 3) % DESTS.length;
    d.t = first ? d.t : 0;
    d.wait = first ? d.wait : 1.2 + (i % 4) * 0.7;
    const a = (i / PARCELS) * Math.PI * 2;
    // Everything flies to Dhaka in the 'in' direction — spread the landings
    // so ten parcels do not stack on one pin.
    d.ox = direction === 'in' ? Math.cos(a) * 0.18 : 0;
    d.oz = direction === 'in' ? Math.sin(a) * 0.18 : 0;
  };
  drops.forEach((d, i) => respawn(d, i, true));

  // ── Theme ──────────────────────────────────────────────────────────
  const applyTheme = (): void => {
    const t = readTokens(SCENE_TOKENS, FALLBACK);
    matPlate.color.set(t['--scene-plate']);
    matLand.color.set(t['--scene-land']);
    matBd.color.set(t['--scene-bd']);
    matPin.color.set(t['--scene-pin']);
    matPlane.color.set(t['--scene-plane']);
    matVan.color.set(t['--scene-van']);
    matParcel.color.set(t['--scene-parcel']);
    matChute.color.set(t['--scene-chute']);
    const g = parseColor(t['--scene-grid']);
    gridMat.color.copy(g.color);
    gridMat.opacity = Math.min(1, g.alpha * 4);
    cArcOut.set(t['--scene-arc-out']);
    cArcIn.set(t['--scene-arc-in']);
    tint(arcs.geometry);
    tint(glow.geometry);
    const haze = new THREE.Color(t['--scene-haze']);
    scene.fog = new THREE.Fog(haze, 5.2, 9.5);
    hemi.color.copy(haze).lerp(new THREE.Color(0xffffff), 0.75);
    hemi.groundColor.copy(haze);
  };
  applyTheme();
  const unsubTheme = subscribeThemeTokens(() => {
    applyTheme();
    if (!running) renderOnce();
  });

  // ── Layout ─────────────────────────────────────────────────────────
  const resize = (): void => {
    const box = host.clientHeight > 0 ? host : (host.parentElement ?? host);
    const w = Math.max(1, box.clientWidth);
    const h = Math.max(1, box.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // A portrait host (the phone, where the art sits behind the copy)
    // pulls the camera back so the whole corridor stays in frame.
    const pull = camera.aspect < 1 ? (1 / camera.aspect - 1) * 1.7 : 0;
    camera.position.copy(camBase).add(new THREE.Vector3(0, pull * 0.6, pull));
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    if (!running) renderOnce();
  });
  ro.observe(host);

  // ── Parallax (pointer only) ────────────────────────────────────────
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    const r = host.getBoundingClientRect();
    parTarget.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      ((e.clientY - r.top) / r.height) * 2 - 1,
    );
  };
  const onLeave = (): void => {
    parTarget.set(0, 0);
  };
  if (!coarse && !poster) {
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave);
  }

  // ── Simulation ─────────────────────────────────────────────────────
  let sim = 0;
  let arcIndex = 0;
  let flight = 0; // 0..1 along the current arc
  let vanOut = -1; // <0 parked; ≥0 seconds into the drive-off
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const step = (dt: number): void => {
    sim += dt;
    // Plane.
    flight += dt / FLIGHT_S;
    if (flight >= 1) {
      flight = 0;
      vanOut = 0;
      arcIndex = (arcIndex + 1) % curves.length;
    }
    const curve = curves[arcIndex] as THREE.QuadraticBezierCurve3;
    const p = direction === 'out' ? flight : 1 - flight;
    curve.getPoint(p, v1);
    curve.getPoint(Math.min(1, Math.max(0, p + (direction === 'out' ? 0.012 : -0.012))), v2);
    v1.y += 0.07;
    v2.y += 0.07;
    plane.position.copy(v1);
    plane.lookAt(v2);
    plane.rotateY(Math.PI); // the fuselage's nose is −z
    const fade = Math.min(1, flight * 12, (1 - flight) * 12);
    plane.scale.setScalar(0.3 + 0.7 * fade);
    // Van — parked beside the destination pin, drives off after touchdown.
    const dest = direction === 'out' ? world(DESTS[arcIndex] as string) : origin;
    const baseY = direction === 'out' ? LAND_H : BD_H;
    if (vanOut >= 0) {
      vanOut += dt;
      if (vanOut > 1.8) vanOut = -1;
    }
    const drive = vanOut < 0 ? 0 : smooth(vanOut / 1.6) * 0.42;
    van.position.set(dest.x + 0.09 + drive, baseY, dest.z + 0.06);
    van.rotation.y = -Math.PI / 2;
    van.scale.setScalar(vanOut < 0 || vanOut < 1.5 ? 1 : Math.max(0, 1 - (vanOut - 1.5) / 0.3));
    // Parcels.
    for (let i = 0; i < PARCELS; i++) {
      const d = drops[i] as Drop;
      if (d.wait > 0) {
        d.wait -= dt;
        m4.makeScale(0, 0, 0);
        parcels.setMatrixAt(i, m4);
        chutes.setMatrixAt(i, m4);
        continue;
      }
      d.t += dt * d.speed;
      if (d.t >= 1.15) respawn(d, i, false);
      const target = direction === 'out' ? world(DESTS[d.dest] as string) : origin;
      const landY = (direction === 'out' ? LAND_H : BD_H) + 0.028;
      const tt = Math.min(1, d.t);
      const y = landY + (1 - smooth(tt)) * 1.15;
      const sway = (1 - tt) * 0.06;
      const x = target.x + d.ox + Math.sin(sim * 1.7 + i) * sway;
      const z = target.z + d.oz + Math.cos(sim * 1.3 + i * 0.7) * sway;
      const settle = d.t > 1 ? Math.max(0, 1 - (d.t - 1) / 0.15) : 1;
      m4.makeTranslation(x, y, z);
      m4.scale(v1.setScalar(settle));
      parcels.setMatrixAt(i, m4);
      const open = Math.min(1, d.t * 4) * (d.t > 0.97 ? Math.max(0, 1 - (d.t - 0.97) / 0.06) : 1);
      q.setFromAxisAngle(up, sim * 0.4 + i);
      m4.compose(v2.set(x, y + 0.1, z), q, v1.setScalar(open * settle));
      chutes.setMatrixAt(i, m4);
    }
    parcels.instanceMatrix.needsUpdate = true;
    chutes.instanceMatrix.needsUpdate = true;
    // Camera parallax.
    par.lerp(parTarget, 0.06);
    camera.position.x += (camBase.x + par.x * 0.28 - camera.position.x) * 0.5;
    camera.lookAt(lookAt.x + par.x * 0.12, lookAt.y - par.y * 0.08, lookAt.z);
  };

  // ── Loop, governor, lifecycle ──────────────────────────────────────
  let running = false;
  let raf = 0;
  let last = 0;
  let ready = false;
  let active = false;
  let disposed = false;
  let frames = 0;
  let sampleStart = 0;
  let stage: 'warm' | 'sample1' | 'sample2' | 'done' = 'warm';

  const renderOnce = (): void => {
    if (disposed) return;
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      host.dataset.sceneReady = '1';
      const r = renderer.info.render;
      host.dataset.drawCalls = String(r.calls);
      host.dataset.triangles = String(r.triangles);
      opts.onReady?.({ calls: r.calls, triangles: r.triangles });
    }
  };

  const govern = (now: number): void => {
    frames++;
    if (stage === 'warm' && frames >= 30) {
      stage = 'sample1';
      frames = 0;
      sampleStart = now;
      return;
    }
    if ((stage === 'sample1' || stage === 'sample2') && frames >= 60) {
      const fps = 60000 / Math.max(1, now - sampleStart);
      if (stage === 'sample1') {
        if (fps < 40) {
          dpr = 1;
          renderer.setPixelRatio(1);
          stage = 'sample2';
          frames = 0;
          sampleStart = now;
        } else stage = 'done';
      } else {
        stage = 'done';
        if (fps < 24) {
          try {
            sessionStorage.setItem(HERO_3D_KEY, 'off');
          } catch {
            /* private mode */
          }
          opts.onFallback?.('fps');
        }
      }
    }
  };

  const loop = (now: number): void => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    step(dt);
    renderOnce();
    govern(now);
    raf = requestAnimationFrame(loop);
  };
  const start = (): void => {
    if (running || disposed || poster) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const reconcile = (): void => {
    if (active && !document.hidden) start();
    else stop();
  };
  const io = new IntersectionObserver(
    (entries) => {
      active = entries[0]?.isIntersecting ?? false;
      reconcile();
    },
    { threshold: 0.05 },
  );
  io.observe(host);
  document.addEventListener('visibilitychange', reconcile);

  if (poster) {
    // One deterministic frame: fixed sim time, plane mid-arc, chutes open.
    for (let i = 0; i < 60; i++) step(1 / 30);
    renderOnce();
  }

  return {
    setDirection(d) {
      if (d === direction) return;
      direction = d;
      tint(arcs.geometry);
      tint(glow.geometry);
      drops.forEach((dr, i) => {
        respawn(dr, i, false);
        dr.wait = (i % 5) * 0.3;
      });
      flight = 0;
      vanOut = -1;
      if (!running) {
        step(0);
        renderOnce();
      }
    },
    setActive(a) {
      active = a;
      reconcile();
    },
    stats() {
      const r = renderer.info.render;
      return { calls: r.calls, triangles: r.triangles };
    },
    dispose() {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      unsubTheme();
      document.removeEventListener('visibilitychange', reconcile);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
