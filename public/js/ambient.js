/* ==========================================================================
   ILoveNime — Ambient background (three.js)
   Partikel melayang pelan berwarna emas, di belakang seluruh UI.
   - DPR dibatasi & jumlah partikel dikurangi di layar kecil
   - prefers-reduced-motion: scene dirender statis sekali
   - Tab hidden: loop berhenti
   ========================================================================== */
import * as THREE from "three";

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canvas = document.getElementById("ambientCanvas");
if (!canvas || prefersReduced) {
  if (canvas) canvas.remove();
} else {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 14;

  const isSmall = window.innerWidth < 768;
  const COUNT = isSmall ? 140 : 320;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const sprite = makeSprite();
  const material = new THREE.PointsMaterial({
    size: isSmall ? 0.16 : 0.2,
    map: sprite,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: new THREE.Color("#FFD700"),
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = { start: performance.now() };
  let running = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { running = false; }
    else { clock.start = performance.now(); running = true; tick(); }
  });

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const t = (performance.now() - clock.start) / 1000;
    const attr = geometry.attributes.position;
    for (let i = 0; i < COUNT; i += 1) {
      const seed = seeds[i];
      attr.array[i * 3 + 1] += Math.sin(t * 0.35 + seed) * 0.0016 + 0.0022;
      attr.array[i * 3] += Math.cos(t * 0.22 + seed) * 0.0011;
      if (attr.array[i * 3 + 1] > 11) attr.array[i * 3 + 1] = -11;
    }
    attr.needsUpdate = true;
    points.rotation.y = Math.sin(t * 0.05) * 0.08;
    renderer.render(scene, camera);
  }

  function makeSprite() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,235,150,1)");
    grad.addColorStop(0.4, "rgba(255,200,60,.55)");
    grad.addColorStop(1, "rgba(255,180,20,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  tick();
}
