// Todo el contenido editable de la web vive en este archivo.
// Cambia textos, horarios, pases o fechas aquí y la página se actualiza sola.

export const sections = [
  { id: "inicio", label: "Inicio" },
  { id: "evento", label: "Evento" },
  { id: "estaciones", label: "Estaciones" },
  { id: "lugar", label: "El lugar" },
  { id: "horario", label: "Horario" },
];

export const site = {
  name: "Arena Panter",
  city: "Maracaibo, Venezuela",
  instagram: "arenapanter",
  instagramUrl: "https://www.instagram.com/arenapanter/",
  // Número de WhatsApp con código de país, sin "+" ni espacios (ej: "584141234567").
  // Si se deja vacío, los botones de reserva abren el chat de Instagram.
  whatsapp: "",
  // Dirección exacta y enlace de Google Maps. Si están vacíos no se muestran.
  address: "",
  mapsUrl: "",
};

export function reserveUrl(message: string): string {
  if (site.whatsapp) {
    return `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;
  }
  return `https://ig.me/m/${site.instagram}`;
}

export const reserveChannel = site.whatsapp ? "WhatsApp" : "Instagram";

// ---------- Horario (hora de Maracaibo) ----------
// Índice 0 = domingo. Minutos desde la medianoche; 1440 = 12:00 am.
export const hours: Record<number, [number, number]> = {
  0: [13 * 60 + 30, 22 * 60], // domingo
  1: [14 * 60 + 30, 22 * 60], // lunes
  2: [14 * 60 + 30, 22 * 60],
  3: [14 * 60 + 30, 22 * 60],
  4: [14 * 60 + 30, 22 * 60], // jueves
  5: [14 * 60 + 30, 24 * 60], // viernes
  6: [13 * 60 + 30, 24 * 60], // sábado
};

export const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ---------- Evento ----------
export type PassTone = "red" | "violet" | "gold";

export const event = {
  name: "Grand Theft Panter 2",
  kind: "Amanecer gamer",
  reason: "por el estreno de GTA 6",
  tagline: "El golpe urbano más épico de Maracaibo.",
  dateLabel: "Sábado 21 de noviembre",
  dateShort: "Sáb 21 nov, 10:00 pm",
  timeLabel: "De 10:00 pm a 6:00 am",
  // Sábado 21 de noviembre de 2026, 10:00 pm en Maracaibo (UTC-4).
  startsAt: Date.parse("2026-11-22T02:00:00Z"),
  endsAt: Date.parse("2026-11-22T10:00:00Z"),
  // offset = horas después de la apertura (la noche dura 8 horas).
  schedule: [
    { offset: 0, time: "10:00 pm", label: "Apertura" },
    { offset: 2, time: "12:00 am", label: "Torneo Mario Kart World" },
    { offset: 3, time: "1:00 am", label: "Torneo EA Sports FC 27" },
    { offset: 4, time: "2:00 am", label: "Torneo Super Smash Bros" },
    { offset: 5, time: "3:00 am", label: "Ramen picante" },
    { offset: 6, time: "4:00 am", label: "Karaoke" },
    { offset: 7, time: "5:00 am", label: "Película" },
    { offset: 8, time: "6:00 am", label: "Despedida" },
  ],
  passes: [
    {
      id: "general",
      name: "General pass",
      price: 15,
      tone: "red" as PassTone,
      perks: ["Acceso al amanecer", "Acceso a torneos", "Actividades especiales"],
    },
    {
      id: "vip",
      name: "VIP pass",
      price: 30,
      tone: "violet" as PassTone,
      perks: [
        "Acceso al amanecer",
        "Acceso a torneos",
        "Actividades especiales",
        "PC exclusiva toda la noche",
        "Comida y bebida",
        "Obsequio",
      ],
    },
    {
      id: "vip-gta",
      name: "VIP GTA pass",
      price: 50,
      tone: "gold" as PassTone,
      perks: [
        "Acceso al amanecer",
        "Acceso a torneos",
        "Actividades especiales",
        "Reserva de PS5 con GTA 6 toda la noche",
        "Comida y bebida",
        "Obsequio",
      ],
    },
  ],
};

// ---------- Estaciones ----------
export type StationId = "pc" | "ps5" | "switch" | "sim";

export const stations: { id: StationId; name: string; short: string; text: string; note: string }[] = [
  {
    id: "pc",
    name: "PC gamer",
    short: "PC",
    text: "Monitor curvo, teclado y mouse RGB y headset en cada puesto. Siéntate, ponte los audífonos y entra a la partida con tu escuadra al lado.",
    note: "En el pase VIP del 21, la PC es tuya toda la noche.",
  },
  {
    id: "ps5",
    name: "PlayStation 5",
    short: "PS5",
    text: "Control en mano y los estrenos en pantalla. GTA 6 se juega aquí desde el Amanecer gamer del 21 de noviembre.",
    note: "El pase VIP GTA reserva una PS5 con GTA 6 para ti.",
  },
  {
    id: "switch",
    name: "Nintendo Switch",
    short: "Switch",
    text: "La estación para jugar en grupo y gritar un poco. Mario Kart World y Super Smash Bros tienen torneo en el Amanecer gamer.",
    note: "Torneos a las 12:00 am y a las 2:00 am.",
  },
  {
    id: "sim",
    name: "Simuladores de carreras",
    short: "Simuladores",
    text: "Volante, pedales y asiento de carreras. Lo más cerca que vas a estar de la pista sin salir de Maracaibo.",
    note: "Reta a un pana y que gane el mejor tiempo.",
  },
];
