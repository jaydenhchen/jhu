import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("view");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("start");
const searchEl = document.getElementById("search");
const resultsEl = document.getElementById("results");
const lookName = document.getElementById("look-name");
const lookNote = document.getElementById("look-note");
const destEl = document.getElementById("dest");
const routeBtn = document.getElementById("route-btn");
const clearBtn = document.getElementById("clear-btn");
const mini = document.getElementById("minimap");
const mctx = mini.getContext("2d");
const compassNeedle = document.querySelector("#compass span");

const MAJOR = new Set([
  "Gilman Hall",
  "Milton S. Eisenhower Library",
  "Brody Learning Commons",
  "Mason Hall",
  "Malone Hall",
  "Hackerman Hall",
  "Levering Hall",
  "Homewood Museum",
  "Bloomberg Student Center",
  "O'Connor Recreation Center",
  "Scott-Bates Commons",
  "Krieger Hall",
  "Ames Hall",
  "Shriver Hall",
  "Chemistry Building",
  "Wolman Hall",
  "AMR I",
  "AMR II",
  "Maryland Hall",
  "Hodson Hall",
  "Mudd Hall",
  "Garland Hall",
  "Imagine Center for Integrative Learning",
  "Glass Pavilion",
  "Jenkins–Mergenthaler Hall",
  "Remsen Hall",
  "Latrobe Hall",
]);

const data = await fetch("data/campus.json").then((r) => r.json());

const elevPts = data.elev.points;
const elevXs = [...new Set(elevPts.map((p) => p[0]))].sort((a, b) => a - b);
const elevZs = [...new Set(elevPts.map((p) => p[1]))].sort((a, b) => a - b);
const elevGrid = new Map(elevPts.map((p) => [`${p[0]},${p[1]}`, p[2]]));
function lerp(a, b, t) { return a + (b - a) * t; }
function hunt(arr, v) {
  let lo = 0, hi = arr.length - 2;
  if (v <= arr[0]) return 0;
  if (v >= arr[arr.length - 1]) return arr.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function heightAt(x, z) {
  if (elevXs.length < 2) return 70;
  const i = hunt(elevXs, x);
  const j = hunt(elevZs, z);
  const x0 = elevXs[i], x1 = elevXs[i + 1];
  const z0 = elevZs[j], z1 = elevZs[j + 1];
  const tx = (x - x0) / (x1 - x0 || 1);
  const tz = (z - z0) / (z1 - z0 || 1);
  const h00 = elevGrid.get(`${x0},${z0}`) ?? 70;
  const h10 = elevGrid.get(`${x1},${z0}`) ?? h00;
  const h01 = elevGrid.get(`${x0},${z1}`) ?? h00;
  const h11 = elevGrid.get(`${x1},${z1}`) ?? h10;
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

const minH = Math.min(...elevPts.map((p) => p[2]));
function groundY(x, z) {
  return heightAt(x, z) - minH;
}

function pip(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      zi = poly[i][1],
      xj = poly[j][0],
      zj = poly[j][1];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a) * 0.5;
}

function makeTex(draw, size = 512, repeat = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function rand(i, a, b) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return a + (x - Math.floor(x)) * (b - a);
}

function drawSash(g, s, cols, rows, glass) {
  g.fillStyle = "#efe8db";
  g.fillRect(0, 0, s, s);
  const m = Math.round(s * 0.08);
  g.fillStyle = glass;
  g.fillRect(m, m, s - 2 * m, s - 2 * m);
  g.fillStyle = "rgba(220,235,245,.12)";
  g.beginPath();
  g.moveTo(m, m);
  g.lineTo(s * 0.55, m);
  g.lineTo(m, s * 0.62);
  g.closePath();
  g.fill();
  g.strokeStyle = "#efe8db";
  g.lineWidth = Math.max(3, s * 0.028);
  const iw = s - 2 * m;
  const ih = s - 2 * m;
  for (let i = 0; i <= cols; i++) {
    const x = m + (i / cols) * iw;
    g.beginPath();
    g.moveTo(x, m);
    g.lineTo(x, s - m);
    g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = m + (j / rows) * ih;
    g.beginPath();
    g.moveTo(m, y);
    g.lineTo(s - m, y);
    g.stroke();
  }
  g.lineWidth = Math.max(6, s * 0.05);
  g.beginPath();
  g.moveTo(m, s / 2);
  g.lineTo(s - m, s / 2);
  g.stroke();
  g.strokeStyle = "#d9d0c2";
  g.lineWidth = Math.max(4, s * 0.035);
  g.strokeRect(m * 0.45, m * 0.45, s - m * 0.9, s - m * 0.9);
}

const tex = {
  brick: makeTex((g, s) => {
    // True Flemish bond, cream mortar, terracotta from Keyser / Maryland photos
    g.fillStyle = "#d7c4ae";
    g.fillRect(0, 0, s, s);
    const header = 14;
    const stretcher = 28;
    const ht = 12;
    const mort = 2;
    let n = 0;
    for (let y = 0, row = 0; y < s + ht; y += ht, row++) {
      let x = row & 1 ? -header : 0;
      let k = row & 1;
      while (x < s + stretcher) {
        const isHeader = k % 2 === 0;
        const w = isHeader ? header : stretcher;
        const shade = rand(n++, 0, 1);
        const r = 148 + shade * 40;
        const gg = 58 + shade * 22;
        const b = 42 + shade * 12;
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(x + mort, y + mort, w - mort, ht - mort);
        g.fillStyle = "rgba(255,230,210,.16)";
        g.fillRect(x + mort, y + mort, w - mort, 1.5);
        g.fillStyle = "rgba(40,10,8,.18)";
        g.fillRect(x + mort, y + ht - 1.5, w - mort, 1.2);
        x += w;
        k++;
      }
    }
  }, 1024),
  stucco: makeTex((g, s) => {
    g.fillStyle = "#f0e2b8";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4200; i++) {
      g.fillStyle = i % 3 ? "rgba(255,255,255,.1)" : "rgba(140,110,60,.08)";
      g.fillRect(rand(i, 0, s), rand(i + 9, 0, s), 2, 2);
    }
  }, 512),
  grass: makeTex((g, s) => {
    g.fillStyle = "#4d7a3c";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 280; i++) {
      g.fillStyle = i % 2 ? "rgba(62,110,48,.28)" : "rgba(90,140,70,.18)";
      g.beginPath();
      g.arc(rand(i, 0, s), rand(i + 5, 0, s), rand(i, 18, 55), 0, Math.PI * 2);
      g.fill();
    }
  }, 512),
  quad: makeTex((g, s) => {
    g.fillStyle = "#567e42";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = i % 2 ? "#628a4a" : "#4c7438";
      g.fillRect(rand(i, 0, s), rand(i + 11, 0, s), 3, 3);
    }
  }, 256),
  brickPath: makeTex((g, s) => {
    g.fillStyle = "#7a4a30";
    g.fillRect(0, 0, s, s);
    const t = 16;
    for (let y = -t; y < s + t; y += t) {
      for (let x = -t; x < s + t; x += t) {
        g.fillStyle = ((x + y) / t) & 1 ? "#c48a5c" : "#d4a06c";
        g.save();
        g.translate(x + t / 2, y + t / 2);
        g.rotate((((x + y) / t) & 1) * Math.PI * 0.5);
        g.fillRect(-t / 2 + 1, -5.5, t - 2, 10);
        g.strokeStyle = "#6a3d26";
        g.lineWidth = 1;
        g.strokeRect(-t / 2 + 1, -5.5, t - 2, 10);
        g.restore();
      }
    }
  }, 256),
  asphalt: makeTex((g, s) => {
    g.fillStyle = "#4a4a4e";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = "#55555b";
      g.fillRect(rand(i, 0, s), rand(i + 4, 0, s), 5, 2);
    }
  }, 256),
  concrete: makeTex((g, s) => {
    g.fillStyle = "#c9c3b6";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,255,255,.12)";
    for (let i = 0; i < 40; i++) g.fillRect(0, i * 7, s, 1);
  }, 256),
  turf: makeTex((g, s) => {
    g.fillStyle = "#3a8a36";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#4aa344";
    for (let y = 0; y < s; y += 18) g.fillRect(0, y, s, 2);
  }, 256),
  slate: makeTex((g, s) => {
    g.fillStyle = "#3f464c";
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 10) {
      for (let x = -20; x < s; x += 28) {
        g.fillStyle = rand(x + y, 0, 1) > 0.5 ? "#555c62" : "#353b41";
        g.fillRect(x + ((y / 10) & 1 ? 14 : 0), y + 1, 26, 8);
      }
    }
  }, 256),
  limestone: makeTex((g, s) => {
    g.fillStyle = "#ddd6c6";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = "rgba(255,255,255,.12)";
      g.fillRect(rand(i, 0, s), rand(i + 2, 0, s), 3, 2);
    }
  }, 256),
  sash: makeTex((g, s) => drawSash(g, s, 3, 4, "#1b3346"), 256, false),
  ribbon: makeTex((g, s) => drawSash(g, s, 4, 2, "#243848"), 256, false),
  plate: makeTex((g, s) => {
    g.fillStyle = "#d8d2c6";
    g.fillRect(0, 0, s, s);
    const m = 10;
    g.fillStyle = "#1a2c38";
    g.fillRect(m, m, s - 2 * m, s - 2 * m);
    g.fillStyle = "rgba(200,220,235,.16)";
    g.fillRect(m, m, (s - 2 * m) * 0.45, (s - 2 * m) * 0.55);
  }, 128, false),
};

function clockFaceTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#f7f1e4";
  g.beginPath();
  g.arc(256, 256, 248, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#1c1a16";
  g.lineWidth = 12;
  g.stroke();
  g.fillStyle = "#1c1a16";
  g.strokeStyle = "#1c1a16";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const inner = i % 5 === 0 ? 198 : 222;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * inner, 256 + Math.sin(a) * inner);
    g.lineTo(256 + Math.cos(a) * 238, 256 + Math.sin(a) * 238);
    g.lineWidth = i % 5 === 0 ? 6 : 2;
    g.stroke();
  }
  g.font = "700 42px Palatino, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const romans = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    g.fillText(romans[i], 256 + Math.cos(a) * 164, 256 + Math.sin(a) * 164);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#7eadd4");
scene.fog = new THREE.Fog("#b9cfe0", 320, 1100);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.12, 2000000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const t of Object.values(tex)) {
  if (t && t.isTexture) t.anisotropy = maxAniso;
}
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
}

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
document.getElementById("labels").appendChild(labelRenderer.domElement);

const sunPos = new THREE.Vector3();
{
  const phi = THREE.MathUtils.degToRad(90 - 48);
  const theta = THREE.MathUtils.degToRad(168);
  sunPos.setFromSphericalCoords(1, phi, theta);
}
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#4f96d0") },
      mid: { value: new THREE.Color("#9ec7e6") },
      bot: { value: new THREE.Color("#e4eef6") },
    },
    vertexShader: `varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `varying vec3 vW;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main() {
        float h = normalize(vW).y;
        vec3 col = mix(bot, mid, smoothstep(-0.05, 0.18, h));
        col = mix(col, top, smoothstep(0.18, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMat);
  scene.add(skyMesh);
}
{
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(14, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#fff3c8", fog: false, depthWrite: false })
  );
  sunGlow.position.copy(sunPos).multiplyScalar(820);
  scene.add(sunGlow);
}

scene.add(new THREE.HemisphereLight("#d7e7f5", "#4a6a38", 0.88));
const sun = new THREE.DirectionalLight("#fff1d2", 1.72);
sun.position.copy(sunPos).multiplyScalar(110);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 4;
sun.shadow.camera.far = 240;
sun.shadow.camera.left = sun.shadow.camera.bottom = -78;
sun.shadow.camera.right = sun.shadow.camera.top = 78;
sun.shadow.bias = -0.00012;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight("#cfe4ff", 0.38);
fill.position.set(90, 55, 10);
scene.add(fill);
scene.add(new THREE.AmbientLight("#9bb4c9", 0.18));

function shapeFrom(poly, holes = []) {
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i ? s.lineTo(p[0], -p[1]) : s.moveTo(p[0], -p[1])));
  s.closePath();
  for (const h of holes) {
    const pth = new THREE.Path();
    h.forEach((p, i) => (i ? pth.lineTo(p[0], -p[1]) : pth.moveTo(p[0], -p[1])));
    pth.closePath();
    s.holes.push(pth);
  }
  return s;
}

function extrudePoly(poly, holes, height) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(poly, holes), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function addMesh(geo, mat, y, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = shadow;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function unwrapWorldUVs(geo, y0 = 0, s = 0.34) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + y0;
    const z = pos.getZ(i);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    if (Math.abs(ny) > 0.65) {
      uvs[i * 2] = x * s;
      uvs[i * 2 + 1] = z * s;
    } else {
      uvs[i * 2] = (-nz * x + nx * z) * s;
      uvs[i * 2 + 1] = y * s;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geo;
}

function worldMapped(mat, scale = 0.28) {
  if (!mat.map) return mat;
  mat.userData.uvScale = scale;
  return mat;
}

{
  const span = 560;
  const n = 96;
  const geo = new THREE.PlaneGeometry(span * 2, span * 2, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundY(x, z));
  }
  geo.computeVertexNormals();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = (Math.sin(pos.getX(i) * 0.07) * Math.cos(pos.getZ(i) * 0.05) + 1) * 0.5;
    cols[i * 3] = 0.38 + n * 0.08;
    cols[i * 3 + 1] = 0.52 + n * 0.12;
    cols[i * 3 + 2] = 0.24 + n * 0.04;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 0.96, metalness: 0, vertexColors: true });
  mat.map.repeat.set(48, 48);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

const colliders = [];
const windowSlots = [];
const shutterSlots = [];
const lintelSlots = [];
const whiteTrim = new THREE.MeshStandardMaterial({ color: "#f4eee4", roughness: 0.4, metalness: 0.03 });
const marbleStep = new THREE.MeshStandardMaterial({ color: "#ece6d8", roughness: 0.38 });
const glassMat = new THREE.MeshStandardMaterial({
  color: "#1a2838",
  roughness: 0.12,
  metalness: 0.35,
  envMapIntensity: 0.8,
});
const shutterMat = new THREE.MeshStandardMaterial({ color: "#2f4c32", roughness: 0.72 });
const lintelMat = new THREE.MeshStandardMaterial({ color: "#e8e0d2", map: tex.limestone, roughness: 0.7 });
const clockTex = clockFaceTex();
const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.45 });
const handMat = new THREE.MeshStandardMaterial({ color: "#1a1814", roughness: 0.45, metalness: 0.1 });

function storyHeight(b) {
  if (b.special === "canopy") return 0.35;
  if (b.special === "library") return 7.4;
  const floors = b.levels ?? (b.special === "church" ? 4 : 3);
  const roof = (b.roofLevels || 0) * 1.8;
  return floors * 3.5 + roof * 0.35;
}

function footprintGround(poly) {
  let m = Infinity;
  for (const pt of poly) m = Math.min(m, groundY(pt[0], pt[1]));
  return Number.isFinite(m) ? m : 0;
}

