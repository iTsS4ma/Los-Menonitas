import Image from "next/image";
import Link from "next/link";
import Horario from "./Horario";

// Página pública para clientes. El menú está escrito aquí mismo para que SIEMPRE
// se vea, aunque falle la base de datos. Si cambian precios o platillos, se
// actualiza la lista MENU de abajo (además de Admin → Menú).

const PLACE_ID = "ChIJk1p5lqT50YUR2eiYO0ZvVVk";
const COMO_LLEGAR = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Los Menonitas")}&destination_place_id=${PLACE_ID}`;
const DEJAR_RESENA = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
const DIRECCION = "Av. Insurgentes Nte. 1681, Local 6, Tepeyac Insurgentes, Gustavo A. Madero, 07800, CDMX";
const TELEFONO = "55 8537 1956"; // el de Google Maps
// Número de WhatsApp a 10 dígitos (ej. "5585371956"). Mientras esté vacío, el botón no aparece.
const WHATSAPP = "5665063395";
const MENSAJE_WA = "Hola, quiero hacer un pedido para llevar en Los Menonitas";

type Platillo = { nombre: string; precio: string; descripcion?: string };
type Seccion = { nombre: string; platillos: Platillo[]; nota?: string };

const MENU: Seccion[] = [
  { nombre: "Gorditas", platillos: [
    { nombre: "Sencilla", precio: "$25", descripcion: "De chicharrón prensado" },
    { nombre: "Especial", precio: "$45", descripcion: "Con maciza" },
  ] },
  { nombre: "Quesadillas", platillos: [
    { nombre: "Sencilla", precio: "$25", descripcion: "De quesillo" },
    { nombre: "Especial", precio: "$45", descripcion: "Quesillo con maciza" },
  ] },
  { nombre: "Sopes", platillos: [
    { nombre: "Sencillo", precio: "$20", descripcion: "Frijol, crema y queso" },
    { nombre: "Especial", precio: "$45", descripcion: "Sencillo con maciza" },
  ] },
  { nombre: "Tacos", platillos: [
    { nombre: "Taco", precio: "$30", descripcion: "Maciza, cuerito, buche, costilla, surtida o longaniza" },
    { nombre: "Combinado", precio: "$30", descripcion: "Dos ingredientes a elegir" },
  ] },
  { nombre: "Tortas", platillos: [
    { nombre: "Torta", precio: "$50", descripcion: "Maciza, cuerito, buche, costilla o surtida" },
    { nombre: "Combinada", precio: "$50", descripcion: "Dos ingredientes a elegir" },
    { nombre: "De chilaquiles", precio: "$75", descripcion: "Chilaquiles con carnitas" },
  ] },
  { nombre: "Chilaquiles", platillos: [
    { nombre: "Sencillos", precio: "$45", descripcion: "Crema, queso y aguacate" },
    { nombre: "Especiales", precio: "$75", descripcion: "Con maciza" },
  ] },
  { nombre: "Por kilo", platillos: [
    { nombre: "Chamorro", precio: "$120 / pza" },
    { nombre: "Carnitas", precio: "$450 / kg" },
    { nombre: "Chicharrón", precio: "$220 / kg" },
    { nombre: "Longaniza", precio: "$160 / kg" },
  ] },
  { nombre: "Bebidas", platillos: [
    { nombre: "Coca Cola, Sprite, Sidral Mundet, Topo Chico o agua natural", precio: "$30" },
    { nombre: "Café", precio: "$20" },
  ] },
];

// Borde de cuadritos rojos, como el mantel y el menú impreso
const cuadritos = {
  backgroundImage: "conic-gradient(var(--color-paliacate) 25%, #fff 0 50%, var(--color-paliacate) 0 75%, #fff 0)",
  backgroundSize: "14px 14px",
};

