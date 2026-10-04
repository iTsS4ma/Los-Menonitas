// Impresión directa a impresora térmica Bluetooth (BLE) desde Chrome en Android.
// Se conecta solo para imprimir y se desconecta enseguida, para que otros meseros
// puedan usar la misma impresora.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EstadoImpresora = {
  soportado: boolean;
  nombre: string | null; // impresora elegida en este celular
  lista: boolean; // ya se puede imprimir sin volver a elegirla
  imprimiendo: boolean;
};

const CLAVE_ID = "impresora_bt_id";
const CLAVE_NOMBRE = "impresora_bt_nombre";

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

let dispositivo: any = null;
let imprimiendo = false;
let cola: Promise<unknown> = Promise.resolve();
const oyentes = new Set<(e: EstadoImpresora) => void>();

const bt = () => (typeof navigator !== "undefined" ? (navigator as any).bluetooth : undefined);
const leer = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function estadoImpresora(): EstadoImpresora {
  return {
    soportado: !!bt(),
    nombre: dispositivo?.name ?? leer(CLAVE_NOMBRE),
    lista: !!dispositivo,
    imprimiendo,
  };
}

function avisar() {
  const e = estadoImpresora();
  oyentes.forEach((f) => f(e));
}

export function escucharImpresora(f: (e: EstadoImpresora) => void) {
  oyentes.add(f);
  f(estadoImpresora());
  return () => {
    oyentes.delete(f);
  };
}

/** Recupera la impresora elegida antes, sin pedir nada al usuario (si Chrome lo permite). */
export async function recuperarImpresora() {
  if (dispositivo) return true;
  const id = leer(CLAVE_ID);
  if (!id || !bt()?.getDevices) return false;
  try {
    const lista = await bt().getDevices();
    dispositivo = lista.find((d: any) => d.id === id) ?? null;
  } catch {
    dispositivo = null;
  }
  avisar();
  return !!dispositivo;
}

/** Abre la ventana de Chrome para elegir la impresora. Debe llamarse desde un toque del usuario. */
export async function elegirImpresora() {
  if (!bt()) throw new Error("Este navegador no puede usar Bluetooth. Usa Chrome en Android.");
  const d = await bt().requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS });
  dispositivo = d;
  try {
    localStorage.setItem(CLAVE_ID, d.id);
    localStorage.setItem(CLAVE_NOMBRE, d.name ?? "Impresora");
  } catch {}
  avisar();
  return d.name as string;
}

async function caracteristicaEscritura(servidor: any) {
  const servicios = await servidor.getPrimaryServices();
  for (const s of servicios) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) return c;
    }
  }
  throw new Error("La impresora no aceptó la conexión. ¿Es Bluetooth BLE?");
}

async function enviarBytes(bytes: Uint8Array) {
  if (!dispositivo) await recuperarImpresora();
  if (!dispositivo) throw new SinImpresora();

  let servidor: any;
  try {
    servidor = await dispositivo.gatt.connect();
  } catch {
    throw new Error("No se pudo conectar con la impresora. ¿Está encendida y cerca?");
  }
  try {
    const c = await caracteristicaEscritura(servidor);
    const TROZO = 100;
    for (let i = 0; i < bytes.length; i += TROZO) {
      const parte = bytes.slice(i, i + TROZO);
      if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) {
        await c.writeValueWithoutResponse(parte);
        await new Promise((r) => setTimeout(r, 25));
      } else {
        await c.writeValue(parte);
      }
    }
    // Pequeña espera para que la impresora termine de recibir antes de desconectar
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    try {
      servidor.disconnect();
    } catch {}
  }
}

export class SinImpresora extends Error {
  constructor() {
    super("No hay impresora elegida en este celular.");
  }
}

/** Imprime (en fila, una a la vez). */
export function imprimir(bytes: Uint8Array): Promise<void> {
  const tarea = cola.then(async () => {
    imprimiendo = true;
    avisar();
    try {
      await enviarBytes(bytes);
    } finally {
      imprimiendo = false;
      avisar();
    }
  });
  cola = tarea.catch(() => undefined);
  return tarea;
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