function palette(b) {
  if (b.special === "homewood") return { map: tex.stucco, color: "#f6ebc8", rough: 0.86, metal: 0 };
  if (b.special === "glass") return { map: null, color: "#9db8c9", rough: 0.08, metal: 0.18, opacity: 0.55, trans: true };
  if (b.special === "studentcenter" || b.special === "modern")
    return { map: tex.limestone, color: "#e6dfd2", rough: 0.48, metal: 0.04 };
  if (b.special === "physics") return { map: tex.limestone, color: "#9aa6b0", rough: 0.38, metal: 0.1 };
  if (b.special === "garage") return { map: tex.concrete, color: "#d4cfc3", rough: 0.9, metal: 0 };
  if (b.special === "construction") return { map: null, color: "#d2a85a", rough: 0.9, metal: 0 };
  if (b.special === "industrial") return { map: tex.concrete, color: "#9aa08e", rough: 0.7, metal: 0.08 };
  if (b.special === "church") return { map: tex.limestone, color: "#e0d8c6", rough: 0.7, metal: 0 };
  if (b.material === "stone") return { map: tex.limestone, color: "#e4ddd0", rough: 0.82, metal: 0 };
  if (b.material === "glass") return { map: null, color: "#9db8c9", rough: 0.1, metal: 0.16, opacity: 0.65, trans: true };
  return { map: tex.brick, color: "#ffffff", rough: 0.78, metal: 0 };
}

function outwardNormal(a, b, poly) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  let nx = dz / len,
    nz = -dx / len;
  const mx = (a[0] + b[0]) / 2,
    mz = (a[1] + b[1]) / 2;
  if (pip(mx + nx * 0.6, mz + nz * 0.6, poly)) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz, len];
}

function eastFacadeCenter(b) {
  let sx = 0,
    sz = 0,
    w = 0;
  let nxS = 0,
    nzS = 0;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    const [nx, nz, len] = outwardNormal(a, c, b.poly);
    if (nx < 0.35 || len < 5) continue;
    const mx = (a[0] + c[0]) / 2,
      mz = (a[1] + c[1]) / 2;
    sx += mx * len;
    sz += mz * len;
    nxS += nx * len;
    nzS += nz * len;
    w += len;
  }
  if (w < 8) return longestEdgeFacing(b, "east");
  const nx = nxS / w,
    nz = nzS / w;
  const mag = Math.hypot(nx, nz) || 1;
  return { mx: sx / w, mz: sz / w, nx: nx / mag, nz: nz / mag, len: w };
}

function longestEdgeFacing(b, prefer) {
  let best = null,
    score = -1;
  const kx = data.spawn.x,
    kz = data.spawn.z;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    const [nx, nz, len] = outwardNormal(a, c, b.poly);
    if (len < 8) continue;
    const mx = (a[0] + c[0]) / 2,
      mz = (a[1] + c[1]) / 2;
    let s = len;
    if (prefer === "east") s = Math.max(0, nx) * (len + 20) + mx * 0.55;
    else if (prefer === "south") s = Math.max(0, nz) * (len + 20) + mz * 0.55;
    else {
      const vx = kx - mx,
        vz = kz - mz;
      const mag = Math.hypot(vx, vz) || 1;
      s *= 0.35 + 0.65 * Math.max(0, (nx * vx + nz * vz) / mag);
    }
    if (s > score) {
      score = s;
      best = { a, c, nx, nz, len, mx, mz };
    }
  }
  return best;
}

function addHippedRoof(b, yTop, color = "#4e555b") {
  const xs = b.poly.map((p) => p[0]);
  const zs = b.poly.map((p) => p[1]);
  const minx = Math.min(...xs),
    maxx = Math.max(...xs),
    minz = Math.min(...zs),
    maxz = Math.max(...zs);
  const w = maxx - minx,
    d = maxz - minz;
  if (w < 8 || d < 8 || w > 55 || d > 55) return;
  const peak = Math.min(4.4, 1.8 + Math.min(w, d) * 0.045);
  const hw = w * 0.44,
    hd = d * 0.44;
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, 0, peak, 0]);
  g.setIndex([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, map: tex.slate, roughness: 0.8, side: THREE.DoubleSide }));
  m.position.set((minx + maxx) / 2, yTop + 0.38, (minz + maxz) / 2);
  m.castShadow = true;
  scene.add(m);
  const brickM = new THREE.MeshStandardMaterial({ map: tex.brick, color: "#b85a45", roughness: 0.75 });
  for (const [sx, sz] of [
    [-hw * 0.45, hd * 0.2],
    [hw * 0.4, -hd * 0.18],
  ]) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.3, 0.85), brickM);
    ch.position.set((minx + maxx) / 2 + sx, yTop + 1.5, (minz + maxz) / 2 + sz);
    ch.castShadow = true;
    scene.add(ch);
  }
}

function addRoof(b, yTop) {
  if (b.special === "homewood") return;
  const floors = b.levels || 3;
  const flat =
    b.special === "library" ||
    b.special === "studentcenter" ||
    b.special === "modern" ||
    b.special === "glass" ||
    b.special === "garage" ||
    b.special === "physics" ||
    b.roofShape === "flat" ||
    floors >= 8;
  const geo = extrudePoly(b.poly, b.holes || [], 0.42);
  unwrapWorldUVs(geo, yTop, 0.22);
  addMesh(geo, new THREE.MeshStandardMaterial({ color: "#5a6168", map: tex.slate, roughness: 0.85 }), yTop, false);
  if (flat) return;
  addHippedRoof(b, yTop, b.special === "dorm" ? "#4a5056" : "#4e555b");
}

function addPortico(edge, baseY, opts = {}) {
  const cols = opts.cols || 4;
  const width = opts.width || 11.5;
  const colH = opts.colH || 7.8;
  const depth = opts.depth ?? 2.15;
  const { mx, mz, nx, nz } = edge;
  const px = -nz,
    pz = nx;
  const yaw = Math.atan2(nx, nz);
  const rCol = opts.rCol || 0.32;
  for (let i = 0; i < cols; i++) {
    const t = cols === 1 ? 0 : (i / (cols - 1) - 0.5) * width;
    const x = mx + px * t + nx * depth;
    const z = mz + pz * t + nz * depth;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(rCol, rCol + 0.06, colH, 16), whiteTrim);
    col.position.set(x, baseY + colH / 2, z);
    col.castShadow = true;
    scene.add(col);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(rCol * 2.6, 0.22, rCol * 2.6), whiteTrim);
    cap.position.set(x, baseY + colH + 0.1, z);
    scene.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(rCol * 2.5, 0.24, rCol * 2.5), whiteTrim);
    base.position.set(x, baseY + 0.12, z);
    scene.add(base);
  }
  const ent = new THREE.Mesh(new THREE.BoxGeometry(width + 2.6, 0.7, depth + 1.15), whiteTrim);
  ent.position.set(mx + nx * depth, baseY + colH + 0.48, mz + nz * depth);
  ent.rotation.y = yaw;
  ent.castShadow = true;
  scene.add(ent);
  const shape = new THREE.Shape();
  const hw = (width + 2.6) / 2;
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(0, Math.max(2.1, width * 0.18));
  shape.closePath();
  const pedGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.62, bevelEnabled: false });
  pedGeo.translate(0, 0, -0.31);
  const ped = new THREE.Mesh(pedGeo, whiteTrim);
  ped.position.set(mx + nx * depth, baseY + colH + 0.84, mz + nz * depth);
  ped.rotation.y = yaw;
  ped.castShadow = true;
  scene.add(ped);
  if (opts.door) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.35, 2.7, 0.12), new THREE.MeshStandardMaterial({ color: "#5c3a22", roughness: 0.7 }));
    door.position.set(mx + nx * 0.2, baseY + 1.45, mz + nz * 0.2);
    door.rotation.y = yaw;
    scene.add(door);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.68, 16, 0, Math.PI), whiteTrim);
    fan.position.set(mx + nx * 0.22, baseY + 2.85, mz + nz * 0.22);
    fan.rotation.y = yaw;
    scene.add(fan);
  }
  for (let s = 0; s < 8; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(width + 3.0 - s * 0.1, 0.14, 0.42), marbleStep);
    step.position.set(mx + nx * (0.25 + s * 0.36), baseY + 0.07 + s * 0.14, mz + nz * (0.25 + s * 0.36));
    step.rotation.y = yaw;
    step.castShadow = true;
    scene.add(step);
  }
}

