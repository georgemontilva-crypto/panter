import Nav from "./components/Nav";
import Rail from "./components/Rail";
import Hero from "./components/Hero";
import EventSection from "./components/EventSection";
import Stations from "./components/Stations";
import Place from "./components/Place";
import Hours from "./components/Hours";
import Footer from "./components/Footer";
import { useEffect, useState } from "react";
import { loadSchedule } from "./time";

export default function App() {
  // Al llegar el horario vigente del servidor se repinta toda la portada con él.
  const [, setScheduleVersion] = useState(0);
  useEffect(() => {
    void loadSchedule().then(() => setScheduleVersion(1));
  }, []);

  return (
    <>
      <a className="skip" href="#evento">
        Saltar al contenido
      </a>
      <Nav />
      <Rail />
      <main>
        <Hero />
        <EventSection />
        <Stations />
        <Place />
        <Hours />
      </main>
      <Footer />
    </>
  );
}
