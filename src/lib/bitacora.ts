// Bitácora de auditoría en memoria: quién/qué/cuándo para cada acción con efecto.
export interface EntradaBitacora { ts: string; accion: string; solicitudId?: string; detalle: unknown }

const entradas: EntradaBitacora[] = [];

export function registrar(accion: string, solicitudId: string | undefined, detalle: unknown) {
  entradas.push({ ts: new Date().toISOString(), accion, solicitudId, detalle });
}
export const leerBitacora = (solicitudId?: string) =>
  solicitudId ? entradas.filter((e) => e.solicitudId === solicitudId) : [...entradas];
