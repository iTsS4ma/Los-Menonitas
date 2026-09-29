import type { Cuenta, Detalle, Pedido } from "@/lib/tipos";

const moneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export const dinero = (n: number) => moneda.format(Number(n));

export function cantidadTexto(d: Pick<Detalle, "cantidad" | "unidad">) {
  const c = Number(d.cantidad);
  return d.unidad === "KG" ? `${c.toFixed(3)} kg` : `${c}×`;
}

export function nombreCuenta(c: Pick<Cuenta, "tipo" | "mesas" | "nombre_cliente" | "numero_orden">) {
  if (c.tipo === "MESA") return `Mesa ${c.mesas?.numero ?? "?"}`;
  return `Llevar #${c.numero_orden}${c.nombre_cliente ? ` · ${c.nombre_cliente}` : ""}`;
}

export function totalCuenta(pedidos: Pedido[]) {
  return pedidos
    .filter((p) => p.estado !== "CANCELADO")
    .flatMap((p) => p.detalle_pedido)
    .filter((d) => d.estado === "ACTIVO")
    .reduce((s, d) => s + Number(d.importe), 0);
}

export function minutosDesde(fecha: string, ahora: number) {
  return Math.max(0, Math.floor((ahora - new Date(fecha).getTime()) / 60000));
}

// Fecha YYYY-MM-DD en hora de Ciudad de México
export function diaMX(fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(fecha);
}

// México no tiene horario de verano desde 2022: UTC-6 todo el año
export const inicioDiaMX = (dia: string) => `${dia}T00:00:00-06:00`;

export function errorTexto(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Ocurrió un error";
}
export function generarUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Alternativa RFC4122 v4 100% compatible con HTTP y navegadores móviles
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}