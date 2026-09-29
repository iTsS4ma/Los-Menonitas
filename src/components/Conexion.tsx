export default function Conexion({ conectado }: { conectado: boolean }) {
  return conectado ? null : (
    <div className="bg-rose-600 hover:bg-rose-700 px-4 py-2 text-center text-sm font-medium text-white">
      Desconectado. Reintentando… Los cambios nuevos pueden no verse todavía.
    </div>
  );
}
