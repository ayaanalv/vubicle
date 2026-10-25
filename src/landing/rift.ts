// Motion layer over the hero art: stars turning inside the hole, a slow pulse, and study symbols
// drifting out toward the viewer. Positions are in the art's own pixels (2000 x 1116).
const ART = { w: 2000, h: 1116 };
const HOLE = { x: 1090, y: 735, rx: 215, ry: 245 };
const GLYPHS = ['∫', 'Σ', 'π', '∞', '√', 'Δ', 'λ', 'θ', 'Na', 'Cl', 'H', 'Fe', '½', 'x²'];
const GOLD = '240, 195, 106';
const STAR = '255, 244, 220';

type Mote = { a: number; d: number; speed: number; size: number; tw: number };
type Glyph = { t: string; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; rot: number; vr: number; tile: boolean };

export function startRift(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let W = 0, H = 0, s = 1, ox = 0, oy = 0, dpr = 1;

  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // Mirror object-fit: cover with the image's object-position so the motion lines up with the art.
    s = Math.max(W / ART.w, H / ART.h);
    const pos = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    ox = (W - ART.w * s) * (pos[0] ?? 0.5);
    oy = (H - ART.h * s) * (pos[1] ?? 0.5);
  };
  fit();
  new ResizeObserver(fit).observe(canvas);

  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + y * s;

  const stars: Mote[] = Array.from({ length: 140 }, () => ({
    a: Math.random() * Math.PI * 2,
    d: Math.sqrt(Math.random()),
    speed: 0.015 + Math.random() * 0.02,
    size: Math.random() < 0.1 ? 1.8 : 0.9,
    tw: Math.random() * 6,
  }));
  const glyphs: Glyph[] = [];
  const spawn = (warm = false) => {
    const a = Math.random() * Math.PI * 2;
    // Mostly up and to the right, the way the galaxy spills out in the art.
    const dir = -0.6 + (Math.random() - 0.5) * 1.6;
    const sp = 18 + Math.random() * 22;
    glyphs.push({
      t: GLYPHS[(Math.random() * GLYPHS.length) | 0],
      x: HOLE.x + Math.cos(a) * HOLE.rx * 0.5,
      y: HOLE.y + Math.sin(a) * HOLE.ry * 0.5,
      vx: Math.cos(dir) * sp,
      vy: Math.sin(dir) * sp,
      life: warm ? Math.random() * 8 : 0,
      max: 9 + Math.random() * 5,
      size: 16 + Math.random() * 12,
      rot: (Math.random() - 0.5) * 0.6,
      vr: (Math.random() - 0.5) * 0.25,
      tile: Math.random() < 0.12,
    });
  };
  for (let i = 0; i < 8; i++) spawn(true);

  let last = performance.now();
  let running = true;
  let raf = 0;

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // The rift breathes on a six-second cycle.
    const pulse = 0.5 + 0.5 * Math.sin(t * ((Math.PI * 2) / 6));
    const g = ctx.createRadialGradient(X(HOLE.x), Y(HOLE.y), 0, X(HOLE.x), Y(HOLE.y), HOLE.ry * s * 1.6);
    g.addColorStop(0, `rgba(${GOLD}, ${0.1 + pulse * 0.1})`);
    g.addColorStop(0.5, `rgba(150, 120, 255, ${0.05 + pulse * 0.06})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stars turning slowly inside the hole.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(X(HOLE.x), Y(HOLE.y), HOLE.rx * s * 0.92, HOLE.ry * s * 0.92, 0, 0, Math.PI * 2);
    ctx.clip();
    for (const st of stars) {
      st.a += st.speed * dt * (1.4 - st.d);
      const x = X(HOLE.x) + Math.cos(st.a) * st.d * HOLE.rx * s;
      const y = Y(HOLE.y) + Math.sin(st.a) * st.d * HOLE.ry * s * 0.8;
      ctx.fillStyle = `rgba(${STAR}, ${0.35 + 0.35 * Math.sin(t * 1.3 + st.tw)})`;
      ctx.fillRect(x, y, st.size, st.size);
    }
    ctx.restore();

    // Symbols drifting toward the viewer: they grow and fade as they leave the wall.
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const gl = glyphs[i];
      gl.life += dt;
      if (gl.life > gl.max) {
        glyphs.splice(i, 1);
        spawn();
        continue;
      }
      const k = gl.life / gl.max;
      gl.x += gl.vx * dt * (1 + k * 2);
      gl.y += gl.vy * dt * (1 + k * 2);
      gl.rot += gl.vr * dt;
      // Fade in only once clear of the painted symbols near the centre of the hole.
      const alpha = Math.min(1, Math.max(0, k - 0.12) * 4) * (1 - k) * 0.85;
      const size = gl.size * (0.6 + k * 1.1) * s * 1.6;
      ctx.save();
      ctx.translate(X(gl.x), Y(gl.y));
      ctx.rotate(gl.rot);
      if (gl.tile) {
        ctx.strokeStyle = `rgba(${STAR}, ${alpha * 0.8})`;
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.strokeRect(-size * 0.55, -size * 0.55, size * 1.1, size * 1.1);
      }
      ctx.fillStyle = `rgba(${GOLD}, ${alpha})`;
      ctx.font = `600 ${size}px "Fredoka Variable", ui-rounded, system-ui`;
      ctx.fillText(gl.t, 0, 0);
      ctx.restore();
    }
    if (running) raf = requestAnimationFrame(frame);
  };

  const setRunning = (on: boolean) => {
    if (on === running) return;
    running = on;
    if (on) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else cancelAnimationFrame(raf);
  };
  let visible = true;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    setRunning(visible && !document.hidden);
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => setRunning(visible && !document.hidden));
  raf = requestAnimationFrame(frame);
}