function addGilmanTower(b, baseY, buildingH, edge) {
  edge = edge || eastFacadeCenter(b) || { mx: b.cx, mz: b.cz, nx: 1, nz: 0 };
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ map: tex.brick, color: "#ffffff", roughness: 0.74 });
  brick.map.repeat.set(2.2, 5.5);
  const white = whiteTrim;
  const gold = new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.7, roughness: 0.32 });
  const roofY = buildingH;
  const shaftH = 9.4;
  const clockH = 6.8;
  const lanternH = 5.2;
  const w = 7.1;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, shaftH, w), brick);
  shaft.position.y = roofY + shaftH / 2;
  shaft.castShadow = true;
  g.add(shaft);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.5, w + 0.7), white);
  belt.position.y = roofY + shaftH;
  g.add(belt);
  const stage = new THREE.Mesh(new THREE.BoxGeometry(w + 0.85, clockH, w + 0.85), brick);
  stage.position.y = roofY + shaftH + clockH / 2;
  stage.castShadow = true;
  g.add(stage);
  const clockY = roofY + shaftH + clockH * 0.52;
  const r = w * 0.52;
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.85, 36), clockMat);
    face.position.set(Math.sin(ang) * r, clockY, Math.cos(ang) * r);
    face.rotation.y = ang;
    g.add(face);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.85, 2.05, 32), white);
    ring.position.copy(face.position);
    ring.rotation.copy(face.rotation);
    g.add(ring);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 1.15, 0.38, w + 1.15), white);
  rail.position.y = roofY + shaftH + clockH;
  g.add(rail);
  const lanternY = roofY + shaftH + clockH + 0.2;
  const lan = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.35, lanternH, 8), white);
  lan.position.y = lanternY + lanternH / 2;
  lan.castShadow = true;
  g.add(lan);
  const dark = new THREE.MeshStandardMaterial({ color: "#1c242c", roughness: 0.32, metalness: 0.15 });
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (Math.PI / 4);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.05, 3.1, 0.1), dark);
    pane.position.set(Math.sin(a) * 2.18, lanternY + lanternH * 0.5, Math.cos(a) * 2.18);
    pane.rotation.y = a;
    g.add(pane);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, lanternH * 0.92, 8), white);
    col.position.set(Math.sin(a - 0.2) * 2.32, lanternY + lanternH * 0.48, Math.cos(a - 0.2) * 2.32);
    g.add(col);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), white);
  dome.position.y = lanternY + lanternH + 0.02;
  g.add(dome);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 8), gold);
  fin.position.y = lanternY + lanternH + 2.05;
  g.add(fin);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.18), gold);
  vane.position.y = lanternY + lanternH + 2.55;
  g.add(vane);
  g.position.set(edge.mx - edge.nx * 3.1, baseY, edge.mz - edge.nz * 3.1);
  g.rotation.y = Math.atan2(edge.nx, edge.nz);
  g.userData.clockY = clockY;
  g.userData.clockR = r + 0.02;
  scene.add(g);
  return g;
}

function addClockHands(towerGroup) {
  const hands = [];
  const cy = towerGroup.userData.clockY;
  const cr = towerGroup.userData.clockR;
  for (let i = 0; i < 4; i++) {
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.08, 0.07), handMat);
    const min = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.48, 0.06), handMat);
    hour.position.set(0, 0.42, 0);
    min.position.set(0, 0.62, 0);
    const pivot = new THREE.Group();
    const hp = new THREE.Group();
    const mp = new THREE.Group();
    hp.add(hour);
    mp.add(min);
    pivot.add(hp, mp);
    const ang = (i * Math.PI) / 2;
    pivot.position.set(Math.sin(ang) * cr, cy, Math.cos(ang) * cr);
    pivot.rotation.y = ang;
    towerGroup.add(pivot);
    hands.push({ hp, mp });
  }
  return hands;
}

function windowSpec(b) {
  const lv = b.levels || 3;
  if (b.special === "library")
    return { floors: 2, spacing: 2.45, winH: 2.4, winW: 1.85, minLen: 3.6, kind: "ribbon", shutters: false };
  if (b.special === "homewood")
    return { floors: 2, spacing: 2.55, winH: 1.85, winW: 1.02, minLen: 4, kind: "sash", shutters: true };
  if (lv >= 8)
    return { floors: Math.round(lv), spacing: 3.15, winH: 1.5, winW: 1.15, minLen: 5, kind: "plate", shutters: false };
  if (["studentcenter", "modern", "physics", "malone"].includes(b.special))
    return { floors: Math.max(3, Math.round(lv)), spacing: 3.3, winH: 1.75, winW: 1.45, minLen: 4.5, kind: "plate", shutters: false };
  if (!["georgian", "gilman", "dorm", "church"].includes(b.special)) return null;
  return {
    floors: Math.max(2, Math.round(lv)),
    spacing: 3.05,
    winH: 1.82,
    winW: 1.08,
    minLen: 4.2,
    kind: "sash",
    shutters: false,
  };
}

function queueWindows(b, gy, h) {
  const spec = windowSpec(b);
  if (!spec) return;
  const story = h / spec.floors;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    const [nx, nz, len] = outwardNormal(a, c, b.poly);
    if (len < spec.minLen) continue;
    const count = Math.min(22, Math.max(1, Math.floor((len - 2.2) / spec.spacing)));
    const yaw = Math.atan2(nx, nz);
    const alongX = -nz;
    const alongZ = nx;
    for (let f = 0; f < spec.floors; f++) {
      const y = gy + 1.05 + f * story + Math.max(0, (story - spec.winH) * 0.18);
      if (y + spec.winH * 0.5 > gy + h - 0.22) continue;
      for (let k = 0; k < count; k++) {
        const u = (k + 1) / (count + 1);
        const x = a[0] + (c[0] - a[0]) * u + nx * 0.08;
        const z = a[1] + (c[1] - a[1]) * u + nz * 0.08;
        windowSlots.push({
          x,
          y,
          z,
          yaw,
          w: spec.winW,
          h: spec.winH,
          nx,
          nz,
          kind: spec.kind,
        });
        if (spec.shutters) {
          shutterSlots.push({ x: x + alongX * 0.72, y, z: z + alongZ * 0.72, yaw, h: spec.winH });
          shutterSlots.push({ x: x - alongX * 0.72, y, z: z - alongZ * 0.72, yaw, h: spec.winH });
        }
      }
    }
  }
}

