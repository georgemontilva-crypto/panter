import techo from "../assets/techo-nubes.webp";
import zonaPc from "../assets/zona-pc.webp";

// Fotos reales de la arena. Para sumar más, guarda el archivo en src/assets
// e impórtalo aquí igual que estas dos.
export default function Place() {
  return (
    <section className="place" id="lugar" aria-labelledby="lugar-titulo">
      <figure className="place__sky">
        <img src={techo} alt="Techo de nubes iluminado con luces LED azules, verdes y moradas en Arena Panter" loading="lazy" />
        <figcaption className="wrap">
          <h2 id="lugar-titulo">
            Aquí se juega <span>bajo las nubes</span>
          </h2>
        </figcaption>
      </figure>

      <div className="wrap place__grid">
        <div className="place__text">
          <p className="place__lead">
            El techo de la arena es un cielo de nubes que cambia de color toda la noche. Abajo: alfombra roja, sillas
            gamer y luces RGB en cada puesto.
          </p>
          <ul className="place__facts">
            <li>
              <strong>Luces bajas</strong>
              <span>Para que lo único que brille sea tu pantalla y el techo.</span>
            </li>
            <li>
              <strong>Puestos lado a lado</strong>
              <span>Trae a tu escuadra y jueguen juntos, sin chat de voz de por medio.</span>
            </li>
            <li>
              <strong>Torneos y amaneceres</strong>
              <span>Noches enteras de competencia, comida y karaoke.</span>
            </li>
          </ul>
        </div>
        <figure className="place__photo">
          <img src={zonaPc} alt="Jugadora con headset frente a un monitor curvo en la zona de PC de Arena Panter" loading="lazy" />
          <figcaption>Zona de PC, con monitores curvos.</figcaption>
        </figure>
      </div>
    </section>
  );
}
