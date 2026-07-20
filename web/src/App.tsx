import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { Screenshots } from './components/Screenshots';
import { Install } from './components/Install';
import { Footer } from './components/Footer';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Screenshots />
        <Install />
      </main>
      <Footer />
    </>
  );
}