function addHomewoodHouse(b, gy, h) {
  let edge = null;
  let best = -1e9;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    const [nx, nz, len] = outwardNormal(a, c, b.poly);
    if (len < 7) continue;
    const mz = (a[1] + c[1]) / 2;
    const s = mz + nz * 10 + len * 0.15;
    if (s > best) {
      best = s;
      edge = { a, c, nx, nz, len, mx: (a[0] + c[0]) / 2, mz };
    }
  }
  if (edge) addPortico(edge, gy, { cols: 4, width: 8.6, colH: 5.4, depth: 1.85, rCol: 0.28, door: true });
  addMesh(extrudePoly(b.poly, b.holes || [], 0.55), new THREE.MeshStandardMaterial({ color: "#5e675f", map: tex.slate, roughness: 0.82 }), gy + h, false);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(3.15, 2.35, 3.15), whiteTrim);
  cube.position.set(b.cx, gy + h + 1.45, b.cz);
  cube.castShadow = true;
  scene.add(cube);
  const dark = new THREE.MeshStandardMaterial({ color: "#243038", roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.4, 0.08), dark);
    pane.position.set(b.cx + Math.sin(a) * 1.6, gy + h + 1.55, b.cz + Math.cos(a) * 1.6);
    pane.rotation.y = a;
    scene.add(pane);
  }
  const py = new THREE.Mesh(new THREE.ConeGeometry(2.35, 1.55, 4), whiteTrim);
  py.position.set(b.cx, gy + h + 3.5, b.cz);
  py.rotation.y = Math.PI / 4;
  py.castShadow = true;
  scene.add(py);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), whiteTrim);
  ball.position.set(b.cx, gy + h + 4.35, b.cz);
  scene.add(ball);
}

let clockHands = [];

const PORTICO_FACE = {
  "Gilman Hall": "east",
  "Maryland Hall": "campus",
  "Hodson Hall": "campus",
};

for (const b of data.buildings) {
  try {
    const h = Math.max(storyHeight(b), 1.2);
    const gy = footprintGround(b.poly);
    if (b.special === "canopy") {
      const geo = extrudePoly(b.poly, b.holes || [], 0.4);
      addMesh(geo, new THREE.MeshStandardMaterial({ color: "#d8c7a2", roughness: 0.7 }), gy + 4.2, false);
      continue;
    }
    const pal = palette(b);
    const mat = new THREE.MeshStandardMaterial({
      map: pal.map || null,
      color: pal.color,
      roughness: pal.rough,
      metalness: pal.metal,
      transparent: !!pal.trans,
      opacity: pal.opacity ?? 1,
    });
    if (pal.map) mat.map = pal.map;
    const geo = extrudePoly(b.poly, b.holes || [], h);
    unwrapWorldUVs(geo, gy, b.special === "homewood" ? 0.16 : 0.17);
    const mesh = addMesh(geo, mat, gy);
    mesh.userData.building = b;
    if (b.special !== "construction") addRoof(b, gy + h);
    if (["georgian", "gilman", "dorm", "homewood", "library"].includes(b.special)) {
      addMesh(extrudePoly(b.poly, b.holes || [], 0.32), whiteTrim, gy + h, false);
      addMesh(extrudePoly(b.poly, b.holes || [], 0.48), whiteTrim, gy, false);
    }
    queueWindows(b, gy, h);
    if (b.special === "homewood") addHomewoodHouse(b, gy, h);
    if (b.special === "malone") {
      const glass = new THREE.MeshStandardMaterial({
        color: "#8fb4c8",
        roughness: 0.1,
        metalness: 0.22,
        transparent: true,
        opacity: 0.62,
      });
      const zs = b.poly.map((p) => p[1]);
      const south = Math.max(...zs);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(18, h * 0.9, 0.35), glass);
      pane.position.set(b.cx, gy + h * 0.5, south + 0.25);
      scene.add(pane);
    }
    if (b.special === "gilman") {
      const edge = eastFacadeCenter(b);
      if (edge) {
        addPortico(edge, gy, { cols: 4, width: 11.2, colH: 9.0, depth: 2.45, rCol: 0.36 });
        const tower = addGilmanTower(b, gy, h, edge);
        clockHands = addClockHands(tower);
      }
    } else if (PORTICO_FACE[b.name]) {
      const edge = longestEdgeFacing(b, PORTICO_FACE[b.name]);
      if (edge) addPortico(edge, gy, { cols: 4, width: 10.2, colH: 7.2, depth: 1.9, rCol: 0.3 });
    }
    if (b.special !== "canopy") colliders.push(b);
    if (b.name && MAJOR.has(b.name)) {
      const div = document.createElement("div");
      div.className = "label3d";
      div.textContent = b.name.replace("Stavros Niarchos Foundation - Agora Institute", "SNF Agora");
      const lab = new CSS2DObject(div);
      lab.position.set(b.cx, gy + h + 3.2, b.cz);
      scene.add(lab);
    }
  } catch (err) {
    console.warn("building failed", b.name || b.id, err);
  }
}

{
  const dummy = new THREE.Object3D();
  const kinds = {
    sash: tex.sash,
    ribbon: tex.ribbon,
    plate: tex.plate,
  };
  for (const [kind, map] of Object.entries(kinds)) {
    const slots = windowSlots.filter((w) => (w.kind || "sash") === kind);
    if (!slots.length) continue;
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: kind === "plate" ? 0.18 : 0.32,
      metalness: 0.08,
      envMapIntensity: 1.15,
    });
    const panes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, slots.length);
    const lintels = kind === "sash" ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.16), lintelMat, slots.length) : null;
    slots.forEach((w, i) => {
      dummy.position.set(w.x + (w.nx || 0) * 0.03, w.y, w.z + (w.nz || 0) * 0.03);
      dummy.rotation.set(0, w.yaw, 0);
      dummy.scale.set(w.w, w.h, 1);
      dummy.updateMatrix();
      panes.setMatrixAt(i, dummy.matrix);
      if (lintels) {
        dummy.position.set(w.x + (w.nx || 0) * 0.05, w.y + w.h * 0.55, w.z + (w.nz || 0) * 0.05);
        dummy.scale.set(w.w + 0.28, 1, 1);
        dummy.updateMatrix();
        lintels.setMatrixAt(i, dummy.matrix);
      }
    });
    scene.add(panes);
    if (lintels) scene.add(lintels);
  }
  if (shutterSlots.length) {
    const sh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 1, 0.07), shutterMat, shutterSlots.length);
    shutterSlots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.set(1, s.h * 0.96, 1);
      dummy.updateMatrix();
      sh.setMatrixAt(i, dummy.matrix);
    });
    scene.add(sh);
  }
}

