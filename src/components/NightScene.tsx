// Escena del Amanecer gamer: el puente sobre el lago y unas palmeras en silueta.
// Dibujo propio, generado con código para poder ajustarlo sin editar un SVG a mano.

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function palm(x: number, base: number, height: number, lean: number, size: number): string[] {
  const tx = x + lean;
  const ty = base - height;
  const mx = x + lean * 0.15;
  const my = base - height * 0.5;
  const trunk = `M${x - 5} ${base} Q${mx - 4} ${my} ${tx - 2} ${ty} L${tx + 3} ${ty} Q${mx + 6} ${my} ${x + 6} ${base} Z`;
  const fronds = [-172, -148, -118, -88, -58, -30, -6].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const len = size * (0.82 + ((i * 37) % 10) / 28);
    const tipX = tx + Math.cos(a) * len;
    const tipY = ty + Math.sin(a) * len + len * 0.42;
    const cX = tx + Math.cos(a) * len * 0.55;
    const cY = ty + Math.sin(a) * len * 0.55 - len * 0.28;
    return `M${tx} ${ty} Q${cX.toFixed(1)} ${cY.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q${cX.toFixed(1)} ${(cY + len * 0.24).toFixed(1)} ${tx} ${(ty + 5).toFixed(1)} Z`;
  });
  return [trunk, ...fronds];
}

const DECK = 150;
const WATER = 194;
const TOWERS = [330, 560, 790, 1020, 1250];

export default function NightScene() {
  const rand = rng(21);
  const stars = Array.from({ length: 90 }, () => ({
    x: rand() * 1150,
    y: rand() * 120,
    r: 0.5 + rand() * 1.1,
    o: 0.25 + rand() * 0.75,
  }));
  const palms = [
    ...palm(70, 222, 150, 26, 62),
    ...palm(150, 224, 104, -18, 48),
    ...palm(1510, 222, 132, -24, 58),
    ...palm(1440, 224, 86, 14, 42),
  ];
  const piers: number[] = [];
  for (let x = 100; x < 1600; x += 115) piers.push(x);

  return (
    <svg className="night__scene" viewBox="0 0 1600 222" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.55" stopColor="#ffb347" />
          <stop offset="1" stopColor="#ff5e3a" />
        </radialGradient>
        <linearGradient id="starfade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.6" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="starmask">
          <rect width="1150" height="130" fill="url(#starfade)" />
        </mask>
      </defs>

      <g mask="url(#starmask)" fill="#fff">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(2)} opacity={s.o.toFixed(2)} />
        ))}
      </g>

      {/* Sol saliendo sobre el lago, al final de la noche */}
      <circle cx="1392" cy={WATER - 4} r="120" fill="#ff8a3d" opacity="0.18" />
      <circle cx="1392" cy={WATER - 4} r="58" fill="url(#sun)" />

      <g className="night__silhouette">
        {/* Tirantes y torres del puente */}
        <g fill="none" strokeLinecap="round">
          {TOWERS.map((x) => (
            <g key={x}>
              <path d={`M${x - 17} ${WATER} L${x} ${DECK - 84} L${x + 17} ${WATER}`} strokeWidth="5.5" />
              <path d={`M${x - 8} ${DECK - 42} H${x + 8}`} strokeWidth="4" />
              <path
                d={`M${x} ${DECK - 80} L${x - 92} ${DECK} M${x} ${DECK - 80} L${x - 52} ${DECK} M${x} ${DECK - 80} L${x + 52} ${DECK} M${x} ${DECK - 80} L${x + 92} ${DECK}`}
                strokeWidth="1.4"
              />
            </g>
          ))}
          {piers.map((x) => (
            <path key={x} d={`M${x - 9} ${DECK} L${x} ${WATER} L${x + 9} ${DECK}`} strokeWidth="3.5" />
          ))}
        </g>
        <rect x="0" y={DECK - 3} width="1600" height="7" />
        <rect x="0" y={WATER} width="1600" height="30" />
        {palms.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* Reflejos en el agua */}
      <g className="night__glints" strokeLinecap="round">
        <path d="M1300 203 H1486 M1338 211 H1452 M1366 218 H1424" />
      </g>
    </svg>
  );
}
