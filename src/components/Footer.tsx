import { PantherMark, Wordmark } from "./Logo";
import { site } from "../content";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__brand">
          <PantherMark className="footer__mark" />
          <Wordmark className="footer__wordmark" title="Panter" />
        </div>
        <div className="footer__row">
          <p>
            {site.name}. {site.city}.
          </p>
          <nav aria-label="Enlaces del pie">
            <a href="#evento">Evento</a>
            <a href="#estaciones">Estaciones</a>
            <a href="#horario">Horario</a>
            <a href={site.instagramUrl} target="_blank" rel="noreferrer">
              Instagram
            </a>
          </nav>
        </div>
        <p className="footer__legal">
          Grand Theft Panter es un evento de fans organizado por {site.name}. Grand Theft Auto, PlayStation, Nintendo
          Switch, Mario Kart, Super Smash Bros y EA Sports FC son marcas de sus respectivos dueños; {site.name} no está
          afiliada a ellos.
        </p>
      </div>
    </footer>
  );
}
