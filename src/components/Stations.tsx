import { useRef, useState } from "react";
import { stations, type StationId } from "../content";

// Ilustraciones de línea en el mismo lenguaje del logo: trazos, quiebres a 45° y nodos.
// Cada trazo lleva pathLength=1 para poder "dibujarse" al elegir la estación.
function Art({ id }: { id: StationId }) {
  const common = { pathLength: 1 } as const;
  return (
    <svg className="station-art" viewBox="0 0 480 320" aria-hidden="true">
      <g className="station-art__circuit">
        <path {...common} d="M0 60 H52 L82 90" />
        <path {...common} d="M480 250 H430 L402 222" />
        <path {...common} d="M0 268 H70" />
        <circle cx="84" cy="92" r="5" />
        <circle cx="400" cy="220" r="5" />
        <circle cx="74" cy="268" r="5" />
      </g>
      <g className="station-art__main">
        {id === "pc" && (
          <>
            <path {...common} d="M96 66 Q240 44 384 66 V214 Q240 194 96 214 Z" />
            <path {...common} d="M112 82 Q240 62 368 82 V198 Q240 180 112 198 Z" className="thin" />
            <path {...common} d="M240 205 V240 M196 252 H284" />
            <path {...common} d="M150 270 H302 a8 8 0 0 1 8 8 V292 a8 8 0 0 1 -8 8 H150 a8 8 0 0 1 -8 -8 V278 a8 8 0 0 1 8 -8 Z" />
            <path {...common} d="M160 285 H292" className="thin" />
            <path {...common} d="M346 268 a14 14 0 0 1 14 14 V288 a14 14 0 0 1 -28 0 V282 a14 14 0 0 1 14 -14 Z M346 268 V282" />
            <path {...common} d="M240 108 V122 M240 142 V156 M216 132 H230 M250 132 H264" />
            <circle {...common} cx="240" cy="132" r="17" className="thin" />
          </>
        )}
        {id === "ps5" && (
          <>
            <path
              {...common}
              d="M134 92 Q240 70 346 92 Q392 102 410 196 Q420 252 386 256 Q360 258 336 214 Q328 200 304 200 H176 Q152 200 144 214 Q120 258 94 256 Q60 252 70 196 Q88 102 134 92 Z"
            />
            <path {...common} d="M152 122 V158 M134 140 H170" />
            <circle {...common} cx="328" cy="120" r="8" />
            <circle {...common} cx="328" cy="160" r="8" />
            <circle {...common} cx="308" cy="140" r="8" />
            <circle {...common} cx="348" cy="140" r="8" />
            <circle {...common} cx="204" cy="166" r="17" />
            <circle {...common} cx="276" cy="166" r="17" />
            <path {...common} d="M206 104 H274 L266 128 H214 Z" className="thin" />
          </>
        )}
        {id === "switch" && (
          <>
            <path {...common} d="M138 86 H342 V234 H138 Z" />
            <path {...common} d="M152 100 H328 V220 H152 Z" className="thin" />
            <path {...common} d="M138 86 H110 Q78 86 78 118 V202 Q78 234 110 234 H138" />
            <path {...common} d="M342 86 H370 Q402 86 402 118 V202 Q402 234 370 234 H342" />
            <circle {...common} cx="108" cy="126" r="11" />
            <circle {...common} cx="372" cy="186" r="11" />
            <path {...common} d="M108 164 V196 M92 180 H124" />
            <circle {...common} cx="372" cy="112" r="5" />
            <circle {...common} cx="372" cy="140" r="5" />
            <circle {...common} cx="358" cy="126" r="5" />
            <circle {...common} cx="386" cy="126" r="5" />
            <path {...common} d="M176 204 Q210 120 240 160 T304 116" className="thin" />
            <path {...common} d="M240 100 V220" className="thin dashed" />
          </>
        )}
        {id === "sim" && (
          <>
            <circle {...common} cx="240" cy="152" r="112" />
            <circle {...common} cx="240" cy="152" r="92" className="thin" />
            <path {...common} d="M210 134 H270 L282 152 L270 178 H210 L198 152 Z" />
            <path {...common} d="M150 140 H206 M150 166 H204 M330 140 H274 M330 166 H276" />
            <path {...common} d="M226 178 V242 M254 178 V242" />
            <path {...common} d="M234 42 H246 V60 H234 Z" />
            <circle {...common} cx="240" cy="155" r="9" className="thin" />
            <path {...common} d="M128 282 H352" />
          </>
        )}
      </g>
    </svg>
  );
}

export default function Stations() {
  const [active, setActive] = useState<StationId>("pc");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = stations.find((s) => s.id === active)!;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const index = stations.findIndex((s) => s.id === active);
    let next = index;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % stations.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (index - 1 + stations.length) % stations.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = stations.length - 1;
    else return;
    e.preventDefault();
    const id = stations[next].id;
    setActive(id);
    tabs.current[id]?.focus();
  };

  return (
    <section className="stations" id="estaciones" aria-labelledby="estaciones-titulo">
      <div className="wrap">
        <header className="section-head">
          <h2 id="estaciones-titulo">Elige tu estación</h2>
          <p>Cuatro formas de jugar bajo el mismo techo. Toca una para verla.</p>
        </header>

        <div className="select">
          <div className="select__list" role="tablist" aria-label="Estaciones de juego" onKeyDown={onKeyDown}>
            {stations.map((s) => (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[s.id] = el;
                }}
                role="tab"
                type="button"
                id={`tab-${s.id}`}
                aria-selected={s.id === active}
                aria-controls="station-panel"
                tabIndex={s.id === active ? 0 : -1}
                className={`select__tab${s.id === active ? " is-active" : ""}`}
                onClick={() => setActive(s.id)}
              >
                <span className="select__node" aria-hidden="true" />
                <span className="select__name">{s.name}</span>
              </button>
            ))}
          </div>

          <div className="select__stage" role="tabpanel" id="station-panel" aria-labelledby={`tab-${active}`}>
            <div className="select__art" key={active}>
              <Art id={active} />
            </div>
            <div className="select__info" key={`info-${active}`}>
              <h3>{current.name}</h3>
              <p>{current.text}</p>
              <p className="select__note">{current.note}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
