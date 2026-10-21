# Agente de Órdenes de Compra (Reto 3)

Agente conversacional en TypeScript/Bun que valida solicitudes de compra contra maestros y crea OCs en un SAP simulado con confirmación humana.

## Correr

```bash
bun install
cp .env.example .env        # pon tu ANTHROPIC_API_KEY
bun demo.ts                 # verificación SIN LLM (6 casos)
bun run dev                 # chat en http://localhost:3000
```

## Estructura

```
agent/prompt.md          system prompt
src/tools/oc.ts          herramientas zod (única superficie de acción del LLM)
src/agent/loop.ts        ciclo tool-use con pausa para confirmación humana
src/domain/              normalizar.ts · extractores.ts · controles.ts (reglas)
src/data/maestros.ts     carga de fixtures
src/sap/                 puerto SapAdapter + SapSimulado
public/index.html        chat
demo.ts                  verificación determinista
fixtures/reto-03/        ⚠️ placeholders: reemplazar por los fixtures reales
```

## Cuando lleguen los fixtures reales (checklist de 2 horas)

1. Reemplaza `fixtures/reto-03/` por la carpeta real. Corre `bun demo.ts` de inmediato.
2. Si algo sale `undefined`: ajusta las rutas de `pick()` en `src/domain/normalizar.ts` y los tipos/`asArray` en `src/data/maestros.ts`. No toques el resto.
3. Lee las reglas del PRD y ajusta `CONTROLES` en `src/domain/controles.ts` (severidades, tope con/sin IVA, tolerancias). Agrega los controles que pida el PRD.
4. Si el PRD trae resultado esperado por caso, llénalo en `ESPERADO` de `demo.ts` hasta que todo salga ✓.
5. Despliega (abajo) y prueba el chat: "procesa todas las solicitudes".
6. Completa los ✏️ de `SOLUCION.md` con la tabla real de resultados.

## API

- `POST /api/chat` `{sessionId, message}` → eventos (text, tool_call, tool_result, confirmation, usage)
- `POST /api/confirm` `{sessionId, toolUseId, approved, comment?}`
- `POST /api/tools/:name` → ejecuta una herramienta sin LLM (respaldo para la defensa). Las que requieren confirmación necesitan `"confirmado": true`.
- `GET /api/health`

## Desplegar

**Railway / Render / Fly (Docker):** el `Dockerfile` está listo. Variables: `ANTHROPIC_API_KEY`, opcional `MODEL`, `PORT`.

```bash
# Fly.io
fly launch --now   # detecta el Dockerfile
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```
