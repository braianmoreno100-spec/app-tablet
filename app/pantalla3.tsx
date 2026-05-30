import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Modal, FlatList,
  ActivityIndicator, BackHandler, AppState
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { obtenerOrdenGlobal, limpiarOrdenGlobal } from '../store/useOrdenStore';
import { obtenerTurnoGlobal, guardarTurnoGlobal } from './pantalla2';
import { API_URL } from '../store/config';
import {
  apiAgregarProduccion, apiAgregarParada, apiAgregarDesperdicio,
  apiIniciarRelevo, apiCerrarRelevo, apiCerrarTurno, apiCerrarOrden,
  apiGetResumenTurno,
  obtenerTurnoId, obtenerOrdenId, limpiarIds, apiValidarEmpleado,
  apiGetCausasParada, apiGetTiposDesperdicio,
  apiIniciarParada, apiFinalizarParada, apiGetParadaActiva,
  CausaParadaAPI, TipoDesperdicioAPI,
} from '../store/api';
import { KoreLogo } from '../components/KoreLogo';

interface RegistroProduccion  { hora: string; cantidad: number; }
interface RegistroParada      { cod: number; descripcion: string; minutos: number; programada: boolean; }
interface RegistroDesperdicio { cod: number; defecto: string; cantidad: number; }
interface RegistroRelevo      { nombre: string; inicio: string; fin: string; }

interface PendienteBuffer { tipo: string; datos: object; timestamp: number; id: string; }
const PENDING_KEY = 'registros_pendientes_v2';

