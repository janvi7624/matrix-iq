'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useReducedMotion } from 'framer-motion';
import { BRAND } from '@/lib/branding';
import styles from './matrixLoginVisual.module.css';

// The real icon mark — a 315-path auto-traced SVG (not clean hand-authored
// vector art: it's a raster-to-vector trace with hundreds of near-identical
// reds approximating anti-aliasing), too large to usefully inline into this
// component. Used as a plain image asset instead; the dim<->vibrant and glow
// states below are done with CSS filters on the rendered image rather than
// per-path recoloring, which works regardless of how many paths compose it.
const MARK_SRC = '/nanta_technologies_logo.svg';

// Fixed (not Math.random()'d — this renders on the server first, so random
// positions here would hydration-mismatch) scatter of small background
// instances of the mark, purely decorative. size/opacity/duration vary by
// hand for a natural, non-grid feel.
const BACKGROUND_MARKS = [
  { x: 12, y: 18, scale: 0.34, opacity: 0.28, rotate: -12, drift: 9.5 },
  { x: 86, y: 12, scale: 0.22, opacity: 0.22, rotate: 20, drift: 11 },
  { x: 90, y: 62, scale: 0.3, opacity: 0.3, rotate: 8, drift: 8 },
  { x: 8, y: 72, scale: 0.26, opacity: 0.25, rotate: -22, drift: 12.5 },
  { x: 62, y: 90, scale: 0.2, opacity: 0.2, rotate: 15, drift: 10 },
  { x: 34, y: 8, scale: 0.16, opacity: 0.18, rotate: -6, drift: 13 }
];

// Department nodes radiating off the mark — the actual modules this
// platform unifies (see BRAND.description), not generic placeholder words.
const NETWORK_NODES = [
  { x: 18, y: 22, label: 'Sales' },
  { x: 82, y: 18, label: 'Projects' },
  { x: 86, y: 76, label: 'Operations' },
  { x: 15, y: 80, label: 'Analytics' },
  { x: 50, y: 6, label: 'CRM' }
];

const CENTER = { x: 50, y: 50 };

interface Bubble {
  x: number;
  y: number;
  vy: number;
  wobble: number;
  wobbleSpeed: number;
  size: number;
  life: number;
  maxLife: number;
}