function areaMesh(poly, yLift, mat, depth = 0.08) {
  if (poly.length < 3 || polyArea(poly) < 18) return;
  const c = centroidXZ(poly);
  const positions = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    positions.push(c[0], groundY(c[0], c[1]) + yLift, c[1]);
    positions.push(a[0], groundY(a[0], a[1]) + yLift, a[1]);
    positions.push(b[0], groundY(b[0], b[1]) + yLift, b[1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
}

function centroidXZ(poly) {
  let x = 0,
    z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

const quadMat = new THREE.MeshStandardMaterial({ map: tex.quad, color: "#6aa04c", roughness: 1 });
quadMat.map.repeat.set(10, 10);
const gardenMat = new THREE.MeshStandardMaterial({ color: "#5e8f45", roughness: 1 });
const woodMat = new THREE.MeshStandardMaterial({ color: "#3a6234", roughness: 1 });
const waterMat = new THREE.MeshStandardMaterial({ color: "#4d88aa", roughness: 0.12, metalness: 0.25 });
const pitchMat = new THREE.MeshStandardMaterial({ map: tex.turf, roughness: 0.95 });
pitchMat.map.repeat.set(6, 6);
const bleachMat = new THREE.MeshStandardMaterial({ color: "#cfc7bb", roughness: 0.8 });
const constructMat = new THREE.MeshStandardMaterial({ color: "#cda45a", roughness: 0.9 });

for (const a of data.areas) {
  if (!a.poly) continue;
  if (a.kind === "quad") areaMesh(a.poly, 0.06, quadMat, 0.1);
  else if (a.kind === "pitch") areaMesh(a.poly, 0.05, pitchMat, 0.12);
  else if (a.kind === "bleachers") {
    const c = centroidXZ(a.poly);
    const geo = extrudePoly(a.poly, [], 7.5);
    addMesh(geo, bleachMat, groundY(c[0], c[1]));
  } else if (a.kind === "garden") areaMesh(a.poly, 0.05, gardenMat, 0.08);
  else if (a.kind === "wood") areaMesh(a.poly, 0.04, woodMat, 0.08);
  else if (a.kind === "water") areaMesh(a.poly, 0.02, waterMat, 0.06);
  else if (a.kind === "construction") areaMesh(a.poly, 0.07, constructMat, 0.2);
  else if (a.kind === "green" && a.name) areaMesh(a.poly, 0.04, gardenMat, 0.07);
  if (a.kind === "quad" && a.name) {
    const div = document.createElement("div");
    div.className = "label3d";
    div.textContent = a.name;
    const lab = new CSS2DObject(div);
    lab.position.set(a.cx, groundY(a.cx, a.cz) + 1.4, a.cz);
    scene.add(lab);
  }
}

function ribbonGeo(pts, width) {
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0],
      dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz * width * 0.5;
    const pz = dx * width * 0.5;
    const y = groundY(pts[i][0], pts[i][1]) + 0.13;
    left.push(pts[i][0] + px, y, pts[i][1] + pz);
    right.push(pts[i][0] - px, y, pts[i][1] - pz);
  }
  const positions = [];
  const uvs = [];
  const index = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const u = dist / Math.max(width, 1);
    positions.push(left[i * 3], left[i * 3 + 1], left[i * 3 + 2]);
    positions.push(right[i * 3], right[i * 3 + 1], right[i * 3 + 2]);
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2,
      b = a + 1,
      c = a + 2,
      d = a + 3;
    index.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const pathBuckets = { brick: [], asphalt: [], concrete: [], steps: [] };
for (const p of data.paths) {
  if (!p.pts || p.pts.length < 2) continue;
  const w =
    p.kind === "road"
      ? p.highway === "primary"
        ? 8.5
        : p.highway === "service"
          ? 3.6
          : 6.2
      : p.kind === "steps"
        ? 2.1
        : p.surface === "paving_stones" || p.surface === "sett"
          ? 2.6
          : 2.15;
  let bucket = "concrete";
  if (p.kind === "road" || p.surface === "asphalt") bucket = "asphalt";
  else if (p.surface === "paving_stones" || p.surface === "sett" || p.surface === "brick") bucket = "brick";
  else if (p.kind === "steps") bucket = "steps";
  else if (p.kind === "foot") bucket = "brick";
  try {
    const g = ribbonGeo(p.pts, w);
    if (g.index && g.index.count) pathBuckets[bucket].push(g);
  } catch {
    /* skip degenerate */
  }
}
const pathMats = {
  brick: new THREE.MeshStandardMaterial({ map: tex.brickPath, roughness: 0.92 }),
  asphalt: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.95 }),
  concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.92, color: "#d2cec4" }),
  steps: new THREE.MeshStandardMaterial({ color: "#d8d0c4", roughness: 0.7 }),
};
for (const [k, geos] of Object.entries(pathBuckets)) {
  if (!geos.length) continue;
  const merged = mergeGeometries(geos, false);
  if (!merged) continue;
  const mesh = new THREE.Mesh(merged, pathMats[k]);
  mesh.receiveShadow = true;
  scene.add(mesh);
  geos.forEach((g) => g.dispose());
}

{
  const trunkM = new THREE.MeshStandardMaterial({ color: "#4a301c", roughness: 0.92 });
  const leafA = new THREE.MeshStandardMaterial({ color: "#3a7a32", roughness: 0.9 });
  const leafB = new THREE.MeshStandardMaterial({ color: "#4e8c3c", roughness: 0.9 });
  const leafC = new THREE.MeshStandardMaterial({ color: "#2f6a2c", roughness: 0.9 });
  const trunk = new THREE.CylinderGeometry(0.18, 0.42, 1, 8);
  const canopy = new THREE.SphereGeometry(1, 10, 8);
  const dummy = new THREE.Object3D();
  const n = data.trees.length;
  const trunks = new THREE.InstancedMesh(trunk, trunkM, n);
  const leaves = new THREE.InstancedMesh(canopy, leafA, n);
  const leaves2 = new THREE.InstancedMesh(canopy, leafB, n);
  const leaves3 = new THREE.InstancedMesh(canopy, leafC, n);
  trunks.castShadow = leaves.castShadow = leaves2.castShadow = leaves3.castShadow = true;
  leaves.receiveShadow = leaves2.receiveShadow = leaves3.receiveShadow = true;
  data.trees.forEach((t, i) => {
    const y = groundY(t[0], t[1]);
    const ht = 7.2 + (i % 9) * 0.55;
    dummy.position.set(t[0], y + ht / 2, t[1]);
    dummy.scale.set(1.15, ht, 1.15);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const s = 3.4 + (i % 6) * 0.28;
    dummy.position.set(t[0], y + ht + s * 0.35, t[1]);
    dummy.scale.set(s * 1.15, s * 0.85, s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t[0] + s * 0.28, y + ht + s * 0.12, t[1] - s * 0.18);
    dummy.scale.set(s * 0.8, s * 0.7, s * 0.85);
    dummy.updateMatrix();
    leaves2.setMatrixAt(i, dummy.matrix);
    dummy.position.set(t[0] - s * 0.22, y + ht + s * 0.08, t[1] + s * 0.2);
    dummy.scale.set(s * 0.72, s * 0.62, s * 0.75);
    dummy.updateMatrix();
    leaves3.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunks, leaves, leaves2, leaves3);
}

{
  const poleM = new THREE.MeshStandardMaterial({ color: "#1f1e1c", metalness: 0.45, roughness: 0.4 });
  const glowM = new THREE.MeshStandardMaterial({ color: "#ffe7b0", emissive: "#ffd089", emissiveIntensity: 0.9 });
  const cageM = new THREE.MeshStandardMaterial({ color: "#2a2926", metalness: 0.3, roughness: 0.5 });
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8);
  const cage = new THREE.BoxGeometry(0.28, 0.4, 0.28);
  const bulb = new THREE.BoxGeometry(0.18, 0.28, 0.18);
  const dummy = new THREE.Object3D();
  const poles = new THREE.InstancedMesh(pole, poleM, data.lamps.length);
  const cages = new THREE.InstancedMesh(cage, cageM, data.lamps.length);
  const bulbs = new THREE.InstancedMesh(bulb, glowM, data.lamps.length);
  data.lamps.forEach((t, i) => {
    const y = groundY(t[0], t[1]);
    dummy.position.set(t[0], y + 1.8, t[1]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 3.75;
    dummy.updateMatrix();
    cages.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 3.75;
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles, cages, bulbs);
}

// Artwork pedestals at OSM nodes
for (const a of data.art) {
  const y = groundY(a.x, a.z);
  const stone = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.7, 0.9),
    new THREE.MeshStandardMaterial({ color: "#d9d1c3" })
  );
  stone.position.set(a.x, y + 0.35, a.z);
  const hue = Math.abs(hash(a.name)) % 360;
  const blob = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.45, 0.55) })
  );
  blob.position.set(a.x, y + 1.05, a.z);
  blob.userData.art = a;
  scene.add(stone, blob);
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// Blue jays — atmospheric, not geography
const birds = [];
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.45, 5),
    new THREE.MeshStandardMaterial({ color: "#2f5ea8" })
  );
  body.rotation.z = Math.PI / 2;
  g.add(body);
  g.userData = { t: i * 1.7, r: 18 + i * 6, y: 14 + i };
  scene.add(g);
  birds.push(g);
}

