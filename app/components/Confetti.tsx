"use client";

import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface ConfettiProps {
  active: boolean;
  isMyWin?: boolean;
  reducedMotion?: boolean;
}

const PARTICLE_COUNT = 10;
const MAX_FRAMES = 36;
const COLORS_WIN = ["#f59e0b", "#fbbf24", "#f97316", "#eab308", "#d97706"];
const COLORS_MY_WIN = ["#0ea5e9", "#38bdf8", "#06b6d4", "#22d3ee", "#67e8f9", "#f59e0b"];

export const Confetti = memo(function Confetti({ active, isMyWin, reducedMotion: reducedMotionOverride }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const motionPreference = useReducedMotion();
  const motionReady = reducedMotionOverride !== undefined || motionPreference.motionReady;
  const reducedMotion = reducedMotionOverride ?? motionPreference.reducedMotion;

  useEffect(() => {
    if (!active || !motionReady || reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const colors = isMyWin ? COLORS_MY_WIN : COLORS_WIN;

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.4,
      vx: (Math.random() - 0.5) * 10,
      vy: -Math.random() * 12 - 4,
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      gravity: 0.25 + Math.random() * 0.1,
      opacity: 1,
    }));

    let frame = 0;
    let isIntersecting = typeof IntersectionObserver === "undefined";

    const animate = () => {
      if (document.hidden || !isIntersecting) {
        animRef.current = 0;
        return;
      }
      if (frame >= MAX_FRAMES) {
        ctx.clearRect(0, 0, width, height);
        animRef.current = 0;
        return;
      }
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.98;
        p.rotation += p.rotSpeed;
        p.opacity = Math.max(0, 1 - frame / MAX_FRAMES);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      frame++;
      animRef.current = requestAnimationFrame(animate);
    };

    const start = () => {
      if (!document.hidden && isIntersecting && animRef.current === 0 && frame < MAX_FRAMES) {
        animRef.current = requestAnimationFrame(animate);
      }
    };
    const stop = () => {
      if (animRef.current !== 0) {
        cancelAnimationFrame(animRef.current);
        animRef.current = 0;
      }
    };
    const syncActivity = () => {
      if (document.hidden || !isIntersecting) stop();
      else start();
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          isIntersecting = entry?.isIntersecting ?? false;
          syncActivity();
        });

    observer?.observe(canvas);
    document.addEventListener("visibilitychange", syncActivity);
    start();

    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncActivity);
    };
  }, [active, isMyWin, motionReady, reducedMotion]);

  if (!active) return null;

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {isMyWin ? "Your winning tile has been revealed." : "The winning tile has been revealed."}
      </span>
      {motionReady && !reducedMotion && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full pointer-events-none z-50"
        />
      )}
    </>
  );
});
