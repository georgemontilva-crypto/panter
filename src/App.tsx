import Nav from "./components/Nav";
import Rail from "./components/Rail";
import Hero from "./components/Hero";
import EventSection from "./components/EventSection";
import Stations from "./components/Stations";
import Place from "./components/Place";
import Hours from "./components/Hours";
import Footer from "./components/Footer";

export default function App() {
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
