import { dinero } from "./formato";
import { ticketCorte } from "./impresoraBT";

export const FONDO_FIJO = 1000;

/** Datos de un cierre de caja (los que guarda la base al cerrar). */
export type DatosCierre = {
  fondo?: number | null;
  ventas_efectivo: number | null;
  entradas: number | null;
  salidas: number | null;
  esperado: number | null;
  contado: number | null;
  diferencia: number | null;
  desglose?: Record<string, number> | null;
  retiro?: number | null;
  tarjeta_terminal?: number | null;
  tarjeta_sistema?: number | null;
  tarjeta_diferencia?: number | null;
  transferencia_sistema?: number | null;
};

export const etiquetaDen = (d: number) => (d < 1 ? "50c" : `$${d}`);

const textoDiferencia = (d: number) => (d === 0 ? "Cuadra" : d < 0 ? `Faltan ${dinero(Math.abs(d))}` : `Sobran ${dinero(d)}`);
export { textoDiferencia };

/** Ticket de cierre de caja: el mismo en Caja y en Admin → Caja. */
export function ticketCierreCaja(c: DatosCierre, fecha: string, hora: string) {
  const n = (x: number | null | undefined) => Number(x ?? 0);
  const renglones: [string, string][] = [
    ["Fondo inicial", dinero(n(c.fondo ?? FONDO_FIJO))],
    ["Ventas en efectivo", dinero(n(c.ventas_efectivo))],
    ["Entradas", dinero(n(c.entradas))],
    ["Salidas", `-${dinero(n(c.salidas))}`],
    ["", ""],
    ["Efectivo esperado", dinero(n(c.esperado))],
    ["Efectivo contado", dinero(n(c.contado))],
    ["Diferencia", textoDiferencia(n(c.diferencia))],
  ];
  if (c.desglose && Object.keys(c.desglose).length) {
    renglones.push(["", ""], ["Conteo:", ""]);
    Object.entries(c.desglose)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .forEach(([d, k]) => renglones.push([`  ${k} x ${etiquetaDen(Number(d))}`, dinero(Number(d) * Number(k))]));
  }
  if (c.tarjeta_sistema != null) {
    renglones.push(
      ["", ""],
      ["Tarjeta (sistema)", dinero(n(c.tarjeta_sistema))],
      ["Tarjeta (terminal)", dinero(n(c.tarjeta_terminal))],
      ["Diferencia tarjeta", textoDiferencia(n(c.tarjeta_diferencia))]
    );
  }
  if (c.transferencia_sistema != null) renglones.push(["Transferencias", dinero(n(c.transferencia_sistema))]);
  renglones.push(["", ""], [`Dejar en caja`, dinero(FONDO_FIJO)]);
  return ticketCorte({
    titulo: "CIERRE DE CAJA",
    fecha,
    hora,
    renglones,
    etiquetaTotal: "RETIRAR",
    total: dinero(n(c.retiro ?? Math.max(n(c.contado) - FONDO_FIJO, 0))),
  });
}
