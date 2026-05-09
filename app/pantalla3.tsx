import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Modal, FlatList,
  ActivityIndicator, BackHandler, Image, AppState
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
  CausaParadaAPI, TipoDesperdicioAPI,
} from '../store/api';

interface RegistroProduccion  { hora: string; cantidad: number; }
interface RegistroParada      { cod: number; descripcion: string; minutos: number; programada: boolean; }
interface RegistroDesperdicio { cod: number; defecto: string; cantidad: number; }
interface RegistroRelevo      { nombre: string; inicio: string; fin: string; }

// FIX E14: clave única por registro para detectar duplicados
interface PendienteBuffer { tipo: string; datos: object; timestamp: number; id: string; }
const PENDING_KEY = 'registros_pendientes_v2'; // nueva clave para evitar conflicto con buffer anterior

export default function Pantalla3() {
  const router      = useRouter();
  const orden       = obtenerOrdenGlobal();
  const turno       = obtenerTurnoGlobal();
  const tipoMaquina = orden?.tipoMaquina ?? 'inyeccion';
  const meta        = orden?.cantidadProducir ?? 0;

  const [conectado, setConectado] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // FIX E20: recalcular proxima hora al volver del background
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        calcularProximaHoraDesdeInicio();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const verificarConexion = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(8000) });
        const estabaDesconectado = !conectado;
        setConectado(res.ok);
        if (res.ok && estabaDesconectado) await sincronizarPendientes();
      } catch { setConectado(false); }
    };
    verificarConexion();
    pingRef.current = setInterval(verificarConexion, 15000);
    return () => { if (pingRef.current) clearInterval(pingRef.current); };
  }, [conectado]);

  // FIX E14: buffer con ID único por registro para evitar duplicados
  const guardarPendiente = async (tipo: string, datos: object): Promise<string> => {
    const id = `${tipo}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const raw       = await AsyncStorage.getItem(PENDING_KEY);
      const pendientes: PendienteBuffer[] = raw ? JSON.parse(raw) : [];
      pendientes.push({ tipo, datos, timestamp: Date.now(), id });
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pendientes));
    } catch {}
    return id;
  };

  // FIX E14: sincronizar pendientes sin riesgo de duplicados (por ID)
  const sincronizarPendientes = async () => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const pendientes: PendienteBuffer[] = JSON.parse(raw);
      if (pendientes.length === 0) return;

      const exitosos: string[] = [];
      for (const p of pendientes) {
        try {
          if (p.tipo === 'produccion') {
            const d = p.datos as any;
            await apiAgregarProduccion(d.turno_id, d.hora, d.cantidad);
          }
          if (p.tipo === 'parada')      await apiAgregarParada(p.datos as any);
          if (p.tipo === 'desperdicio') await apiAgregarDesperdicio(p.datos as any);
          exitosos.push(p.id);
        } catch {}
      }

      const restantes = pendientes.filter(p => !exitosos.includes(p.id));
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(restantes));
      if (exitosos.length > 0) {
        Alert.alert('Sincronizado', `${exitosos.length} registro(s) pendiente(s) enviado(s) al servidor.`);
      }
    } catch {}
  };

  const pendientesCount = useRef(0);

  // ── Catálogos ─────────────────────────────────────────────────────────────
  const [paradas,           setParadas]           = useState<CausaParadaAPI[]>([]);
  const [desperdicios,      setDesperdicios]      = useState<TipoDesperdicioAPI[]>([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);

  useEffect(() => {
    const inicializar = async () => {
      if (!obtenerTurnoGlobal()) {
        const guardado = await AsyncStorage.getItem('turno_activo');
        if (guardado) {
          try { guardarTurnoGlobal(JSON.parse(guardado)); } catch {}
        }
      }
      // FIX E13: recuperar registros individuales de BD, no solo el total
      try {
        const turnoId = await obtenerTurnoId();
        if (turnoId) {
          const resumen = await apiGetResumenTurno(turnoId);
          if (resumen.contador_produccion > 0) {
            // Intentar cargar registros individuales desde el endpoint de registros
            try {
              const res = await fetch(`${API_URL}/produccion/registro/turno/${turnoId}`);
              if (res.ok) {
                const registros = await res.json();
                if (Array.isArray(registros) && registros.length > 0) {
                  setProduccion(registros.map((r: any) => ({ hora: r.hora, cantidad: r.cantidad })));
                } else {
                  // Fallback: mostrar total como sesión anterior
                  setProduccion([{ hora: 'Sesión anterior', cantidad: resumen.contador_produccion }]);
                }
              }
            } catch {
              setProduccion([{ hora: 'Sesión anterior', cantidad: resumen.contador_produccion }]);
            }
          }
          if (resumen.total_desperdicio > 0) {
            setDesperdRegistrados([{ cod: 0, defecto: 'Sesiones anteriores', cantidad: resumen.total_desperdicio }]);
          }
        }
      } catch {}

      // FIX E20: contar pendientes del buffer para mostrar indicador
      try {
        const raw = await AsyncStorage.getItem(PENDING_KEY);
        const p   = raw ? JSON.parse(raw) : [];
        pendientesCount.current = p.length;
      } catch {}
    };
    inicializar();
  }, []);

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [causas, tipos] = await Promise.all([apiGetCausasParada(tipoMaquina), apiGetTiposDesperdicio()]);
        setParadas(causas);
        setDesperdicios(tipos);
      } catch {
        Alert.alert('Aviso', 'No se pudieron cargar los catálogos. Verifica la conexión.');
      } finally {
        setCargandoCatalogos(false);
      }
    };
    cargarCatalogos();
  }, [tipoMaquina]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Turno en curso',
        'No puedes salir mientras hay un turno activo. Usa "Fin de turno" para cerrar correctamente.',
        [{ text: 'Entendido', style: 'cancel' }]
      );
      return true;
    });
    return () => backHandler.remove();
  }, []);

  // ── Estado producción ─────────────────────────────────────────────────────
  const [produccion,          setProduccion]          = useState<RegistroProduccion[]>([]);
  const [unidadesHora,        setUnidadesHora]        = useState('');
  const [guardandoProduccion, setGuardandoProduccion] = useState(false);

  // ── Estado paradas ────────────────────────────────────────────────────────
  const [paradasRegistradas, setParadasRegistradas] = useState<RegistroParada[]>([]);
  const [paradaSeleccionada, setParadaSeleccionada] = useState<CausaParadaAPI | null>(null);
  const [minutosParada,      setMinutosParada]      = useState('');
  const [modalParadas,       setModalParadas]       = useState(false);
  const [guardandoParada,    setGuardandoParada]    = useState(false);

  // ── Estado desperdicios ───────────────────────────────────────────────────
  const [desperdRegistrados,  setDesperdRegistrados]  = useState<RegistroDesperdicio[]>([]);
  const [desperdSeleccionado, setDesperdSeleccionado] = useState<TipoDesperdicioAPI | null>(null);
  const [cantidadDesperd,     setCantidadDesperd]     = useState('');
  const [modalDesperdicios,   setModalDesperdicios]   = useState(false);
  const [guardandoDesperd,    setGuardandoDesperd]    = useState(false);

  // ── Estado relevos ────────────────────────────────────────────────────────
  const [cedulaRelevo,     setCedulaRelevo]     = useState('');
  const [nombreRelevo,     setNombreRelevo]     = useState('');
  const [relevoActivo,     setRelevoActivo]     = useState(false);
  const [horaInicioRelevo, setHoraInicioRelevo] = useState('');
  const [relevoIdActivo,   setRelevoIdActivo]   = useState<number | null>(null);
  const [historialRelevos, setHistorialRelevos] = useState<RegistroRelevo[]>([]);

  // ── Timer próxima hora ────────────────────────────────────────────────────
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
      base = new Date();
      base.setHours(hh, mm, 0, 0);
    } else {
      base = new Date();
    }
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

  // ── Cálculos derivados ────────────────────────────────────────────────────
  const totalContador     = produccion.reduce((acc, r) => acc + r.cantidad, 0);
  const totalRechazados   = desperdRegistrados.reduce((acc, r) => acc + r.cantidad, 0);
  // FIX E19: progreso basado en prod_real (sin rechazos), igual que el OEE
  const totalProducidoReal = Math.max(0, totalContador - totalRechazados);
  const totalDesperdicios  = totalRechazados;
  const progresoPct        = meta > 0 ? Math.min(100, Math.round((totalProducidoReal / meta) * 100)) : 0;
  const ordenCompleta      = totalProducidoReal >= meta && meta > 0;

  // FIX E15: límite teórico correcto por tipo de máquina
  const limiteUdsHora = (() => {
    const cav  = Number(orden?.cavidades ?? 0);
    const cic  = Number(orden?.ciclos    ?? 0);
    if (cav <= 0 || cic <= 0) return 50_000;
    if (tipoMaquina === 'acondicionamiento') {
      // ciclos = uds/hora por operario, cav = nro. operarios → NO multiplicar por 60
      return cav * cic;
    }
    // inyeccion, soplado, linea: ciclos = ciclos/min → × 60 = ciclos/hora
    return cav * cic * 60;
  })();

  // ── Sincronización manual ────────────────────────────────────────────────
  const handleSincronizarManual = async () => {
    setSincronizando(true);
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error();
      setConectado(true);
      const raw        = await AsyncStorage.getItem(PENDING_KEY);
      const pendientes = raw ? JSON.parse(raw) : [];
      if (pendientes.length === 0) {
        Alert.alert("✓ Al día", "No hay registros pendientes.");
      } else {
        await sincronizarPendientes();
      }
    } catch {
      setConectado(false);
      Alert.alert("Sin conexión", "No se pudo conectar al servidor. Los registros siguen guardados localmente.");
    } finally {
      setSincronizando(false);
    }
  };

  // ── Producción ─────────────────────────────────────────────────────────---
  const handleAgregarProduccion = async () => {
    if (!unidadesHora || Number(unidadesHora) <= 0) {
      Alert.alert('Error', 'Ingresa una cantidad válida'); return;
    }
    const cantidad = Number(unidadesHora);
    if (cantidad > limiteUdsHora) {
      Alert.alert(
        'Cantidad inusual',
        `Registraste ${cantidad.toLocaleString('es-CO')} unidades, pero el máximo teórico por hora es ${limiteUdsHora.toLocaleString('es-CO')} uds. ¿Es correcto?`,
        [
          { text: 'Corregir', style: 'cancel' },
          { text: 'Registrar igual', onPress: () => guardarProduccion(cantidad) },
        ]
      );
      return;
    }
    await guardarProduccion(cantidad);
  };

  // FIX E14: lógica de guardado sin riesgo de duplicados
  const guardarProduccion = async (cantidad: number) => {
    const hora = horaActual();
    setGuardandoProduccion(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');

      if (!conectado) {
        // Sin conexión — guardar en buffer con ID único
        await guardarPendiente('produccion', { turno_id: turnoId, hora, cantidad });
        setProduccion(p => [...p, { hora, cantidad }]);
        setUnidadesHora('');
      } else {
        // Con conexión — enviar directo, SIN buffer
        await apiAgregarProduccion(turnoId, hora, cantidad);
        setProduccion(p => [...p, { hora, cantidad }]);
        setUnidadesHora('');
      }
    } catch (error: any) {
      // FIX E14: si falla la conexión, guardar en buffer UNA SOLA VEZ
      // No reintentar desde catch — el buffer se sincroniza automáticamente
      const turnoId = await obtenerTurnoId().catch(() => null);
      if (turnoId) {
        await guardarPendiente('produccion', { turno_id: turnoId, hora, cantidad });
        setProduccion(p => [...p, { hora, cantidad }]);
        setUnidadesHora('');
        Alert.alert('Sin conexión', 'Registro guardado localmente. Se enviará cuando vuelva la señal.');
      } else {
        Alert.alert('Error', 'No se pudo guardar el registro');
      }
    } finally {
      setGuardandoProduccion(false);
    }
  };

  // ── Paradas ───────────────────────────────────────────────────────────────
  const handleAgregarParada = async () => {
    if (!paradaSeleccionada) { Alert.alert('Error', 'Selecciona el tipo de parada'); return; }
    if (!minutosParada || Number(minutosParada) <= 0) { Alert.alert('Error', 'Ingresa los minutos'); return; }
    setGuardandoParada(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      const datosParada = {
        turno_id: turnoId, codigo: paradaSeleccionada.codigo,
        descripcion: paradaSeleccionada.descripcion,
        minutos: Number(minutosParada), programada: paradaSeleccionada.programada,
      };
      if (!conectado) {
        await guardarPendiente('parada', datosParada);
      } else {
        await apiAgregarParada(datosParada);
      }
      setParadasRegistradas(p => [...p, {
        cod: paradaSeleccionada.codigo, descripcion: paradaSeleccionada.descripcion,
        minutos: Number(minutosParada), programada: paradaSeleccionada.programada,
      }]);
      setParadaSeleccionada(null); setMinutosParada('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo guardar la parada');
    } finally { setGuardandoParada(false); }
  };

  // ── Desperdicios ──────────────────────────────────────────────────────────
  const handleAgregarDesperdicio = async () => {
    if (!desperdSeleccionado) { Alert.alert('Error', 'Selecciona el tipo de defecto'); return; }
    if (!cantidadDesperd || Number(cantidadDesperd) <= 0) { Alert.alert('Error', 'Ingresa la cantidad'); return; }
    setGuardandoDesperd(true);
    try {
      const turnoId = await obtenerTurnoId();
      if (!turnoId) throw new Error('No hay turno activo');
      const datosDesperd = {
        turno_id: turnoId, codigo: desperdSeleccionado.codigo,
        defecto: desperdSeleccionado.descripcion, cantidad: Number(cantidadDesperd),
      };
      if (!conectado) {
        await guardarPendiente('desperdicio', datosDesperd);
      } else {
        await apiAgregarDesperdicio(datosDesperd);
      }
      setDesperdRegistrados(p => [...p, {
        cod: desperdSeleccionado.codigo, defecto: desperdSeleccionado.descripcion,
        cantidad: Number(cantidadDesperd),
      }]);
      setDesperdSeleccionado(null); setCantidadDesperd('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo guardar el desperdicio');
    } finally { setGuardandoDesperd(false); }
  };

  // ── Relevos ───────────────────────────────────────────────────────────────
  const handleInicioRelevo = async () => {
    if (!cedulaRelevo || !nombreRelevo) { Alert.alert('Error', 'Ingresa la cédula del empleado en relevo'); return; }
    if (relevoActivo) { Alert.alert('Error', 'Ya hay un relevo activo'); return; }
    // FIX E17: no permitir relevo de sí mismo
    if (cedulaRelevo === turno?.cedulaEmpleado) {
      Alert.alert('Error', 'El empleado en relevo debe ser diferente al operario actual'); return;
    }
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
    } catch (error: any) {
      Alert.alert('Error', error?.message || error?.detail || 'No se pudo cerrar el relevo');
    }
  };

  // ── Fin turno ─────────────────────────────────────────────────────────────
  const handleFinTurno = () => {
    if (relevoActivo && relevoIdActivo) {
      Alert.alert('Relevo activo', `Hay un relevo en curso de ${nombreRelevo}. Debes cerrarlo antes.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Cerrar relevo y turno', style: 'destructive', onPress: async () => {
            try {
              const hora = horaActual();
              await apiCerrarRelevo(relevoIdActivo, hora);
              const turnoId = await obtenerTurnoId();
              if (turnoId) await apiCerrarTurno(turnoId, hora);
              guardarTurnoGlobal(null);
              router.replace('/pantalla2');
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'No se pudo cerrar el relevo y el turno');
            }
          }},
        ]
      );
      return;
    }
    Alert.alert('Fin de turno', '¿Deseas cerrar el turno actual?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: async () => {
        try {
          const turnoId = await obtenerTurnoId();
          if (turnoId) await apiCerrarTurno(turnoId, horaActual());
          guardarTurnoGlobal(null);
          router.replace('/pantalla2');
        } catch (error: any) {
          Alert.alert('Error', error?.message || 'No se pudo cerrar el turno');
        }
      }},
    ]);
  };

  // ── Fin orden ─────────────────────────────────────────────────────────────
  const handleFinOrden = () => {
    if (!ordenCompleta) return;

    // FIX E18: verificar pendientes del buffer antes de cerrar la orden
    const verificarYCerrar = async () => {
      try {
        const raw       = await AsyncStorage.getItem(PENDING_KEY);
        const pendientes = raw ? JSON.parse(raw) : [];
        if (pendientes.length > 0) {
          Alert.alert(
            'Registros pendientes',
            `Hay ${pendientes.length} registro(s) sin sincronizar con el servidor. ¿Deseas sincronizar antes de cerrar la orden?`,
            [
              { text: 'Sincronizar primero', onPress: async () => {
                await sincronizarPendientes();
                confirmarFinOrden(relevoActivo && !!relevoIdActivo);
              }},
              { text: 'Cerrar sin sincronizar', style: 'destructive', onPress: () => confirmarFinOrden(relevoActivo && !!relevoIdActivo) },
              { text: 'Cancelar', style: 'cancel' },
            ]
          );
          return;
        }
      } catch {}
      confirmarFinOrden(relevoActivo && !!relevoIdActivo);
    };

    if (relevoActivo && relevoIdActivo) {
      Alert.alert('Relevo activo', `Hay un relevo en curso. Se cerrará al finalizar la orden.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Cerrar relevo y orden', style: 'destructive', onPress: verificarYCerrar },
        ]
      );
      return;
    }
    verificarYCerrar();
  };

  const confirmarFinOrden = (cerrarRelevo: boolean) => {
    Alert.alert(
      'Fin de orden',
      `Producidos: ${totalProducidoReal.toLocaleString('es-CO')} uds reales de ${meta.toLocaleString('es-CO')}. ¿Confirmar cierre?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
          try {
            const hora    = horaActual();
            const turnoId = await obtenerTurnoId();
            const ordenId = await obtenerOrdenId();
            if (cerrarRelevo && relevoIdActivo) await apiCerrarRelevo(relevoIdActivo, hora).catch(() => {});
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
        <ActivityIndicator size="large" color="#5A9E2F" />
        <Text style={s.loadingText}>Cargando catálogos...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* ── Banner sin conexión ── */}
      {!conectado && (
        <View style={s.bannerSinConexion}>
          <Text style={s.bannerTexto}>
            ⚠ Sin conexión — los registros se guardan localmente y se enviarán cuando vuelva la señal
          </Text>
        </View>
      )}

      {/* ── Meta y progreso ── */}
      <View style={s.metaCard}>
        {/* ── Indicador de conexión + botón sincronizar ── */}
        <View style={s.conexionRow}>
          <View style={s.conexionIndicador}>
            <View style={[s.conexionDot, conectado ? s.conexionDotOk : s.conexionDotFail]} />
            <Text style={[s.conexionTexto, conectado ? s.conexionTextoOk : s.conexionTextoFail]}>
              {conectado ? 'Conectado' : 'Sin conexión'}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.btnSync, sincronizando && s.btnSyncActivo]}
            onPress={handleSincronizarManual}
            disabled={sincronizando}
          >
            <Text style={s.btnSyncTexto}>{sincronizando ? '↻ Sincronizando...' : '↻ Sincronizar'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaLogoWrap}>
            <Image source={require('../assets/logo_inverfarma.png')} style={s.metaLogo} resizeMode="contain" />
          </View>
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

        {/* FIX E19: mostrar prod real (sin rechazos) en el progreso */}
        <Text style={s.metaInfo}>
          Producido real: <Text style={s.metaInfoAcento}>{totalProducidoReal.toLocaleString('es-CO')} uds</Text>
          {'  ·  '}Contador: <Text style={{ color: '#888' }}>{totalContador.toLocaleString('es-CO')}</Text>
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

      {/* ── Producción ── */}
      <View style={s.card}>
        <Text style={s.seccion}>PRODUCCIÓN POR HORA</Text>
        <View style={s.fila}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={unidadesHora} onChangeText={setUnidadesHora}
            placeholder="Unidades producidas" placeholderTextColor="#555" keyboardType="numeric"
          />
          <TouchableOpacity
            style={[s.btnAgregar, guardandoProduccion && s.btnDisabled]}
            onPress={handleAgregarProduccion} disabled={guardandoProduccion}
          >
            <Text style={s.btnAgregarText}>{guardandoProduccion ? '...' : '+ Agregar'}</Text>
          </TouchableOpacity>
        </View>
        {produccion.length > 0 && (
          <View style={s.listaRegistros}>
            <Text style={s.totalText}>
              Contador total: <Text style={s.totalAcento}>{totalContador.toLocaleString('es-CO')} uds</Text>
            </Text>
            {produccion.map((r, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={s.registroHora}>{r.hora}</Text>
                <Text style={s.registroCantidad}>{r.cantidad.toLocaleString('es-CO')} uds</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Paradas ── */}
      <View style={s.card}>
        <Text style={s.seccion}>PARADAS</Text>
        <TouchableOpacity style={s.selector} onPress={() => setModalParadas(true)}>
          <Text style={[s.selectorText, !paradaSeleccionada && s.placeholder]}>
            {paradaSeleccionada ? `${paradaSeleccionada.codigo}. ${paradaSeleccionada.descripcion}` : 'Selecciona el tipo de parada'}
          </Text>
          <Text style={s.selectorChevron}>›</Text>
        </TouchableOpacity>
        <View style={s.fila}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={minutosParada} onChangeText={setMinutosParada}
            placeholder="Minutos de parada" placeholderTextColor="#555" keyboardType="numeric"
          />
          <TouchableOpacity
            style={[s.btnAgregar, guardandoParada && s.btnDisabled]}
            onPress={handleAgregarParada} disabled={guardandoParada}
          >
            <Text style={s.btnAgregarText}>{guardandoParada ? '...' : '+ Agregar'}</Text>
          </TouchableOpacity>
        </View>
        {paradasRegistradas.length > 0 && (
          <View style={s.listaRegistros}>
            {paradasRegistradas.map((p, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={[s.registroHora, { flex: 1 }]}>{p.cod}. {p.descripcion}</Text>
                <Text style={[s.registroCantidad, { color: p.programada ? '#888' : '#f87171' }]}>{p.minutos} min</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Desperdicios ── */}
      <View style={s.card}>
        <Text style={s.seccion}>DESPERDICIOS</Text>
        <TouchableOpacity style={s.selector} onPress={() => setModalDesperdicios(true)}>
          <Text style={[s.selectorText, !desperdSeleccionado && s.placeholder]}>
            {desperdSeleccionado ? `${desperdSeleccionado.codigo}. ${desperdSeleccionado.descripcion}` : 'Selecciona el tipo de defecto'}
          </Text>
          <Text style={s.selectorChevron}>›</Text>
        </TouchableOpacity>
        <View style={s.fila}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={cantidadDesperd} onChangeText={setCantidadDesperd}
            placeholder="Unidades rechazadas" placeholderTextColor="#555" keyboardType="numeric"
          />
          <TouchableOpacity
            style={[s.btnAgregar, guardandoDesperd && s.btnDisabled]}
            onPress={handleAgregarDesperdicio} disabled={guardandoDesperd}
          >
            <Text style={s.btnAgregarText}>{guardandoDesperd ? '...' : '+ Agregar'}</Text>
          </TouchableOpacity>
        </View>
        {desperdRegistrados.length > 0 && (
          <View style={s.listaRegistros}>
            <Text style={s.totalText}>
              Rechazos: <Text style={s.totalRechazo}>{totalDesperdicios.toLocaleString('es-CO')} uds</Text>
            </Text>
            {desperdRegistrados.map((d, i) => (
              <View key={i} style={s.registroFila}>
                <Text style={[s.registroHora, { flex: 1 }]}>{d.cod}. {d.defecto}</Text>
                <Text style={s.registroCantidad}>{d.cantidad.toLocaleString('es-CO')} uds</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Relevos ── */}
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
            setCedulaRelevo(v);
            setNombreRelevo('');
            // FIX E17: buscar empleado en tiempo real para validar que no sea él mismo
            if (v.length >= 5) {
              try { const r = await apiValidarEmpleado(v); setNombreRelevo(r.nombre); }
              catch { setNombreRelevo('Empleado no encontrado'); }
            }
          }}
          placeholder="Ingresa la cédula"
          placeholderTextColor={relevoActivo ? '#3a3a3a' : '#555'}
          keyboardType="numeric"
          editable={!relevoActivo}
        />
        <Text style={s.label}>Nombre del empleado en relevo</Text>
        <View style={s.inputAuto}>
          <Text style={[s.inputAutoText, !nombreRelevo && s.placeholder]}>
            {nombreRelevo || 'Se completa automáticamente'}
          </Text>
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

      {/* ── Botones finales ── */}
      <View style={s.botonesFinales}>
        <TouchableOpacity style={s.btnTurno} onPress={handleFinTurno}>
          <Text style={s.btnFinText}>↩ Fin de turno</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnOrden, !ordenCompleta && s.btnOrdenBloqueado]}
          onPress={handleFinOrden} disabled={!ordenCompleta} activeOpacity={ordenCompleta ? 0.8 : 1}
        >
          <Text style={[s.btnFinText, !ordenCompleta && s.btnFinTextBloqueado]}>
            {ordenCompleta ? '✓ Fin de orden' : `🔒 ${progresoPct}% completado`}
          </Text>
        </TouchableOpacity>
      </View>

      {!ordenCompleta && (
        <Text style={s.notaBloqueado}>
          El botón "Fin de orden" se habilitará cuando se alcancen {meta.toLocaleString('es-CO')} uds reales producidas
        </Text>
      )}

      {/* ── Modal Paradas ── */}
      <Modal visible={modalParadas} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona la parada</Text>
          <FlatList
            data={paradas} keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => { setParadaSeleccionada(item); setModalParadas(false); }}>
                <Text style={s.modalItemCod}>{item.codigo}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalItemText}>{item.descripcion}</Text>
                  <Text style={{ fontSize: 11, color: item.programada ? '#888' : '#f87171', marginTop: 2 }}>
                    {item.programada ? 'Programada' : 'No programada'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={s.btnCerrar} onPress={() => setModalParadas(false)}>
            <Text style={s.btnCerrarText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Modal Desperdicios ── */}
      <Modal visible={modalDesperdicios} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona el defecto</Text>
          <FlatList
            data={desperdicios} keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => { setDesperdSeleccionado(item); setModalDesperdicios(false); }}>
                <Text style={s.modalItemCod}>{item.codigo}.</Text>
                <Text style={s.modalItemText}>{item.descripcion}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={s.btnCerrar} onPress={() => setModalDesperdicios(false)}>
            <Text style={s.btnCerrarText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  bannerSinConexion:    { backgroundColor: '#7f1d1d', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#E24B4A' },
  bannerTexto:          { color: '#fca5a5', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  loadingContainer:     { flex: 1, backgroundColor: '#181818', justifyContent: 'center', alignItems: 'center' },
  loadingText:          { color: '#888', marginTop: 16, fontSize: 14 },
  container:            { flex: 1, backgroundColor: '#181818' },
  content:              { padding: 20, paddingTop: 48, paddingBottom: 48 },
  metaCard:             { backgroundColor: '#222', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#2e2e2e' },
  metaRow:              { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  metaLogoWrap:         { width: 40 },
  metaLogo:             { width: 40, height: 40 },
  metaLabel:            { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValor:            { fontSize: 26, fontWeight: '800', color: '#f0f0f0', marginTop: 2 },
  metaCirculo:          { width: 50, height: 50, borderRadius: 25, backgroundColor: '#2a2a2a', borderWidth: 2, borderColor: '#5A9E2F', justifyContent: 'center', alignItems: 'center' },
  metaCirculoOk:        { borderColor: '#22c55e', backgroundColor: '#14532d' },
  metaPct:              { fontSize: 13, fontWeight: '800', color: '#5A9E2F' },
  metaPctOk:            { color: '#4ade80' },
  barraFondo:           { height: 5, backgroundColor: '#2a2a2a', borderRadius: 3, marginBottom: 10 },
  barraRelleno:         { height: 5, backgroundColor: '#5A9E2F', borderRadius: 3 },
  barraRellenoOk:       { backgroundColor: '#22c55e' },
  metaInfo:             { fontSize: 12, color: '#888', marginBottom: 2 },
  metaInfoSub:          { fontSize: 11, color: '#666' },
  metaInfoAcento:       { color: '#7ec44f', fontWeight: '600' },
  metaInfoOk:           { color: '#4ade80', fontWeight: '700' },
  metaInfoPendiente:    { color: '#f59e0b', fontWeight: '600' },
  card:                 { backgroundColor: '#222', borderRadius: 12, borderWidth: 1, borderColor: '#2e2e2e', padding: 16, marginBottom: 14 },
  seccion:              { fontSize: 11, fontWeight: '700', color: '#5A9E2F', letterSpacing: 1.2, marginBottom: 14 },
  label:                { fontSize: 13, color: '#888', marginBottom: 6 },
  input:                { backgroundColor: '#2a2a2a', borderRadius: 10, padding: 14, fontSize: 15, color: '#f0f0f0', borderWidth: 1, borderColor: '#383838' },
  inputAuto:            { backgroundColor: '#1e2a16', borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#2d3f20' },
  inputAutoText:        { fontSize: 15, color: '#7ec44f' },
  placeholder:          { color: '#3a4a30' },
  fila:                 { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btnAgregar:           { backgroundColor: '#5A9E2F', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center', minWidth: 90, alignItems: 'center' },
  btnAgregarText:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled:          { opacity: 0.3 },
  listaRegistros:       { backgroundColor: '#2a2a2a', borderRadius: 10, padding: 12, marginTop: 4, borderWidth: 1, borderColor: '#383838' },
  totalText:            { fontSize: 12, color: '#888', fontWeight: '600', marginBottom: 8 },
  totalAcento:          { color: '#7ec44f' },
  totalRechazo:         { color: '#f87171' },
  registroFila:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#383838' },
  registroHora:         { fontSize: 12, color: '#888' },
  registroCantidad:     { fontSize: 12, color: '#f0f0f0', fontWeight: '600' },
  selector:             { backgroundColor: '#2a2a2a', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#383838', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectorText:         { fontSize: 14, color: '#f0f0f0', flex: 1 },
  selectorChevron:      { fontSize: 22, color: '#5A9E2F', marginLeft: 8 },
  relevoSeccionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  relevoEstadoBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#1a2e10', borderWidth: 1, borderColor: '#2d4a1a' },
  relevoEstadoLibre:    { backgroundColor: '#2a2a2a', borderColor: '#383838' },
  relevoEstadoTextoActivo: { fontSize: 10, fontWeight: '700', color: '#7ec44f', letterSpacing: 0.8 },
  relevoEstadoTextoLibre:  { fontSize: 10, fontWeight: '700', color: '#555', letterSpacing: 0.8 },
  inputDeshabilitado:   { backgroundColor: '#1e1e1e', borderColor: '#282828', color: '#555', opacity: 0.6 },
  relevoActivoBadge:    { backgroundColor: '#1e2a16', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#2d3f20' },
  relevoActivoText:     { fontSize: 13, color: '#7ec44f', fontWeight: '600' },
  relevoActivoSub:      { fontSize: 11, color: '#5a7a4a', marginTop: 3 },
  btnRelevo:            { flex: 1, backgroundColor: '#1e3320', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2d4a2a' },
  btnRelevoFin:         { flex: 1, backgroundColor: '#3b1010', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#5a1a1a' },
  btnRelevoText:        { color: '#fff', fontWeight: '700', fontSize: 13 },
  botonesFinales:       { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnTurno:             { flex: 1, backgroundColor: '#1e3320', borderRadius: 12, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#2d4a2a' },
  btnOrden:             { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 12, padding: 18, alignItems: 'center' },
  btnOrdenBloqueado:    { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#383838' },
  btnFinText:           { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnFinTextBloqueado:  { color: '#555', fontSize: 13 },
  notaBloqueado:        { fontSize: 11, color: '#555', textAlign: 'center', marginTop: 10, marginBottom: 4, paddingHorizontal: 8 },
  modal:                { flex: 1, backgroundColor: '#181818', padding: 20, paddingTop: 60 },
  modalTitulo:          { fontSize: 18, fontWeight: '700', color: '#f0f0f0', marginBottom: 16 },
  modalItem:            { flexDirection: 'row', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: '#222', alignItems: 'flex-start' },
  modalItemCod:         { fontSize: 14, color: '#5A9E2F', fontWeight: '700', minWidth: 28 },
  modalItemText:        { fontSize: 14, color: '#d0d0d0', flex: 1 },
  btnCerrar:            { backgroundColor: '#222', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: '#383838' },
  btnCerrarText:        { color: '#888', fontWeight: '600', fontSize: 15 },
  conexionRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  conexionIndicador:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  conexionDot:          { width: 8, height: 8, borderRadius: 4 },
  conexionDotOk:        { backgroundColor: '#5A9E2F' },
  conexionDotFail:      { backgroundColor: '#e24b4a' },
  conexionTexto:        { fontSize: 12, fontWeight: '600' },
  conexionTextoOk:      { color: '#5A9E2F' },
  conexionTextoFail:    { color: '#e24b4a' },
  btnSync:              { backgroundColor: '#2a2a2a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#383838' },
  btnSyncActivo:        { borderColor: '#5A9E2F', backgroundColor: '#1e2a16' },
  btnSyncTexto:         { fontSize: 12, color: '#888', fontWeight: '600' },
});