import * as THREE from 'three';

export const FOG_COLOR = 0x0d0d10;
// FogExp2 falloff is exp(-(d·depth)²) — 0.085 ≈ 50% haze at 10u, opaque ~16u
const BASE_DENSITY = 0.085;

// ---------------------------------------------------------------------------
// FogDirector — density is a living, smoothed signal, never a constant.
// ---------------------------------------------------------------------------
export class FogDirector {
  fog: THREE.FogExp2;
  private density = BASE_DENSITY;
  bias = 0;                // sanity thickens the world
  thin = 0;                // rail telegraph briefly thins it (a lie of safety)
  private t = 0;
  private baseColor = new THREE.Color(FOG_COLOR);
  private dreadColor = new THREE.Color(0x180d0c);

  constructor(scene: THREE.Scene) {
    this.fog = new THREE.FogExp2(FOG_COLOR, BASE_DENSITY);
    scene.fog = this.fog;
    scene.background = new THREE.Color(FOG_COLOR);
  }

  tick(dt: number, fear: number) {
    this.t += dt;
    const breathe = 0.007 * Math.sin(this.t * 0.7);
    const target = BASE_DENSITY + breathe + this.bias - this.thin;
    this.density += (target - this.density) * Math.min(1, dt * 2);
    this.fog.density = this.density;
    this.fog.color.copy(this.baseColor).lerp(this.dreadColor, fear * 0.7);
    this.thin *= Math.max(0, 1 - dt * 1.5);
  }
}

// ---------------------------------------------------------------------------
// Flashlight — one real light + fake volumetric cone. No shadow maps.
// ---------------------------------------------------------------------------
export class Flashlight {
  readonly spot: THREE.SpotLight;
  readonly beam: THREE.Mesh;
  private sway = 0;
  private flickerT = 0;
  private flickerOff = 0;
  peer = 0;                 // 0..1 peer blend

  private readonly BASE = 90;

  constructor(rig: THREE.Object3D) {
    const spot = new THREE.SpotLight(0xfff2d8, 90, 10.5, Math.PI / 5.6, 0.65, 1.8);
    spot.castShadow = false;
    spot.position.set(0, 1.4, 0.6);
    spot.target.position.set(0, 0.1, -3.2);
    rig.add(spot, spot.target);
    this.spot = spot;

    // lantern glow — keeps the wanderer readable against the dark
    const lantern = new THREE.PointLight(0xffd9a0, 3.5, 3.2, 2);
    lantern.position.set(0.16, 0.7, -0.1);
    rig.add(lantern);

    // fake volumetric beam: open additive cone aimed down the light axis
    const geo = new THREE.ConeGeometry(1.55, 7.2, 20, 6, true);
    geo.translate(0, -3.6, 0);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec3 vPos;
        varying vec3 vNormal;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vPos;
        varying vec3 vNormal;
        float n2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          float along = clamp(-vPos.z / 7.2, 0.0, 1.0);
          float fade = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.12, along);
          float fresnel = pow(abs(vNormal.z), 1.5);
          float motes = 0.75 + 0.25 * n2(floor(vPos.xy * 6.0) + floor(uTime * 8.0));
          float a = fade * (0.35 + 0.65 * fresnel) * motes * 0.14 * uIntensity;
          gl_FragColor = vec4(1.0, 0.94, 0.82, a);
        }`,
    });
    this.beam = new THREE.Mesh(geo, mat);
    this.beam.position.set(0, 1.1, 0.3);
    this.beam.rotation.x = -0.18;      // tilts down toward the spot target
    rig.add(this.beam);
  }

  tick(dt: number, fear: number) {
    this.sway += dt;
    const swayX = Math.sin(this.sway * 1.3) * 0.35 + Math.sin(this.sway * 3.7) * 0.12;
    this.spot.target.position.x = swayX * (1 - this.peer * 0.7);

    // peer: trade width for depth
    this.spot.angle = Math.PI / 7 - this.peer * (Math.PI / 7 - Math.PI / 11);
    this.spot.distance = 9.5 + this.peer * 3.5;
    this.beam.scale.set(1 - this.peer * 0.45, 1 - this.peer * 0.45, 1 + this.peer * 0.4);

    // low-sanity gutter: Poisson-ish flicker
    let intensity = this.BASE;
    if (fear > 0.55) {
      this.flickerT -= dt;
      if (this.flickerT <= 0) {
        this.flickerT = 0.08 + Math.random() * (2.2 - fear * 1.6);
        this.flickerOff = Math.random() < 0.4 ? 0.12 : 0;
      }
      if (this.flickerOff > 0) { intensity *= 0.25; this.flickerOff -= dt; }
    }
    this.spot.intensity = intensity;
    const m = this.beam.material as THREE.ShaderMaterial;
    m.uniforms.uTime.value += dt;
    m.uniforms.uIntensity.value = intensity / this.BASE;
  }

  gutterOut(progress: number) {
    // death: light dies over ~0.4s
    const k = Math.max(0, 1 - progress);
    this.spot.intensity = this.BASE * k * (Math.random() > 0.3 ? 1 : 0.2);
    (this.beam.material as THREE.ShaderMaterial).uniforms.uIntensity.value = k;
  }
}

// ---------------------------------------------------------------------------
// Ash — drifting particle field that follows the camera.
// ---------------------------------------------------------------------------
export class AshField {
  readonly points: THREE.Points;
  private vel: Float32Array;
  private n = 420;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 1] = Math.random() * 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.3;
      this.vel[i * 3 + 1] = -0.12 - Math.random() * 0.25;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8a8d94, size: 0.035, transparent: true, opacity: 0.7,
      sizeAttenuation: true, fog: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    scene.add(this.points);
  }

  tick(dt: number, centerZ: number) {
    this.points.position.z = centerZ;
    const p = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute);
    const a = p.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      a[i * 3] += this.vel[i * 3] * dt;
      a[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      a[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (a[i * 3 + 1] < 0) { a[i * 3 + 1] = 5; a[i * 3] = (Math.random() - 0.5) * 14; }
    }
    p.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Film grain — one fullscreen quad in an overlay pass. No EffectComposer.
// ---------------------------------------------------------------------------
export class GrainPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0.06 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uAmount;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float g = hash(vUv * vec2(853.0, 1481.0) + fract(uTime) * 61.0);
          // scanline whisper
          float scan = 0.5 + 0.5 * sin(vUv.y * 900.0 + uTime * 9.0);
          float a = uAmount * (0.65 + 0.35 * scan);
          gl_FragColor = vec4(vec3(g), a);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(quad);
  }

  tick(dt: number, fear: number) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uAmount.value = 0.05 + fear * 0.14;
  }

  render(r: THREE.WebGLRenderer) {
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.autoClear = true;
  }
}

// ---------------------------------------------------------------------------
// The Static — the wall of consuming fog behind the player.
// ---------------------------------------------------------------------------
export class StaticWall {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uProximity: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uProximity;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float n = hash(floor(vUv * vec2(240.0, 130.0)) + floor(uTime * 24.0));
          float edge = smoothstep(0.0, 0.5, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          vec3 col = mix(vec3(0.04, 0.03, 0.035), vec3(0.28, 0.24, 0.26), n);
          gl_FragColor = vec4(col, edge * 0.5 * uProximity);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), this.mat);
    this.mesh.position.y = 2.2;
    scene.add(this.mesh);
  }

  tick(dt: number, staticRowZ: number, proximity: number) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uProximity.value = proximity;
    this.mesh.visible = proximity > 0.01;
    this.mesh.position.z = staticRowZ;
  }
}
