import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Modal, FlatList
} from 'react-native';
import { useRouter } from 'expo-router';
import { obtenerOrdenGlobal, limpiarOrdenGlobal } from '../store/useOrdenStore';
import { obtenerTurnoGlobal, guardarTurnoGlobal } from './pantalla2';
import { getParadas, getDesperdicios, Parada, Desperdicio } from '../constants/listas';
import { EMPLEADOS } from '../constants/autocompletado';


interface RegistroProduccion {
  hora: string;
  cantidad: number;
}

interface RegistroParada {
  cod: number;
  descripcion: string;
  minutos: number;
  programada: boolean;
}

interface RegistroDesperdicio {
  cod: number;
  defecto: string;
  cantidad: number;
}

interface RegistroRelevo {
  nombre: string;
  inicio: string;
  fin: string;
}

export default function Pantalla3() {
  const router = useRouter();
  const orden = obtenerOrdenGlobal();
  const turno = obtenerTurnoGlobal();
  const tipoMaquina = orden?.tipoMaquina ?? 'inyeccion';

  const paradas = getParadas(tipoMaquina);
  const desperdicios = getDesperdicios(tipoMaquina);

  const [produccion, setProduccion] = useState<RegistroProduccion[]>([]);
  const [unidadesHora, setUnidadesHora] = useState('');

  const [paradasRegistradas, setParadasRegistradas] = useState<RegistroParada[]>([]);
  const [paradaSeleccionada, setParadaSeleccionada] = useState<Parada | null>(null);
  const [minutosParada, setMinutosParada] = useState('');
  const [modalParadas, setModalParadas] = useState(false);

  const [desperdRegistrados, setDesperdRegistrados] = useState<RegistroDesperdicio[]>([]);
  const [desperdSeleccionado, setDesperdSeleccionado] = useState<Desperdicio | null>(null);
  const [cantidadDesperd, setCantidadDesperd] = useState('');
  const [modalDesperdicios, setModalDesperdicios] = useState(false);

  const [cedulaRelevo, setCedulaRelevo] = useState('');
  const [nombreRelevo, setNombreRelevo] = useState('');
  const [relevoActivo, setRelevoActivo] = useState(false);
  const [horaInicioRelevo, setHoraInicioRelevo] = useState('');
  const [historialRelevos, setHistorialRelevos] = useState<RegistroRelevo[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [proximaHora, setProximaHora] = useState('');

  useEffect(() => {
    calcularProximaHora();
    intervalRef.current = setInterval(() => {
      verificarHora();
    }, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const calcularProximaHora = () => {
    const ahora = new Date();
    const proxima = new Date(ahora);
    proxima.setMinutes(0, 0, 0);
    proxima.setHours(proxima.getHours() + 1);
    setProximaHora(proxima.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }));
  };

  const verificarHora = () => {
    const ahora = new Date();
    if (ahora.getMinutes() === 0) {
      Alert.alert('Registro de producción', 'Es hora de registrar las unidades producidas');
    }
  };

  const handleAgregarProduccion = () => {
    if (!unidadesHora || Number(unidadesHora) <= 0) {
      Alert.alert('Error', 'Ingresa una cantidad válida');
      return;
    }
    const ahora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    setProduccion(p => [...p, { hora: ahora, cantidad: Number(unidadesHora) }]);
    setUnidadesHora('');
  };

const handleAgregarParada = () => {
  if (!paradaSeleccionada) {
    Alert.alert('Error', 'Selecciona el tipo de parada');
    return;
  }
  if (!minutosParada || Number(minutosParada) <= 0) {
    Alert.alert('Error', 'Ingresa los minutos de la parada');
    return;
  }
  const esProgramada = paradasRegistradas.length < 12;
  setParadasRegistradas(p => [...p, {
    cod: paradaSeleccionada.cod,
    descripcion: paradaSeleccionada.descripcion,
    minutos: Number(minutosParada),
    programada: esProgramada,
  }]);
  setParadaSeleccionada(null);
  setMinutosParada('');
};

  const handleAgregarDesperdicio = () => {
    if (!desperdSeleccionado) {
      Alert.alert('Error', 'Selecciona el tipo de defecto');
      return;
    }
    if (!cantidadDesperd || Number(cantidadDesperd) <= 0) {
      Alert.alert('Error', 'Ingresa la cantidad de unidades rechazadas');
      return;
    }
    setDesperdRegistrados(p => [...p, {
      cod: desperdSeleccionado.cod,
      defecto: desperdSeleccionado.defecto,
      cantidad: Number(cantidadDesperd),
    }]);
    setDesperdSeleccionado(null);
    setCantidadDesperd('');
  };

  const handleCedulaRelevo = (valor: string) => {
    setCedulaRelevo(valor);
    setNombreRelevo(EMPLEADOS[valor] || '');
  };

  const handleInicioRelevo = () => {
    if (!cedulaRelevo || !nombreRelevo) {
      Alert.alert('Error', 'Ingresa la cédula del empleado en relevo');
      return;
    }
    if (relevoActivo) {
      Alert.alert('Error', 'Ya hay un relevo activo');
      return;
    }
    const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    setHoraInicioRelevo(hora);
    setRelevoActivo(true);
  };

  const handleFinRelevo = () => {
    if (!relevoActivo) {
      Alert.alert('Error', 'No hay un relevo activo');
      return;
    }
    const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    setHistorialRelevos(h => [...h, {
      nombre: nombreRelevo,
      inicio: horaInicioRelevo,
      fin: hora,
    }]);
    setRelevoActivo(false);
    setCedulaRelevo('');
    setNombreRelevo('');
    setHoraInicioRelevo('');
  };

  const totalProducido = produccion.reduce((acc, r) => acc + r.cantidad, 0);
  const totalDesperdicios = desperdRegistrados.reduce((acc, r) => acc + r.cantidad, 0);

  const handleFinTurno = () => {
    Alert.alert('Fin de turno', '¿Deseas cerrar el turno actual?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar', onPress: () => {
          guardarTurnoGlobal(null);
          router.replace('/pantalla2');
        }
      }
    ]);
  };

  const handleFinOrden = () => {
    Alert.alert('Fin de orden', '¿Deseas cerrar la orden completa?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar', onPress: () => {
          guardarTurnoGlobal(null);
          limpiarOrdenGlobal();
          router.replace('/pantalla1');
        }
      }
    ]);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      <View style={s.etiquetaMeta}>
        <Text style={s.etiquetaLabel}>Meta a producir</Text>
        <Text style={s.etiquetaValor}>{orden?.cantidadProducir ?? 0} uds</Text>
      </View>

      <Text style={s.info}>Orden: {orden?.numeroOrden} · {turno?.nombreEmpleado}</Text>
      <Text style={s.info}>Próximo registro: {proximaHora}</Text>

      <Text style={s.seccion}>Producción por hora</Text>

      <View style={s.fila}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={unidadesHora}
          onChangeText={setUnidadesHora}
          placeholder="Unidades producidas"
          placeholderTextColor="#475569"
          keyboardType="numeric"
        />
        <TouchableOpacity style={s.btnAgregar} onPress={handleAgregarProduccion}>
          <Text style={s.btnAgregarText}>+ Agregar</Text>
        </TouchableOpacity>
      </View>

      {produccion.length > 0 && (
        <View style={s.listaRegistros}>
          <Text style={s.totalText}>Total: {totalProducido} uds</Text>
          {produccion.map((r, i) => (
            <View key={i} style={s.registroFila}>
              <Text style={s.registroHora}>{r.hora}</Text>
              <Text style={s.registroCantidad}>{r.cantidad} uds</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.seccion}>Paradas</Text>

      <TouchableOpacity style={s.selector} onPress={() => setModalParadas(true)}>
        <Text style={[s.selectorText, !paradaSeleccionada && s.placeholder]}>
          {paradaSeleccionada
            ? `${paradaSeleccionada.cod}. ${paradaSeleccionada.descripcion}`
            : 'Selecciona el tipo de parada'}
        </Text>
      </TouchableOpacity>


      <View style={s.fila}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={minutosParada}
          onChangeText={setMinutosParada}
          placeholder="Minutos de parada"
          placeholderTextColor="#475569"
          keyboardType="numeric"
        />
        <TouchableOpacity style={s.btnAgregar} onPress={handleAgregarParada}>
          <Text style={s.btnAgregarText}>+ Agregar</Text>
        </TouchableOpacity>
      </View>

      {paradasRegistradas.length > 0 && (
        <View style={s.listaRegistros}>
          {paradasRegistradas.map((p, i) => (
            <View key={i} style={s.registroFila}>
              <Text style={s.registroHora}>{p.cod}. {p.descripcion}</Text>
             <Text style={s.registroCantidad}>{p.minutos} min</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.seccion}>Desperdicios</Text>

      <TouchableOpacity style={s.selector} onPress={() => setModalDesperdicios(true)}>
        <Text style={[s.selectorText, !desperdSeleccionado && s.placeholder]}>
          {desperdSeleccionado
            ? `${desperdSeleccionado.cod}. ${desperdSeleccionado.defecto}`
            : 'Selecciona el tipo de defecto'}
        </Text>
      </TouchableOpacity>

      <View style={s.fila}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={cantidadDesperd}
          onChangeText={setCantidadDesperd}
          placeholder="Unidades rechazadas"
          placeholderTextColor="#475569"
          keyboardType="numeric"
        />
        <TouchableOpacity style={s.btnAgregar} onPress={handleAgregarDesperdicio}>
          <Text style={s.btnAgregarText}>+ Agregar</Text>
        </TouchableOpacity>
      </View>

      {desperdRegistrados.length > 0 && (
        <View style={s.listaRegistros}>
          <Text style={s.totalText}>Total rechazos: {totalDesperdicios} uds</Text>
          {desperdRegistrados.map((d, i) => (
            <View key={i} style={s.registroFila}>
              <Text style={s.registroHora}>{d.cod}. {d.defecto}</Text>
              <Text style={s.registroCantidad}>{d.cantidad} uds</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.seccion}>Relevo</Text>

      <Text style={s.label}>Cédula del empleado en relevo</Text>
      <TextInput
        style={s.input}
        value={cedulaRelevo}
        onChangeText={handleCedulaRelevo}
        placeholder="Ingresa la cédula"
        placeholderTextColor="#475569"
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
          <Text style={s.relevoActivoText}>Relevo activo desde {horaInicioRelevo}</Text>
        </View>
      )}

      <View style={s.fila}>
        <TouchableOpacity
          style={[s.btnRelevo, relevoActivo && s.btnDisabled]}
          onPress={handleInicioRelevo}
          disabled={relevoActivo}
        >
          <Text style={s.btnRelevoText}>Inicio relevo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnRelevoFin, !relevoActivo && s.btnDisabled]}
          onPress={handleFinRelevo}
          disabled={!relevoActivo}
        >
          <Text style={s.btnRelevoText}>Fin relevo</Text>
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

      <View style={s.botonesFinales}>
        <TouchableOpacity style={s.btnTurno} onPress={handleFinTurno}>
          <Text style={s.btnFinText}>Fin de turno</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnOrden} onPress={handleFinOrden}>
          <Text style={s.btnFinText}>Fin de orden</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={modalParadas} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona la parada</Text>
          <FlatList
            data={paradas}
            keyExtractor={item => item.cod.toString()}
          
           renderItem={({ item }) => (
  <TouchableOpacity
    style={s.modalItem}
    onPress={() => { setParadaSeleccionada(item); setModalParadas(false); }}
  >
    <Text style={s.modalItemCod}>{item.cod}.</Text>
    <Text style={s.modalItemText}>{item.descripcion}</Text>
  </TouchableOpacity>
)}

          />
          <TouchableOpacity style={s.btnCerrar} onPress={() => setModalParadas(false)}>
            <Text style={s.btnCerrarText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={modalDesperdicios} animationType="slide">
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Selecciona el defecto</Text>
          <FlatList
            data={desperdicios}
            keyExtractor={item => item.cod.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.modalItem}
                onPress={() => { setDesperdSeleccionado(item); setModalDesperdicios(false); }}
              >
                <Text style={s.modalItemCod}>{item.cod}.</Text>
                <Text style={s.modalItemText}>{item.defecto}</Text>
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
  container:        { flex: 1, backgroundColor: '#0f172a' },
  content:          { padding: 24, paddingTop: 50, paddingBottom: 40 },
  etiquetaMeta:     { backgroundColor: '#1e1b4b', borderRadius: 12, padding: 16,
                      flexDirection: 'row', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 12, borderWidth: 1,
                      borderColor: '#4338ca' },
  etiquetaLabel:    { fontSize: 13, color: '#a5b4fc' },
  etiquetaValor:    { fontSize: 22, fontWeight: '700', color: '#818cf8' },
  info:             { fontSize: 12, color: '#64748b', marginBottom: 4 },
  seccion:          { fontSize: 13, fontWeight: '600', color: '#6366f1',
                      textTransform: 'uppercase', letterSpacing: 1,
                      marginTop: 24, marginBottom: 12 },
  label:            { fontSize: 13, color: '#94a3b8', marginBottom: 6 },
  fila:             { flexDirection: 'row', gap: 10, marginBottom: 14 },
  input:            { backgroundColor: '#1e293b', borderRadius: 10, padding: 14,
                      fontSize: 15, color: '#f1f5f9', borderWidth: 1,
                      borderColor: '#334155' },
  inputAuto:        { backgroundColor: '#0f2744', borderRadius: 10, padding: 14,
                      marginBottom: 14, borderWidth: 1, borderColor: '#1e3a5f' },
  inputAutoText:    { fontSize: 15, color: '#6366f1' },
  placeholder:      { color: '#475569' },
  btnAgregar:       { backgroundColor: '#6366f1', borderRadius: 10,
                      paddingHorizontal: 16, justifyContent: 'center' },
  btnAgregarText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  listaRegistros:   { backgroundColor: '#1e293b', borderRadius: 10, padding: 12,
                      marginBottom: 14, borderWidth: 1, borderColor: '#334155' },
  totalText:        { fontSize: 13, color: '#6366f1', fontWeight: '700', marginBottom: 8 },
  registroFila:     { flexDirection: 'row', justifyContent: 'space-between',
                      paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#334155' },
  registroHora:     { fontSize: 12, color: '#94a3b8', flex: 1 },
  registroCantidad: { fontSize: 12, color: '#f1f5f9', fontWeight: '600' },
  selector:         { backgroundColor: '#1e293b', borderRadius: 10, padding: 16,
                      marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  selectorText:     { fontSize: 14, color: '#f1f5f9' },
  badge:            { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
                      marginBottom: 12, alignSelf: 'flex-start' },
  badgeProg:        { backgroundColor: '#14532d' },
  badgeNoProg:      { backgroundColor: '#7c2d12' },
  badgeText:        { fontSize: 11, fontWeight: '600', color: '#fff' },
  relevoActivoBadge: { backgroundColor: '#14532d', borderRadius: 8, padding: 10,
                       marginBottom: 12, borderWidth: 1, borderColor: '#16a34a' },
  relevoActivoText: { fontSize: 13, color: '#86efac', fontWeight: '600' },
  btnRelevo:        { flex: 1, backgroundColor: '#0f6e56', borderRadius: 10,
                      padding: 14, alignItems: 'center' },
  btnRelevoFin:     { flex: 1, backgroundColor: '#7c2d12', borderRadius: 10,
                      padding: 14, alignItems: 'center' },
  btnRelevoText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled:      { opacity: 0.4 },
  botonesFinales:   { flexDirection: 'row', gap: 12, marginTop: 24 },
  btnTurno:         { flex: 1, backgroundColor: '#0f6e56', borderRadius: 12,
                      padding: 16, alignItems: 'center' },
  btnOrden:         { flex: 1, backgroundColor: '#991b1b', borderRadius: 12,
                      padding: 16, alignItems: 'center' },
  btnFinText:       { color: '#fff', fontWeight: '700', fontSize: 15 },
  modal:            { flex: 1, backgroundColor: '#0f172a', padding: 20, paddingTop: 60 },
  modalTitulo:      { fontSize: 18, fontWeight: '700', color: '#f1f5f9', marginBottom: 16 },
  modalItem:        { flexDirection: 'row', gap: 10, padding: 14,
                      borderBottomWidth: 1, borderBottomColor: '#1e293b',
                      alignItems: 'flex-start' },
  modalItemProg:    { backgroundColor: '#0a1628' },
  modalItemNoProg:  { backgroundColor: '#0f172a' },
  modalItemCod:     { fontSize: 14, color: '#6366f1', fontWeight: '700', minWidth: 28 },
  modalItemText:    { fontSize: 14, color: '#f1f5f9' },
  modalItemTipo:    { fontSize: 11, color: '#64748b', marginTop: 2 },
  btnCerrar:        { backgroundColor: '#1e293b', borderRadius: 12,
                      padding: 16, alignItems: 'center', marginTop: 16 },
  btnCerrarText:    { color: '#94a3b8', fontWeight: '600', fontSize: 15 },
});