import { useEffect, useState } from "react";
import { PantherMark, Wordmark } from "./Logo";
import { reserveChannel, reserveUrl } from "../content";
import { openStatus, useNow } from "../time";

const links = [
  { href: "#evento", label: "Evento" },
  { href: "#estaciones", label: "Estaciones" },
  { href: "#lugar", label: "El lugar" },
  { href: "#horario", label: "Horario" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const status = openStatus(useNow(30_000));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("no-scroll", menuOpen);
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className={`nav${scrolled ? " nav--solid" : ""}${menuOpen ? " nav--open" : ""}`}>
      <a className="nav__brand" href="#inicio" aria-label="Arena Panter, ir al inicio">
        <PantherMark className="nav__mark" />
        <Wordmark className="nav__wordmark" />
      </a>

      <nav className="nav__links" aria-label="Secciones">
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>

      <div className="nav__side">
        <a className={`status${status.open ? " status--open" : ""}`} href="#horario">
          <span className="status__dot" aria-hidden="true" />
          <span>
            {status.headline}
            <span className="status__detail">. {status.detail}</span>
          </span>
        </a>
        <a
          className="btn btn--small"
          href={reserveUrl("Hola, quiero reservar en Arena Panter.")}
          target="_blank"
          rel="noreferrer"
        >
          Reservar por {reserveChannel}
        </a>
        <button
          className="nav__toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="menu-movil"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="sr-only">{menuOpen ? "Cerrar menú" : "Abrir menú"}</span>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>

      <div className="menu" id="menu-movil" hidden={!menuOpen}>
        <nav aria-label="Secciones (móvil)">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <p className="menu__status">
          {status.headline}. {status.detail}.
        </p>
        <a
          className="btn"
          href={reserveUrl("Hola, quiero reservar en Arena Panter.")}
          target="_blank"
          rel="noreferrer"
        >
          Reservar por {reserveChannel}
        </a>
      </div>
    </header>
  );
}
