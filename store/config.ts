/**
 * config.ts
 * Configuración central de la app tablet Inverfarma.
 *
 * ── CAMBIAR DE RED ───────────────────────────────────────────
 * Al instalar en una nueva red, solo cambiar SERVER_IP abajo.
 * El resto del código se actualiza automáticamente.
 *
 * Cómo encontrar la IP del servidor:
 *   1. En el PC servidor abrir terminal
 *   2. Ejecutar: ipconfig
 *   3. Buscar "Dirección IPv4" de la red WiFi
 *   4. Pegar ese valor en SERVER_IP
 * ─────────────────────────────────────────────────────────────
 */

export const SERVER_IP   = '192.168.1.12';
export const SERVER_PORT = '8000';
export const API_URL     = `http://${SERVER_IP}:${SERVER_PORT}`;