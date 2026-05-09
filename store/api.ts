/**
 * services/api.ts
 * Capa de comunicación con el servidor FastAPI
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';

async function request<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: object
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Error ${response.status}`);
  }
  if (response.status === 204) return {} as T;
  return response.json();
}

export interface OrdenCreada        { id: number; numero_orden: string; activa: boolean; }
export interface TurnoIniciado      { turno_id: number; mensaje: string; }
export interface RegistroProduccionResp { id: number; turno_id: number; hora: string; cantidad: number; }
export interface CausaParadaAPI     { id: number; codigo: number; descripcion: string; programada: boolean; tipo_maquina: string; activa: boolean; }
export interface TipoDesperdicioAPI { id: number; codigo: number; descripcion: string; activa: boolean; }
export interface ResumenTurno       { hora_fin: string | null; oee: number; disponibilidad: number; rendimiento: number; calidad: number; tiempo_programado: number; tiempo_real: number; contador_produccion: number; produccion_planeada: number; total_paradas_min: number; total_desperdicio: number; }
export interface ProductoBD         { id: number; codigo: string; descripcion: string; material: string; cavidades: number; ciclos: number; peso_pieza: number; }

// Respuesta enriquecida del endpoint verificar:
// No existe:        { existe: false }
// Existe y cerrada: { existe: true, activa: false }
// Existe y abierta: { existe: true, activa: true, orden_id, turno_activo_id?, ...datos }
export interface VerificarOrdenResp {
  existe:              boolean;
  activa?:             boolean;
  orden_id?:           number;
  turno_activo_id?:    number | null;
  codigo_producto?:    string;
  descripcion_producto?: string;
  cantidad_producir?:  number;
  material?:           string;
  tipo_maquina?:       string;
  numero_maquina?:     string;
  cavidades?:          number;
  ciclos?:             number;
  tiene_pigmento?:     boolean;
  numero_pigmento?:    string;
  descripcion_pigmento?: string;
  cedula_lider?:       string;
  nombre_lider?:       string;
}

// ─── AUTH ────────────────────────────────────────────────────
export const apiValidarLider    = (cedula: string) => request<{ cedula: string; nombre: string }>('/auth/lider', 'POST', { cedula });
export const apiValidarEmpleado = (cedula: string) => request<{ cedula: string; nombre: string }>('/auth/empleado', 'POST', { cedula });

// ─── ÓRDENES ─────────────────────────────────────────────────
export const apiCrearOrden = (datos: {
  numero_orden: string; codigo_producto: string; descripcion_producto: string;
  cantidad_producir: number; material: string; tipo_maquina: string; numero_maquina: string;
  cavidades: number; ciclos: number; tiene_pigmento: boolean;
  numero_pigmento: string; descripcion_pigmento: string; cedula_lider: string; nombre_lider: string;
}) => request<OrdenCreada>('/ordenes/', 'POST', datos);

export const apiVerificarOrden = (numero_orden: string) =>
  request<VerificarOrdenResp>(`/ordenes/verificar/${encodeURIComponent(numero_orden)}`);

export const apiCerrarOrden = (orden_id: number) => request(`/ordenes/${orden_id}/cerrar`, 'PUT');

// ─── TURNOS ──────────────────────────────────────────────────
export const apiIniciarTurno = (datos: {
  orden_id: number; cedula_empleado: string; nombre_empleado: string;
  turno: string; hora_inicio: string; fecha: string;
}) => request<TurnoIniciado>('/produccion/turno/iniciar', 'POST', datos);

export const apiCerrarTurno     = (turno_id: number, hora_fin: string) => request(`/produccion/turno/${turno_id}/cerrar`, 'PATCH', { turno_id, hora_fin });
export const apiGetResumenTurno = (turno_id: number) => request<ResumenTurno>(`/produccion/turno/${turno_id}/resumen`);

// ─── PRODUCCIÓN ──────────────────────────────────────────────
export const apiAgregarProduccion = (turno_id: number, hora: string, cantidad: number) =>
  request<RegistroProduccionResp>('/produccion/registro', 'POST', { turno_id, hora, cantidad });

export const apiGetRegistrosTurno = (turno_id: number) =>
  request<RegistroProduccionResp[]>(`/produccion/registro/turno/${turno_id}`);

// ─── PARADAS ─────────────────────────────────────────────────
export const apiAgregarParada = (datos: { turno_id: number; codigo: number; descripcion: string; minutos: number; programada: boolean; }) =>
  request('/produccion/parada', 'POST', datos);

// ─── DESPERDICIOS ────────────────────────────────────────────
export const apiAgregarDesperdicio = (datos: { turno_id: number; codigo: number; defecto: string; cantidad: number; }) =>
  request('/produccion/desperdicio', 'POST', datos);

// ─── RELEVOS ─────────────────────────────────────────────────
export const apiIniciarRelevo = (datos: { turno_id: number; cedula_empleado: string; nombre_empleado: string; hora_inicio: string; }) =>
  request<{ id: number }>('/produccion/relevo', 'POST', datos);

export const apiCerrarRelevo = (relevo_id: number, hora_fin: string) =>
  request(`/produccion/relevo/${relevo_id}/cerrar?hora_fin=${hora_fin}`, 'PATCH');

// ─── STORAGE HELPERS ─────────────────────────────────────────
export const guardarOrdenId  = (id: number) => AsyncStorage.setItem('orden_id', id.toString());
export const obtenerOrdenId  = async (): Promise<number | null> => { const v = await AsyncStorage.getItem('orden_id'); return v ? Number(v) : null; };
export const guardarTurnoId  = (id: number) => AsyncStorage.setItem('turno_id', id.toString());
export const obtenerTurnoId  = async (): Promise<number | null> => { const v = await AsyncStorage.getItem('turno_id'); return v ? Number(v) : null; };
export const limpiarIds      = () => AsyncStorage.multiRemove(['orden_id', 'turno_id']);

// ─── PRODUCTOS / CATÁLOGOS ────────────────────────────────────
export const apiGetProducto         = (codigo: string)        => request<ProductoBD>(`/catalogos/productos/${encodeURIComponent(codigo)}`);
export const apiGetCausasParada     = (tipo_maquina: string)  => request<CausaParadaAPI[]>(`/catalogos/causas-parada?tipo_maquina=${tipo_maquina}&solo_activas=true`);
export const apiGetTiposDesperdicio = ()                      => request<TipoDesperdicioAPI[]>('/catalogos/tipos-desperdicio?solo_activas=true');