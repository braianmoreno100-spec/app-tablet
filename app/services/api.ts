/**
 * services/api.ts
 * Capa de comunicación con el servidor FastAPI
 * Cambia API_URL por la IP de tu PC en la red local
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── CONFIGURACIÓN ───────────────────────────────────────────
// Cambia esta IP por la de tu PC (ejecuta ipconfig en Windows)
export const API_URL = 'http://192.168.1.8:8000';

// ─── HELPER BASE ─────────────────────────────────────────────
async function request<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: object
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Error ${response.status}`);
  }

  if (response.status === 204) return {} as T;
  return response.json();
}

// ─── TIPOS ───────────────────────────────────────────────────

export interface OrdenCreada {
  id: number;
  numero_orden: string;
  activa: boolean;
}

export interface TurnoIniciado {
  turno_id: number;
  mensaje: string;
}

export interface RegistroProduccionResp {
  id: number;
  turno_id: number;
  hora: string;
  cantidad: number;
}

// ─── AUTH ────────────────────────────────────────────────────

export const apiValidarLider = (cedula: string) =>
  request<{ cedula: string; nombre: string }>('/auth/lider', 'POST', { cedula });

export const apiValidarEmpleado = (cedula: string) =>
  request<{ cedula: string; nombre: string }>('/auth/empleado', 'POST', { cedula });

// ─── ÓRDENES ─────────────────────────────────────────────────

export const apiCrearOrden = (datos: {
  numero_orden: string;
  codigo_producto: string;
  descripcion_producto: string;
  cantidad_producir: number;
  material: string;
  tipo_maquina: string;
  numero_maquina: string;
  cavidades: number;
  ciclos: number;
  tiene_pigmento: boolean;
  numero_pigmento: string;
  descripcion_pigmento: string;
  cedula_lider: string;
  nombre_lider: string;
}) => request<OrdenCreada>('/ordenes/', 'POST', datos);

export const apiCerrarOrden = (orden_id: number) =>
  request(`/ordenes/${orden_id}/cerrar`, 'PUT');

// ─── TURNOS ──────────────────────────────────────────────────

export const apiIniciarTurno = (datos: {
  orden_id: number;
  cedula_empleado: string;
  nombre_empleado: string;
  turno: string;
  hora_inicio: string;
  fecha: string;
}) => request<TurnoIniciado>('/produccion/turno/iniciar', 'POST', datos);

export const apiCerrarTurno = (turno_id: number, hora_fin: string) =>
  request(`/produccion/turno/${turno_id}/cerrar`, 'PATCH', { turno_id, hora_fin });

// ─── PRODUCCIÓN POR HORA ─────────────────────────────────────

export const apiAgregarProduccion = (turno_id: number, hora: string, cantidad: number) =>
  request<RegistroProduccionResp>('/produccion/registro', 'POST', {
    turno_id,
    hora,
    cantidad,
  });

// ─── PARADAS ─────────────────────────────────────────────────

export const apiAgregarParada = (datos: {
  turno_id: number;
  codigo: number;
  descripcion: string;
  minutos: number;
  programada: boolean;
}) => request('/produccion/parada', 'POST', datos);

// ─── DESPERDICIOS ────────────────────────────────────────────

export const apiAgregarDesperdicio = (datos: {
  turno_id: number;
  codigo: number;
  defecto: string;
  cantidad: number;
}) => request('/produccion/desperdicio', 'POST', datos);

// ─── RELEVOS ─────────────────────────────────────────────────

export const apiIniciarRelevo = (datos: {
  turno_id: number;
  cedula_empleado: string;
  nombre_empleado: string;
  hora_inicio: string;
}) => request<{ id: number }>('/produccion/relevo', 'POST', datos);

export const apiCerrarRelevo = (relevo_id: number, hora_fin: string) =>
  request(`/produccion/relevo/${relevo_id}/cerrar`, 'PATCH', { hora_fin });

// ─── STORAGE HELPERS ─────────────────────────────────────────
// Guardan orden_id y turno_id en AsyncStorage para persistencia

export const guardarOrdenId = (id: number) =>
  AsyncStorage.setItem('orden_id', id.toString());

export const obtenerOrdenId = async (): Promise<number | null> => {
  const val = await AsyncStorage.getItem('orden_id');
  return val ? Number(val) : null;
};

export const guardarTurnoId = (id: number) =>
  AsyncStorage.setItem('turno_id', id.toString());

export const obtenerTurnoId = async (): Promise<number | null> => {
  const val = await AsyncStorage.getItem('turno_id');
  return val ? Number(val) : null;
};

export const limpiarIds = () =>
  AsyncStorage.multiRemove(['orden_id', 'turno_id']);
