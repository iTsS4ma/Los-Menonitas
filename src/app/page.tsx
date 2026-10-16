import Image from "next/image";
import Link from "next/link";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import Horario from "./Horario";

// Página pública para clientes. El menú se lee de la base (lo que se edita en
// Admin aparece aquí solo) y se actualiza cada 5 minutos.
export const revalidate = 300;

// Identificador del restaurante en Google (Place ID): abre directo la ruta y el formulario de reseña
const PLACE_ID = "ChIJk1p5lqT50YUR2eiYO0ZvVVk";
const COMO_LLEGAR = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Los Menonitas")}&destination_place_id=${PLACE_ID}`;
const DEJAR_RESENA = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
const DIRECCION = "Av. Insurgentes Nte. 1681, Local 6, Tepeyac Insurgentes, Gustavo A. Madero, 07800, CDMX";
const TELEFONO = "55 8537 1956"; // el de Google Maps
// Número de WhatsApp a 10 dígitos (ej. "5585371956"). Mientras esté vacío, el botón no aparece.
const WHATSAPP = "";
const MENSAJE_WA = "Hola, quiero hacer un pedido para llevar en Los Menonitas";

type Categoria = { id: string; nombre: string; orden: number };
type Producto = {
  id: string;
  categoria_id: string;
  nombre: string;
  precio: number;
  unidad: "PIEZA" | "KG";
  descripcion: string | null;
  disponible: boolean;
  orden: number;
};

async function obtenerMenu() {
  try {
    const db = crearClienteAdmin();
    const [c, p] = await Promise.all([
      db.from("categorias").select("id, nombre, orden").order("orden"),
      db
        .from("productos")
        .select("id, categoria_id, nombre, precio, unidad, descripcion, disponible, orden")
        .eq("activo", true)
        .eq("eliminado", false)
        .order("orden"),
    ]);
    const productos = ((p.data ?? []) as Producto[]).filter((x) => x.nombre !== "Quesillo extra");
    const quesillo = ((p.data ?? []) as Producto[]).find((x) => x.nombre === "Quesillo extra");
    const categorias = ((c.data ?? []) as Categoria[])
      .map((cat) => ({ ...cat, productos: productos.filter((x) => x.categoria_id === cat.id) }))
      .filter((cat) => cat.productos.length > 0);
    return { categorias, quesillo: quesillo ? Number(quesillo.precio) : null };
  } catch {
    return { categorias: [], quesillo: null };
  }
}

const precio = (p: Producto) => `$${Number(p.precio).toFixed(0)}${p.unidad === "KG" ? " / kg" : ""}`;
// Quita la palabra de la categoría para que se lea como en el menú impreso ("Gordita sencilla" → "Sencilla")
const corto = (nombre: string, categoria: string) => {
  const raiz = categoria.toLowerCase().replace(/s$/, "").replace(/es$/, "");
  const limpio = nombre.replace(new RegExp(`^${raiz}s?\\s+`, "i"), "");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

// Borde de cuadritos rojos, como el mantel y el menú impreso
const cuadritos = {
  backgroundImage: "conic-gradient(var(--color-paliacate) 25%, #fff 0 50%, var(--color-paliacate) 0 75%, #fff 0)",
  backgroundSize: "14px 14px",
};

export default async function Inicio() {
  const { categorias, quesillo } = await obtenerMenu();
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
              <a href={`tel:${TELEFONO.replace(/\s/g, "")}`} className="rounded-full border-2 border-cafe px-6 py-3 font-semibold hover:bg-cafe hover:text-crema">
                Llamar {TELEFONO}
              </a>
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
          {categorias.length === 0 ? (
            <p className="text-center text-cafe-medio">El menú no está disponible en este momento.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {categorias.map((cat) => (
                <article key={cat.id} className="rounded-sm border-[3px] border-double border-paliacate bg-crema p-5 shadow-[0_1px_0_#e6d5ba]">
                  <h3 className="mb-3 text-center font-display text-2xl font-black uppercase tracking-wider text-paliacate">{cat.nombre}</h3>
                  <ul className="space-y-2.5">
                    {cat.productos.map((p) => (
                      <li key={p.id} className={p.disponible ? "" : "opacity-50"}>
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold">{corto(p.nombre, cat.nombre)}</span>
                          <span className="flex-1 border-b-2 border-dotted border-cafe/30" />
                          <span className="font-display font-bold text-paliacate">{p.disponible ? precio(p) : "Agotado"}</span>
                        </div>
                        {p.descripcion && <p className="text-sm italic text-cafe-medio">{p.descripcion}</p>}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
          {quesillo && (
            <p className="mt-6 text-center text-sm">
              <strong className="uppercase">Quesillo extra +${quesillo.toFixed(0)}</strong>{" "}
              <span className="text-cafe-medio">en gorditas, sopes, tacos, tortas y chilaquiles</span>
            </p>
          )}
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