const STREET_LABELS = new Set([
  "North Charles Street",
  "West University Parkway",
  "East University Parkway",
  "East 33rd Street",
  "West 33rd Street",
  "Wyman Park Drive",
  "Art Museum Drive",
  "San Martin Drive",
]);
for (const s of data.streets || []) {
  if (!STREET_LABELS.has(s.name)) continue;
  const div = document.createElement("div");
  div.className = "label3d";
  div.textContent = s.name.replace("North ", "").replace("West ", "").replace("East ", "");
  const lab = new CSS2DObject(div);
  lab.position.set(s.x, groundY(s.x, s.z) + 2.4, s.z);
  scene.add(lab);
}

const directory = [];
for (const b of data.buildings) {
  if (!b.name) continue;
  directory.push({
    name: b.name,
    aliases: b.aliases || [],
    note: b.note || b.addr || "",
    x: b.cx,
    z: b.cz,
    kind: "building",
  });
}
for (const a of data.areas) {
  if (!a.name) continue;
  if (!["quad", "pitch"].includes(a.kind) && a.name !== "Homewood Field") continue;
  directory.push({ name: a.name, aliases: [], note: a.kind, x: a.cx, z: a.cz, kind: "place" });
}
for (const p of data.pois) directory.push({ name: p.name, aliases: [], note: p.kind, x: p.x, z: p.z, kind: "poi" });
const bsc = directory.find((d) => d.name === "Bloomberg Student Center");
if (bsc) {
  directory.push({
    name: "Whitehead Hall",
    aliases: ["Mattin Center", "Mattin"],
    note: "Demolished 2021. The Bloomberg Student Center stands on this site.",
    x: bsc.x,
    z: bsc.z,
    kind: "relocated",
  });
}
for (const a of data.areas || []) {
  if (a.aliases) {
    const hit = directory.find((d) => d.name === a.name);
    if (hit) hit.aliases = a.aliases;
  }
}

function matches(q, item) {
  const n = (item.name + " " + item.aliases.join(" ")).toLowerCase();
  return n.includes(q);
}

let selected = null;
searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  resultsEl.innerHTML = "";
  if (!q) {
    resultsEl.hidden = true;
    return;
  }
  const hits = directory.filter((d) => matches(q, d)).slice(0, 12);
  resultsEl.hidden = !hits.length;
  hits.forEach((h, i) => {
    const li = document.createElement("li");
    li.textContent = h.aliases.length ? `${h.name}  (${h.aliases[0]})` : h.name;
    if (i === 0) li.classList.add("active");
    li.onclick = () => pick(h);
    resultsEl.appendChild(li);
  });
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = resultsEl.querySelector("li");
    if (first) first.click();
  }
});

const navGraph = buildGraph(data.paths);
let routeLine = null;
let routePts = [];

