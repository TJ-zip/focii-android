"use client";

import { useEffect, useRef } from "react";
import { PRESETS } from "../audio/presets";

export type VisualMode = "focus" | "relax" | "sleep" | "pump";

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

/**
 * Seconds per beat, with a fallback for a preset that has no pulse.
 *
 * Only focus and pump have a bpm; relax and sleep are 0 by design and use
 * plain seconds below. The fallback exists so that removing a mode's pulse
 * can never turn a period into Infinity and freeze the animation - it would
 * simply revert that mode to free-running time.
 */
function beat(bpm: number, fallback: number): number {
  return bpm > 0 ? 60 / bpm : fallback;
}

const FOCUS_BEAT = beat(PRESETS.focus.bpm, 1); // 60.1 bpm -> 0.9983 s
const PUMP_BEAT = beat(PRESETS.pump.bpm, 0.5); // 122.0 bpm -> 0.4918 s

/* ------------------------------------------------------------------ */
/* Mode character                                                      */
/* ------------------------------------------------------------------ */

interface ModeParams {
  breath: number; // seconds per global breathing cycle
  spawnMin: number; // min seconds between glyph spawns
  spawnMax: number;
  maxGlyphs: number;
  lifeMin: number; // glyph lifetime range (s)
  lifeMax: number;
  brightness: number; // master intensity multiplier
  redBias: number; // probability a glyph uses the ember-red tint
  frameEvery: number; // average seconds between grid-frame events
  gridAlpha: number; // base grid line alpha
  drift: number; // sub-pixel breathing drift of the whole field
}

/**
 * The pulsed modes state their periods in BEATS of their own preset rather
 * than in seconds, for the same reason quantizeRoot() exists in presets.ts:
 * two cycles that are close but not commensurate do not look independent,
 * they look like one cycle with a fault in it. A 7.5 s breath against a
 * 0.9983 s beat completes 7.51 beats, so its peak lands at a different point
 * in the bar every time round and slowly walks the whole way through - which
 * reads as the picture lagging the music and then catching up.
 *
 * Both were also asked to move faster, so the beat counts were chosen below
 * the old free-running value rather than at the nearest one:
 *
 *   focus  7.5 s -> 6 beats  = 5.99 s   (1.25x)
 *   pump   5.5 s -> 8 beats  = 3.93 s   (1.40x)
 *
 * Rounding to the NEAREST whole beat would have given focus 8 beats, i.e.
 * slower, which is the opposite of what was wanted.
 *
 * relax and sleep have bpm 0 - no pulse layer at all - so they keep literal
 * seconds. There is no grid for them to be off, and inventing one would make
 * two modes whose whole point is that nothing is counting feel counted.
 */
const PARAMS: Record<VisualMode, ModeParams> = {
  focus: {
    breath: 6 * FOCUS_BEAT, // 5.99 s
    spawnMin: 0.5 * FOCUS_BEAT, // 0.50 s
    spawnMax: 1.5 * FOCUS_BEAT, // 1.50 s
    maxGlyphs: 17,
    lifeMin: 4,
    lifeMax: 8,
    brightness: 1,
    redBias: 0.2,
    frameEvery: 16 * FOCUS_BEAT, // 15.97 s
    gridAlpha: 0.05,
    drift: 2.5,
  },
  relax: {
    breath: 16,
    spawnMin: 1.8,
    spawnMax: 4.2,
    maxGlyphs: 9,
    lifeMin: 8,
    lifeMax: 16,
    brightness: 0.8,
    redBias: 0.32,
    frameEvery: 38,
    gridAlpha: 0.04,
    drift: 3.5,
  },
  sleep: {
    breath: 30,
    spawnMin: 4.5,
    spawnMax: 9,
    maxGlyphs: 5,
    lifeMin: 14,
    lifeMax: 26,
    brightness: 0.5,
    redBias: 0.42,
    frameEvery: 70,
    gridAlpha: 0.028,
    drift: 1,
  },
  pump: {
    breath: 8 * PUMP_BEAT, // 3.93 s
    spawnMin: 0.5 * PUMP_BEAT, // 0.25 s
    spawnMax: 2 * PUMP_BEAT, // 0.98 s
    maxGlyphs: 20,
    lifeMin: 3,
    lifeMax: 7,
    brightness: 1.25,
    redBias: 0.55,
    frameEvery: 24 * PUMP_BEAT, // 11.80 s
    gridAlpha: 0.13,
    drift: 4,
  },
};

