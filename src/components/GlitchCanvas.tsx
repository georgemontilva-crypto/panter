import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../time";

// Rayas de interferencia como las del arte del logo: líneas cortas de color
// que aparecen y se apagan sobre el negro.
const COLORS = ["255,43,28", "255,43,28", "255,90,60", "40,220,255", "80,255,140", "255,60,220", "255,255,255"];

type Streak = { x: number; y: number; w: number; h: number; color: string; life: number; ttl: number };

export default function GlitchCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = prefersReducedMotion();
    let streaks: Streak[] = [];
    let w = 0;
    let h = 0;
    let visible = true;
    let timer = 0;

    const spawn = (): Streak => {
      const ttl = 4 + Math.floor(Math.random() * 14);
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        w: 14 + Math.random() * Math.random() * 220,
        h: Math.random() < 0.85 ? 1 : 2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: ttl,
        ttl,
      };
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) {
        streaks = Array.from({ length: 46 }, spawn);
        draw();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of streaks) {
        const alpha = still ? 0.35 : 0.55 * Math.sin((s.life / s.ttl) * Math.PI);
        ctx.fillStyle = `rgba(${s.color},${alpha.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    };

    const tick = () => {
      if (!visible) return;
      const target = Math.round((w * h) / 26000);
      for (let i = 0; i < 3 && streaks.length < target; i++) streaks.push(spawn());
      streaks = streaks.filter((s) => --s.life > 0);
      draw();
    };

    resize();
    window.addEventListener("resize", resize);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    if (!still) timer = window.setInterval(tick, 70);

    return () => {
      window.removeEventListener("resize", resize);
      io.disconnect();
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return <canvas ref={ref} className="glitch-canvas" aria-hidden="true" />;
}
