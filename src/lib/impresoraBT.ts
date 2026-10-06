// Impresión directa a impresoras térmicas Bluetooth (BLE) desde Chrome
// (Android o computadora con Bluetooth). Cada "destino" (cocina, caja) puede
// tener una o varias impresoras; la comanda se manda a todas, una por una.
// Se conecta solo para imprimir y se desconecta enseguida, para que otros
// equipos puedan usar la misma impresora.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { LOGO_ALTO, LOGO_ANCHO, LOGO_BITS } from "./logoTicket";

export type Destino = "cocina" | "caja";

export type ImpresoraGuardada = { id: string; nombre: string; lista: boolean };

export type EstadoImpresoras = {
  soportado: boolean;
  impresoras: ImpresoraGuardada[];
  imprimiendo: boolean;
};

// Servicios que usan las impresoras térmicas Bluetooth más comunes
const SERVICIOS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

const dispositivos: Record<Destino, Map<string, any>> = { cocina: new Map(), caja: new Map() };
const imprimiendo: Record<Destino, boolean> = { cocina: false, caja: false };
let cola: Promise<unknown> = Promise.resolve();
const oyentes: Record<Destino, Set<(e: EstadoImpresoras) => void>> = { cocina: new Set(), caja: new Set() };

const bt = () => (typeof navigator !== "undefined" ? (navigator as any).bluetooth : undefined);
const clave = (d: Destino) => `impresoras_bt_${d}`;

function guardadas(d: Destino): { id: string; nombre: string }[] {
  try {
    const crudo = localStorage.getItem(clave(d));
    if (crudo) return JSON.parse(crudo);
    // Compatibilidad con la versión anterior (una sola impresora de cocina)
    if (d === "cocina") {
      const id = localStorage.getItem("impresora_bt_id");
      if (id) return [{ id, nombre: localStorage.getItem("impresora_bt_nombre") ?? "Impresora" }];
    }
  } catch {}
  return [];
}

function guardar(d: Destino, lista: { id: string; nombre: string }[]) {
  try {
    localStorage.setItem(clave(d), JSON.stringify(lista));
  } catch {}
}

export function estadoImpresoras(d: Destino): EstadoImpresoras {
  return {
    soportado: !!bt(),
    impresoras: guardadas(d).map((g) => ({ ...g, lista: dispositivos[d].has(g.id) })),
    imprimiendo: imprimiendo[d],
  };
}

function avisar(d: Destino) {
  const e = estadoImpresoras(d);
  oyentes[d].forEach((f) => f(e));
}

export function escucharImpresoras(d: Destino, f: (e: EstadoImpresoras) => void) {
  oyentes[d].add(f);
  f(estadoImpresoras(d));
  return () => {
    oyentes[d].delete(f);
  };
}

/** Recupera las impresoras elegidas antes, sin pedir nada (si Chrome lo permite). */
export async function recuperarImpresoras(d: Destino) {
  const lista = guardadas(d);
  if (!lista.length || !bt()?.getDevices) return;
  try {
    const conocidos = await bt().getDevices();
    lista.forEach((g) => {
      const dev = conocidos.find((x: any) => x.id === g.id);
      if (dev) dispositivos[d].set(g.id, dev);
    });
  } catch {}
  avisar(d);
}

/** Abre la ventana de Chrome para elegir una impresora. Debe llamarse desde un toque. */
export async function elegirImpresora(d: Destino, reemplazarTodas = false) {
  if (!bt()) throw new Error("Este navegador no puede usar Bluetooth. Usa Chrome.");
  const dev = await bt().requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS });
  let lista = reemplazarTodas ? [] : guardadas(d).filter((g) => g.id !== dev.id);
  if (reemplazarTodas) {
    dispositivos[d].forEach((x) => soltar(x));
    dispositivos[d].clear();
  }
  lista = [...lista, { id: dev.id, nombre: dev.name ?? "Impresora" }];
  guardar(d, lista);
  dispositivos[d].set(dev.id, dev);
  avisar(d);
  return dev.name as string;
}

export function quitarImpresora(d: Destino, id: string) {
  const dev = dispositivos[d].get(id);
  if (dev) soltar(dev);
  guardar(d, guardadas(d).filter((g) => g.id !== id));
  dispositivos[d].delete(id);
  avisar(d);
}