function formatearTiempo(segundos: number): string {
  const m = Math.floor(segundos / 60).toString().padStart(2, '0');
  const s = (segundos % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Pantalla3() {
  const router      = useRouter();
  const orden       = obtenerOrdenGlobal();
  const turno       = obtenerTurnoGlobal();
  const tipoMaquina = orden?.tipoMaquina ?? 'inyeccion';
  const meta        = orden?.cantidadProducir ?? 0;

  const [conectado,     setConectado]     = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const pingRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const conectadoRef = useRef(true);

  const setConectadoSync = (val: boolean) => {
    conectadoRef.current = val;
    setConectado(val);
  };

  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        calcularProximaHoraDesdeInicio();
        recuperarParadaActiva();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const verificarConexion = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${API_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        const estabaDesconectado = !conectadoRef.current;
        setConectadoSync(res.ok);
        if (res.ok && estabaDesconectado) await sincronizarPendientes();
      } catch { setConectadoSync(false); }
    };
    verificarConexion();
    pingRef.current = setInterval(verificarConexion, 15000);
    return () => { if (pingRef.current) clearInterval(pingRef.current); };
  }, []);

  const [produccion,          setProduccion]          = useState<RegistroProduccion[]>([]);
  const [unidadesHora,        setUnidadesHora]        = useState('');
  const [guardandoProduccion, setGuardandoProduccion] = useState(false);
  const [errorProduccion,     setErrorProduccion]     = useState('');

  const [desperdRegistrados,  setDesperdRegistrados]  = useState<RegistroDesperdicio[]>([]);
  const [desperdSeleccionado, setDesperdSeleccionado] = useState<TipoDesperdicioAPI | null>(null);
  const [cantidadDesperd,     setCantidadDesperd]     = useState('');
  const [modalDesperdicios,   setModalDesperdicios]   = useState(false);
  const [guardandoDesperd,    setGuardandoDesperd]    = useState(false);

  const [paradasRegistradas,  setParadasRegistradas]  = useState<RegistroParada[]>([]);
  const [paradaSeleccionada,  setParadaSeleccionada]  = useState<CausaParadaAPI | null>(null);
  const [modalParadas,        setModalParadas]        = useState(false);
  const [guardandoParada,     setGuardandoParada]     = useState(false);

  const [paradaActiva,      setParadaActiva]      = useState(false);
  const [paradaSegundos,    setParadaSegundos]    = useState(0);
  const [paradaIdActiva,    setParadaIdActiva]    = useState<number | null>(null);
  const paradaTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const paradaCausaActiva   = useRef<CausaParadaAPI | null>(null);
  const paradaTsInicio      = useRef<number | null>(null);

  const recuperarParadaActiva = async () => {
    if (paradaActiva) return;
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) return;
      const resp = await apiGetParadaActiva(turnoId);
      if (resp?.hay_parada_activa) {
        paradaCausaActiva.current = {
          id: 0, codigo: resp.codigo, descripcion: resp.descripcion,
          programada: resp.programada, tipo_maquina: tipoMaquina, activa: true,
        };
        paradaTsInicio.current = resp.timestamp_inicio;
        setParadaIdActiva(resp.parada_id);
        setParadaSegundos(resp.segundos_activa ?? 0);
        setParadaActiva(true);
        let seg = resp.segundos_activa ?? 0;
        paradaTimerRef.current = setInterval(() => { seg += 1; setParadaSegundos(seg); }, 1000);
      }
    } catch {}
  };

  const guardarPendiente = async (tipo: string, datos: object): Promise<string> => {
    const id = `${tipo}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const raw        = await AsyncStorage.getItem(PENDING_KEY);
      const pendientes: PendienteBuffer[] = raw ? JSON.parse(raw) : [];
      pendientes.push({ tipo, datos, timestamp: Date.now(), id });
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pendientes));
    } catch {}
    return id;
  };

  const sincronizarPendientes = async () => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const pendientes: PendienteBuffer[] = JSON.parse(raw);
      if (pendientes.length === 0) return;
      const exitosos: string[] = [];
      for (const p of pendientes) {
        try {
          if (p.tipo === 'produccion') { const d = p.datos as any; await apiAgregarProduccion(d.turno_id, d.hora, d.cantidad); }
          if (p.tipo === 'parada')      await apiAgregarParada(p.datos as any);
          if (p.tipo === 'desperdicio') await apiAgregarDesperdicio(p.datos as any);
          exitosos.push(p.id);
        } catch {}
      }
      const restantes = pendientes.filter(p => !exitosos.includes(p.id));
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(restantes));
      if (exitosos.length > 0) Alert.alert('Sincronizado', `${exitosos.length} registro(s) pendiente(s) enviado(s) al servidor.`);
    } catch {}
  };

  const pendientesCount = useRef(0);

  const [paradas,           setParadas]           = useState<CausaParadaAPI[]>([]);
  const [desperdicios,      setDesperdicios]      = useState<TipoDesperdicioAPI[]>([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);

  useEffect(() => {
    const inicializar = async () => {
      if (!obtenerTurnoGlobal()) {
        const guardado = await AsyncStorage.getItem('turno_activo');
        if (guardado) { try { guardarTurnoGlobal(JSON.parse(guardado)); } catch {} }
      }
      try {
        const turnoId = await obtenerTurnoId();
        if (turnoId) {
          const resumen   = await apiGetResumenTurno(turnoId);
          const totalProd = resumen.total_produccion ?? (resumen as any).contador_produccion ?? 0;
          if (totalProd > 0) {
            if (Array.isArray(resumen.registros_produccion) && resumen.registros_produccion.length > 0) {
              setProduccion(resumen.registros_produccion.map((r: any) => ({ hora: r.hora, cantidad: r.cantidad })));
            } else { setProduccion([{ hora: 'Sesión anterior', cantidad: totalProd }]); }
          }
          if (resumen.total_desperdicio > 0) {
            if (Array.isArray(resumen.desperdicios) && resumen.desperdicios.length > 0) {
              setDesperdRegistrados(resumen.desperdicios.map((d: any) => ({ cod: d.codigo, defecto: d.defecto, cantidad: d.cantidad })));
            } else { setDesperdRegistrados([{ cod: 0, defecto: 'Sesiones anteriores', cantidad: resumen.total_desperdicio }]); }
          }
          if (Array.isArray(resumen.paradas) && resumen.paradas.length > 0) {
            setParadasRegistradas(resumen.paradas.filter((p: any) => !p.activa).map((p: any) => ({
              cod: p.codigo, descripcion: p.descripcion, minutos: p.minutos, programada: p.programada,
            })));
          }
        }
      } catch {}
      try {
        const raw = await AsyncStorage.getItem(PENDING_KEY);
        const p   = raw ? JSON.parse(raw) : [];
        pendientesCount.current = p.length;
      } catch {}
      await recuperarParadaActiva();
    };
    inicializar();
  }, []);

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [causas, tipos] = await Promise.all([apiGetCausasParada(tipoMaquina), apiGetTiposDesperdicio()]);
        setParadas(causas); setDesperdicios(tipos);
      } catch { Alert.alert('Aviso', 'No se pudieron cargar los catálogos. Verifica la conexión.'); }
      finally { setCargandoCatalogos(false); }
    };
    cargarCatalogos();
  }, [tipoMaquina]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Turno en curso', 'No puedes salir mientras hay un turno activo. Usa "Fin de turno" para cerrar correctamente.',
        [{ text: 'Entendido', style: 'cancel' }]);
      return true;
    });
    return () => backHandler.remove();
  }, []);

  useEffect(() => { return () => { if (paradaTimerRef.current) clearInterval(paradaTimerRef.current); }; }, []);

  const [cedulaRelevo,     setCedulaRelevo]     = useState('');
  const [nombreRelevo,     setNombreRelevo]     = useState('');
  const [relevoActivo,     setRelevoActivo]     = useState(false);
  const [horaInicioRelevo, setHoraInicioRelevo] = useState('');
  const [relevoIdActivo,   setRelevoIdActivo]   = useState<number | null>(null);
  const [historialRelevos, setHistorialRelevos] = useState<RegistroRelevo[]>([]);

  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const proximaHoraRef = useRef<Date | null>(null);
  const [proximaHora, setProximaHora] = useState('');

  const calcularProximaHoraDesdeInicio = () => {
    const horaInicioStr = turno?.horaInicio ?? '';
    let base: Date;
    if (horaInicioStr) {
      const partes = horaInicioStr.split(':');
      const hh = parseInt(partes[0], 10);
      const mm = parseInt(partes[1], 10);
      base = new Date(); base.setHours(hh, mm, 0, 0);
    } else { base = new Date(); }
    const proxima = new Date(base);
    const ahora   = new Date();
    while (proxima <= ahora) { proxima.setHours(proxima.getHours() + 1); }
    proximaHoraRef.current = proxima;
    setProximaHora(proxima.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }));
  };

  const verificarHora = () => {
    const ahora   = new Date();
    const proxima = proximaHoraRef.current;
    if (!proxima) return;
    if (ahora.getHours() === proxima.getHours() && ahora.getMinutes() === proxima.getMinutes()) {
      Alert.alert('⏰ Registro de producción', 'Es hora de registrar las unidades producidas');
      proxima.setHours(proxima.getHours() + 1);
      proximaHoraRef.current = new Date(proxima);
      setProximaHora(proxima.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }));
    }
  };

  useEffect(() => {
    calcularProximaHoraDesdeInicio();
    intervalRef.current = setInterval(verificarHora, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const horaActual = () => new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  const totalContador      = produccion.reduce((acc, r) => acc + r.cantidad, 0);
  const totalRechazados    = desperdRegistrados.reduce((acc, r) => acc + r.cantidad, 0);
  const totalProducidoReal = Math.max(0, totalContador - totalRechazados);
  const totalDesperdicios  = totalRechazados;
  const progresoPct        = meta > 0 ? Math.min(100, Math.round((totalProducidoReal / meta) * 100)) : 0;
  const ordenCompleta      = totalProducidoReal >= meta && meta > 0;

  const limiteUdsHora = (() => {
    const cav = Number(orden?.cavidades ?? 0);
    const cic = Number(orden?.ciclos    ?? 0);
    if (cav <= 0 || cic <= 0) return 0;
    if (tipoMaquina === 'acondicionamiento') return Math.floor(cav * cic);
    return Math.floor(cav * cic * 60);
  })();

  const ultimaHoraProduccion = produccion.length > 0 ? produccion[produccion.length - 1].cantidad : null;
  const ritmoVsMeta = (() => {
    if (ultimaHoraProduccion == null || limiteUdsHora <= 0) return null;
    return Math.round(((ultimaHoraProduccion - limiteUdsHora) / limiteUdsHora) * 100);
  })();
  const colorRitmo  = ritmoVsMeta == null ? '#6b8aa0' : ritmoVsMeta >= 0 ? '#00C896' : ritmoVsMeta >= -20 ? '#FF6B35' : '#f87171';
  const bgRitmo     = ritmoVsMeta == null ? '#1e2d3d' : ritmoVsMeta >= 0 ? '#003d2e' : ritmoVsMeta >= -20 ? '#2d1f00' : '#3b1010';
  const borderRitmo = ritmoVsMeta == null ? '#243040' : ritmoVsMeta >= 0 ? '#00573d' : ritmoVsMeta >= -20 ? '#854d0e' : '#5a1a1a';

  const handleSincronizarManual = async () => {
    setSincronizando(true);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error();
      setConectadoSync(true);
      const raw        = await AsyncStorage.getItem(PENDING_KEY);
      const pendientes = raw ? JSON.parse(raw) : [];
      if (pendientes.length === 0) { Alert.alert('✓ Al día', 'No hay registros pendientes.'); }
      else { await sincronizarPendientes(); }
    } catch {
      setConectadoSync(false);
      Alert.alert('Sin conexión', 'No se pudo conectar al servidor. Los registros siguen guardados localmente.');
    } finally { setSincronizando(false); }
  };

  const handleCambioUnidades = (texto: string) => {
    setUnidadesHora(texto);
    const cantidad = Number(texto);
    if (limiteUdsHora > 0 && cantidad > limiteUdsHora) {
      setErrorProduccion(`Máximo permitido: ${limiteUdsHora.toLocaleString('es-CO')} uds/hora`);
    } else { setErrorProduccion(''); }
  };

  const produccionSuperaLimite = limiteUdsHora > 0 && Number(unidadesHora) > limiteUdsHora;

  const handleAgregarProduccion = async () => {
    if (!unidadesHora || Number(unidadesHora) <= 0) { Alert.alert('Error', 'Ingresa una cantidad válida'); return; }
    if (produccionSuperaLimite) return;
    await guardarProduccion(Number(unidadesHora));
  };

  const guardarProduccion = async (cantidad: number) => {
    const hora = horaActual();
    setGuardandoProduccion(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      if (!conectadoRef.current) {
        await guardarPendiente('produccion', { turno_id: turnoId, hora, cantidad });
      } else { await apiAgregarProduccion(turnoId, hora, cantidad); }
      setProduccion(p => [...p, { hora, cantidad }]);
      setUnidadesHora(''); setErrorProduccion('');
    } catch (error: any) {
      const turnoId = await obtenerTurnoId().catch(() => null);
      if (turnoId) {
        await guardarPendiente('produccion', { turno_id: turnoId, hora, cantidad });
        setProduccion(p => [...p, { hora, cantidad }]);
        setUnidadesHora(''); setErrorProduccion('');
        Alert.alert('Sin conexión', 'Registro guardado localmente. Se enviará cuando vuelva la señal.');
      } else { Alert.alert('Error', 'No se pudo guardar el registro'); }
    } finally { setGuardandoProduccion(false); }
  };

  const handleIniciarParada = async () => {
    if (!paradaSeleccionada) { Alert.alert('Error', 'Selecciona el tipo de parada primero'); return; }
    if (paradaActiva) { Alert.alert('Error', 'Ya hay una parada activa. Finalízala antes de iniciar otra.'); return; }
    const tsInicio = Date.now();
    paradaCausaActiva.current = paradaSeleccionada;
    paradaTsInicio.current    = tsInicio;
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      if (conectadoRef.current) {
        const resp = await apiIniciarParada({
          turno_id: turnoId, codigo: paradaSeleccionada.codigo,
          descripcion: paradaSeleccionada.descripcion, programada: paradaSeleccionada.programada,
          timestamp_inicio: tsInicio,
        });
        setParadaIdActiva(resp.id);
      } else { setParadaIdActiva(null); }
    } catch (error: any) { Alert.alert('Error', error.message || 'No se pudo iniciar la parada'); return; }
    setParadaSeleccionada(null); setParadaSegundos(0); setParadaActiva(true);
    paradaTimerRef.current = setInterval(() => { setParadaSegundos(s => s + 1); }, 1000);
  };

  const handleFinalizarParada = async () => {
    if (!paradaActiva || !paradaCausaActiva.current) return;
    if (paradaTimerRef.current) { clearInterval(paradaTimerRef.current); paradaTimerRef.current = null; }
    const tsFin   = Date.now();
    const minutos = Math.max(1, Math.round(paradaSegundos / 60));
    const causa   = paradaCausaActiva.current;
    setGuardandoParada(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      if (paradaIdActiva && conectadoRef.current) {
        await apiFinalizarParada(paradaIdActiva, tsFin);
      } else {
        const datosParada = { turno_id: turnoId, codigo: causa.codigo, descripcion: causa.descripcion, minutos, programada: causa.programada };
        if (conectadoRef.current) { await apiAgregarParada(datosParada); }
        else { await guardarPendiente('parada', datosParada); }
      }
      setParadasRegistradas(p => [...p, { cod: causa.codigo, descripcion: causa.descripcion, minutos, programada: causa.programada }]);
    } catch (error: any) { Alert.alert('Error', error.message || 'No se pudo guardar la parada'); }
    finally {
      setGuardandoParada(false); setParadaActiva(false); setParadaSegundos(0);
      setParadaIdActiva(null); paradaCausaActiva.current = null; paradaTsInicio.current = null;
    }
  };

  const handleAgregarDesperdicio = async () => {
    if (!desperdSeleccionado) { Alert.alert('Error', 'Selecciona el tipo de defecto'); return; }
    if (!cantidadDesperd || Number(cantidadDesperd) <= 0) { Alert.alert('Error', 'Ingresa la cantidad'); return; }
    setGuardandoDesperd(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      const datosDesperd = { turno_id: turnoId, codigo: desperdSeleccionado.codigo, defecto: desperdSeleccionado.descripcion, cantidad: Number(cantidadDesperd) };
      if (!conectadoRef.current) { await guardarPendiente('desperdicio', datosDesperd); }
      else { await apiAgregarDesperdicio(datosDesperd); }
      setDesperdRegistrados(p => [...p, { cod: desperdSeleccionado.codigo, defecto: desperdSeleccionado.descripcion, cantidad: Number(cantidadDesperd) }]);
      setDesperdSeleccionado(null); setCantidadDesperd('');
    } catch (error: any) { Alert.alert('Error', error.message || 'No se pudo guardar el desperdicio'); }
    finally { setGuardandoDesperd(false); }
  };

  const handleInicioRelevo = async () => {
    if (!cedulaRelevo || !nombreRelevo) { Alert.alert('Error', 'Ingresa la cédula del empleado en relevo'); return; }
    if (relevoActivo) { Alert.alert('Error', 'Ya hay un relevo activo'); return; }
    if (cedulaRelevo === turno?.cedulaEmpleado) { Alert.alert('Error', 'El empleado en relevo debe ser diferente al operario actual'); return; }
    const hora = horaActual();
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      const resp = await apiIniciarRelevo({ turno_id: turnoId, cedula_empleado: cedulaRelevo, nombre_empleado: nombreRelevo, hora_inicio: hora });
      setRelevoIdActivo(resp.id); setHoraInicioRelevo(hora); setRelevoActivo(true);
    } catch (error: any) { Alert.alert('Error', error.message || 'No se pudo registrar el relevo'); }
  };

  const handleFinRelevo = async () => {
    if (!relevoActivo || !relevoIdActivo) { Alert.alert('Error', 'No hay un relevo activo'); return; }
    const hora = horaActual();
    try {
      await apiCerrarRelevo(relevoIdActivo, hora);
      setHistorialRelevos(h => [...h, { nombre: nombreRelevo, inicio: horaInicioRelevo, fin: hora }]);
      setRelevoActivo(false); setRelevoIdActivo(null);
      setCedulaRelevo(''); setNombreRelevo(''); setHoraInicioRelevo('');
    } catch (error: any) { Alert.alert('Error', error?.message || error?.detail || 'No se pudo cerrar el relevo'); }
  };

  // ── Lógica compartida para cerrar turno ────────────────────────────────────
  const cerrarTurnoBase = async (): Promise<boolean> => {
    if (paradaActiva) {
      Alert.alert('Parada activa', 'Hay una parada en curso. Finalízala antes de continuar.', [{ text: 'Entendido', style: 'cancel' }]);
      return false;
    }
    if (relevoActivo && relevoIdActivo) {
      const hora = horaActual();
      try { await apiCerrarRelevo(relevoIdActivo, hora); } catch {}
    }
    try {
      const turnoId = await obtenerTurnoId();
      if (turnoId) await apiCerrarTurno(turnoId, horaActual());
      guardarTurnoGlobal(null);
      return true;
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'No se pudo cerrar el turno');
      return false;
    }
  };

  // ── Fin de turno → va a pantalla 2 (nuevo turno en la misma orden) ─────────
  const handleFinTurno = () => {
    if (paradaActiva) {
      Alert.alert('Parada activa', 'Hay una parada en curso. Finalízala antes de cerrar el turno.', [{ text: 'Entendido', style: 'cancel' }]);
      return;
    }
    if (relevoActivo && relevoIdActivo) {
      Alert.alert('Relevo activo', `Hay un relevo en curso de ${nombreRelevo}. Se cerrará automáticamente.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar relevo y turno', style: 'destructive', onPress: async () => {
          const ok = await cerrarTurnoBase();
          if (ok) router.replace('/pantalla2');
        }},
      ]);
      return;
    }
    Alert.alert(
      'Fin de turno',
      '¿Deseas cerrar este turno?\n\nPodrás iniciar un nuevo turno en la misma orden.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
          const ok = await cerrarTurnoBase();
          if (ok) router.replace('/pantalla2');
        }},
      ]
    );
  };

  // ── Pausar orden → cierra turno y va a pantalla 1 (deja orden para después) ─
  const handlePausarOrden = () => {
    if (paradaActiva) {
      Alert.alert('Parada activa', 'Hay una parada en curso. Finalízala antes de pausar la orden.', [{ text: 'Entendido', style: 'cancel' }]);
      return;
    }
    Alert.alert(
      '⏸ Pausar orden',
      `¿Deseas pausar la orden ${orden?.numeroOrden}?\n\nEl turno se cerrará y la orden quedará disponible para que otro operario la retome desde la pantalla principal.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Pausar orden', style: 'destructive', onPress: async () => {
          const ok = await cerrarTurnoBase();
          if (ok) {
            // Limpiar estado de turno pero mantener la orden activa en el servidor
            // La orden queda activa=true en BD — el próximo operario la retoma desde pantalla 1
            router.replace('/pantalla1');
          }
        }},
      ]
    );
  };

  // ── Fin de orden ───────────────────────────────────────────────────────────
  const handleFinOrden = () => {
    if (!ordenCompleta) return;
    if (paradaActiva) {
      Alert.alert('Parada activa', 'Finaliza la parada en curso antes de cerrar la orden.', [{ text: 'Entendido', style: 'cancel' }]);
      return;
    }
    const verificarYCerrar = async () => {
      try {
        const raw        = await AsyncStorage.getItem(PENDING_KEY);
        const pendientes = raw ? JSON.parse(raw) : [];
        if (pendientes.length > 0) {
          Alert.alert('Registros pendientes', `Hay ${pendientes.length} registro(s) sin sincronizar. ¿Sincronizar antes de cerrar la orden?`, [
            { text: 'Sincronizar primero', onPress: async () => { await sincronizarPendientes(); confirmarFinOrden(); }},
            { text: 'Cerrar sin sincronizar', style: 'destructive', onPress: confirmarFinOrden },
            { text: 'Cancelar', style: 'cancel' },
          ]);
          return;
        }
      } catch {}
      confirmarFinOrden();
    };
    if (relevoActivo && relevoIdActivo) {
      Alert.alert('Relevo activo', 'Hay un relevo en curso. Se cerrará al finalizar la orden.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar relevo y orden', style: 'destructive', onPress: verificarYCerrar },
      ]);
      return;
    }
    verificarYCerrar();
  };

  const confirmarFinOrden = () => {
    Alert.alert('Fin de orden',
      `Producidos: ${totalProducidoReal.toLocaleString('es-CO')} uds reales de ${meta.toLocaleString('es-CO')}. ¿Confirmar cierre?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
          try {
            const hora    = horaActual();
            const turnoId = await obtenerTurnoId();
            const ordenId = await obtenerOrdenId();
            if (relevoActivo && relevoIdActivo) await apiCerrarRelevo(relevoIdActivo, hora).catch(() => {});
            if (turnoId) await apiCerrarTurno(turnoId, hora);
            if (ordenId) await apiCerrarOrden(ordenId);
          } catch {}
          await limpiarIds();
          guardarTurnoGlobal(null);
          limpiarOrdenGlobal();
          router.replace('/pantalla1');
        }},
      ]
    );
  };

  if (cargandoCatalogos) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#00C896" />
        <Text style={s.loadingText}>Cargando catálogos...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {!conectado && (
        <View style={s.bannerSinConexion}>
          <Text style={s.bannerTexto}>⚠ Sin conexión — los registros se guardan localmente y se enviarán cuando vuelva la señal</Text>
        </View>
      )}

      {paradaActiva && (
        <View style={s.bannerParadaActiva}>
          <Text style={s.bannerParadaTexto} numberOfLines={1}>🔴 {paradaCausaActiva.current?.descripcion}</Text>
          <Text style={s.bannerParadaCronometro}>{formatearTiempo(paradaSegundos)}</Text>
        </View>
      )}

      {/* Meta y progreso */}
      <View style={s.metaCard}>
        <View style={s.conexionRow}>
          <View style={s.conexionIndicador}>
            <View style={[s.conexionDot, conectado ? s.conexionDotOk : s.conexionDotFail]} />
            <Text style={[s.conexionTexto, conectado ? s.conexionTextoOk : s.conexionTextoFail]}>
              {conectado ? 'Conectado' : 'Sin conexión'}
            </Text>
          </View>
          <TouchableOpacity style={[s.btnSync, sincronizando && s.btnSyncActivo]} onPress={handleSincronizarManual} disabled={sincronizando}>
            <Text style={s.btnSyncTexto}>{sincronizando ? '↻ Sincronizando...' : '↻ Sincronizar'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaLogoWrap}><KoreLogo size={40} dark /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.metaLabel}>Meta a producir</Text>
            <Text style={s.metaValor}>{meta.toLocaleString('es-CO')} uds</Text>
          </View>
          <View style={[s.metaCirculo, ordenCompleta && s.metaCirculoOk]}>
            <Text style={[s.metaPct, ordenCompleta && s.metaPctOk]}>{progresoPct}%</Text>
          </View>
        </View>

        <View style={s.barraFondo}>
          <View style={[s.barraRelleno, { width: `${progresoPct}%` as any }, ordenCompleta && s.barraRellenoOk]} />
        </View>

        <Text style={s.metaInfo}>
          Producido real: <Text style={s.metaInfoAcento}>{totalProducidoReal.toLocaleString('es-CO')} uds</Text>
          {'  ·  '}Contador: <Text style={{ color: '#6b8aa0' }}>{totalContador.toLocaleString('es-CO')}</Text>
          {totalRechazados > 0 && <Text style={{ color: '#f87171' }}>  ·  Rechazos: {totalRechazados.toLocaleString('es-CO')}</Text>}
        </Text>
        <Text style={s.metaInfo}>
          Faltan: <Text style={ordenCompleta ? s.metaInfoOk : s.metaInfoPendiente}>
            {ordenCompleta ? '¡Completado!' : `${Math.max(0, meta - totalProducidoReal).toLocaleString('es-CO')} uds`}
          </Text>
        </Text>
        <Text style={s.metaInfoSub}>
          {orden?.numeroOrden} · {turno?.nombreEmpleado} · Próximo registro: {proximaHora}
        </Text>
      </View>

      {/* Producción */}
      <View style={s.card}>
        <Text style={s.seccion}>PRODUCCIÓN POR HORA</Text>
        {limiteUdsHora > 0 && (
          <View style={s.ritmoDashboard}>
            <View style={[s.ritmoTarjeta, { backgroundColor: '#003d2e', borderColor: '#00573d' }]}>
              <Text style={[s.ritmoLabel, { color: '#1e6b50' }]}>Meta/hora</Text>
              <Text style={[s.ritmoValor, { color: '#00C896' }]}>{limiteUdsHora.toLocaleString('es-CO')}</Text>
              <Text style={[s.ritmoSub,   { color: '#1e6b50' }]}>uds esperadas</Text>
            </View>
            <View style={[s.ritmoTarjeta, { backgroundColor: '#1e2d3d', borderColor: '#243040' }]}>
              <Text style={[s.ritmoLabel, { color: '#3d5568' }]}>Última hora</Text>
              <Text style={[s.ritmoValor, { color: '#b8c8d8' }]}>
                {ultimaHoraProduccion != null ? ultimaHoraProduccion.toLocaleString('es-CO') : '—'}
              </Text>
              <Text style={[s.ritmoSub, { color: '#3d5568' }]}>uds registradas</Text>
            </View>
            <View style={[s.ritmoTarjeta, { backgroundColor: bgRitmo, borderColor: borderRitmo }]}>
              <Text style={[s.ritmoLabel, { color: colorRitmo, opacity: 0.7 }]}>Ritmo</Text>
              <Text style={[s.ritmoValor, { color: colorRitmo }]}>
                {ritmoVsMeta == null ? '—' : ritmoVsMeta >= 0 ? `+${ritmoVsMeta}%` : `${ritmoVsMeta}%`}
              </Text>
              <Text style={[s.ritmoSub, { color: colorRitmo, opacity: 0.7 }]}>
                {ritmoVsMeta == null ? 'sin datos aún' : ritmoVsMeta >= 0 ? 'sobre la meta' : 'bajo la meta'}
              </Text>
            </View>
          </View>
        )}
        <View style={s.fila}>
          <View style={{ flex: 1 }}>
            <TextInput style={[s.input, produccionSuperaLimite && s.inputError]}
              value={unidadesHora} onChangeText={handleCambioUnidades}
              placeholder="Unidades producidas esta hora" placeholderTextColor="#3d5568" keyboardType="numeric" />
            {errorProduccion !== '' && <Text style={s.textoError}>{errorProduccion}</Text>}
          </View>
          <TouchableOpacity style={[s.btnAgregar, (guardandoProduccion || produccionSuperaLimite) && s.btnDisabled]}
            onPress={handleAgregarProduccion} disabled={guardandoProduccion || produccionSuperaLimite}>
            <Text style={s.btnAgregarText}>{guardandoProduccion ? '...' : '+ Agregar'}</Text>
          </TouchableOpacity>
        </View>
        {produccion.length > 0 && (
          <View style={s.listaRegistros}>
            <Text style={s.totalText}>Contador total: <Text style={s.totalAcento}>{totalContador.toLocaleString('es-CO')} uds</Text></Text>
            {produccion.map((r, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={s.registroHora}>{r.hora}</Text>
                <Text style={s.registroCantidad}>{r.cantidad.toLocaleString('es-CO')} uds</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Paradas */}
      <View style={s.card}>
        <Text style={s.seccion}>PARADAS</Text>
        {!paradaActiva ? (
          <>
            <TouchableOpacity style={s.selector} onPress={() => setModalParadas(true)}>
              <Text style={[s.selectorText, !paradaSeleccionada && s.placeholder]}>
                {paradaSeleccionada ? `${paradaSeleccionada.codigo}. ${paradaSeleccionada.descripcion}` : 'Selecciona el tipo de parada'}
              </Text>
              <Text style={s.selectorChevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnIniciarParada, !paradaSeleccionada && s.btnDisabled]}
              onPress={handleIniciarParada} disabled={!paradaSeleccionada}>
              <Text style={s.btnIniciarParadaText}>▶ Iniciar parada</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.paradaActivaCard}>
            <View style={s.paradaActivaHeader}>
              <View style={s.paradaActivaDot} />
              <Text style={s.paradaActivaCausa} numberOfLines={2}>
                {paradaCausaActiva.current?.codigo}. {paradaCausaActiva.current?.descripcion}
              </Text>
            </View>
            <Text style={s.paradaCronometroGrande}>{formatearTiempo(paradaSegundos)}</Text>
            <Text style={s.paradaCronometroSub}>tiempo transcurrido</Text>
            <TouchableOpacity style={[s.btnFinalizarParada, guardandoParada && s.btnDisabled]}
              onPress={handleFinalizarParada} disabled={guardandoParada}>
              <Text style={s.btnFinalizarParadaText}>
                {guardandoParada ? 'Guardando...' : `■ Finalizar parada (${Math.max(1, Math.round(paradaSegundos / 60))} min)`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {paradasRegistradas.length > 0 && (
          <View style={[s.listaRegistros, { marginTop: 10 }]}>
            {paradasRegistradas.map((p, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={[s.registroHora, { flex: 1 }]}>{p.cod}. {p.descripcion}</Text>
                <Text style={[s.registroCantidad, { color: p.programada ? '#6b8aa0' : '#f87171' }]}>{p.minutos} min</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Desperdicios */}
      <View style={s.card}>
        <Text style={s.seccion}>DESPERDICIOS</Text>
        <TouchableOpacity style={s.selector} onPress={() => setModalDesperdicios(true)}>
          <Text style={[s.selectorText, !desperdSeleccionado && s.placeholder]}>
            {desperdSeleccionado ? `${desperdSeleccionado.codigo}. ${desperdSeleccionado.descripcion}` : 'Selecciona el tipo de defecto'}
          </Text>
          <Text style={s.selectorChevron}>›</Text>
        </TouchableOpacity>
        <View style={s.fila}>
          <TextInput style={[s.input, { flex: 1 }]} value={cantidadDesperd} onChangeText={setCantidadDesperd}
            placeholder="Unidades rechazadas" placeholderTextColor="#3d5568" keyboardType="numeric" />
          <TouchableOpacity style={[s.btnAgregar, guardandoDesperd && s.btnDisabled]}
            onPress={handleAgregarDesperdicio} disabled={guardandoDesperd}>
            <Text style={s.btnAgregarText}>{guardandoDesperd ? '...' : '+ Agregar'}</Text>
          </TouchableOpacity>
        </View>
        {desperdRegistrados.length > 0 && (
          <View style={s.listaRegistros}>
            <Text style={s.totalText}>Rechazos: <Text style={s.totalRechazo}>{totalDesperdicios.toLocaleString('es-CO')} uds</Text></Text>
            {desperdRegistrados.map((d, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={[s.registroHora, { flex: 1 }]}>{d.cod}. {d.defecto}</Text>
                <Text style={s.registroCantidad}>{d.cantidad.toLocaleString('es-CO')} uds</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Relevos */}
      <View style={s.card}>
        <View style={s.relevoSeccionRow}>
          <Text style={s.seccion}>RELEVO</Text>
          {relevoActivo
            ? <View style={s.relevoEstadoBadge}><Text style={s.relevoEstadoTextoActivo}>● EN CURSO</Text></View>
            : <View style={[s.relevoEstadoBadge, s.relevoEstadoLibre]}><Text style={s.relevoEstadoTextoLibre}>○ LIBRE</Text></View>
          }
        </View>
        <Text style={s.label}>{relevoActivo ? 'Cédula bloqueada durante el relevo' : 'Cédula del empleado en relevo'}</Text>
        <TextInput
          style={[s.input, relevoActivo && s.inputDeshabilitado]}
          value={cedulaRelevo}
          onChangeText={async v => {
            setCedulaRelevo(v); setNombreRelevo('');
            if (v.length >= 5) {
              try { const r = await apiValidarEmpleado(v); setNombreRelevo(r.nombre); }
              catch { setNombreRelevo('Empleado no encontrado'); }
            }
          }}
          placeholder="Ingresa la cédula" placeholderTextColor={relevoActivo ? '#1e2d3d' : '#3d5568'}
          keyboardType="numeric" editable={!relevoActivo}
        />
        <Text style={s.label}>Nombre del empleado en relevo</Text>
        <View style={s.inputAuto}>
          <Text style={[s.inputAutoText, !nombreRelevo && s.placeholder]}>{nombreRelevo || 'Se completa automáticamente'}</Text>
        </View>
        {relevoActivo && (
          <View style={s.relevoActivoBadge}>
            <Text style={s.relevoActivoText}>⏱ Relevo activo desde {horaInicioRelevo}</Text>
            <Text style={s.relevoActivoSub}>Cierra el relevo antes de terminar el turno</Text>
          </View>
        )}
        <View style={s.fila}>
          <TouchableOpacity style={[s.btnRelevo, relevoActivo && s.btnDisabled]} onPress={handleInicioRelevo} disabled={relevoActivo}>
            <Text style={s.btnRelevoText}>▶ Inicio relevo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btnRelevoFin, !relevoActivo && s.btnDisabled]} onPress={handleFinRelevo} disabled={!relevoActivo}>
            <Text style={s.btnRelevoText}>■ Fin relevo</Text>
          </TouchableOpacity>
        </View>
        {historialRelevos.length > 0 && (
          <View style={s.listaRegistros}>
            <Text style={s.totalText}>Historial de relevos</Text>
            {historialRelevos.map((r, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={s.registroHora}>{r.nombre}</Text>
                <Text style={s.registroCantidad}>{r.inicio} → {r.fin}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Botones finales — 3 botones ─────────────────────────────────────── */}
      <View style={s.botonesFinales}>
        {/* Fin de turno → va a pantalla 2 (nuevo turno misma orden) */}
        <TouchableOpacity style={s.btnTurno} onPress={handleFinTurno}>
          <Text style={s.btnFinTexto}>↩ Fin de{'\n'}turno</Text>
        </TouchableOpacity>

        {/* Pausar orden → cierra turno y va a pantalla 1 */}
        <TouchableOpacity style={s.btnPausar} onPress={handlePausarOrden}>
          <Text style={s.btnFinTexto}>⏸ Pausar{'\n'}orden</Text>
        </TouchableOpacity>

        {/* Fin de orden → solo habilitado cuando se cumple la meta */}
        <TouchableOpacity
          style={[s.btnOrden, !ordenCompleta && s.btnOrdenBloqueado]}
          onPress={handleFinOrden}
          disabled={!ordenCompleta}
          activeOpacity={ordenCompleta ? 0.8 : 1}
        >
          <Text style={[s.btnFinTexto, !ordenCompleta && s.btnFinTextoBloqueado]}>
            {ordenCompleta ? '✓ Fin de\norden' : `🔒 ${progresoPct}%\ncompletado`}
          </Text>
        </TouchableOpacity>
      </View>

      {!ordenCompleta && (
        <Text style={s.notaBloqueado}>
          "Fin de orden" se habilita cuando se alcancen {meta.toLocaleString('es-CO')} uds reales
        </Text>
      )}

      {/* Modal Paradas */}
      <Modal visible={modalParadas} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona la parada</Text>
          <FlatList data={paradas} keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => { setParadaSeleccionada(item); setModalParadas(false); }}>
                <Text style={s.modalItemCod}>{item.codigo}.</Text>
                <View style={{ flex: 1 }}><Text style={s.modalItemText}>{item.descripcion}</Text></View>
              </TouchableOpacity>
            )} />
          <TouchableOpacity style={s.btnCerrar} onPress={() => setModalParadas(false)}>
            <Text style={s.btnCerrarText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Modal Desperdicios */}
      <Modal visible={modalDesperdicios} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona el defecto</Text>
          <FlatList data={desperdicios} keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => { setDesperdSeleccionado(item); setModalDesperdicios(false); }}>
                <Text style={s.modalItemCod}>{item.codigo}.</Text>
                <Text style={s.modalItemText}>{item.descripcion}</Text>
              </TouchableOpacity>
            )} />
          <TouchableOpacity style={s.btnCerrar} onPress={() => setModalDesperdicios(false)}>
            <Text style={s.btnCerrarText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bannerSinConexion:        { backgroundColor: '#3b0f0f', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#E24B4A' },
  bannerTexto:              { color: '#fca5a5', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  bannerParadaActiva:       { backgroundColor: '#3b1010', borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1.5, borderColor: '#e24b4a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerParadaTexto:        { color: '#fca5a5', fontSize: 12, fontWeight: '700', flex: 1 },
  bannerParadaCronometro:   { color: '#f87171', fontSize: 18, fontWeight: '800' },
  loadingContainer:         { flex: 1, backgroundColor: '#0F1923', justifyContent: 'center', alignItems: 'center' },
  loadingText:              { color: '#6b8aa0', marginTop: 16, fontSize: 14 },
  container:                { flex: 1, backgroundColor: '#0F1923' },
  content:                  { padding: 20, paddingTop: 48, paddingBottom: 48 },
  metaCard:                 { backgroundColor: '#162029', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#243040' },
  metaRow:                  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  metaLogoWrap:             { width: 48 },
  metaLabel:                { fontSize: 11, color: '#6b8aa0', textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValor:                { fontSize: 26, fontWeight: '800', color: '#F5F5F5', marginTop: 2 },
  metaCirculo:              { width: 50, height: 50, borderRadius: 25, backgroundColor: '#1e2d3d', borderWidth: 2, borderColor: '#00C896', justifyContent: 'center', alignItems: 'center' },
  metaCirculoOk:            { borderColor: '#00C896', backgroundColor: '#003d2e' },
  metaPct:                  { fontSize: 13, fontWeight: '800', color: '#00C896' },
  metaPctOk:                { color: '#00C896' },
  barraFondo:               { height: 5, backgroundColor: '#1e2d3d', borderRadius: 3, marginBottom: 10 },
  barraRelleno:             { height: 5, backgroundColor: '#00C896', borderRadius: 3 },
  barraRellenoOk:           { backgroundColor: '#00C896' },
  metaInfo:                 { fontSize: 12, color: '#6b8aa0', marginBottom: 2 },
  metaInfoSub:              { fontSize: 11, color: '#3d5568' },
  metaInfoAcento:           { color: '#00C896', fontWeight: '600' },
  metaInfoOk:               { color: '#00C896', fontWeight: '700' },
  metaInfoPendiente:        { color: '#FF6B35', fontWeight: '600' },
  card:                     { backgroundColor: '#162029', borderRadius: 12, borderWidth: 1, borderColor: '#243040', padding: 16, marginBottom: 14 },
  seccion:                  { fontSize: 11, fontWeight: '700', color: '#00C896', letterSpacing: 1.2, marginBottom: 14 },
  label:                    { fontSize: 13, color: '#6b8aa0', marginBottom: 6 },
  input:                    { backgroundColor: '#1e2d3d', borderRadius: 10, padding: 14, fontSize: 15, color: '#F5F5F5', borderWidth: 1, borderColor: '#243040' },
  inputError:               { borderColor: '#e24b4a', borderWidth: 1.5 },
  textoError:               { color: '#f87171', fontSize: 11, marginTop: 4, marginLeft: 2 },
  inputAuto:                { backgroundColor: '#003d2e', borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#00573d' },
  inputAutoText:            { fontSize: 15, color: '#00C896' },
  placeholder:              { color: '#1e4a3a' },
  fila:                     { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btnAgregar:               { backgroundColor: '#00C896', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center', minWidth: 90, alignItems: 'center' },
  btnAgregarText:           { color: '#0F1923', fontWeight: '700', fontSize: 13 },
  btnDisabled:              { opacity: 0.3 },
  listaRegistros:           { backgroundColor: '#1e2d3d', borderRadius: 10, padding: 12, marginTop: 4, borderWidth: 1, borderColor: '#243040' },
  totalText:                { fontSize: 12, color: '#6b8aa0', fontWeight: '600', marginBottom: 8 },
  totalAcento:              { color: '#00C896' },
  totalRechazo:             { color: '#f87171' },
  registroFila:             { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#243040' },
  registroHora:             { fontSize: 12, color: '#6b8aa0' },
  registroCantidad:         { fontSize: 12, color: '#F5F5F5', fontWeight: '600' },
  selector:                 { backgroundColor: '#1e2d3d', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#243040', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectorText:             { fontSize: 14, color: '#F5F5F5', flex: 1 },
  selectorChevron:          { fontSize: 22, color: '#00C896', marginLeft: 8 },
  btnIniciarParada:         { backgroundColor: '#7f1d1d', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#991b1b', marginBottom: 4 },
  btnIniciarParadaText:     { color: '#fff', fontWeight: '700', fontSize: 14 },
  paradaActivaCard:         { backgroundColor: '#3b1010', borderRadius: 10, padding: 16, borderWidth: 1.5, borderColor: '#e24b4a', alignItems: 'center', marginBottom: 4 },
  paradaActivaHeader:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, width: '100%' },
  paradaActivaDot:          { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e24b4a', flexShrink: 0 },
  paradaActivaCausa:        { fontSize: 13, color: '#fca5a5', fontWeight: '600', flex: 1 },
  paradaCronometroGrande:   { fontSize: 48, fontWeight: '800', color: '#f87171', letterSpacing: 2 },
  paradaCronometroSub:      { fontSize: 11, color: '#9a4a4a', marginBottom: 16 },
  btnFinalizarParada:       { backgroundColor: '#0F1923', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e24b4a', width: '100%' },
  btnFinalizarParadaText:   { color: '#f87171', fontWeight: '700', fontSize: 13 },
  relevoSeccionRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  relevoEstadoBadge:        { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#003d2e', borderWidth: 1, borderColor: '#00573d' },
  relevoEstadoLibre:        { backgroundColor: '#1e2d3d', borderColor: '#243040' },
  relevoEstadoTextoActivo:  { fontSize: 10, fontWeight: '700', color: '#00C896', letterSpacing: 0.8 },
  relevoEstadoTextoLibre:   { fontSize: 10, fontWeight: '700', color: '#3d5568', letterSpacing: 0.8 },
  inputDeshabilitado:       { backgroundColor: '#162029', borderColor: '#1e2d3d', color: '#3d5568', opacity: 0.6 },
  relevoActivoBadge:        { backgroundColor: '#003d2e', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#00573d' },
  relevoActivoText:         { fontSize: 13, color: '#00C896', fontWeight: '600' },
  relevoActivoSub:          { fontSize: 11, color: '#1e6b50', marginTop: 3 },
  btnRelevo:                { flex: 1, backgroundColor: '#003d2e', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#00573d' },
  btnRelevoFin:             { flex: 1, backgroundColor: '#3b1010', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#5a1a1a' },
  btnRelevoText:            { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Botones finales ────────────────────────────────────────────────────────
  botonesFinales:           { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnTurno:                 { flex: 1, backgroundColor: '#003d2e', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#00573d' },
  btnPausar:                { flex: 1, backgroundColor: '#1e2a3a', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FF6B35' },
  btnOrden:                 { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnOrdenBloqueado:        { backgroundColor: '#1e2d3d', borderWidth: 1, borderColor: '#243040' },
  btnFinTexto:              { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  btnFinTextoBloqueado:     { color: '#3d5568', fontSize: 12, textAlign: 'center' },
  notaBloqueado:            { fontSize: 11, color: '#3d5568', textAlign: 'center', marginTop: 10, marginBottom: 4, paddingHorizontal: 8 },

  modal:                    { flex: 1, backgroundColor: '#0F1923', padding: 20, paddingTop: 60 },
  modalTitulo:              { fontSize: 18, fontWeight: '700', color: '#F5F5F5', marginBottom: 16 },
  modalItem:                { flexDirection: 'row', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: '#162029', alignItems: 'flex-start' },
  modalItemCod:             { fontSize: 14, color: '#00C896', fontWeight: '700', minWidth: 28 },
  modalItemText:            { fontSize: 14, color: '#b8c8d8', flex: 1 },
  btnCerrar:                { backgroundColor: '#162029', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: '#243040' },
  btnCerrarText:            { color: '#6b8aa0', fontWeight: '600', fontSize: 15 },
  conexionRow:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  conexionIndicador:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  conexionDot:              { width: 8, height: 8, borderRadius: 4 },
  conexionDotOk:            { backgroundColor: '#00C896' },
  conexionDotFail:          { backgroundColor: '#e24b4a' },
  conexionTexto:            { fontSize: 12, fontWeight: '600' },
  conexionTextoOk:          { color: '#00C896' },
  conexionTextoFail:        { color: '#e24b4a' },
  btnSync:                  { backgroundColor: '#1e2d3d', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#243040' },
  btnSyncActivo:            { borderColor: '#00C896', backgroundColor: '#003d2e' },
  btnSyncTexto:             { fontSize: 12, color: '#6b8aa0', fontWeight: '600' },
  ritmoDashboard:           { flexDirection: 'row', gap: 8, marginBottom: 14 },
  ritmoTarjeta:             { flex: 1, borderRadius: 8, padding: 10, borderWidth: 1 },
  ritmoLabel:               { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  ritmoValor:               { fontSize: 18, fontWeight: '800', marginBottom: 1 },
  ritmoSub:                 { fontSize: 9 },
});