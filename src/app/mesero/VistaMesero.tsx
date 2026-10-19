"use client";

import { generarUUID } from "@/lib/formato";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Conexion from "@/components/Conexion";
import { NOMBRE_ESTACION } from "@/lib/comandas";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { cantidadTexto, dinero, errorTexto, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Perfil } from "@/lib/perfil";
import type { Categoria, Cuenta, Mesa, Opcion, Producto, Pedido, DetallePedido } from "@/lib/tipos";

type Linea = {
  clave: string;
  producto: Producto;
  opcion: Opcion | null;
  cantidad?: number;
  monto?: number;
  quesillo: boolean;
  sinCebolla: boolean;
  sinCilantro: boolean;
  plato: number;
  notas: string;
};

// Cuenta que todavía no existe en la base: se crea al mandar la primera ronda
type Borrador = { tipo: "MESA"; mesa: Mesa } | { tipo: "PARA_LLEVAR"; nombre: string };
type Destino = { cuentaId: string } | Borrador;

export default function VistaMesero({ perfil, cuentaInicial = null }: { perfil: Perfil; cuentaInicial?: string | null }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [pestana, setPestana] = useState<"MESAS" | "LLEVAR">("MESAS");
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial);
  const [capturando, setCapturando] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [aviso, setAviso] = useState("");
  const [solicitandoCuenta, setSolicitandoCuenta] = useState(false);

  const [info, setInfo] = useState("");

  const cargar = useCallback(async () => {
    const [m, c, cat, p, o] = await Promise.all([
      supabase.from("mesas").select("*").eq("activa", true).order("numero"),
      supabase
        .from("cuentas")
        .select("*, mesas(numero), pedidos(*, detalle_pedido(*), comandas(*))")
        .in("estado", ["ABIERTA", "CUENTA_SOLICITADA"])
        .order("abierta_en"),
      supabase.from("categorias").select("*").order("orden"),
      supabase.from("productos").select("*").eq("activo", true).order("orden"),
      supabase.from("opciones_producto").select("*").eq("activo", true).order("nombre"),
    ]);
    const error = m.error || c.error || cat.error || p.error || o.error;
    if (error) return setAviso(errorTexto(error));
    setMesas((m.data as Mesa[]) || []);
    setCuentas((c.data as Cuenta[]) || []);
    setCategorias((cat.data as Categoria[]) || []);
    setProductos((p.data as Producto[]) || []);
    setOpciones((o.data as Opcion[]) || []);
  }, [supabase]);

  const conectado = useTiempoReal("mesero", ["cuentas", "pedidos", "detalle_pedido", "comandas"], cargar);

  // Aviso (vibración) cuando cocina termina una ronda
  const listasVistas = useRef<Set<string> | null>(null);
  useEffect(() => {
    const listas = new Set(cuentas.flatMap((c) => (c.pedidos || []).filter((p) => p.estado === "LISTO").map((p) => p.id)));
    if (listasVistas.current && [...listas].some((id) => !listasVistas.current!.has(id))) {
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {}
    }
    listasVistas.current = listas;
  }, [cuentas]);

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? null;

  // La comanda la imprime la estación de cocina; aquí solo se pide que la vuelva a imprimir
  async function reimprimirRonda(pedidoId: string) {
    setInfo("");
    const ok = await ejecutar(() => supabase.rpc("reimprimir_ronda", { p_pedido: pedidoId }));
    if (ok) setInfo("Se mandó a reimprimir en cocina.");
  }

  async function marcarEntregada(pedidoId: string) {
    await ejecutar(() => supabase.from("pedidos").update({ estado: "ENTREGADO" }).eq("id", pedidoId));
  }

  async function ejecutar(accion: () => PromiseLike<{ error: unknown }>) {
    setAviso("");
    const { error } = await accion();
    if (error) setAviso(errorTexto(error));
    await cargar();
    return !error;
  }

  // La cuenta NO se crea aquí: se crea cuando el mesero manda la primera ronda.
  // Si se arrepiente antes de mandar, no queda nada registrado.
  function abrirMesa(mesa: Mesa) {
    setAviso("");
    const existente = cuentas.find((c) => c.mesa_id === mesa.id);
    if (existente) return setCuentaId(existente.id);
    setBorrador({ tipo: "MESA", mesa });
  }

  function nuevaParaLlevar() {
    setAviso("");
    const nombre = window.prompt("Nombre del cliente (opcional)");
    if (nombre === null) return; // tocó Cancelar
    setBorrador({ tipo: "PARA_LLEVAR", nombre: nombre.trim() });
  }

  // Cancelar un producto: la estación de cocina imprime el aviso sola
  async function cancelarItemIndividual(d: DetallePedido) {
    const motivo = window.prompt("Motivo de la cancelación para cocina:");
    if (!motivo || !motivo.trim()) return;
    await ejecutar(() =>
      supabase.from("detalle_pedido").update({ estado: "CANCELADO", motivo_cancelacion: motivo.trim() }).eq("id", d.id)
    );
  }

  // Cancelar toda una ronda (también avisa a cocina sola)
  async function cancelarRondaCompleta(p: Pedido) {
    if (!window.confirm("¿Seguro que deseas cancelar toda esta ronda en cocina?")) return;
    const motivo = window.prompt("Motivo de la cancelación de la ronda:");
    if (!motivo || !motivo.trim()) return;
    await ejecutar(() => supabase.from("pedidos").update({ estado: "CANCELADO", motivo_cancelacion: motivo.trim() }).eq("id", p.id));
  }

  // Cocina ya no marca rondas como listas: la cuenta se puede pedir en cualquier momento
  async function pedirCuentaSegura() {
    if (!cuenta) return;
    setSolicitandoCuenta(true);
    setAviso("");
    const { error } = await supabase.from("cuentas").update({ estado: "CUENTA_SOLICITADA" }).eq("id", cuenta.id);
    setSolicitandoCuenta(false);
    if (error) setAviso(errorTexto(error));
    await cargar();
  }

  // ---------- Vista: captura de una cuenta nueva (todavía sin crear) ----------
  if (borrador) {
    return (
      <Captura
        titulo={
          borrador.tipo === "MESA"
            ? `Mesa ${borrador.mesa.numero}`
            : `Para llevar${borrador.nombre ? ` · ${borrador.nombre}` : ""}`
        }
        destino={borrador}
        categorias={categorias}
        productos={productos}
        opciones={opciones}
        onCancelar={() => setBorrador(null)}
        onEnviado={async (pedidoId, nuevaCuentaId) => {
          setBorrador(null);
          await cargar();
          setCuentaId(nuevaCuentaId);
        }}
      />
    );
  }

  // ---------- Vista: captura de productos ----------
  if (cuenta && capturando) {
    return (
      <Captura
        titulo={nombreCuenta(cuenta)}
        destino={{ cuentaId: cuenta.id }}
        categorias={categorias}
        productos={productos}
        opciones={opciones}
        onCancelar={() => setCapturando(false)}
        onEnviado={async () => {
          setCapturando(false);
          await cargar();
        }}
      />
    );
  }

  // ---------- Vista: detalle de una cuenta ----------
  if (cuenta) {
    const total = totalCuenta(cuenta.pedidos);
    const rondas = [...(cuenta.pedidos || [])].sort((a, b) => a.numero_ronda - b.numero_ronda);

    const puedePedirCuenta = cuenta.estado === "ABIERTA" && total > 0 && !solicitandoCuenta;

    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-3 pb-8 pt-3">
        <Conexion conectado={conectado} />
        <button
          onClick={() => setCuentaId(null)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-cafe bg-white py-3.5 text-base font-semibold active:scale-[0.99] active:bg-crema-oscuro"
        >
          <span aria-hidden className="text-xl leading-none">‹</span> Regresar a las mesas
        </button>

        {total === 0 && (
          <div className="rounded-2xl border-2 border-queso bg-queso-claro px-4 py-3 text-sm">
            <strong>Esta cuenta quedó en $0.</strong> Agrega productos o pide a caja que la cancele.
          </div>
        )}

        <div className="flex items-end justify-between rounded-2xl border border-borde bg-white px-4 py-4">
          <div>
            <h2 className="font-display text-3xl font-extrabold leading-none">{nombreCuenta(cuenta)}</h2>
            <p className="mt-1 text-sm text-cafe-medio">
              {rondas.length} {rondas.length === 1 ? "ronda" : "rondas"}
            </p>
          </div>
          <span className="font-display text-3xl font-bold">{dinero(total)}</span>
        </div>

        {cuenta.estado === "CUENTA_SOLICITADA" && (
          <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm font-medium text-cafe">
            Cuenta solicitada a caja. Si piden algo más, se reabre automáticamente.
          </p>
        )}
        {aviso && (
          <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{aviso}</p>
        )}
        {info && <p className="rounded-xl bg-hoja-claro px-3 py-2.5 text-sm font-medium text-hoja">{info}</p>}

        {rondas.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-8 text-center text-cafe-medio">
            Sin productos todavía. Toca <strong>Agregar productos</strong> para empezar.
          </p>
        )}

        {rondas.map((p) => {
          const estadoNorm = String(p.estado || "").toUpperCase().trim();
          return (
            <section
              key={p.id}
              className="rounded-2xl border border-borde bg-white p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <strong className="font-display text-lg">Ronda {p.numero_ronda}</strong>
                  {estadoNorm !== "CANCELADO" && (p.comandas || []).some((c) => c.tipo === "PEDIDO") && (
                    <button
                      onClick={() => reimprimirRonda(p.id)}
                      className="rounded-lg border border-borde px-2 py-1 text-xs font-semibold text-cafe-medio hover:border-cafe-medio"
                    >
                      Reimprimir
                    </button>
                  )}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    estadoNorm === "CANCELADO"
                      ? "bg-paliacate-claro text-paliacate-oscuro"
                      : estadoNorm === "LISTO"
                      ? "bg-hoja text-white"
                      : "bg-crema-oscuro text-cafe-medio"
                  }`}
                >
                  {estadoNorm === "CANCELADO" ? "Cancelada" : estadoNorm === "LISTO" ? "¡Lista!" : estadoNorm === "ENTREGADO" ? "Entregada" : "En cocina"}
                </span>
              </div>
              {estadoNorm !== "CANCELADO" && estadoNorm !== "ENTREGADO" && (p.comandas || []).some((c) => c.tipo === "PEDIDO") && (
                <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                  {(p.comandas || [])
                    .filter((c) => c.tipo === "PEDIDO")
                    .map((c) => (
                      <span
                        key={c.id}
                        className={`rounded-full px-2.5 py-1 font-semibold ${
                          !c.impresa_en ? "bg-paliacate-claro text-paliacate-oscuro" : c.lista_en ? "bg-hoja-claro text-hoja" : "bg-crema-oscuro text-cafe-medio"
                        }`}
                      >
                        {NOMBRE_ESTACION[c.estacion]}: {!c.impresa_en ? "sin imprimir" : c.lista_en ? "lista ✓" : "preparando"}
                      </span>
                    ))}
                </div>
              )}
              {estadoNorm === "LISTO" && (
                <button
                  onClick={() => marcarEntregada(p.id)}
                  className="mb-3 w-full rounded-xl bg-hoja py-3 font-bold text-white active:scale-[0.99]"
                >
                  Ya la llevé a la mesa
                </button>
              )}
              <ul className="space-y-2">
                {(p.detalle_pedido || []).map((d) => {
                  const tachado = d.estado === "CANCELADO" || estadoNorm === "CANCELADO";
                  return (
                    <li key={d.id} className={`flex items-start justify-between gap-3 ${tachado ? "text-cafe/40 line-through" : ""}`}>
                      <span className="min-w-0">
                        <span className="font-semibold">{cantidadTexto(d)}</span> {d.nombre_producto}
                        {d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}
                        {(d.plato ?? 1) > 1 || (p.detalle_pedido || []).some((x) => (x.plato ?? 1) > 1) ? (
                          <span className="ml-1.5 rounded bg-crema-oscuro px-1.5 text-xs font-bold text-cafe-medio">Persona {d.plato ?? 1}</span>
                        ) : null}
                        {d.con_quesillo && <span className="block text-xs font-semibold text-cafe">+ quesillo</span>}
                        {(d.sin_cebolla || d.sin_cilantro) && (
                          <span className="block text-xs font-semibold text-cafe">
                            {[d.sin_cebolla && "sin cebolla", d.sin_cilantro && "sin cilantro"].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        {d.notas ? <em className="block text-xs text-cafe-medio">{d.notas}</em> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums">{dinero(d.importe)}</span>
                        {d.estado === "ACTIVO" &&
                          estadoNorm !== "CANCELADO" &&
                          estadoNorm !== "ENTREGADO" && (
                            <button
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-paliacate hover:bg-paliacate-claro"
                              onClick={() => cancelarItemIndividual(d)}
                            >
                              Quitar
                            </button>
                          )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {estadoNorm !== "CANCELADO" && estadoNorm !== "ENTREGADO" && (
                <div className="mt-4 flex justify-end">
                  <button
                    className="rounded-xl border border-paliacate/40 px-4 py-2.5 text-sm font-semibold text-paliacate hover:bg-paliacate-claro"
                    onClick={() => cancelarRondaCompleta(p)}
                  >
                    Cancelar ronda
                  </button>
                </div>
              )}
            </section>
          );
        })}

        <div className="grid gap-3 pt-2">
          <button
            className="rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro active:scale-[0.99]"
            onClick={() => setCapturando(true)}
          >
            Agregar productos
          </button>

          {cuenta.estado === "ABIERTA" && total > 0 && (
            <div>
              <button
                disabled={!puedePedirCuenta}
                className={`w-full rounded-xl py-3.5 font-semibold transition-colors ${
                  puedePedirCuenta
                    ? "bg-cafe text-crema hover:bg-cafe/90"
                    : "cursor-not-allowed bg-crema-oscuro text-cafe/50"
                }`}
                onClick={pedirCuentaSegura}
              >
                {solicitandoCuenta ? "Enviando…" : "Pedir la cuenta"}
              </button>
            </div>
          )}

          {(perfil.puede_cobrar || perfil.rol === "ADMIN") && total > 0 && (
            <Link
              href={`/caja?cuenta=${cuenta.id}`}
              className="rounded-xl border-2 border-cafe py-3 text-center font-semibold hover:bg-crema-oscuro"
            >
              Cobrar
            </Link>
          )}

        </div>

      </main>
    );
  }

  // ---------- Vista: lista de mesas / para llevar ----------
  const paraLlevar = cuentas.filter((c) => c.tipo === "PARA_LLEVAR");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-8 pt-3">
      <Conexion conectado={conectado} />
      {aviso && (
        <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{aviso}</p>
      )}


      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-crema-oscuro p-1">
        {(["MESAS", "LLEVAR"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`rounded-xl py-3 font-semibold transition-colors ${
              pestana === p ? "bg-white text-cafe shadow-sm" : "text-cafe-medio"
            }`}
          >
            {p === "MESAS" ? "Mesas" : `Para llevar (${paraLlevar.length})`}
          </button>
        ))}
      </div>

      {pestana === "MESAS" ? (
        mesas.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-8 text-center text-cafe-medio">
            No hay mesas. Dalas de alta en Admin → Mesas.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {mesas.map((m) => {
                const c = cuentas.find((x) => x.mesa_id === m.id);
                const pidioCuenta = c?.estado === "CUENTA_SOLICITADA";
                const lista = (c?.pedidos || []).some((p) => p.estado === "LISTO");
                const estilo = lista
                  ? "border-hoja bg-hoja-claro text-cafe"
                  : pidioCuenta
                  ? "border-paliacate bg-paliacate-claro text-cafe"
                  : c
                  ? "border-cafe bg-white text-cafe"
                  : "border-borde bg-white/60 text-cafe/50";
                return (
                  <button
                    key={m.id}
                    onClick={() => abrirMesa(m)}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 transition-transform active:scale-95 ${estilo}`}
                  >
                    {lista && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-hoja px-2 py-0.5 text-[11px] font-extrabold text-white">
                        ¡LISTA!
                      </span>
                    )}
                    <span className="font-display text-4xl font-extrabold leading-none">{m.numero}</span>
                    <span className="mt-1.5 text-xs font-semibold">
                      {c ? (pidioCuenta ? "Cuenta" : totalCuenta(c.pedidos) === 0 ? "En $0" : dinero(totalCuenta(c.pedidos))) : "Libre"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-cafe-medio">
              <Leyenda color="bg-white border-2 border-borde" texto="Libre" />
              <Leyenda color="bg-white border-2 border-cafe" texto="Abierta" />
              <Leyenda color="bg-paliacate" texto="Pidió cuenta" />
              <Leyenda color="bg-hoja" texto="Comida lista para llevar" />
            </div>
          </>
        )
      ) : (
        <div className="space-y-3">
          <button
            onClick={nuevaParaLlevar}
            className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro"
          >
            Nueva orden para llevar
          </button>
          {paraLlevar.length === 0 && (
            <p className="py-6 text-center text-sm text-cafe-medio">No hay órdenes para llevar abiertas.</p>
          )}
          {paraLlevar.map((c) => {
            return (
              <button
                key={c.id}
                onClick={() => setCuentaId(c.id)}
                className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-4 text-left ${
                  c.estado === "CUENTA_SOLICITADA" ? "border-paliacate bg-paliacate-claro" : "border-borde bg-white"
                }`}
              >
                <span className="font-display text-lg font-bold">
                  {nombreCuenta(c)}
                  {(c.pedidos || []).some((p) => p.estado === "LISTO") && (
                    <span className="ml-2 rounded-full bg-hoja px-2 py-0.5 align-middle text-xs font-extrabold text-white">¡LISTA!</span>
                  )}
                </span>
                <span className="font-semibold">{c.estado === "CUENTA_SOLICITADA" ? "Cuenta" : dinero(totalCuenta(c.pedidos))}</span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${color}`} />
      {texto}
    </span>
  );
}

// =====================================================================
// Captura de productos para una ronda
// =====================================================================
function Captura({
  titulo,
  destino,
  categorias,
  productos,
  opciones,
  onCancelar,
  onEnviado,
}: {
  titulo: string;
  destino: Destino;
  categorias: Categoria[];
  productos: Producto[];
  opciones: Opcion[];
  onCancelar: () => void;
  onEnviado: (pedidoId: string | null, cuentaId: string) => void;
}) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [catId, setCatId] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [eligiendo, setEligiendo] = useState<Producto | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Plato al que se agrega lo que se toque (para que cocina sepa qué va en cada plato)
  const [plato, setPlato] = useState(1);
  const [numPlatos, setNumPlatos] = useState(1);
  const [error, setError] = useState("");

  // El quesillo se pregunta en cada platillo: no se muestra como producto suelto
  const productosVisibles = productos.filter((p) => p.nombre !== "Quesillo extra");
  const categoriasVisibles = categorias.filter((c) => productosVisibles.some((p) => p.categoria_id === c.id));
  const categoriaActiva = catId ?? categoriasVisibles[0]?.id ?? null;

  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (lineas.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [lineas.length]);

  // Mismo producto, opción, extras y plato (sin nota) = se suma a la misma línea
  const mismaLinea = (a: Omit<Linea, "clave" | "notas">, b: Linea) =>
    b.producto.id === a.producto.id &&
    b.opcion?.id === a.opcion?.id &&
    b.quesillo === a.quesillo &&
    b.sinCebolla === a.sinCebolla &&
    b.sinCilantro === a.sinCilantro &&
    b.plato === a.plato &&
    !b.notas;

  function agregar(l: { producto: Producto; opcion: Opcion | null; cantidad?: number; monto?: number }) {
    const nueva = { ...l, quesillo: false, sinCebolla: false, sinCilantro: false, plato };
    setLineas((prev) => {
      if (l.producto.unidad === "PIEZA") {
        const i = prev.findIndex((x) => mismaLinea(nueva, x));
        if (i >= 0) return prev.map((x, j) => (j === i ? { ...x, cantidad: (x.cantidad ?? 0) + 1 } : x));
      }
      return [...prev, { ...nueva, notas: "", clave: generarUUID() }];
    });
  }

  function cambiarLinea(clave: string, cambios: Partial<Linea>) {
    setLineas((prev) => prev.map((x) => (x.clave === clave ? { ...x, ...cambios } : x)));
  }

  // Separa una pieza en su propia línea (para ponerle otros extras u otro plato)
  function separarUna(l: Linea) {
    setLineas((prev) =>
      prev.flatMap((x) =>
        x.clave !== l.clave ? [x] : [{ ...x, cantidad: (x.cantidad ?? 1) - 1 }, { ...x, cantidad: 1, notas: "", clave: generarUUID() }]
      )
    );
  }

  function tocarProducto(p: Producto) {
    if (!p.disponible) return;
    if (p.requiere_opcion || p.unidad === "KG") return setEligiendo(p);
    agregar({ producto: p, opcion: null, cantidad: 1 });
  }

  // Precio del quesillo: el del producto "Quesillo extra" (editable en Admin)
  const precioQuesillo = Number(productos.find((p) => p.nombre === "Quesillo extra")?.precio ?? 10);
  const importeLinea = (l: Linea) =>
    l.monto ??
    Math.round((l.cantidad ?? 0) * (Number(l.producto.precio) + (l.quesillo ? precioQuesillo : 0)) * 100) / 100;
  const total = lineas.reduce((s, l) => s + importeLinea(l), 0);

  // Cuántas piezas de cada producto van en la ronda (para mostrarlo sobre el botón)
  const enRonda = (id: string) =>
    lineas.filter((l) => l.producto.id === id).reduce((s, l) => s + (l.producto.unidad === "PIEZA" ? l.cantidad ?? 0 : 1), 0);

  async function enviar() {
    setEnviando(true);
    setError("");
    const items = lineas.map((l) => ({
      producto_id: l.producto.id,
      opcion_id: l.opcion?.id ?? null,
      ...(l.monto !== undefined ? { monto: l.monto } : { cantidad: l.cantidad }),
      quesillo: l.quesillo,
      sin_cebolla: l.sinCebolla,
      sin_cilantro: l.sinCilantro,
      plato: l.plato,
      notas: l.notas || null,
    }));
    let pedidoId: string | null = null;
    let cuentaId: string;
    if ("cuentaId" in destino) {
      const { data, error } = await supabase.rpc("enviar_pedido", { p_cuenta_id: destino.cuentaId, p_items: items });
      if (error) {
        setEnviando(false);
        return setError(errorTexto(error));
      }
      pedidoId = (data as string) ?? null;
      cuentaId = destino.cuentaId;
    } else {
      // Primera ronda: la base crea la cuenta y la ronda juntas (o ninguna, si algo falla)
      const { data, error } = await supabase.rpc("abrir_cuenta_y_enviar", {
        p_tipo: destino.tipo,
        p_mesa_id: destino.tipo === "MESA" ? destino.mesa.id : null,
        p_nombre: destino.tipo === "PARA_LLEVAR" ? destino.nombre : null,
        p_items: items,
      });
      if (error) {
        setEnviando(false);
        return setError(errorTexto(error));
      }
      const r = data as { cuenta_id: string; pedido_id: string };
      pedidoId = r.pedido_id;
      cuentaId = r.cuenta_id;
    }
    setEnviando(false);
    setLineas([]);
    onEnviado(pedidoId, cuentaId);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 pt-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => (!lineas.length || window.confirm("¿Descartar esta ronda?")) && onCancelar()}
          className="rounded-full px-2 py-1 text-sm font-semibold text-cafe-medio hover:bg-crema-oscuro"
        >
          ‹ Cancelar
        </button>
        <strong className="font-display text-xl">{titulo}</strong>
      </div>

      <div className="sticky top-0 z-[5] -mx-3 mb-3 flex gap-2 overflow-x-auto bg-crema px-3 py-2">
        {categoriasVisibles.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatId(c.id)}
            className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              categoriaActiva === c.id ? "bg-cafe text-crema" : "border border-borde bg-white text-cafe"
            }`}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-2xl border border-borde bg-white px-3 py-2">
        <span className="shrink-0 text-sm font-semibold text-cafe-medio">Agregar a:</span>
        {Array.from({ length: numPlatos }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setPlato(n)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${plato === n ? "bg-paliacate text-white" : "border border-borde bg-crema/50"}`}
          >
            Persona {n}
          </button>
        ))}
        <button
          onClick={() => {
            setNumPlatos(numPlatos + 1);
            setPlato(numPlatos + 1);
          }}
          className="shrink-0 rounded-full border-2 border-dashed border-cafe-medio px-3 py-1.5 text-sm font-semibold"
        >
          + Persona
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {productosVisibles
          .filter((p) => p.categoria_id === categoriaActiva)
          .map((p) => {
            const n = enRonda(p.id);
            return (
              <button
                key={p.id}
                onClick={() => tocarProducto(p)}
                disabled={!p.disponible}
                className={`relative min-h-[84px] rounded-2xl border-2 bg-white p-3 text-left transition-transform active:scale-[0.97] disabled:opacity-40 ${
                  n > 0 ? "border-paliacate" : "border-borde"
                }`}
              >
                {n > 0 && (
                  <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-paliacate px-1.5 text-xs font-bold text-white">
                    {n}
                  </span>
                )}
                <span className="block pr-6 font-semibold leading-snug">{p.nombre}</span>
                {p.descripcion && <span className="mt-0.5 block text-xs leading-snug text-cafe-medio">{p.descripcion}</span>}
                <span className="mt-1 block text-sm text-cafe-medio">
                  {p.disponible ? `${dinero(p.precio)}${p.unidad === "KG" ? " / kg" : ""}` : "Agotado"}
                </span>
              </button>
            );
          })}
      </div>

      <section className="mt-5 flex-1 space-y-2 pb-4">
        <h3 className="font-display text-lg font-bold">Esta ronda</h3>
        {lineas.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-6 text-center text-sm text-cafe-medio">
            Toca un producto para agregarlo.
          </p>
        )}
        {Array.from(new Set(lineas.map((l) => l.plato)))
          .sort((a, b) => a - b)
          .map((n) => (
            <div key={n} className="space-y-2">
              {numPlatos > 1 && <p className="pt-1 text-xs font-extrabold uppercase tracking-wider text-cafe-medio">Persona {n}</p>}
              {lineas
                .filter((l) => l.plato === n)
                .map((l) => (
                  <div key={l.clave} className="rounded-2xl border border-borde bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-semibold">
                          {l.producto.nombre}
                          {l.opcion ? ` (${l.opcion.nombre})` : ""}
                        </span>
                        <span className="block text-xs text-cafe-medio">
                          {l.producto.unidad === "KG"
                            ? l.monto !== undefined
                              ? `${dinero(l.monto)} de producto (≈ ${(l.monto / Number(l.producto.precio)).toFixed(3)} kg)`
                              : `${(l.cantidad ?? 0).toFixed(3)} kg`
                            : `${l.cantidad} pz`}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {l.producto.unidad === "PIEZA" && (
                          <>
                            <button
                              aria-label="Quitar uno"
                              className="h-10 w-10 rounded-xl border border-borde text-xl font-semibold"
                              onClick={() =>
                                setLineas((prev) =>
                                  prev.flatMap((x) =>
                                    x.clave !== l.clave ? [x] : (x.cantidad ?? 1) > 1 ? [{ ...x, cantidad: (x.cantidad ?? 1) - 1 }] : []
                                  )
                                )
                              }
                            >
                              −
                            </button>
                            <button
                              aria-label="Agregar uno"
                              className="h-10 w-10 rounded-xl border border-borde text-xl font-semibold"
                              onClick={() => cambiarLinea(l.clave, { cantidad: (l.cantidad ?? 0) + 1 })}
                            >
                              +
                            </button>
                          </>
                        )}
                        {l.producto.unidad === "KG" && (
                          <button
                            className="h-10 rounded-xl border border-borde px-3 text-sm font-semibold"
                            onClick={() => setLineas((prev) => prev.filter((x) => x.clave !== l.clave))}
                          >
                            Quitar
                          </button>
                        )}
                        <span className="w-20 text-right font-semibold tabular-nums">{dinero(importeLinea(l))}</span>
                      </span>
                    </div>

                    {/* Extras opcionales: solo se tocan si el cliente los pide */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {l.producto.lleva_verdura !== false && (
                        <>
                          <Extra activo={l.sinCebolla} onClick={() => cambiarLinea(l.clave, { sinCebolla: !l.sinCebolla })}>
                            Sin cebolla
                          </Extra>
                          <Extra activo={l.sinCilantro} onClick={() => cambiarLinea(l.clave, { sinCilantro: !l.sinCilantro })}>
                            Sin cilantro
                          </Extra>
                        </>
                      )}
                      {l.producto.pregunta_quesillo && l.producto.unidad === "PIEZA" && (
                        <Extra activo={l.quesillo} onClick={() => cambiarLinea(l.clave, { quesillo: !l.quesillo })}>
                          + Quesillo {dinero(precioQuesillo)}
                        </Extra>
                      )}
                      {numPlatos > 1 && (
                        <select
                          value={l.plato}
                          onChange={(e) => cambiarLinea(l.clave, { plato: Number(e.target.value) })}
                          className="rounded-full border border-borde bg-white px-2.5 py-1.5 text-xs font-semibold"
                        >
                          {Array.from({ length: numPlatos }, (_, i) => i + 1).map((k) => (
                            <option key={k} value={k}>
                              Persona {k}
                            </option>
                          ))}
                        </select>
                      )}
                      {l.producto.unidad === "PIEZA" && (l.cantidad ?? 1) > 1 && (
                        <button onClick={() => separarUna(l)} className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-cafe-medio underline">
                          Separar 1
                        </button>
                      )}
                    </div>
                    {l.producto.unidad === "PIEZA" && (l.cantidad ?? 1) > 1 && (l.quesillo || l.sinCebolla || l.sinCilantro) && (
                      <p className="mt-1 text-xs text-cafe-medio">Los extras aplican a las {l.cantidad} piezas. Si solo es una, toca Separar 1.</p>
                    )}
                    <input
                      placeholder="Nota (ej. bien dorado)"
                      value={l.notas}
                      onChange={(e) => cambiarLinea(l.clave, { notas: e.target.value })}
                      className="mt-2 w-full rounded-xl border border-borde bg-crema/40 px-3 py-2 text-sm focus:border-cafe focus:outline-none"
                    />
                  </div>
                ))}
            </div>
          ))}
      </section>

      {error && (
        <p className="mb-2 rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{error}</p>
      )}
      <div className="sticky bottom-0 -mx-3 border-t border-borde bg-crema/95 px-3 pb-3 pt-2 backdrop-blur">
        <button
          onClick={enviar}
          disabled={!lineas.length || enviando}
          className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro disabled:opacity-40"
        >
          {enviando ? "Enviando…" : `Enviar a cocina · ${dinero(total)}`}
        </button>
      </div>

      {eligiendo && (
        <Selector
          producto={eligiendo}
          opciones={opciones.filter((o) => o.producto_id === eligiendo.id)}
          onCerrar={() => setEligiendo(null)}
          onElegir={(l) => {
            agregar({ producto: eligiendo, ...l });
            setEligiendo(null);
          }}
        />
      )}
    </main>
  );
}