async function caracteristicaEscritura(servidor: any) {
  const servicios = await servidor.getPrimaryServices();
  let sinConfirmacion: any = null;
  for (const s of servicios) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.write) return c; // preferida: confirma cada envío
      if (c.properties.writeWithoutResponse && !sinConfirmacion) sinConfirmacion = c;
    }
  }
  if (sinConfirmacion) return sinConfirmacion;
  throw new Error("La impresora no aceptó la conexión. ¿Es Bluetooth BLE?");
}

// ---------------------------------------------------------------------------
// Conexiones: se mantienen abiertas unos segundos por si vienen más tickets
// (reconectar seguido falla, sobre todo en Windows). Al soltar una impresora
// se espera antes de volver a conectarla, y si conectar falla se reintenta.
// ---------------------------------------------------------------------------

// Cuánto tiempo sin imprimir antes de soltar la impresora
const ESPERA_SOLTAR: Record<Destino, number> = {
  cocina: 4000, // corto: otros meseros usan las mismas impresoras
  caja: 20000, // la impresora de caja es solo de la computadora de caja
};
const PAUSA_TRAS_SOLTAR = 1500;

type Conexion = { servidor: any; caract: any; temporizador?: ReturnType<typeof setTimeout> };
const conexiones = new Map<string, Conexion>();
const soltadaEn = new Map<string, number>();
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function soltar(dev: any) {
  const c = conexiones.get(dev.id);
  if (c?.temporizador) clearTimeout(c.temporizador);
  conexiones.delete(dev.id);
  try {
    if (dev.gatt?.connected) dev.gatt.disconnect();
  } catch {}
  soltadaEn.set(dev.id, Date.now());
}

async function conectar(dev: any): Promise<Conexion> {
  const viva = conexiones.get(dev.id);
  if (viva && dev.gatt?.connected) return viva;
  if (viva) soltar(dev);

  if (!dev.__escuchaDesconexion) {
    dev.addEventListener?.("gattserverdisconnected", () => {
      conexiones.delete(dev.id);
      soltadaEn.set(dev.id, Date.now());
    });
    dev.__escuchaDesconexion = true;
  }

  let ultimoError: unknown;
  for (let intento = 0; intento < 3; intento++) {
    // Darle tiempo a la impresora (y a Windows) después de soltarla
    const desde = Date.now() - (soltadaEn.get(dev.id) ?? 0);
    const pausa = intento === 0 ? PAUSA_TRAS_SOLTAR - desde : 1000 * intento;
    if (pausa > 0) await dormir(pausa);
    try {
      const servidor = await dev.gatt.connect();
      const caract = await caracteristicaEscritura(servidor);
      const c: Conexion = { servidor, caract };
      conexiones.set(dev.id, c);
      return c;
    } catch (e) {
      ultimoError = e;
      try {
        dev.gatt?.disconnect();
      } catch {}
      soltadaEn.set(dev.id, Date.now());
    }
  }
  const msg = ultimoError instanceof Error ? ultimoError.message : "";
  throw new Error(/BLE/.test(msg) ? msg : "no se pudo conectar (¿encendida y cerca?)");
}

// Si la impresora lo permite, se escribe CON confirmación: cada trozo espera el
// "recibido" de la impresora, y si no llega, falla con error (en vez de perderse
// en silencio). Si solo acepta sin confirmación, se manda más despacio.
async function escribir(caract: any, bytes: Uint8Array) {
  const conConfirmacion = !!caract.properties.write;
  const TROZO = conConfirmacion ? 180 : 100;
  for (let i = 0; i < bytes.length; i += TROZO) {
    const parte = bytes.slice(i, i + TROZO);
    if (conConfirmacion) {
      if (caract.writeValueWithResponse) await caract.writeValueWithResponse(parte);
      else await caract.writeValue(parte);
    } else {
      await caract.writeValueWithoutResponse(parte);
      await dormir(50);
    }
  }
}

// Tiempo aproximado que tarda la impresora en sacar el ticket (~80 ms por renglón)
function tiempoImpresion(bytes: Uint8Array) {
  let renglones = 0;
  for (const b of bytes) if (b === 10) renglones++;
  return 300 + renglones * 80;
}

