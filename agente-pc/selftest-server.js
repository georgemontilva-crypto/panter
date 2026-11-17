// Servidor simulado para la autoprueba del programa de bloqueo (ver runSelfTest en main.js).
// Responde como la web real cuando una PC está libre y bloqueada.
const http = require("node:http");

http
  .createServer((req, res) => {
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        serverTime: Date.now(),
        station: { number: 7, label: "PC 07" },
        state: "bloqueada",
        pairCode: "1234",
        session: null,
        unlockUntil: null,
      }),
    );
  })
  .listen(47811, "127.0.0.1", () => console.log("servidor de autoprueba en http://127.0.0.1:47811"));