/* ------------------------------------------------------------------ */
/* Internal types                                                      */
/* ------------------------------------------------------------------ */

type GlyphKind = "plus" | "square" | "ticks" | "flare" | "dust";

interface Glyph {
  kind: GlyphKind;
  gx: number; // grid column (intersection index)
  gy: number; // grid row
  born: number; // seconds
  life: number; // seconds
  red: boolean;
  phase: number; // individual pulse offset
  scale: number; // size jitter 0.8..1.3
}

interface GridFrame {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  born: number;
  life: number;
}

interface Field {
  cell: number;
  cols: number;
  rows: number;
  ox: number; // origin offset so the grid is centered
  oy: number;
}

const WHITE: [number, number, number] = [232, 228, 224];
const RED: [number, number, number] = [214, 40, 52];

const KINDS: GlyphKind[] = ["plus", "square", "ticks", "flare", "dust"];
const KIND_WEIGHTS = [0.3, 0.2, 0.18, 0.17, 0.15];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  // Box–Muller
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickKind(rnd: () => number): GlyphKind {
  const r = rnd();
  let acc = 0;
  for (let i = 0; i < KINDS.length; i++) {
    acc += KIND_WEIGHTS[i];
    if (r <= acc) return KINDS[i];
  }
  return "plus";
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** fade-in / hold / fade-out envelope over a glyph's life, 0..1 */
function envelope(age: number, life: number): number {
  const inEnd = life * 0.18;
  const outStart = life * 0.7;
  if (age < inEnd) return smoothstep(0, inEnd, age);
  if (age > outStart) return 1 - smoothstep(outStart, life, age);
  return 1;
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(4)})`;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function computeField(w: number, h: number): Field {
  const cell = Math.max(56, Math.min(w, h) / 8.5);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const ox = (w - (cols - 1) * cell) / 2;
  const oy = (h - (rows - 1) * cell) / 2;
  return { cell, cols, rows, ox, oy };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  f: Field,
  w: number,
  h: number,
  alpha: number,
  breatheK: number,
) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(WHITE, alpha * (0.85 + 0.15 * breatheK));
  ctx.beginPath();
  for (let c = 0; c < f.cols; c++) {
    const x = Math.round(f.ox + c * f.cell) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let r = 0; r < f.rows; r++) {
    const y = Math.round(f.oy + r * f.cell) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  g: Glyph,
  f: Field,
  now: number,
  p: ModeParams,
  breatheK: number,
) {
  const age = now - g.born;
  const env = envelope(age, g.life);
  if (env <= 0.004) return;

  const pulse = 0.72 + 0.28 * Math.sin((2 * Math.PI * now) / p.breath + g.phase);
  const a = Math.min(1, env * pulse * p.brightness);
  const color = g.red ? RED : WHITE;
  const x = f.ox + g.gx * f.cell;
  const y = f.oy + g.gy * f.cell;
  const s = f.cell * 0.16 * g.scale;

  ctx.save();
  ctx.shadowColor = rgba(color, Math.min(0.9, a));
  ctx.shadowBlur = 10 + 8 * breatheK;

  switch (g.kind) {
    case "plus": {
      const arm = s * 0.55;
      ctx.strokeStyle = rgba(color, a * 0.95);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.stroke();
      // horizontal light streak behind the cross
      const streak = f.cell * (0.9 + 0.5 * breatheK) * g.scale;
      const grad = ctx.createLinearGradient(x - streak, y, x + streak, y);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(0.5, rgba(color, a * 0.22));
      grad.addColorStop(1, rgba(color, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - streak, y);
      ctx.lineTo(x + streak, y);
      ctx.stroke();
      break;
    }
    case "square": {
      const half = s * 0.5;
      ctx.strokeStyle = rgba(color, a);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - half, y - half, s, s);
      break;
    }
    case "ticks": {
      const len = s * 1.6;
      const gap = Math.max(3, s * 0.45);
      ctx.strokeStyle = rgba(color, a * 0.95);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y - gap / 2);
      ctx.lineTo(x + len / 2, y - gap / 2);
      ctx.moveTo(x - len / 2, y + gap / 2);
      ctx.lineTo(x + len / 2, y + gap / 2);
      ctx.stroke();
      break;
    }
    case "flare": {
      const wdt = f.cell * (1.3 + 0.6 * breatheK) * g.scale;
      const grad = ctx.createLinearGradient(x - wdt, y, x + wdt, y);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(0.5, rgba(color, a * 0.85));
      grad.addColorStop(1, rgba(color, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - wdt, y);
      ctx.lineTo(x + wdt, y);
      ctx.stroke();
      // dim companion line
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x - wdt * 0.6, y + Math.max(4, s * 0.5));
      ctx.lineTo(x + wdt * 0.6, y + Math.max(4, s * 0.5));
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case "dust": {
      ctx.fillStyle = rgba(color, a * 0.8);
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  fr: GridFrame,
  f: Field,
  now: number,
  p: ModeParams,
) {
  const age = now - fr.born;
  const env = envelope(age, fr.life);
  if (env <= 0.004) return;
  const a = env * 0.5 * p.brightness;
  const x0 = f.ox + fr.c0 * f.cell;
  const y0 = f.oy + fr.r0 * f.cell;
  const x1 = f.ox + fr.c1 * f.cell;
  const y1 = f.oy + fr.r1 * f.cell;
  ctx.save();
  ctx.shadowColor = rgba(WHITE, a);
  ctx.shadowBlur = 6;
  ctx.strokeStyle = rgba(WHITE, a);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
  ctx.restore();
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.3,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  g.addColorStop(0, "rgba(5,5,5,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* Spawning                                                            */
/* ------------------------------------------------------------------ */

function spawnGlyph(
  rnd: () => number,
  f: Field,
  now: number,
  p: ModeParams,
): Glyph {
  const cx = (f.cols - 1) / 2;
  const cy = (f.rows - 1) / 2;
  const gx = Math.min(
    f.cols - 1,
    Math.max(0, Math.round(cx + gauss(rnd) * f.cols * 0.16)),
  );
  const gy = Math.min(
    f.rows - 1,
    Math.max(0, Math.round(cy + gauss(rnd) * f.rows * 0.16)),
  );
  return {
    kind: pickKind(rnd),
    gx,
    gy,
    born: now,
    life: p.lifeMin + rnd() * (p.lifeMax - p.lifeMin),
    red: rnd() < p.redBias,
    phase: rnd() * Math.PI * 2,
    scale: 0.8 + rnd() * 0.5,
  };
}

function spawnFrame(
  rnd: () => number,
  f: Field,
  now: number,
  p: ModeParams,
): GridFrame {
  const spanC = 2 + Math.floor(rnd() * 2); // 2–3 columns
  const spanR = 3 + Math.floor(rnd() * 3); // 3–5 rows
  const cx = Math.round((f.cols - 1) / 2 + gauss(rnd) * 0.8);
  const cy = Math.round((f.rows - 1) / 2 + gauss(rnd) * 0.8);
  const c0 = Math.max(0, Math.min(f.cols - 1 - spanC, cx - Math.ceil(spanC / 2)));
  const r0 = Math.max(0, Math.min(f.rows - 1 - spanR, cy - Math.ceil(spanR / 2)));
  return {
    c0,
    r0,
    c1: Math.min(f.cols - 1, c0 + spanC),
    r1: Math.min(f.rows - 1, r0 + spanR),
    born: now,
    life: Math.max(10, p.frameEvery * 0.55),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
  mode: VisualMode;
  /**
   * Stop animating entirely.
   *
   * Set while a blackout or whiteout screen is up. Without it this canvas goes
   * on repainting the full viewport sixty times a second underneath an opaque
   * sheet -- invisible, and for the study-lamp case actively harmful, since
   * the entire point of that mode is to leave a device sitting there lit for
   * an hour.
   *
   * Note the field is NOT reseeded on resume. The animation clock runs from
   * page load, so glyphs that expired during the pause are simply gone when it
   * restarts, exactly as if it had been running. The visualizer has always
   * been rate-locked rather than phase-locked to the audio, so a discontinuity
   * here has nothing to fall out of step with.
   */
  paused?: boolean;
}

export default function Visualizer({ mode, paused = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<VisualMode>(mode);
  modeRef.current = mode;

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  /**
   * Handle on the running loop, published by the main effect.
   *
   * `paused` deliberately does not join the main effect's dependency array.
   * That effect owns the canvas context, the field geometry, the glyph list
   * and the PRNG; re-running it would tear all of that down and reseed a fresh
   * field every time a screen is toggled, so leaving a blackout would show a
   * visibly different composition from the one that entered it.
   */
  const controlRef = useRef<{ restart: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rnd = mulberry32(Math.floor(Date.now() % 2147483647));
    let raf = 0;
    let width = 0;
    let height = 0;
    let field: Field = computeField(1, 1);
    let glyphs: Glyph[] = [];
    let frames: GridFrame[] = [];
    let nextSpawn = 0;
    let nextFrame = 0;
    const start = performance.now();

    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");

    function resize() {
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      field = computeField(width, height);
      glyphs = glyphs.filter((g) => g.gx < field.cols && g.gy < field.rows);
      if (mql.matches) renderStatic();
    }

    /** One still, calm composition for reduced-motion users. */
    function renderStatic() {
      if (!ctx) return;
      const p = PARAMS[modeRef.current];
      const srnd = mulberry32(41);
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, width, height);
      drawGrid(ctx, field, width, height, p.gridAlpha, 0.5);
      const still: Glyph[] = [];
      for (let i = 0; i < Math.min(8, p.maxGlyphs); i++) {
        const g = spawnGlyph(srnd, field, 0, p);
        g.born = -g.life * 0.4; // mid-envelope
        g.phase = Math.PI / 2; // pulse peak, frozen
        still.push(g);
      }
      for (const g of still) drawGlyph(ctx, g, field, 0, p, 0.5);
      drawVignette(ctx, width, height);
    }

    function tick(t: number) {
      if (!ctx) return;
      const now = (t - start) / 1000;
      const p = PARAMS[modeRef.current];
      const breatheK =
        0.5 + 0.5 * Math.sin((2 * Math.PI * now) / p.breath - Math.PI / 2);

      // spawn glyphs
      if (now >= nextSpawn) {
        if (glyphs.length < p.maxGlyphs) {
          glyphs.push(spawnGlyph(rnd, field, now, p));
        }
        nextSpawn = now + p.spawnMin + rnd() * (p.spawnMax - p.spawnMin);
      }
      // spawn roaming grid frame
      if (now >= nextFrame) {
        frames.push(spawnFrame(rnd, field, now, p));
        nextFrame = now + p.frameEvery * (0.7 + rnd() * 0.6);
      }
      glyphs = glyphs.filter((g) => now - g.born < g.life);
      frames = frames.filter((fr) => now - fr.born < fr.life);

      // paint
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      const drift = Math.sin((2 * Math.PI * now) / (p.breath * 2)) * p.drift;
      ctx.translate(0, drift);
      drawGrid(ctx, field, width, height, p.gridAlpha, breatheK);
      for (const fr of frames) drawFrame(ctx, fr, field, now, p);
      for (const g of glyphs) drawGlyph(ctx, g, field, now, p, breatheK);
      ctx.restore();

      drawVignette(ctx, width, height);
      raf = requestAnimationFrame(tick);
    }

    function startOrStop() {
      cancelAnimationFrame(raf);
      // A pause outranks everything else, including a change of motion
      // preference arriving while a screen is up.
      if (pausedRef.current) return;
      if (mql.matches) {
        renderStatic();
      } else {
        raf = requestAnimationFrame(tick);
      }
    }

    resize();
    startOrStop();
    controlRef.current = { restart: startOrStop };
    window.addEventListener("resize", resize);
    mql.addEventListener("change", startOrStop);

    return () => {
      cancelAnimationFrame(raf);
      controlRef.current = null;
      window.removeEventListener("resize", resize);
      mql.removeEventListener("change", startOrStop);
    };
  }, []);

  // Runs after the effect above on mount, so the handle is always published
  // by the time this reads it. startOrStop() consults pausedRef itself, so
  // one call covers both directions.
  useEffect(() => {
    controlRef.current?.restart();
  }, [paused]);

  return <canvas ref={canvasRef} className="viz" aria-hidden="true" />;
}
