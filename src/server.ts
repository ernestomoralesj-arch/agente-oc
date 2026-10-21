import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { confirmar, enviarMensaje, MODEL } from "./agent/loop";
import { obtenerSesion, reiniciarSesion } from "./agent/sessions";
import { ejecutarTool, tools, toolsByName } from "./tools/oc";

const app = new Hono();
const sid = (v: unknown) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : null);

app.get("/api/health", (c) =>
  c.json({ ok: true, model: MODEL, llmConfigurado: !!process.env.ANTHROPIC_API_KEY, tools: tools.map((t) => t.name) }));

app.post("/api/chat", async (c) => {
  const { sessionId, message } = await c.req.json();
  const id = sid(sessionId);
  if (!id || typeof message !== "string" || !message.trim()) return c.json({ error: "sessionId y message son requeridos" }, 400);
  const s = obtenerSesion(id);
  try {
    const events = await enviarMensaje(s, message);
    return c.json({ events, pending: !!s.pending });
  } catch (e) {
    return c.json({ error: (e as Error).message, pending: !!s.pending }, 500);
  }
});

app.post("/api/confirm", async (c) => {
  const { sessionId, toolUseId, approved, comment } = await c.req.json();
  const id = sid(sessionId);
  if (!id || typeof toolUseId !== "string") return c.json({ error: "sessionId y toolUseId son requeridos" }, 400);
  const s = obtenerSesion(id);
  try {
    const events = await confirmar(s, toolUseId, !!approved, comment);
    return c.json({ events, pending: !!s.pending });
  } catch (e) {
    return c.json({ error: (e as Error).message, pending: !!s.pending }, 500);
  }
});

app.post("/api/reset", async (c) => {
  const { sessionId } = await c.req.json();
  const id = sid(sessionId);
  if (id) reiniciarSesion(id);
  return c.json({ ok: true });
});

// Modo sin LLM: ejecución directa de herramientas (respaldo para la defensa si falla la API del modelo).
// Las herramientas con confirmación exigen confirmado:true explícito.
app.post("/api/tools/:name", async (c) => {
  const name = c.req.param("name");
  const tool = toolsByName[name];
  if (!tool) return c.json({ error: "Herramienta no existe" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const { confirmado, ...input } = body ?? {};
  if (tool.requiresConfirmation && confirmado !== true) {
    return c.json({ requiereConfirmacion: true, preview: tool.preview ? await tool.preview(tool.input.parse(input)) : null });
  }
  try { return c.json({ output: await ejecutarTool(name, input) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

app.use("/*", serveStatic({ root: "./public" }));

const port = Number(process.env.PORT ?? 3000);
console.log(`Agente OC escuchando en http://localhost:${port} (modelo ${MODEL})`);
export default { port, fetch: app.fetch };
