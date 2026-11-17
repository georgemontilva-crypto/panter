import { useEffect, useRef, useState } from "react";
import { sections } from "../content";

// Riel lateral: una pista de circuito que se enciende con el avance de la página
// y marca en qué sección estás. Solo en pantallas anchas.
export default function Rail() {
  const fill = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState("inicio");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      fill.current?.style.setProperty("--p", p.toFixed(4));

      const probe = window.innerHeight * 0.4;
      let current = sections[0].id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= probe) current = s.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav className="rail" aria-label="Avance de la página">
      <span className="rail__track" aria-hidden="true">
        <span className="rail__fill" ref={fill} />
      </span>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={s.id === active ? "is-active" : undefined}
              aria-current={s.id === active ? "true" : undefined}
            >
              <span className="rail__node" aria-hidden="true" />
              <span className="rail__label">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
