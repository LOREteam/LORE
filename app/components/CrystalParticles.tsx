"use client";

import React, { useEffect, useRef } from "react";

const PARTICLE_COUNT = 35;
const COLORS = [
  "rgba(139, 92, 246, 0.6)",   // violet
  "rgba(167, 139, 250, 0.5)",  // lavender
  "rgba(34, 211, 238, 0.4)",   // cyan
  "rgba(192, 132, 252, 0.3)",  // light purple
  "rgba(99, 102, 241, 0.35)",  // indigo
];

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  opacity: number;
  opacityDir: number;
}

function createParticle(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    size: 1 + Math.random() * 3,
    speedX: (Math.random() - 0.5) * 0.3,
    speedY: -0.15 - Math.random() * 0.3,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.02,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: 0.1 + Math.random() * 0.4,
    opacityDir: Math.random() > 0.5 ? 0.003 : -0.003,
  };
}

export const CrystalParticles = React.memo(function CrystalParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeImmediate = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    const resize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeImmediate, 150);
    };
    resizeImmediate();
    window.addEventListener("resize", resize);

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () =>
      createParticle(canvas.width, canvas.height)
    );

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;

      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotationSpeed;
        p.opacity += p.opacityDir;

        if (p.opacity > 0.5 || p.opacity < 0.05) p.opacityDir *= -1;

        if (p.y < -10 || p.x < -10 || p.x > canvas.width + 10) {
          Object.assign(p, createParticle(canvas.width, canvas.height));
          p.y = canvas.height + 5;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;

        // Diamond/crystal shape
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.6, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.6, 0);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();

        // Inner glow
        ctx.globalAlpha = p.opacity * 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();

        ctx.restore();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  );
});
