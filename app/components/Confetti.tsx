"use client";

import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface ConfettiProps {
  active: boolean;
  isMyWin?: boolean;
}

const PARTICLE_COUNT = 10;
const MAX_FRAMES = 36;
const COLORS_WIN = ["#f59e0b", "#fbbf24", "#f97316", "#eab308", "#d97706"];
const COLORS_MY_WIN = ["#0ea5e9", "#38bdf8", "#06b6d4", "#22d3ee", "#67e8f9", "#f59e0b"];

export const Confetti = memo(function Confetti({ active, isMyWin }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const { reducedMotion } = useReducedMotion();

  useEffect(() => {
    if (!active || reducedMotion) return;
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

    const animate = () => {
      if (frame >= MAX_FRAMES) {
        ctx.clearRect(0, 0, width, height);
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

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [active, isMyWin, reducedMotion]);

  if (!active || reducedMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none z-50"
    />
  );
});
