'use client';

import { useEffect, useRef } from 'react';

/**
 * A one-shot celebratory confetti burst on a full-screen, click-through canvas. Zero dependencies
 * (plain canvas), self-cleaning after ~2.6s, and a no-op for users who prefer reduced motion.
 */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();

    const colors = ['#0E8C92', '#13A0A6', '#F76C5E', '#F5A623', '#3FD07A'];
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 3;
    const parts = Array.from({ length: 150 }, () => ({
      x: originX,
      y: originY,
      vx: (Math.random() - 0.5) * 13,
      vy: Math.random() * -13 - 4,
      size: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));

    const DURATION = 2600;
    const start = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const p of parts) {
        p.vy += 0.35; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - elapsed / DURATION);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      ctx.restore();
      if (elapsed < DURATION) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-screen w-screen"
    />
  );
}
