import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { crearClienteAdmin } from "@/lib/supabase/admin";

// Respaldo completo de la base en un archivo JSON (solo administrador).
// Incluye menú, mesas, personal (sin contraseñas), cuentas, rondas, pagos y códigos.
const TABLAS = [
  "categorias",
  "productos",
  "opciones_producto",
  "mesas",
  "usuarios",
  "cuentas",
  "pedidos",
  "detalle_pedido",
  "pagos",
  "contrasenas_preferente",
  "bitacora",
] as const;

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });

  const admin = crearClienteAdmin();
  const { data: perfil } = await admin.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (perfil?.rol !== "ADMIN" || !perfil.activo) return NextResponse.json({ error: "Solo el administrador" }, { status: 403 });

  const datos: Record<string, unknown[]> = {};
  for (const tabla of TABLAS) {
    const filas: unknown[] = [];
    // De 1,000 en 1,000 (límite de Supabase por consulta)
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await admin.from(tabla).select("*").range(desde, desde + 999);
      if (error) return NextResponse.json({ error: `${tabla}: ${error.message}` }, { status: 500 });
      filas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    datos[tabla] = filas;
  }

  const fecha = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).replace(" ", "_").replace(/:/g, "-");
  const archivo = JSON.stringify({ sistema: "Los Menonitas", generado: new Date().toISOString(), tablas: datos }, null, 1);
  return new NextResponse(archivo, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="respaldo-losmenonitas-${fecha}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