// Idle (unhovered) vs. peak (hovered) CSS-filter recipe for the real logo
// image — sepia+desaturate+dim reads as "low-contrast dark/brown," fading to
// full brightness/saturation plus a contour-hugging drop-shadow glow as
// proximity rises. Interpolated by `p` every frame, same as everything else.
const IDLE_FILTER = { brightness: 0.5, saturate: 0.5, sepia: 0.4, contrast: 0.9, shadowBlur: 4, shadowAlpha: 0.12, opacity: 0.55 };
const PEAK_FILTER = { brightness: 1.08, saturate: 1.35, sepia: 0, contrast: 1.05, shadowBlur: 44, shadowAlpha: 0.85, opacity: 1 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function markFilter(p: number): { filter: string; opacity: string } {
  const brightness = lerp(IDLE_FILTER.brightness, PEAK_FILTER.brightness, p);
  const saturate = lerp(IDLE_FILTER.saturate, PEAK_FILTER.saturate, p);
  const sepia = lerp(IDLE_FILTER.sepia, PEAK_FILTER.sepia, p);
  const contrast = lerp(IDLE_FILTER.contrast, PEAK_FILTER.contrast, p);
  const shadowBlur = lerp(IDLE_FILTER.shadowBlur, PEAK_FILTER.shadowBlur, p);
  const shadowAlpha = lerp(IDLE_FILTER.shadowAlpha, PEAK_FILTER.shadowAlpha, p);
  const opacity = lerp(IDLE_FILTER.opacity, PEAK_FILTER.opacity, p);
  return {
    filter: `brightness(${brightness.toFixed(3)}) saturate(${saturate.toFixed(3)}) sepia(${sepia.toFixed(3)}) contrast(${contrast.toFixed(3)}) drop-shadow(0 0 ${shadowBlur.toFixed(1)}px rgba(255,0,0,${shadowAlpha.toFixed(3)}))`,
    opacity: opacity.toFixed(3)
  };
}

export default function MatrixLoginVisual() {
  // useReducedMotion() reads the client's matchMedia state, which the server
  // can't know — gating it behind a post-mount flag keeps the very first
  // client render identical to the server-rendered HTML (both "false") so
  // React never hits a hydration mismatch here; the correct value then
  // applies on the immediate next render, before the effect below would
  // otherwise have started any animation loop.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const prefersReducedMotionRaw = useReducedMotion();
  const prefersReducedMotion = mounted && !!prefersReducedMotionRaw;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markGroupRef = useRef<HTMLDivElement>(null);
  const markImgRef = useRef<HTMLImageElement>(null);
  const markGlowRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const nodesLayerRef = useRef<SVGGElement>(null);

  // Mouse-driven target, smoothed toward `current` every frame (see the
  // original component's own reasoning: no setState on mousemove — every
  // reactive value here is a direct style/attribute write in the RAF loop).
  const targetRef = useRef({ proximity: 0, dx: 0, dy: 0, px: 50, py: 50 });
  const currentRef = useRef({ proximity: 0, dx: 0, dy: 0 });
  const idleSpinRef = useRef(0);
  const meshPhaseRef = useRef(0);
  const bubblesRef = useRef<Bubble[]>([]);
  const lastBubbleAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      const el = containerRef.current;
      if (!el || !canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = el.clientWidth;
      height = el.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    resize();
    window.addEventListener('resize', resize);

    // A handful of receding contour lines (closer together "far" at the
    // top, spread out "near" at the bottom) with two summed sine waves per
    // line for an organic, non-mechanical undulation — the "distorted
    // topography" surface.
    function drawMesh(t: number) {
      if (!ctx || !width || !height) return;
      const rows = 9;
      ctx.lineWidth = 1;
      for (let i = 0; i < rows; i++) {
        const p = i / (rows - 1); // 0 (far/top) -> 1 (near/bottom)
        const eased = p * p; // bunch rows toward the top
        const baseY = height * (0.08 + eased * 0.86);
        const amp = 6 + p * 20;
        const freq1 = 0.006 + p * 0.002;
        const freq2 = 0.013;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 14) {
          const y =
            baseY +
            Math.sin(x * freq1 + t * 0.0006 + i * 0.7) * amp +
            Math.sin(x * freq2 - t * 0.0004 + i * 1.3) * amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(120, 140, 190, ${0.05 + p * 0.05})`;
        ctx.stroke();
      }
    }

    function drawBubbles() {
      if (!ctx) return;
      const bubbles = bubblesRef.current;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.life += 1 / b.maxLife;
        if (b.life >= 1) {
          bubbles.splice(i, 1);
          continue;
        }
        b.y += b.vy;
        b.x += Math.sin(b.life * Math.PI * 2 * b.wobbleSpeed) * b.wobble;
        const fade = b.life < 0.15 ? b.life / 0.15 : 1 - (b.life - 0.15) / 0.85;
        const r = b.size * (0.7 + b.life * 0.5);

        const grad = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.1, b.x, b.y, r);
        grad.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
        grad.addColorStop(0.35, `rgba(255,225,225,${0.4 * fade})`);
        grad.addColorStop(0.75, `rgba(255,120,120,${0.16 * fade})`);
        grad.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.55 * fade})`;
        ctx.arc(b.x - r * 0.32, b.y - r * 0.32, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(t: number) {
      const tgt = targetRef.current;
      const cur = currentRef.current;
      // Snappier than before (was 0.09) so the tilt/glow visibly catches up
      // to the cursor instead of lagging behind it.
      const LERP = 0.16;
      cur.proximity += (tgt.proximity - cur.proximity) * LERP;
      cur.dx += (tgt.dx - cur.dx) * LERP;
      cur.dy += (tgt.dy - cur.dy) * LERP;
      const p = cur.proximity;

      // Constant spin around the vertical (Y) axis — a turntable rotation,
      // not a flat clock-face spin — running on its own, centered on the
      // mark's own middle (transform-origin defaults to 50% 50%, and unlike
      // the previous version this value is never added to the cursor's
      // horizontal offset, so the spin itself stays perfectly even/centered
      // instead of getting skewed while hovering). Negative = reversed from
      // the earlier version. Cursor tilt still nudges rotateX (vertical
      // tilt from the mouse's Y position) on top of it, scaled by proximity
      // so it's inert until hovered near.
      idleSpinRef.current -= 0.12;
      meshPhaseRef.current = t;

      if (markGroupRef.current) {
        const tiltX = -cur.dy * 16 * p;
        markGroupRef.current.style.transform = `rotateX(${tiltX}deg) rotateY(${idleSpinRef.current}deg) scale(${1 + p * 0.06})`;
      }
      if (markImgRef.current) {
        const { filter, opacity } = markFilter(p);
        markImgRef.current.style.filter = filter;
        markImgRef.current.style.opacity = opacity;
      }
      if (markGlowRef.current) {
        markGlowRef.current.style.opacity = String(0.22 + p * 0.68);
        markGlowRef.current.style.filter = `blur(${14 + p * 40}px)`;
        markGlowRef.current.style.transform = `scale(${1 + p * 0.35})`;
      }
      if (spotlightRef.current) {
        spotlightRef.current.style.opacity = String(p * 0.85);
        spotlightRef.current.style.left = `${tgt.px}%`;
        spotlightRef.current.style.top = `${tgt.py}%`;
      }
      if (dimRef.current) {
        dimRef.current.style.opacity = String(p * 0.3);
      }
      if (nodesLayerRef.current) {
        nodesLayerRef.current.style.opacity = String(0.45 + p * 0.4);
      }

      if (ctx && canvas) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawMesh(t);
        drawBubbles();
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    function spawnBubble(px: number, py: number) {
      const now = performance.now();
      if (now - lastBubbleAtRef.current < 60) return; // throttle
      lastBubbleAtRef.current = now;
      if (bubblesRef.current.length > 46) bubblesRef.current.shift();
      bubblesRef.current.push({
        x: px + (Math.random() - 0.5) * 18,
        y: py + (Math.random() - 0.5) * 10,
        vy: -(0.5 + Math.random() * 0.9),
        wobble: 6 + Math.random() * 10,
        wobbleSpeed: 0.8 + Math.random() * 1.4,
        size: 3 + Math.random() * 7,
        life: 0,
        maxLife: 70 + Math.random() * 50
      });
    }

    function handleMove(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      // Wide enough to cover the mark's own rendered footprint (up to 860px
      // across) on typical viewports, not just a tight ring around dead
      // center — the old 0.42 factor meant you had to be almost exactly on
      // the middle before the hover effect registered at all.
      const maxDist = Math.min(rect.width, rect.height) * 0.62;
      const raw = Math.max(0, Math.min(1, 1 - dist / maxDist));
      // Eased (sqrt-ish) rather than linear so the effect ramps up quickly
      // as the cursor approaches instead of staying faint until the very
      // last stretch — makes the hover read as responsive, not sluggish.
      const proximity = Math.pow(raw, 0.55);
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      targetRef.current = {
        proximity,
        dx: dist > 0 ? dx / dist : 0,
        dy: dist > 0 ? dy / dist : 0,
        px: (px / rect.width) * 100,
        py: (py / rect.height) * 100
      };

      if (proximity > 0.25) spawnBubble(px, py);
    }

    function handleLeave() {
      targetRef.current = { ...targetRef.current, proximity: 0, dx: 0, dy: 0 };
    }

    if (prefersReducedMotion) {
      // No RAF loop, no bubbles, no parallax — draw exactly one static
      // frame of the mesh so the panel still has depth, then stop.
      resize();
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMesh(0);
      }
      return () => window.removeEventListener('resize', resize);
    }

    // Listen on window, not the container element — the centered,
    // transparent form card sits directly on top of the mark and has
    // pointer-events:auto (it needs to be clickable/typeable), which was
    // silently swallowing every mousemove under it. That's exactly where
    // users' cursors naturally rest while filling in the form, so it made
    // the hover effect feel dead in the most common case. Proximity is
    // still computed purely from clientX/Y against the container's rect,
    // so this changes nothing about *where* the effect is strongest — only
    // removes the blind spot caused by an element sitting on top of it.
    window.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseleave', handleLeave);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseleave', handleLeave);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [prefersReducedMotion]);

  return (
    <div className={styles.visualSide} ref={containerRef} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.meshCanvas} />

      <svg className={styles.nodesLayer} viewBox="0 0 100 100" preserveAspectRatio="none">
        <g ref={nodesLayerRef} className={styles.nodesGroup}>
          {NETWORK_NODES.map((n) => (
            <line key={`line-${n.label}`} x1={n.x} y1={n.y} x2={CENTER.x} y2={CENTER.y} className={styles.connectorLine} />
          ))}
          {NETWORK_NODES.map((n) => (
            <circle key={`dot-${n.label}`} cx={n.x} cy={n.y} r={0.9} className={styles.nodeDot} />
          ))}
        </g>
      </svg>
      <div className={styles.nodeLabels}>
        {NETWORK_NODES.map((n) => (
          <span key={n.label} className={styles.nodeLabel} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
            {n.label}
          </span>
        ))}
      </div>

      <div className={styles.backgroundMarks}>
        {BACKGROUND_MARKS.map((m, i) => (
          <Image
            key={i}
            src={MARK_SRC}
            alt=""
            width={240}
            height={240}
            unoptimized
            className={styles.bgMark}
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: `${m.scale * 240}px`,
              height: 'auto',
              opacity: m.opacity,
              // @ts-expect-error -- custom property consumed by the CSS module's keyframe
              '--drift': `${m.drift}px`,
              '--rot': `${m.rotate}deg`,
              animationDelay: `${i * -1.7}s`
            }}
          />
        ))}
      </div>

      <div className={styles.dimOverlay} ref={dimRef} />
      {!prefersReducedMotion && <div className={styles.spotlight} ref={spotlightRef} />}

      <div className={styles.stage}>
        <div className={styles.logoGlow} ref={markGlowRef} />
        <div className={styles.markGroup} ref={markGroupRef}>
          <Image ref={markImgRef} src={MARK_SRC} alt={`${BRAND.companyName} logo`} width={240} height={240} unoptimized priority className={styles.markImg} />
        </div>
      </div>

      <div className={styles.caption}>
        <div className={styles.captionTitle}>{BRAND.appName}</div>
        <div className={styles.captionSub}>Intelligent Business Operations</div>
      </div>
    </div>
  );
}