async function enviarA(dev: any, bytes: Uint8Array, d: Destino) {
  let c = await conectar(dev);
  try {
    await escribir(c.caract, bytes);
  } catch {
    // La conexión guardada se había caído: reconectar una vez y reintentar
    soltar(dev);
    c = await conectar(dev);
    await escribir(c.caract, bytes);
  }
  // Esperar a que termine de imprimir antes del siguiente ticket
  await dormir(tiempoImpresion(bytes));
  if (c.temporizador) clearTimeout(c.temporizador);
  c.temporizador = setTimeout(() => soltar(dev), ESPERA_SOLTAR[d]);
}

/** Error con el detalle de qué impresoras fallaron (para reintentar solo esas). */
export class ErrorImpresion extends Error {
  constructor(public fallidas: { id: string; nombre: string; motivo: string; sinPermiso: boolean }[]) {
    super(
      fallidas.length === 0
        ? "No hay impresora configurada."
        : fallidas.map((f) => `${f.nombre}: ${f.motivo}`).join(" · ")
    );
  }
}

/**
 * Imprime en todas las impresoras del destino (o solo en `soloIds`), una por una.
 * Si alguna falla, lanza ErrorImpresion con las que fallaron; las demás sí imprimen.
 */
export function imprimir(d: Destino, bytes: Uint8Array, soloIds?: string[]): Promise<void> {
  const tarea = cola.then(async () => {
    const lista = guardadas(d).filter((g) => !soloIds || soloIds.includes(g.id));
    if (lista.length === 0) throw new ErrorImpresion([]);
    if (lista.some((g) => !dispositivos[d].has(g.id))) await recuperarImpresoras(d);

    imprimiendo[d] = true;
    avisar(d);
    const fallidas: ErrorImpresion["fallidas"] = [];
    try {
      for (const g of lista) {
        const dev = dispositivos[d].get(g.id);
        if (!dev) {
          fallidas.push({ ...g, motivo: "hay que volver a conectarla", sinPermiso: true });
          continue;
        }
        try {
          await enviarA(dev, bytes, d);
        } catch (e) {
          fallidas.push({ ...g, motivo: e instanceof Error ? e.message : "error", sinPermiso: false });
        }
      }
    } finally {
      imprimiendo[d] = false;
      avisar(d);
    }
    if (fallidas.length) throw new ErrorImpresion(fallidas);
  });
  cola = tarea.catch(() => undefined);
  return tarea;
}

/** Vuelve a dar permiso a una impresora guardada (abre la ventana de Chrome). */
export async function reconectarImpresora(d: Destino) {
  return elegirImpresora(d);
}

// ---------------------------------------------------------------------------
// Formato ESC/POS para rollo de 58 mm (32 caracteres por línea)
// ---------------------------------------------------------------------------
const ANCHO = 32;
const ESC = 0x1b;
const GS = 0x1d;

// Las impresoras baratas no traen acentos fiables: se quitan (á→a, ñ→n)
const limpio = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡]/g, "")
    .replace(/[^\x20-\x7e]/g, "");

