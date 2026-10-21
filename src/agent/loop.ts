// Ciclo del agente: LLM -> tool_use -> (confirmación humana si aplica) -> tool_result -> LLM ... -> respuesta final.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anthropicToolDefs, ejecutarTool, toolsByName } from "../tools/oc";
import type { Sesion } from "./sessions";

export const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const MAX_PASOS = Number(process.env.MAX_PASOS ?? 16);
const SYSTEM = readFileSync(resolve("agent/prompt.md"), "utf8");

let _client: Pick<Anthropic, "messages"> | null = null;
const client = () => {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el servidor. Usa /api/tools/* o `bun demo.ts` para el modo sin LLM.");
  return (_client = new Anthropic());
};
/** Solo para pruebas: inyecta un cliente simulado. */
export const _setClient = (c: Pick<Anthropic, "messages">) => { _client = c; };

export type EventoAgente =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: unknown; isError: boolean }
  | { type: "confirmation"; id: string; name: string; input: unknown; preview?: unknown }
  | { type: "usage"; input_tokens: number; output_tokens: number };

export async function enviarMensaje(s: Sesion, texto: string): Promise<EventoAgente[]> {
  if (s.pending) throw new Error("Hay una confirmación pendiente: apruébala o recházala primero.");
  s.messages.push({ role: "user", content: texto });
  return correrLoop(s, []);
}

export async function confirmar(s: Sesion, toolUseId: string, aprobado: boolean, comentario?: string): Promise<EventoAgente[]> {
  const p = s.pending;
  if (!p || p.toolUse.id !== toolUseId) throw new Error("No hay una confirmación pendiente con ese id.");
  s.pending = undefined;
  const eventos: EventoAgente[] = [];
  let resultado: Anthropic.ToolResultBlockParam;
  if (aprobado) {
    resultado = await ejecutar(p.toolUse, eventos);
  } else {
    const output = { rechazadoPorHumano: true, comentario: comentario ?? null };
    eventos.push({ type: "tool_result", id: p.toolUse.id, name: p.toolUse.name, output, isError: true });
    resultado = { type: "tool_result", tool_use_id: p.toolUse.id, content: JSON.stringify(output), is_error: true };
  }
  const pausado = await procesarToolUses(s, p.restantes, [...p.resultados, resultado], eventos);
  return pausado ? eventos : correrLoop(s, eventos);
}

async function correrLoop(s: Sesion, eventos: EventoAgente[]): Promise<EventoAgente[]> {
  for (let paso = 0; paso < MAX_PASOS; paso++) {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Prompt caching del system prompt + tools: abarata cada vuelta del loop
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: anthropicToolDefs,
      messages: s.messages,
    });
    eventos.push({ type: "usage", input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens });
    s.messages.push({ role: "assistant", content: resp.content as Anthropic.ContentBlockParam[] });
    for (const b of resp.content) if (b.type === "text" && b.text.trim()) eventos.push({ type: "text", text: b.text });

    if (resp.stop_reason !== "tool_use") return eventos;
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const pausado = await procesarToolUses(s, toolUses, [], eventos);
    if (pausado) return eventos;
  }
  eventos.push({ type: "text", text: "(Se alcanzó el límite de pasos del agente. Escribe 'continúa' para seguir.)" });
  return eventos;
}

/** Ejecuta tool_uses en orden. Si encuentra uno que requiere confirmación, pausa y guarda el estado. */
async function procesarToolUses(
  s: Sesion, pendientes: Anthropic.ToolUseBlock[], resultados: Anthropic.ToolResultBlockParam[], eventos: EventoAgente[],
): Promise<boolean> {
  const cola = [...pendientes];
  while (cola.length) {
    const tu = cola[0]!;
    const tool = toolsByName[tu.name];
    if (tool?.requiresConfirmation) {
      let preview: unknown;
      try { preview = tool.preview ? await tool.preview(tool.input.parse(tu.input)) : undefined; }
      catch (e) { preview = { error: (e as Error).message }; }
      s.pending = { toolUse: tu, restantes: cola.slice(1), resultados };
      eventos.push({ type: "confirmation", id: tu.id, name: tu.name, input: tu.input, preview });
      return true;
    }
    resultados.push(await ejecutar(tu, eventos));
    cola.shift();
  }
  s.messages.push({ role: "user", content: resultados });
  return false;
}

async function ejecutar(tu: Anthropic.ToolUseBlock, eventos: EventoAgente[]): Promise<Anthropic.ToolResultBlockParam> {
  eventos.push({ type: "tool_call", id: tu.id, name: tu.name, input: tu.input });
  try {
    const output = await ejecutarTool(tu.name, tu.input);
    eventos.push({ type: "tool_result", id: tu.id, name: tu.name, output, isError: false });
    return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) };
  } catch (e) {
    const output = { error: (e as Error).message };
    eventos.push({ type: "tool_result", id: tu.id, name: tu.name, output, isError: true });
    return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output), is_error: true };
  }
}
