// demo.ts — Verificación determinista SIN modelo de lenguaje.
// Recorre todas las solicitudes llamando directamente a las herramientas y demuestra:
//   1) decisión por caso, 2) creación de OC solo cuando corresponde (la confirmación humana se simula),
//   3) idempotencia (segunda creación no duplica), 4) determinismo (dos evaluaciones = mismo resultado).
// Uso: bun demo.ts        (exit code 1 si algún caso no coincide con ESPERADO)
import { ejecutarTool } from "./src/tools/oc";
import type { Evaluacion } from "./src/domain/controles";

// ✏️ Completar con el resultado esperado de cada caso según el PRD (deja vacío para solo reportar).
const ESPERADO: Record<string, Evaluacion["decision"]> = {
  // "sol-001": "APROBAR",
  // "sol-002": "RECHAZAR",
};

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const color = (d: string) => (d === "APROBAR" ? C.g : d === "RECHAZAR" ? C.r : C.y) + d + C.x;

const { solicitudes } = (await ejecutarTool("listar_solicitudes", {})) as { solicitudes: { id: string }[] };
console.log(`${C.b}Procesando ${solicitudes.length} solicitudes (sin LLM)${C.x}\n`);

const filas: string[][] = [];
let fallos = 0;

for (const { id } of solicitudes) {
  const ev = (await ejecutarTool("validar_controles", { solicitudId: id })) as Evaluacion;
  const ev2 = (await ejecutarTool("validar_controles", { solicitudId: id })) as Evaluacion;
  const determinista = JSON.stringify(ev) === JSON.stringify(ev2);

  const noOk = ev.resultados.filter((r) => r.estado !== "OK" && r.estado !== "NO_APLICA");
  console.log(`${C.b}${id}${C.x} → ${color(ev.decision)}${ev.retroactiva ? `  ${C.y}[RETROACTIVA]${C.x}` : ""}`);
  console.log(`  ${C.d}${ev.resultados.length - noOk.length}/${ev.resultados.length} controles OK o no aplican${C.x}`);
  for (const r of noOk) console.log(`  ${r.severidad === "BLOQUEANTE" ? C.r : C.y}✗ ${r.id} ${r.nombre}${C.x}: ${r.detalle}`);

  let oc = "—";
  if (ev.decision === "APROBAR") {
    // En el chat esto pasa por la tarjeta de confirmación humana; aquí se simula la aprobación.
    const r1: any = await ejecutarTool("crear_orden_compra", { solicitudId: id });
    const r2: any = await ejecutarTool("crear_orden_compra", { solicitudId: id });
    oc = r1.numeroOC ?? "error";
    const idem = r1.numeroOC === r2.numeroOC && r2.creada === false;
    console.log(`  ${C.g}OC ${oc}${C.x} creada (confirmación humana simulada) · idempotencia ${idem ? "✓" : "✗"}`);
    if (!idem) fallos++;
  } else if (ev.decision === "REVISION_HUMANA") {
    const sinJust: any = await ejecutarTool("crear_orden_compra", { solicitudId: id });
    console.log(`  ${C.y}Requiere decisión humana${C.x}; crear sin justificación → ${sinJust.creada ? "✗ se creó (no debía)" : "bloqueado ✓"}`);
    if (sinJust.creada) fallos++;
  } else {
    const intento: any = await ejecutarTool("crear_orden_compra", { solicitudId: id });
    console.log(`  ${C.r}No se crea OC${C.x}; intento forzado → ${intento.creada ? "✗ se creó (no debía)" : "bloqueado ✓"}`);
    if (intento.creada) fallos++;
  }

  const esperado = ESPERADO[id];
  const coincide = esperado ? esperado === ev.decision : null;
  if (coincide === false || !determinista) fallos++;
  filas.push([id, ev.decision, esperado ?? "—", coincide === null ? "—" : coincide ? "✓" : "✗", determinista ? "✓" : "✗", oc]);
  console.log();
}

console.log(`${C.b}Resumen${C.x}`);
console.table(filas.map(([id, decision, esperado, ok, det, oc]) => ({ id, decision, esperado, coincide: ok, determinista: det, oc })));
console.log(fallos ? `${C.r}${fallos} verificación(es) fallida(s)${C.x}` : `${C.g}Todas las verificaciones pasaron${C.x}`);
process.exit(fallos ? 1 : 0);
