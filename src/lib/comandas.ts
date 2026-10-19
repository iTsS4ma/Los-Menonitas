import type { Detalle, Estacion, Pedido } from "./tipos";
import type { RenglonTicket } from "./impresoraBT";

export const NOMBRE_ESTACION: Record<Estacion, string> = { COCINA: "Cocina", GARNACHAS: "Garnachas" };
export const DESTINO_ESTACION = { COCINA: "cocina", GARNACHAS: "garnachas" } as const;

// "Kg Carnitas" → "Carnitas 1.000 kg"
const nombreKilo = (d: Detalle) => `${d.nombre_producto.replace(/^kg\s+/i, "")} ${Number(d.cantidad).toFixed(3)} kg`;

/** Sopes que acompañan un producto por kilo: 2 por cada medio kilo (mínimo 1). */
export const sopesDeKilo = (cantidadKg: number) => Math.max(1, Math.round(cantidadKg * 4));

/** Qué ve y prepara una estación de un renglón del pedido. */
export function renglonEstacion(d: Detalle, estacion: Estacion): RenglonTicket & { piezas: number; resumen: string } {
  if (d.unidad === "KG" && estacion === "GARNACHAS") {
    const n = sopesDeKilo(Number(d.cantidad));
    return { texto: `${n}x Sope de acompañamiento (${nombreKilo(d)})`, piezas: n, resumen: "Sope de acompañamiento", nota: d.notas };
  }
  const extras: string[] = [];
  if (d.sin_cebolla) extras.push("SIN CEBOLLA");
  if (d.sin_cilantro) extras.push("SIN CILANTRO");
  const opcion = d.nombre_opcion ? ` (${d.nombre_opcion})` : "";
  if (d.unidad === "KG") {
    return { texto: nombreKilo(d), detalle: d.productos?.descripcion, extras, nota: d.notas, piezas: 99, resumen: d.nombre_producto };
  }
  const n = Math.trunc(Number(d.cantidad));
  return {
    texto: `${n}x ${d.nombre_producto}${opcion}`,
    detalle: d.productos?.descripcion,
    quesillo: !!d.con_quesillo,
    extras,
    nota: d.notas,
    piezas: n,
    resumen: `${d.nombre_producto}${opcion}`,
  };
}

/** Renglones activos de una estación, agrupados por plato. */
export function platosEstacion(p: Pick<Pedido, "detalle_pedido">, estacion: Estacion) {
  const activos = (p.detalle_pedido || []).filter((d) => d.estado === "ACTIVO" && (d.estaciones || []).includes(estacion));
  const porPlato = new Map<number, ReturnType<typeof renglonEstacion>[]>();
  activos.forEach((d) => {
    const n = d.plato ?? 1;
    porPlato.set(n, [...(porPlato.get(n) ?? []), renglonEstacion(d, estacion)]);
  });
  const platos = [...porPlato.entries()].sort((a, b) => a[0] - b[0]).map(([plato, renglones]) => ({ plato, renglones }));
  const piezas = platos.reduce((s, x) => s + x.renglones.reduce((t, r) => t + r.piezas, 0), 0);
  return { platos, piezas, rapida: piezas > 0 && piezas <= 2 };
}