function buildGraph(paths) {
  const nodes = [];
  const cell = new Map();
  const key = (x, z) => `${Math.round(x / 6)}:${Math.round(z / 6)}`;
  function addNode(x, z) {
    const id = nodes.length;
    nodes.push({ x, z, e: [] });
    const k = key(x, z);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(id);
    return id;
  }
  function link(a, b) {
    if (a === b) return;
    const w = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
    nodes[a].e.push({ t: b, w });
    nodes[b].e.push({ t: a, w });
  }
  for (const p of paths) {
    if (p.kind === "road" && p.highway === "primary") continue;
    const pts = p.pts;
    if (!pts || pts.length < 2) continue;
    let last = -1;
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (i === 0 || i === pts.length - 1 || acc >= 8) {
        const id = addNode(pts[i][0], pts[i][1]);
        if (last >= 0) link(last, id);
        last = id;
        acc = 0;
      }
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const list = cell.get(`${Math.round(n.x / 6) + gx}:${Math.round(n.z / 6) + gz}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const d = Math.hypot(n.x - nodes[j].x, n.z - nodes[j].z);
          if (d > 0.4 && d < 5.2) link(i, j);
        }
      }
    }
  }
  return nodes;
}

function nearestNode(x, z) {
  let best = 0,
    bd = 1e9;
  for (let i = 0; i < navGraph.length; i++) {
    const d = Math.hypot(navGraph[i].x - x, navGraph[i].z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function astar(a, b) {
  const open = new Set([a]);
  const came = new Map();
  const g = new Float64Array(navGraph.length).fill(Infinity);
  const f = new Float64Array(navGraph.length).fill(Infinity);
  g[a] = 0;
  f[a] = Math.hypot(navGraph[a].x - navGraph[b].x, navGraph[a].z - navGraph[b].z);
  while (open.size) {
    let cur = -1,
      bf = Infinity;
    for (const id of open) {
      if (f[id] < bf) {
        bf = f[id];
        cur = id;
      }
    }
    if (cur === b) break;
    open.delete(cur);
    for (const ed of navGraph[cur].e) {
      const ng = g[cur] + ed.w;
      if (ng < g[ed.t]) {
        came.set(ed.t, cur);
        g[ed.t] = ng;
        f[ed.t] = ng + Math.hypot(navGraph[ed.t].x - navGraph[b].x, navGraph[ed.t].z - navGraph[b].z);
        open.add(ed.t);
      }
    }
  }
  if (!came.has(b) && a !== b) return [];
  const path = [b];
  let c = b;
  while (c !== a) {
    c = came.get(c);
    if (c == null) return [];
    path.push(c);
  }
  path.reverse();
  return path.map((i) => navGraph[i]);
}

function drawRoute(pts) {
  if (routeLine) {
    scene.remove(routeLine);
    routeLine.geometry.dispose();
    routeLine = null;
  }
  routePts = pts;
  if (pts.length < 2) return;
  const v = pts.map((p) => new THREE.Vector3(p.x, groundY(p.x, p.z) + 0.22, p.z));
  const curve = new THREE.CatmullRomCurve3(v);
  const geo = new THREE.TubeGeometry(curve, Math.max(12, pts.length * 3), 0.32, 6, false);
  routeLine = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc9a227 }));
  scene.add(routeLine);
}

function pick(item) {
  selected = item;
  resultsEl.hidden = true;
  searchEl.value = item.name;
  destEl.textContent = `Route to ${item.name}`;
  routeBtn.disabled = false;
  const start = nearestNode(camera.position.x, camera.position.z);
  const end = nearestNode(item.x, item.z);
  const path = astar(start, end);
  if (path.length) drawRoute(path);
  else drawRoute([
    { x: camera.position.x, z: camera.position.z },
    { x: item.x, z: item.z },
  ]);
  lookName.textContent = item.name;
  lookNote.textContent = item.note || "";
}

routeBtn.onclick = () => {
  if (selected) pick(selected);
};
clearBtn.onclick = () => {
  selected = null;
  drawRoute([]);
  destEl.textContent = "";
  routeBtn.disabled = true;
};

const controls = new PointerLockControls(camera, document.body);
startBtn.onclick = () => controls.lock();
canvas.onclick = () => controls.lock();
controls.addEventListener("lock", () => {
  overlay.style.display = "none";
});
controls.addEventListener("unlock", () => {
  overlay.style.display = "grid";
});

const spawn = data.spawn;
camera.position.set(spawn.x, groundY(spawn.x, spawn.z) + 1.65, spawn.z);
camera.lookAt(spawn.lookX, groundY(spawn.lookX, spawn.lookZ) + 8, spawn.lookZ);

const EYE = 1.65;
const WALK_SPEED = 5.1;
const SPRINT_SPEED = 9.2;
const JUMP_SPEED = 6.4;
const GRAVITY = 22;
let vy = 0;
let grounded = true;

const keys = Object.create(null);
addEventListener("keydown", (e) => {
  if (e.target === searchEl) return;
  keys[e.code] = true;
  if (e.code === "KeyF" && selected) pick(selected);
  if (e.code === "Space" && controls.isLocked) e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (e.target === searchEl) return;
  keys[e.code] = false;
});

const colliderIndex = new Map();
function ckey(x, z) {
  return `${Math.floor(x / 20)}:${Math.floor(z / 20)}`;
}
for (const b of colliders) {
  const xs = b.poly.map((p) => p[0]);
  const zs = b.poly.map((p) => p[1]);
  const minx = Math.min(...xs) - 4,
    maxx = Math.max(...xs) + 4,
    minz = Math.min(...zs) - 4,
    maxz = Math.max(...zs) + 4;
  b._bb = [minx, maxx, minz, maxz];
  for (let x = minx; x <= maxx; x += 20) {
    for (let z = minz; z <= maxz; z += 20) {
      const k = ckey(x, z);
      if (!colliderIndex.has(k)) colliderIndex.set(k, []);
      colliderIndex.get(k).push(b);
    }
  }
}

function resolveCollision(x, z, radius = 0.55) {
  const nearby = colliderIndex.get(ckey(x, z)) || [];
  let px = x,
    pz = z;
  for (const b of nearby) {
    const [minx, maxx, minz, maxz] = b._bb;
    if (px < minx || px > maxx || pz < minz || pz > maxz) continue;
    if (!pip(px, pz, b.poly)) continue;
    let best = 1e9,
      nx = 0,
      nz = 0,
      bx = px,
      bz = pz;
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i];
      const c = b.poly[(i + 1) % b.poly.length];
      const abx = c[0] - a[0],
        abz = c[1] - a[1];
      const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (pz - a[1]) * abz) / (abx * abx + abz * abz || 1)));
      const qx = a[0] + abx * t,
        qz = a[1] + abz * t;
      const d = Math.hypot(px - qx, pz - qz);
      if (d < best) {
        best = d;
        bx = qx;
        bz = qz;
        nx = px - qx;
        nz = pz - qz;
      }
    }
    const len = Math.hypot(nx, nz) || 1;
    px = bx + (nx / len) * (radius + 0.08);
    pz = bz + (nz / len) * (radius + 0.08);
  }
  return [px, pz];
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(0, 0);
let lookTarget = null;

function updateLook() {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  lookTarget = null;
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.building && !o.userData.art) o = o.parent;
    if (o?.userData.building) {
      lookTarget = o.userData.building;
      break;
    }
    if (o?.userData.art) {
      lookName.textContent = o.userData.art.name;
      lookNote.textContent = "Campus artwork (OpenStreetMap)";
      return;
    }
  }
  if (lookTarget) {
    lookName.textContent = lookTarget.name || lookTarget.addr || "Building";
    lookNote.textContent = lookTarget.note || lookTarget.addr || "";
  } else if (!selected) {
    lookName.textContent = "Homewood";
    lookNote.textContent = "Walk the quads · search a hall to drop a gold route";
  }
}

function drawMinimap() {
  const w = mini.width,
    h = mini.height;
  mctx.fillStyle = "#cfe3b8";
  mctx.fillRect(0, 0, w, h);
  const R = 160;
  const px = camera.position.x,
    pz = camera.position.z;
  const to = (x, z) => [((x - px) / R) * (w / 2) + w / 2, ((z - pz) / R) * (h / 2) + h / 2];
  mctx.fillStyle = "#8f3b32";
  for (const b of data.buildings) {
    if (!b.poly) continue;
    mctx.beginPath();
    b.poly.forEach((p, i) => {
      const [u, v] = to(p[0], p[1]);
      i ? mctx.lineTo(u, v) : mctx.moveTo(u, v);
    });
    mctx.closePath();
    mctx.fill();
  }
  mctx.fillStyle = "#6aa04a";
  for (const a of data.areas) {
    if (a.kind !== "quad" || !a.poly) continue;
    mctx.beginPath();
    a.poly.forEach((p, i) => {
      const [u, v] = to(p[0], p[1]);
      i ? mctx.lineTo(u, v) : mctx.moveTo(u, v);
    });
    mctx.closePath();
    mctx.fill();
  }
  if (routePts.length) {
    mctx.strokeStyle = "#c9a227";
    mctx.lineWidth = 2;
    mctx.beginPath();
    routePts.forEach((p, i) => {
      const [u, v] = to(p.x, p.z);
      i ? mctx.lineTo(u, v) : mctx.moveTo(u, v);
    });
    mctx.stroke();
  }
  mctx.fillStyle = "#0b1f4b";
  mctx.beginPath();
  mctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
  mctx.fill();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  mctx.strokeStyle = "#0b1f4b";
  mctx.beginPath();
  mctx.moveTo(w / 2, h / 2);
  mctx.lineTo(w / 2 + dir.x * 16, h / 2 + dir.z * 16);
  mctx.stroke();
  mctx.fillStyle = "#0b1f4b";
  mctx.font = "11px sans-serif";
  mctx.fillText("N", w / 2 - 4, 12);
}

const clock = new THREE.Clock();
const vel = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

function tickClockHands() {
  const now = new Date();
  const m = now.getMinutes() + now.getSeconds() / 60;
  const h = (now.getHours() % 12) + m / 60;
  const ha = -h * (Math.PI / 6);
  const ma = -m * (Math.PI / 30);
  for (const hand of clockHands) {
    hand.hp.rotation.z = ha;
    hand.mp.rotation.z = ma;
  }
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  if (controls.isLocked) {
    const sprinting = keys.KeyR || keys.ShiftLeft || keys.ShiftRight;
    const spd = (sprinting ? SPRINT_SPEED : WALK_SPEED) * dt;
    const forward = (keys.KeyW ? 1 : 0) + (keys.KeyS ? -1 : 0);
    const side = (keys.KeyD ? 1 : 0) + (keys.KeyA ? -1 : 0);
    if (forward || side) {
      const mag = Math.hypot(forward, side) || 1;
      controls.moveForward((forward / mag) * spd);
      controls.moveRight((side / mag) * spd);
      const [x, z] = resolveCollision(camera.position.x, camera.position.z);
      camera.position.x = x;
      camera.position.z = z;
    }
    const floor = groundY(camera.position.x, camera.position.z) + EYE;
    if (keys.Space && grounded) {
      vy = JUMP_SPEED;
      grounded = false;
    }
    vy -= GRAVITY * dt;
    camera.position.y += vy * dt;
    if (camera.position.y <= floor) {
      camera.position.y = floor;
      vy = 0;
      grounded = true;
    } else {
      grounded = false;
    }
  }
  const t = clock.elapsedTime;
  birds.forEach((b, i) => {
    const u = t * 0.22 + b.userData.t;
    b.position.set(Math.cos(u) * b.userData.r - 40, b.userData.y + Math.sin(u * 3) * 0.6, Math.sin(u) * b.userData.r);
    b.rotation.y = -u + Math.PI / 2;
  });
  {
    const lift = 92;
    sun.position.set(
      camera.position.x + sunPos.x * lift,
      camera.position.y + sunPos.y * lift,
      camera.position.z + sunPos.z * lift
    );
    sun.target.position.copy(camera.position);
    sun.target.updateMatrixWorld();
  }
  tickClockHands();
  updateLook();
  drawMinimap();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const yaw = Math.atan2(dir.x, -dir.z);
  const needle = document.getElementById("needle");
  if (needle) needle.style.transform = `rotate(${(-yaw * 180) / Math.PI}deg)`;
  scene.traverse((o) => {
    if (o.isCSS2DObject) {
      const d = camera.position.distanceTo(o.position);
      o.visible = d > 10 && d < 150;
    }
  });
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

window.__jhu = { camera, scene, pick, directory, data, controls, groundY, colliders, resolveCollision };
loop();