// Ventana para elegir guisado, peso/monto y quesillo.
// • Opciones "A con B" (ej. "Campechano con Maciza") se agrupan en un submenú "A".
// • Opciones "A y B" (ej. "Maciza y Cuerito") se eligen tocando 2 ingredientes.
// • El quesillo, la cebolla y el cilantro ya no se preguntan: son extras en la línea.
function Selector({
  producto,
  opciones,
  onCerrar,
  onElegir,
}: {
  producto: Producto;
  opciones: Opcion[];
  onCerrar: () => void;
  onElegir: (l: { opcion: Opcion | null; cantidad?: number; monto?: number }) => void;
}) {
  const [peso, setPeso] = useState("");
  const [monto, setMonto] = useState("");
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [pareja, setPareja] = useState<string[]>([]);
  const precio = Number(producto.precio);

  // ¿Es un platillo de "elige 2"? (todas sus opciones son "A y B")
  const combinado = useMemo(() => {
    if (opciones.length < 3 || !opciones.every((o) => o.nombre.includes(" y "))) return null;
    const ingredientes: string[] = [];
    const porPareja = new Map<string, Opcion>();
    opciones.forEach((o) => {
      const [a, b] = o.nombre.split(" y ");
      [a, b].forEach((x) => !ingredientes.includes(x) && ingredientes.push(x));
      porPareja.set([a, b].sort().join("|"), o);
    });
    return { ingredientes, porPareja };
  }, [opciones]);

  // Agrupar "Campechano con Maciza"... bajo "Campechano"
  const { sueltas, grupos } = useMemo(() => {
    const porPrefijo = new Map<string, { opcion: Opcion; detalle: string }[]>();
    opciones.forEach((o) => {
      const i = o.nombre.indexOf(" con ");
      if (i > 0) {
        const grupo = o.nombre.slice(0, i);
        const lista = porPrefijo.get(grupo) ?? [];
        lista.push({ opcion: o, detalle: o.nombre.slice(i + 5) });
        porPrefijo.set(grupo, lista);
      }
    });
    const grupos = new Map([...porPrefijo].filter(([, l]) => l.length >= 2));
    const enGrupo = new Set([...grupos.values()].flat().map((x) => x.opcion.id));
    return { sueltas: opciones.filter((o) => !enGrupo.has(o.id)), grupos };
  }, [opciones]);

  function elegirOpcion(opcion: Opcion | null) {
    onElegir({ opcion, cantidad: 1 });
  }

  function tocarIngrediente(ing: string) {
    if (!combinado) return;
    const nueva = pareja.includes(ing) ? pareja.filter((x) => x !== ing) : [...pareja, ing].slice(-2);
    setPareja(nueva);
    if (nueva.length === 2) {
      const o = combinado.porPareja.get([...nueva].sort().join("|"));
      if (o) setTimeout(() => elegirOpcion(o), 120);
    }
  }

  const botonOpcion = "rounded-2xl border-2 border-borde bg-white py-5 text-lg font-semibold active:scale-[0.97]";
  const titulo = grupoAbierto
    ? `${producto.nombre} ${grupoAbierto.toLowerCase()}`
    : producto.nombre;

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-cafe/50 sm:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-crema p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-2xl font-extrabold leading-tight">{titulo}</h3>
          <span className="shrink-0 text-sm text-cafe-medio">
            {dinero(precio)}
            {producto.unidad === "KG" ? " / kg" : ""}
          </span>
        </div>
        {producto.descripcion && <p className="-mt-2 text-sm text-cafe-medio">{producto.descripcion}</p>}

        {/* Elige 2 ingredientes */}
        {producto.requiere_opcion && combinado && (
          <>
            <p className="text-sm font-semibold">Elige 2 ingredientes ({pareja.length}/2)</p>
            <div className="grid grid-cols-2 gap-2.5">
              {combinado.ingredientes.map((ing) => (
                <button
                  key={ing}
                  className={`rounded-2xl border-2 py-5 text-lg font-semibold active:scale-[0.97] ${
                    pareja.includes(ing) ? "border-paliacate bg-paliacate text-white" : "border-borde bg-white"
                  }`}
                  onClick={() => tocarIngrediente(ing)}
                >
                  {ing}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Submenú "A con B" */}
        {producto.requiere_opcion && !combinado && grupoAbierto && (
          <>
            <p className="text-sm text-cafe-medio">¿Con qué lo quiere?</p>
            <div className="grid grid-cols-2 gap-2.5">
              {(grupos.get(grupoAbierto) ?? []).map(({ opcion, detalle }) => (
                <button key={opcion.id} className={botonOpcion} onClick={() => elegirOpcion(opcion)}>
                  {detalle}
                </button>
              ))}
            </div>
            <button
              className="w-full rounded-xl border-2 border-cafe bg-white py-3 font-semibold active:bg-crema-oscuro"
              onClick={() => setGrupoAbierto(null)}
            >
              ‹ Regresar
            </button>
          </>
        )}

        {/* Opciones normales */}
        {producto.requiere_opcion && !combinado && !grupoAbierto && (
          <div className="grid grid-cols-2 gap-2.5">
            {sueltas.map((o) => (
              <button key={o.id} className={botonOpcion} onClick={() => elegirOpcion(o)}>
                {o.nombre}
              </button>
            ))}
            {[...grupos.keys()].map((g) => (
              <button
                key={g}
                className="rounded-2xl border-2 border-cafe bg-queso-claro py-5 text-lg font-semibold active:scale-[0.97]"
                onClick={() => setGrupoAbierto(g)}
              >
                {g} ›
              </button>
            ))}
          </div>
        )}

        {/* Por kilo */}
        {producto.unidad === "KG" && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[0.25, 0.5, 0.75, 1].map((k) => (
                <button
                  key={k}
                  className="rounded-2xl border-2 border-borde bg-white py-4 font-semibold active:scale-[0.97]"
                  onClick={() => onElegir({ opcion: null, cantidad: k })}
                >
                  {k === 1 ? "1 kg" : `${k * 1000} g`}
                </button>
              ))}
            </div>
            <label className="block text-sm font-semibold">
              Otro peso (kg)
              <div className="mt-1 flex gap-2">
                <input
                  inputMode="decimal"
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                  placeholder="0.350"
                  className="min-w-0 flex-1 rounded-xl border border-borde bg-white px-3 py-3 font-normal focus:border-cafe focus:outline-none"
                />
                <button
                  className="rounded-xl bg-paliacate px-5 font-semibold text-white disabled:opacity-40"
                  disabled={!(Number(peso) > 0)}
                  onClick={() => onElegir({ opcion: null, cantidad: Math.round(Number(peso) * 1000) / 1000 })}
                >
                  Agregar
                </button>
              </div>
            </label>
            <label className="block text-sm font-semibold">
              Por monto ($)
              <div className="mt-1 flex gap-2">
                <input
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="100"
                  className="min-w-0 flex-1 rounded-xl border border-borde bg-white px-3 py-3 font-normal focus:border-cafe focus:outline-none"
                />
                <button
                  className="rounded-xl bg-paliacate px-5 font-semibold text-white disabled:opacity-40"
                  disabled={!(Number(monto) > 0)}
                  onClick={() => onElegir({ opcion: null, monto: Math.round(Number(monto) * 100) / 100 })}
                >
                  Agregar
                </button>
              </div>
              {Number(monto) > 0 && (
                <span className="mt-1 block text-xs font-normal text-cafe-medio">≈ {(Number(monto) / precio).toFixed(3)} kg</span>
              )}
            </label>
          </>
        )}
        <button className="w-full rounded-xl py-3 text-sm font-semibold text-cafe-medio hover:bg-crema-oscuro" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Extra({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
        activo ? "bg-cafe text-crema" : "border border-borde bg-white text-cafe-medio"
      }`}
    >
      {activo ? "✓ " : ""}
      {children}
    </button>
  );
}
