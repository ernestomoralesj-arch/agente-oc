// Puerto (interfaz) hacia SAP. El agente nunca habla con SAP directo: solo con este contrato.
// En producción se reemplaza SapSimulado por SapOData / SapRfc sin tocar tools ni agente.
import type { PayloadOC } from "../domain/controles";

export interface MensajeSap { tipo: "S" | "W" | "E"; texto: string }

export interface OrdenSap {
  numeroOC: string;
  referenciaExterna: string;
  creadaEn: string;
  claseDocumento: string;
  payload: PayloadOC;
}

export interface ResultadoSap {
  ok: boolean;
  numeroOC?: string;
  /** false cuando la OC ya existía para esa referencia (idempotencia) */
  creada: boolean;
  mensajes: MensajeSap[];
}

export interface SapAdapter {
  crearOrdenCompra(p: PayloadOC): Promise<ResultadoSap>;
  consultarPorReferencia(referencia: string): Promise<OrdenSap | null>;
  listar(): Promise<OrdenSap[]>;
}