export default function Inicio() {
  const wa = WHATSAPP ? `https://wa.me/52${WHATSAPP}?text=${encodeURIComponent(MENSAJE_WA)}` : null;

  return (
    <div className="min-h-screen bg-crema text-cafe">
      <div className="h-3.5 w-full" style={cuadritos} />

      {/* Portada */}
      <header className="mx-auto max-w-5xl px-5 pb-14 pt-10 md:pt-16">
        <div className="flex flex-col items-center gap-8 text-center md:flex-row md:items-end md:text-left">
          <Image src="/logo.png" alt="Los Menonitas" width={220} height={215} priority className="h-auto w-44 md:w-56" />
          <div className="flex-1 space-y-4">
            <Horario />
            <h1 className="font-display text-5xl font-black uppercase leading-[0.9] tracking-tight text-paliacate sm:text-6xl md:text-7xl">
              Los Menonitas
            </h1>
            <p className="font-display text-2xl leading-snug md:text-3xl">
              Carnitas, tacos y antojitos <span className="text-cafe-medio">hechos al momento.</span>
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2 md:justify-start">
              <a href={COMO_LLEGAR} target="_blank" rel="noopener" className="rounded-full bg-paliacate px-6 py-3 font-semibold text-white shadow-sm hover:bg-paliacate-oscuro">
                Cómo llegar
              </a>
              {wa && (
                <a href={wa} target="_blank" rel="noopener" className="rounded-full bg-hoja px-6 py-3 font-semibold text-white shadow-sm hover:opacity-90">
                  Pedir por WhatsApp
                </a>
              )}
              <a href="#menu" className="rounded-full px-4 py-3 font-semibold underline decoration-queso decoration-4 underline-offset-4">
                Ver el menú ↓
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Menú */}
      <section id="menu" className="bg-white/60 py-14">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="mb-2 text-center font-display text-4xl font-black uppercase tracking-wide text-paliacate">Menú</h2>
          <div className="mb-10" />
          <div className="grid gap-6 md:grid-cols-2">
            {MENU.map((sec) => (
              <article key={sec.nombre} className="rounded-sm border-[3px] border-double border-paliacate bg-crema p-5 shadow-[0_1px_0_#e6d5ba]">
                <h3 className="mb-3 text-center font-display text-2xl font-black uppercase tracking-wider text-paliacate">{sec.nombre}</h3>
                <ul className="space-y-2.5">
                  {sec.platillos.map((p) => (
                    <li key={p.nombre}>
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold">{p.nombre}</span>
                        <span className="flex-1 border-b-2 border-dotted border-cafe/30" />
                        <span className="shrink-0 font-display font-bold text-paliacate">{p.precio}</span>
                      </div>
                      {p.descripcion && <p className="text-sm italic text-cafe-medio">{p.descripcion}</p>}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="mt-6 text-center text-sm">
            <strong className="uppercase">Quesillo extra +$10</strong>{" "}
            <span className="text-cafe-medio">en gorditas, sopes, tacos, tortas y chilaquiles</span>
          </p>
        </div>
      </section>

      {/* Visítanos */}
      <section className="mx-auto grid max-w-5xl gap-8 px-5 py-14 md:grid-cols-2">
        <div className="space-y-5">
          <h2 className="font-display text-4xl font-black uppercase tracking-wide text-paliacate">Visítanos</h2>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-cafe-medio">Dirección</h3>
            <p className="text-lg">{DIRECCION}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-cafe-medio">Horario</h3>
            <p className="text-lg">Todos los días, de 9:00 a 18:00</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-cafe-medio">Teléfono</h3>
            <a href={`tel:${TELEFONO.replace(/\s/g, "")}`} className="text-lg font-semibold underline decoration-queso decoration-4 underline-offset-4">
              {TELEFONO}
            </a>
          </div>
          {wa && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-cafe-medio">WhatsApp</h3>
              <a href={wa} target="_blank" rel="noopener" className="text-lg font-semibold underline decoration-hoja decoration-4 underline-offset-4">
                56 6506 3395
              </a>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <a href={COMO_LLEGAR} target="_blank" rel="noopener" className="rounded-full bg-paliacate px-5 py-2.5 font-semibold text-white hover:bg-paliacate-oscuro">
              Cómo llegar
            </a>
            <a href={DEJAR_RESENA} target="_blank" rel="noopener" className="rounded-full border-2 border-cafe px-5 py-2.5 font-semibold hover:bg-cafe hover:text-crema">
              ★ Déjanos tu reseña
            </a>
          </div>
        </div>
        <div className="overflow-hidden rounded-sm border-[3px] border-double border-paliacate bg-white">
          <iframe
            title="Mapa de Los Menonitas"
            src={`https://www.google.com/maps?q=${encodeURIComponent("Los Menonitas, " + DIRECCION)}&output=embed`}
            className="h-80 w-full md:h-full md:min-h-[360px]"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>

      <footer className="border-t border-borde">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-cafe-medio">
          <span>© {new Date().getFullYear()} Los Menonitas · Gustavo A. Madero, CDMX</span>
          <Link href="/login" className="underline-offset-4 hover:underline">
            Acceso personal
          </Link>
        </div>
      </footer>
      <div className="h-3.5 w-full" style={cuadritos} />
    </div>
  );
}
