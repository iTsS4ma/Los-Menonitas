"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Rol } from "@/lib/perfil";
import { actualizarPersonal, cambiarPassword, crearPersonal, eliminarPersonal } from "./acciones";

export type Persona = { id: string; nombre: string; email: string | null; rol: Rol; puede_cobrar: boolean; activo: boolean };

const ROLES: { valor: Rol; texto: string }[] = [
  { valor: "MESERO", texto: "Mesero" },
  { valor: "CAJERO", texto: "Cajero" }, { valor: "ADMIN", texto: "Administrador" },
];

export default function Personal({ personas }: { personas: Persona[] }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState("");
  const [nuevo, setNuevo] = useState({ nombre: "", email: "", password: "", rol: "MESERO" as Rol, puede_cobrar: false });

  function correr(accion: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    iniciar(async () => {
      const r = await accion();
      setMensaje(r.ok ? exito : `Error: ${r.error}`);
      if (r.ok) router.refresh();
    });
  }

  const campo = "rounded-xl border border-borde bg-white px-3 py-2.5 focus:border-cafe focus:outline-none";
  const textoRol = (r: Rol) => ROLES.find((x) => x.valor === r)?.texto ?? r;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Personal</h1>
        <p className="text-sm text-cafe-medio">
          Desactivar quita el acceso por un tiempo. Eliminar lo borra del sistema; sus ventas pasadas conservan su nombre.
        </p>
      </div>

      {mensaje && (
        <p className={`rounded-xl px-4 py-3 text-sm font-medium ${mensaje.startsWith("Error") ? "bg-paliacate-claro text-paliacate-oscuro" : "bg-hoja-claro text-hoja"}`}>
          {mensaje}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-borde bg-white p-5">
        <h2 className="font-display text-xl font-bold">Agregar persona</h2>
        <p className="text-sm text-cafe-medio">
          El correo solo sirve para iniciar sesión; no se envía ningún mensaje. Si alguien no tiene correo, puedes inventar uno, por ejemplo juan@mirestaurante.com.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className={campo} />
          <input placeholder="Correo" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} className={campo} />
          <input placeholder="Contraseña (mínimo 8)" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} className={campo} />
          <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })} className={campo}>
            {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
        </div>
        {nuevo.rol === "MESERO" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-paliacate" checked={nuevo.puede_cobrar} onChange={(e) => setNuevo({ ...nuevo, puede_cobrar: e.target.checked })} />
            Puede cobrar
          </label>
        )}
        <button
          disabled={pendiente}
          onClick={() => correr(async () => {
            const r = await crearPersonal(nuevo);
            if (r.ok) setNuevo({ nombre: "", email: "", password: "", rol: "MESERO", puede_cobrar: false });
            return r;
          }, "Persona agregada. Ya puede iniciar sesión.")}
          className="rounded-xl bg-paliacate px-6 py-2.5 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
        >
          Agregar persona
        </button>
      </section>

      <ul className="divide-y divide-borde/70 overflow-hidden rounded-2xl border border-borde bg-white">
        {personas.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${p.activo ? "" : "bg-crema/60 text-cafe/50"}`}>
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-crema-oscuro font-display font-bold">
                {p.nombre.trim().charAt(0).toUpperCase()}
              </span>
              <span>
                <strong>{p.nombre}</strong>
                {!p.activo && <span className="ml-2 text-xs font-semibold">(sin acceso)</span>}
                <span className="block text-sm text-cafe-medio">
                  {textoRol(p.rol)} · {p.email}
                </span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <select value={p.rol} disabled={pendiente}
                onChange={(e) => correr(() => actualizarPersonal(p.id, { rol: e.target.value as Rol }), "Rol actualizado")}
                className="rounded-lg border border-borde bg-white px-2 py-1.5">
                {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
              </select>
              {p.rol === "MESERO" && (
                <label className="flex items-center gap-1.5 rounded-lg border border-borde px-2 py-1.5">
                  <input type="checkbox" className="accent-paliacate" checked={p.puede_cobrar} disabled={pendiente}
                    onChange={(e) => correr(() => actualizarPersonal(p.id, { puede_cobrar: e.target.checked }), "Permiso actualizado")} />
                  Cobra
                </label>
              )}
              <button className="rounded-lg border border-borde px-3 py-1.5 font-semibold hover:border-cafe-medio" disabled={pendiente} onClick={() => {
                const nueva = window.prompt(`Nueva contraseña para ${p.nombre} (mínimo 8)`);
                if (nueva) correr(() => cambiarPassword(p.id, nueva), "Contraseña cambiada");
              }}>Contraseña</button>
              <button
                className={`rounded-lg border px-3 py-1.5 font-semibold ${p.activo ? "border-paliacate/40 text-paliacate hover:bg-paliacate-claro" : "border-hoja text-hoja hover:bg-hoja-claro"}`}
                disabled={pendiente}
                onClick={() => correr(() => actualizarPersonal(p.id, { activo: !p.activo }), p.activo ? "Acceso desactivado" : "Acceso activado")}>
                {p.activo ? "Desactivar" : "Activar"}
              </button>
              <button
                className="rounded-lg bg-paliacate px-3 py-1.5 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
                disabled={pendiente}
                onClick={() => {
                  if (!window.confirm(`¿Eliminar a ${p.nombre}? Ya no podrá entrar al sistema. Sus ventas pasadas se conservan con su nombre. No se puede deshacer.`)) return;
                  correr(() => eliminarPersonal(p.id), `${p.nombre} eliminado`);
                }}
              >
                Eliminar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