function partir(texto: string, ancho: number, sangria = "") {
  const palabras = limpio(texto).split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const tentativa = actual ? `${actual} ${p}` : p;
    if (tentativa.length <= ancho) actual = tentativa;
    else {
      if (actual) lineas.push(actual);
      actual = p.length > ancho ? p.slice(0, ancho) : p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.map((l, i) => (i === 0 ? l : sangria + l));
}

class Ticket {
  private b: number[] = [ESC, 0x40]; // inicializar
  texto(t: string) {
    for (const ch of limpio(t)) this.b.push(ch.charCodeAt(0));
    this.b.push(0x0a);
    return this;
  }
  centro() { this.b.push(ESC, 0x61, 1); return this; }
  izquierda() { this.b.push(ESC, 0x61, 0); return this; }
  grande() { this.b.push(GS, 0x21, 0x11); return this; }
  normal() { this.b.push(GS, 0x21, 0x00); return this; }
  negrita(on: boolean) { this.b.push(ESC, 0x45, on ? 1 : 0); return this; }
  linea(c = "-") { return this.texto(c.repeat(ANCHO)); }
  avanzar(n: number) { this.b.push(ESC, 0x64, n); return this; }
  cortar() { this.b.push(GS, 0x56, 0x42, 0x00); return this; }
  // Imagen en blanco y negro (GS v 0), en franjas para no saturar la impresora
  imagen(bits: Uint8Array, ancho: number, alto: number) {
    const porRenglon = ancho / 8;
    const FRANJA = 48;
    for (let y = 0; y < alto; y += FRANJA) {
      const h = Math.min(FRANJA, alto - y);
      this.b.push(GS, 0x76, 0x30, 0x00, porRenglon & 0xff, porRenglon >> 8, h & 0xff, h >> 8);
      for (let i = y * porRenglon; i < (y + h) * porRenglon; i++) this.b.push(bits[i]);
    }
    return this;
  }
  bytes() { return new Uint8Array(this.b); }
}

export type RenglonTicket = { texto: string; detalle?: string | null; quesillo?: boolean; nota?: string | null };

export function ticketComanda(d: { cuenta: string; ronda: number; hora: string; mesero?: string; renglones: RenglonTicket[] }) {
  const t = new Ticket().centro().grande().negrita(true);
  partir(d.cuenta, 16).forEach((l) => t.texto(l));
  t.normal().texto(`Ronda ${d.ronda}  -  ${d.hora}`).negrita(false);
  if (d.mesero) t.texto(`Mesero: ${d.mesero}`);
  t.izquierda().linea();
  d.renglones.forEach((r) => {
    t.negrita(true);
    partir(r.texto, ANCHO, "   ").forEach((l) => t.texto(l));
    t.negrita(false);
    if (r.detalle) partir(`(${r.detalle})`, ANCHO - 3, " ").forEach((l) => t.texto(`   ${l}`));
    if (r.quesillo) t.negrita(true).texto("   + CON QUESILLO").negrita(false);
    if (r.nota) partir(`* ${r.nota}`, ANCHO - 3, "     ").forEach((l) => t.texto(`   ${l}`));
  });
  t.linea().centro().texto("FIN COMANDA").avanzar(4).cortar();
  return t.bytes();
}

export function ticketCancelacion(d: { cuenta: string; ronda: number; hora: string; motivo: string; renglones: RenglonTicket[] }) {
  const t = new Ticket().centro().grande().negrita(true).texto("CANCELACION").normal();
  t.texto(`${d.cuenta} - Ronda ${d.ronda}`).negrita(false).texto(d.hora).izquierda().linea("=");
  t.negrita(true).texto("NO PREPARAR:");
  d.renglones.forEach((r) => partir(`X ${r.texto}`, ANCHO, "  ").forEach((l) => t.texto(l)));
  t.negrita(false).linea();
  t.texto("Motivo:");
  partir(d.motivo, ANCHO).forEach((l) => t.texto(l));
  t.linea("=").centro().negrita(true).texto("RETIRAR COMANDA").negrita(false).avanzar(4).cortar();
  return t.bytes();
}

// Datos del local para el ticket de cuenta
export const DATOS_LOCAL = [
  "Av. Insurgentes Nte. 1681",
  "Local 6, Tepeyac Insurgentes",
  "Gustavo A. Madero",
  "07800 Ciudad de Mexico",
  "Tel. 56 6506 3395",
];

function bitsLogo() {
  const crudo = atob(LOGO_BITS);
  const bits = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) bits[i] = crudo.charCodeAt(i);
  return bits;
}

export function ticketCuenta(d: {
  cuenta: string;
  fecha: string;
  renglones: { cantidad: string; nombre: string; importe: string }[];
  total: string;
  preferente?: boolean;
}) {
  const t = new Ticket().centro().imagen(bitsLogo(), LOGO_ANCHO, LOGO_ALTO);
  t.grande().negrita(true).texto("LOS MENONITAS").normal().negrita(false);
  DATOS_LOCAL.forEach((l) => t.texto(l));
  t.linea();
  t.negrita(true).texto(d.cuenta).negrita(false).texto(d.fecha).izquierda().linea();
  d.renglones.forEach((r) => {
    const izquierda = `${r.cantidad} ${r.nombre}`;
    const anchoTexto = ANCHO - r.importe.length - 1;
    const lineas = partir(izquierda, anchoTexto, "   ");
    lineas.forEach((l, i) => {
      t.texto(i === 0 ? l.padEnd(anchoTexto) + " " + limpio(r.importe) : l);
    });
  });
  t.linea();
  const etiqueta = d.preferente ? "CONSUMO" : "TOTAL";
  t.grande().negrita(true).texto(etiqueta + limpio(d.total).padStart(16 - etiqueta.length)).normal();
  if (d.preferente) t.centro().texto("").texto("PREFERENTE: SIN COBRO").izquierda();
  t.negrita(false);
  t.linea().centro().texto("Gracias por su preferencia!").avanzar(4).cortar();
  return t.bytes();
}
