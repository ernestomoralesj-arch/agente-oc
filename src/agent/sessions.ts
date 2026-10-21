import type Anthropic from "@anthropic-ai/sdk";

export interface Pendiente {
  toolUse: Anthropic.ToolUseBlock;
  restantes: Anthropic.ToolUseBlock[];
  resultados: Anthropic.ToolResultBlockParam[];
}

export interface Sesion {
  id: string;
  messages: Anthropic.MessageParam[];
  pending?: Pendiente;
  actualizada: number;
}

const sesiones = new Map<string, Sesion>();
const TTL_MS = 6 * 60 * 60 * 1000;

export function obtenerSesion(id: string): Sesion {
  // Limpieza perezosa de sesiones viejas (estado en memoria; en producción iría a Redis/DB)
  const ahora = Date.now();
  for (const [k, s] of sesiones) if (ahora - s.actualizada > TTL_MS) sesiones.delete(k);
  let s = sesiones.get(id);
  if (!s) { s = { id, messages: [], actualizada: ahora }; sesiones.set(id, s); }
  s.actualizada = ahora;
  return s;
}

export const reiniciarSesion = (id: string) => sesiones.delete(id);
