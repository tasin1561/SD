'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import * as THREE from 'three';

/**
 * SIZE SPIKE, take 2 — RAW three, no React Three Fiber. The R3F build
 * measured 230.6 KB gz for the lazy total (three 99.0 + 86.4, R3F and its
 * reconciler 45.2) against a 220 KB budget, so the reconciler goes and the
 * hero drives three directly from one rAF loop. Same geometry mix as the
 * real scene (Extrude, Tube, Instanced, Lambert, two lights).
 */
export default function SpikeScene(): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 2, 4);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight('#ffffff', '#222233', 0.8));
    const sun = new THREE.DirectionalLight('#ffffff', 0.9);
    sun.position.set(3, 5, 2);
    scene.add(sun);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1, 0);
    shape.lineTo(1, 1);
    shape.lineTo(0, 1);
    const box = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }),
      new THREE.MeshLambertMaterial({ color: '#2563eb' }),
    );
    scene.add(box);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(1, 0, 0),
        ),
        16,
        0.02,
        6,
        false,
      ),
      new THREE.MeshBasicMaterial({ color: '#f59e0b' }),
    );
    scene.add(tube);
    const pins = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
      new THREE.MeshLambertMaterial({ color: '#10b981' }),
      8,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) pins.setMatrixAt(i, m.makeTranslation(i * 0.3 - 1, 0, 1));
    scene.add(pins);
    let frame = 0;
    let last = performance.now();
    const loop = (t: number): void => {
      box.rotation.y += (t - last) * 0.0005;
      last = t;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      renderer.forceContextLoss();
      el.removeChild(renderer.domElement);
    };
  }, []);
  return <div ref={host} className="h-full w-full" />;
}
