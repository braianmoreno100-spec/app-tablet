import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Switch, Alert, ActivityIndicator, Image
} from 'react-native';
import { useRouter } from 'expo-router';
import { guardarOrdenGlobal } from '../store/useOrdenStore';
import { LIDERES, PRODUCTOS } from '../constants/autocompletado';
import { TipoMaquina } from '../constants/listas';
import {
  apiCrearOrden, apiVerificarOrden, apiGetProducto,
  guardarOrdenId, guardarTurnoId, VerificarOrdenResp,
} from '../store/api';

const TIPOS_MAQUINA: { label: string; value: TipoMaquina }[] = [
  { label: 'Inyección',         value: 'inyeccion'         },
  { label: 'Soplado',           value: 'soplado'           },
  { label: 'Línea de empaque',  value: 'linea'             },
  { label: 'Acondicionamiento', value: 'acondicionamiento' },
];

const MAQUINAS_POR_TIPO: Record<TipoMaquina, number[] | null> = {
  inyeccion:         [1, 2, 3, 4, 5, 6, 7],
  soplado:           [1],
  linea:             [1, 2],
  acondicionamiento: [1, 2],
};

const ETIQUETAS_MAQUINA: Partial<Record<TipoMaquina, Record<number, string>>> = {
  linea: { 1: 'Copro', 2: 'Orina' },
};

export default function Pantalla1() {
  const router = useRouter();

  const [cedulaLider,         setCedulaLider]         = useState('');
  const [nombreLider,         setNombreLider]         = useState('');
  const [errorLider,          setErrorLider]          = useState('');
  const [numeroOrden,         setNumeroOrden]         = useState('');
  const [codigoProducto,      setCodigoProducto]      = useState('');
  const [descripcionProducto, setDescripcionProducto] = useState('');
  const [cantidadProducir,    setCantidadProducir]    = useState('');
  const [material,            setMaterial]            = useState('');
  const [tipoMaquina,         setTipoMaquina]         = useState<TipoMaquina | null>(null);
  const [numeroMaquina,       setNumeroMaquina]       = useState('');
  const [cavidades,           setCavidades]           = useState('');
  const [ciclos,              setCiclos]              = useState('');
  const [tienePigmento,       setTienePigmento]       = useState(false);
  const [numeroPigmento,      setNumeroPigmento]      = useState('');
  const [descripcionPigmento, setDescripcionPigmento] = useState('');
  const [cargando,            setCargando]            = useState(false);

  const [validandoProducto, setValidandoProducto] = useState(false);
  const [productoValidado,  setProductoValidado]  = useState(false);
  const [productoListoBD,   setProductoListoBD]   = useState(false);
  const [errorProducto,     setErrorProducto]     = useState('');
  const [errorOrden,        setErrorOrden]        = useState('');

  // NUEVO: banner de orden retomada
  const [ordenRetomada, setOrdenRetomada] = useState(false);

  const debounceProducto = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceOrden    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTogglePigmento = (valor: boolean) => {
    setTienePigmento(valor);
    if (!valor) { setNumeroPigmento(''); setDescripcionPigmento(''); }
  };

  const handleCedulaLider = (valor: string) => {
    setCedulaLider(valor);
    setErrorLider('');
    if (LIDERES[valor]) {
      setNombreLider(LIDERES[valor]);
    } else {
      setNombreLider('');
      if (valor.length >= 6) setErrorLider('Líder no encontrado. Verifica la cédula o agrégalo en Catálogos.');
    }
  };

  // ── NUEVO: llenar formulario con datos de una orden existente ─────────────
  const rellenarConOrdenExistente = (datos: VerificarOrdenResp) => {
    setCedulaLider(datos.cedula_lider ?? '');
    setNombreLider(datos.nombre_lider ?? '');
    setCodigoProducto(datos.codigo_producto ?? '');
    setDescripcionProducto(datos.descripcion_producto ?? '');
    setCantidadProducir(String(datos.cantidad_producir ?? ''));
    setMaterial(datos.material ?? '');
    setTipoMaquina((datos.tipo_maquina as TipoMaquina) ?? null);
    setNumeroMaquina(datos.numero_maquina ?? '');
    setCavidades(String(datos.cavidades ?? ''));
    setCiclos(String(datos.ciclos ?? ''));
    setTienePigmento(datos.tiene_pigmento ?? false);
    setNumeroPigmento(datos.numero_pigmento ?? '');
    setDescripcionPigmento(datos.descripcion_pigmento ?? '');
    setProductoValidado(true);
    setProductoListoBD(true);
    setErrorProducto('');
    setErrorOrden('');
    setOrdenRetomada(true);
  };

  // FIX E3 + NUEVO: verificar orden desde 1 char, detectar orden abierta
  const handleNumeroOrden = (valor: string) => {
    setNumeroOrden(valor);
    setErrorOrden('');
    setOrdenRetomada(false);
    if (debounceOrden.current) clearTimeout(debounceOrden.current);
    if (valor.trim().length >= 1) {
      debounceOrden.current = setTimeout(async () => {
        try {
          const resp = await apiVerificarOrden(valor.trim());

          if (!resp.existe) return; // No existe — campo libre, sin error

          if (resp.activa === false) {
            // Orden cerrada — no se puede usar
            setErrorOrden(`La orden "${valor}" ya fue cerrada. Usa un número diferente.`);
            return;
          }

          // Orden ABIERTA — ofrecer retomar
          Alert.alert(
            '📋 Orden en curso',
            `La orden "${valor}" ya existe y está abierta.\n\n` +
            `Producto: ${resp.descripcion_producto}\n` +
            `Máquina: ${resp.tipo_maquina} #${resp.numero_maquina}\n\n` +
            (resp.turno_activo_id
              ? '⚡ Tiene un turno activo en curso.'
              : '➕ Sin turno activo — puedes iniciar uno nuevo.'),
            [
              {
                text: 'Retomar orden',
                onPress: async () => {
                  // Guardar el ID de la orden en storage sin crear una nueva
                  if (resp.orden_id) await guardarOrdenId(resp.orden_id);

                  // Si hay turno activo, guardar también el turno_id
                  if (resp.turno_activo_id) await guardarTurnoId(resp.turno_activo_id);

                  // Rellenar el formulario con los datos de la orden
                  rellenarConOrdenExistente(resp);

                  // Guardar en el store global para Pantalla2/3
                  guardarOrdenGlobal({
                    cedulaLider:         resp.cedula_lider ?? '',
                    nombreLider:         resp.nombre_lider ?? '',
                    numeroOrden:         valor.trim(),
                    codigoProducto:      resp.codigo_producto ?? '',
                    descripcionProducto: resp.descripcion_producto ?? '',
                    cantidadProducir:    resp.cantidad_producir ?? 0,
                    material:            resp.material ?? '',
                    tipoMaquina:         (resp.tipo_maquina as TipoMaquina) ?? 'inyeccion',
                    numeroMaquina:       resp.numero_maquina ?? '',
                    cavidades:           resp.cavidades ?? 0,
                    ciclos:              resp.ciclos ?? 0,
                    tienePigmento:       resp.tiene_pigmento ?? false,
                    numeroPigmento:      resp.numero_pigmento ?? '',
                    descripcionPigmento: resp.descripcion_pigmento ?? '',
                  });

                  // Navegar: si hay turno activo → Pantalla3, si no → Pantalla2
                  if (resp.turno_activo_id) {
                    router.replace('/pantalla3');
                  } else {
                    router.push('/pantalla2');
                  }
                },
              },
              {
                text: 'Usar otro número',
                style: 'cancel',
                onPress: () => {
                  setNumeroOrden('');
                  setOrdenRetomada(false);
                },
              },
            ]
          );
        } catch (e: any) {
  Alert.alert('Error verificar', e?.message || String(e));
}
      }, 600);
    }
  };

  const handleCodigoProducto = (valor: string) => {
    const v = valor.toUpperCase();
    setCodigoProducto(v);
    setProductoValidado(false);
    setProductoListoBD(false);
    setErrorProducto('');

    const productoLocal = PRODUCTOS[v];
    if (productoLocal) {
      setDescripcionProducto(productoLocal.descripcion);
      setMaterial(productoLocal.material);
      // FIX E1: NO llenar ciclos/cavidades desde local — esperar BD
    } else {
      setDescripcionProducto('');
      setMaterial('');
      setCavidades('');
      setCiclos('');
    }

    if (debounceProducto.current) clearTimeout(debounceProducto.current);
    if (v.length >= 3) {
      setValidandoProducto(true);
      debounceProducto.current = setTimeout(async () => {
        try {
          const productoBD = await apiGetProducto(v);
          setDescripcionProducto(productoBD.descripcion);
          setMaterial(productoBD.material || '');
          setCavidades(String(productoBD.cavidades));
          setCiclos(String(productoBD.ciclos));
          setProductoValidado(true);
          setProductoListoBD(true);
          setErrorProducto('');
        } catch {
          if (productoLocal) {
            setCavidades(productoLocal.cavidades.toString());
            setCiclos(productoLocal.ciclos.toString());
            setErrorProducto('No se pudo verificar con el servidor');
          } else {
            setDescripcionProducto('');
            setMaterial('');
            setCavidades('');
            setCiclos('');
            setErrorProducto('Código no encontrado en BD');
          }
          setProductoValidado(false);
          setProductoListoBD(false);
        } finally {
          setValidandoProducto(false);
        }
      }, 700);
    } else {
      setValidandoProducto(false);
    }
  };

  const handleTipoMaquina = (tipo: TipoMaquina) => {
    setTipoMaquina(tipo);
    setNumeroMaquina('');
  };

  const handleGuardar = async () => {
    if (!cedulaLider || !nombreLider) { Alert.alert('Campos incompletos', 'Ingresa la cédula del líder'); return; }
    if (!numeroOrden.trim())          { Alert.alert('Campos incompletos', 'Ingresa el número de orden'); return; }
    if (!codigoProducto.trim() || !descripcionProducto) { Alert.alert('Campos incompletos', 'Ingresa un código de producto válido'); return; }
    if (errorProducto === 'Código no encontrado en BD') { Alert.alert('Producto inválido', `El código "${codigoProducto}" no existe en la base de datos.`); return; }
    if (validandoProducto) { Alert.alert('Espera', 'Verificando el código de producto con el servidor...'); return; }
    if (!productoListoBD && !errorProducto) { Alert.alert('Espera', 'Aún verificando datos del producto con el servidor...'); return; }
    if (!cavidades || cavidades === '0' || !ciclos || ciclos === '0') { Alert.alert('Datos incompletos', 'No se pudieron cargar los ciclos y cavidades del producto.'); return; }

    const cantidad = Number(cantidadProducir);
    if (!cantidadProducir || isNaN(cantidad) || cantidad <= 0) { Alert.alert('Cantidad inválida', 'La cantidad a producir debe ser mayor a cero'); return; }
    if (cantidad > 10_000_000) { Alert.alert('Cantidad inválida', 'La cantidad parece demasiado alta. Verifica el valor.'); return; }
    if (!tipoMaquina)   { Alert.alert('Tipo de máquina', 'Debes seleccionar el tipo de máquina'); return; }
    if (!numeroMaquina) { Alert.alert('Número de máquina', 'Debes seleccionar el número de máquina'); return; }
    if (tienePigmento && (!numeroPigmento.trim() || !descripcionPigmento.trim())) { Alert.alert('Datos de pigmento', 'Si lleva pigmento completa número y descripción'); return; }

    // Si la orden fue retomada → no crear nueva orden, ir directo a Pantalla2
    if (ordenRetomada) {
      guardarOrdenGlobal({
        cedulaLider, nombreLider, numeroOrden: numeroOrden.trim(), codigoProducto,
        descripcionProducto, cantidadProducir: cantidad, material,
        tipoMaquina: tipoMaquina!, numeroMaquina,
        cavidades: Number(cavidades), ciclos: Number(ciclos),
        tienePigmento, numeroPigmento: numeroPigmento.trim(), descripcionPigmento: descripcionPigmento.trim(),
      });
      router.push('/pantalla2');
      return;
    }

    setCargando(true);
    try {
      // Verificación final de duplicado antes de crear
      try {
        const resp = await apiVerificarOrden(numeroOrden.trim());
        if (resp.existe && resp.activa) {
          Alert.alert('Orden abierta', `La orden "${numeroOrden}" ya existe. Escribe el número en el campo de orden para retomar.`);
          setCargando(false); return;
        }
        if (resp.existe && resp.activa === false) {
          Alert.alert('Orden cerrada', `La orden "${numeroOrden}" ya fue cerrada. Usa un número diferente.`);
          setCargando(false); return;
        }
      } catch {
        Alert.alert(
          'Advertencia',
          'No se pudo verificar si el número de orden ya existe. ¿Continuar de todas formas?',
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => setCargando(false) },
            { text: 'Continuar', onPress: () => crearOrden(cantidad) },
          ]
        );
        return;
      }
      await crearOrden(cantidad);
    } catch (error: any) {
      Alert.alert('Error al guardar', error.message || 'No se pudo conectar al servidor');
      setCargando(false);
    }
  };

  const crearOrden = async (cantidad: number) => {
    guardarOrdenGlobal({
      cedulaLider, nombreLider, numeroOrden: numeroOrden.trim(), codigoProducto,
      descripcionProducto, cantidadProducir: cantidad, material,
      tipoMaquina: tipoMaquina!, numeroMaquina,
      cavidades: Number(cavidades), ciclos: Number(ciclos),
      tienePigmento, numeroPigmento: numeroPigmento.trim(), descripcionPigmento: descripcionPigmento.trim(),
    });
    try {
      const ordenCreada = await apiCrearOrden({
        numero_orden: numeroOrden.trim(), codigo_producto: codigoProducto,
        descripcion_producto: descripcionProducto, cantidad_producir: cantidad,
        material, tipo_maquina: tipoMaquina!, numero_maquina: numeroMaquina,
        cavidades: Number(cavidades), ciclos: Number(ciclos),
        tiene_pigmento: tienePigmento,
        numero_pigmento: numeroPigmento.trim(),
        descripcion_pigmento: descripcionPigmento.trim(),
        cedula_lider: cedulaLider, nombre_lider: nombreLider,
      });
      await guardarOrdenId(ordenCreada.id);
      router.push('/pantalla2');
    } catch (error: any) {
      Alert.alert('Error al guardar', error.message || 'No se pudo conectar al servidor');
    } finally {
      setCargando(false);
    }
  };

  const opcionesMaquina = tipoMaquina ? MAQUINAS_POR_TIPO[tipoMaquina] : null;

  const renderSelectorNumeroMaquina = () => {
    if (!tipoMaquina) return null;
    if (opcionesMaquina) {
      const etiquetas = ETIQUETAS_MAQUINA[tipoMaquina];
      return (
        <>
          <Text style={s.label}>{tipoMaquina === 'linea' ? 'Línea de empaque' : 'Número de máquina'}</Text>
          <View style={s.botonesNumero}>
            {opcionesMaquina.map((num) => {
              const etiqueta = etiquetas?.[num] ?? String(num);
              const activo   = numeroMaquina === String(num);
              return (
                <TouchableOpacity
                  key={num}
                  style={[s.botonNumero, tipoMaquina === 'linea' && s.botonNumeroLinea, activo && s.botonNumeroActivo]}
                  onPress={() => setNumeroMaquina(String(num))}
                >
                  <Text style={[s.botonNumeroText, tipoMaquina === 'linea' && s.botonNumeroTextLinea, activo && s.botonNumeroTextActivo]}>{etiqueta}</Text>
                  {tipoMaquina === 'linea' && <Text style={[s.botonNumeroSub, activo && s.botonNumeroSubActivo]}>Línea {num}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      );
    }
    return (
      <>
        <Text style={s.label}>Número de máquina</Text>
        <TextInput style={s.input} value={numeroMaquina} onChangeText={setNumeroMaquina} placeholder="Ingresa el número de máquina" placeholderTextColor="#555" keyboardType="numeric" />
      </>
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.header}>
        <Image source={require('../assets/logo_inverfarma.png')} style={s.logo} resizeMode="contain" />
        <View>
          <Text style={s.titulo}>Datos de la orden</Text>
          <Text style={s.subtitulo}>Ingreso del líder de producción</Text>
        </View>
      </View>

      {/* ── Banner orden retomada ── */}
      {ordenRetomada && (
        <View style={s.bannerRetomada}>
          <Text style={s.bannerRetomadaTexto}>✓ Orden retomada — los datos se cargaron automáticamente</Text>
        </View>
      )}

      {/* ── Líder ── */}
      <View style={s.card}>
        <Text style={s.seccion}>DATOS DEL LÍDER</Text>
        <Text style={s.label}>Cédula del líder</Text>
        <TextInput style={s.input} value={cedulaLider} onChangeText={handleCedulaLider} placeholder="Ingresa la cédula" placeholderTextColor="#555" keyboardType="numeric" editable={!ordenRetomada} />
        <Text style={s.label}>Nombre del líder</Text>
        {errorLider ? (
          <View style={[s.inputAuto, { backgroundColor: '#3b1010', borderColor: '#5a1a1a' }]}>
            <Text style={[s.inputAutoText, { color: '#f87171' }]}>{errorLider}</Text>
          </View>
        ) : (
          <View style={s.inputAuto}>
            <Text style={[s.inputAutoText, !nombreLider && s.placeholder]}>{nombreLider || 'Se completa automáticamente'}</Text>
          </View>
        )}
      </View>

      {/* ── Orden ── */}
      <View style={s.card}>
        <Text style={s.seccion}>DATOS DE LA ORDEN</Text>
        <Text style={s.label}>Número de orden</Text>
        <TextInput
          style={[s.input, ordenRetomada && s.inputRetomado]}
          value={numeroOrden} onChangeText={handleNumeroOrden}
          placeholder="Ingresa el número de orden" placeholderTextColor="#555" keyboardType="numeric"
        />
        {errorOrden ? <Text style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{errorOrden}</Text> : null}

        <Text style={s.label}>Código de producto</Text>
        <TextInput style={[s.input, ordenRetomada && s.inputRetomado]} value={codigoProducto} onChangeText={handleCodigoProducto} placeholder="Ingresa el código" placeholderTextColor="#555" autoCapitalize="characters" editable={!ordenRetomada} />

        <Text style={s.label}>Descripción de producto</Text>
        <View style={[s.inputAuto, errorProducto === 'Código no encontrado en BD' && s.inputAutoError]}>
          {validandoProducto ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#5A9E2F" />
              <Text style={s.inputAutoTextMuted}>Verificando con servidor...</Text>
            </View>
          ) : (
            <Text style={[s.inputAutoText, !descripcionProducto && s.placeholder, errorProducto === 'Código no encontrado en BD' && s.inputAutoErrorText]}>
              {errorProducto === 'Código no encontrado en BD' ? 'Código no encontrado en la base de datos' : descripcionProducto || 'Se completa con el código'}
            </Text>
          )}
        </View>
        {errorProducto === 'No se pudo verificar con el servidor' && <Text style={s.advertenciaProducto}>⚠ Usando datos locales — no se pudo confirmar con el servidor</Text>}
        {productoValidado && <Text style={s.productoOk}>✓ Producto verificado en BD</Text>}

        <View style={s.fila}>
          <View style={s.mitad}>
            <Text style={s.label}>Cantidad a producir <Text style={s.labelReq}>*</Text></Text>
            <TextInput
              style={[s.input, cantidadProducir === '' && s.inputPendiente, ordenRetomada && s.inputRetomado]}
              value={cantidadProducir} onChangeText={setCantidadProducir}
              placeholder="Obligatorio" placeholderTextColor="#c0392b" keyboardType="numeric"
              editable={!ordenRetomada}
            />
            {cantidadProducir !== '' && Number(cantidadProducir) > 0 && <Text style={s.hint}>{Number(cantidadProducir).toLocaleString('es-CO')} uds</Text>}
          </View>
          <View style={s.mitad}>
            <Text style={s.label}>Material</Text>
            <View style={s.inputAuto}><Text style={[s.inputAutoText, !material && s.placeholder]}>{material || 'Auto'}</Text></View>
          </View>
        </View>
      </View>

      {/* ── Máquina ── */}
      <View style={s.card}>
        <Text style={s.seccion}>MÁQUINA</Text>
        <Text style={s.label}>Tipo de máquina</Text>
        {TIPOS_MAQUINA.map((tipo) => (
          <TouchableOpacity
            key={tipo.value}
            style={[s.opcionCard, tipoMaquina === tipo.value && s.opcionActiva, ordenRetomada && s.opcionDeshabilitada]}
            onPress={() => !ordenRetomada && handleTipoMaquina(tipo.value)}
          >
            <View style={[s.radio, tipoMaquina === tipo.value && s.radioActivo]} />
            <Text style={[s.opcionText, tipoMaquina === tipo.value && s.opcionTextActivo]}>{tipo.label}</Text>
          </TouchableOpacity>
        ))}
        {renderSelectorNumeroMaquina()}
        <View style={s.fila}>
          <View style={s.mitad}>
            <Text style={s.label}>Cavidades</Text>
            <View style={[s.inputAuto, (!cavidades || cavidades === '0') && s.inputAutoEspera]}>
              <Text style={[s.inputAutoText, !cavidades && s.placeholder]}>{validandoProducto ? '...' : cavidades || 'Auto'}</Text>
            </View>
          </View>
          <View style={s.mitad}>
            <Text style={s.label}>Ciclos</Text>
            <View style={[s.inputAuto, (!ciclos || ciclos === '0') && s.inputAutoEspera]}>
              <Text style={[s.inputAutoText, !ciclos && s.placeholder]}>{validandoProducto ? '...' : ciclos || 'Auto'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Pigmento ── */}
      <View style={s.card}>
        <Text style={s.seccion}>PIGMENTO</Text>
        <View style={s.toggleFila}>
          <Text style={s.toggleLabel}>¿Lleva pigmento?</Text>
          <Switch value={tienePigmento} onValueChange={handleTogglePigmento} trackColor={{ false: '#333', true: '#5A9E2F' }} thumbColor={tienePigmento ? '#fff' : '#888'} disabled={ordenRetomada} />
        </View>
        {tienePigmento && (
          <>
            <Text style={s.label}>Número de pigmento</Text>
            <TextInput style={s.input} value={numeroPigmento} onChangeText={setNumeroPigmento} placeholder="Ingresa el número de pigmento" placeholderTextColor="#555" keyboardType="numeric" editable={!ordenRetomada} />
            <Text style={s.label}>Descripción del pigmento</Text>
            <TextInput style={s.input} value={descripcionPigmento} onChangeText={setDescripcionPigmento} placeholder="Ej: Azul marino concentrado" placeholderTextColor="#555" editable={!ordenRetomada} />
          </>
        )}
      </View>

      <TouchableOpacity style={[s.btn, cargando && s.btnDisabled]} onPress={handleGuardar} disabled={cargando}>
        {cargando
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>{ordenRetomada ? 'Continuar orden →' : 'Guardar orden y continuar →'}</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:             { flex: 1, backgroundColor: '#181818' },
  content:               { padding: 20, paddingTop: 52, paddingBottom: 48 },
  header:                { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  logo:                  { width: 52, height: 52 },
  titulo:                { fontSize: 22, fontWeight: '800', color: '#f0f0f0' },
  subtitulo:             { fontSize: 13, color: '#888', marginTop: 2 },
  bannerRetomada:        { backgroundColor: '#1e3320', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#2d4a2a' },
  bannerRetomadaTexto:   { color: '#7ec44f', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  card:                  { backgroundColor: '#222', borderRadius: 12, borderWidth: 1, borderColor: '#2e2e2e', padding: 16, marginBottom: 14 },
  seccion:               { fontSize: 11, fontWeight: '700', color: '#5A9E2F', letterSpacing: 1.2, marginBottom: 14 },
  label:                 { fontSize: 13, color: '#888', marginBottom: 6 },
  labelReq:              { color: '#e74c3c', fontSize: 13 },
  input:                 { backgroundColor: '#2a2a2a', borderRadius: 10, padding: 14, fontSize: 15, color: '#f0f0f0', marginBottom: 14, borderWidth: 1, borderColor: '#383838' },
  inputPendiente:        { borderColor: '#7f2e2e' },
  inputRetomado:         { backgroundColor: '#1e2a16', borderColor: '#2d3f20', color: '#7ec44f' },
  inputAuto:             { backgroundColor: '#1e2a16', borderRadius: 10, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: '#2d3f20' },
  inputAutoEspera:       { backgroundColor: '#2a2a1e', borderColor: '#3f3f20' },
  inputAutoError:        { backgroundColor: '#2a1616', borderColor: '#4a2020' },
  inputAutoText:         { fontSize: 15, color: '#7ec44f' },
  inputAutoTextMuted:    { fontSize: 14, color: '#888' },
  inputAutoErrorText:    { color: '#ef4444' },
  placeholder:           { color: '#3a4a30' },
  hint:                  { fontSize: 12, color: '#5A9E2F', marginTop: -10, marginBottom: 14 },
  advertenciaProducto:   { fontSize: 11, color: '#f59e0b', marginBottom: 12, marginTop: 2 },
  productoOk:            { fontSize: 11, color: '#5A9E2F', marginBottom: 12, marginTop: 2 },
  fila:                  { flexDirection: 'row', gap: 12 },
  mitad:                 { flex: 1 },
  opcionCard:            { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#383838' },
  opcionActiva:          { borderColor: '#5A9E2F', backgroundColor: '#1e2a16' },
  opcionDeshabilitada:   { opacity: 0.6 },
  radio:                 { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#555' },
  radioActivo:           { borderColor: '#5A9E2F', backgroundColor: '#5A9E2F' },
  opcionText:            { fontSize: 15, color: '#888' },
  opcionTextActivo:      { color: '#f0f0f0', fontWeight: '600' },
  botonesNumero:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  botonNumero:           { width: 54, height: 54, borderRadius: 10, backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#383838', alignItems: 'center', justifyContent: 'center' },
  botonNumeroLinea:      { width: 108, height: 62 },
  botonNumeroActivo:     { backgroundColor: '#1e2a16', borderColor: '#5A9E2F' },
  botonNumeroText:       { fontSize: 20, fontWeight: '600', color: '#555' },
  botonNumeroTextLinea:  { fontSize: 15, fontWeight: '700', color: '#555' },
  botonNumeroTextActivo: { color: '#7ec44f' },
  botonNumeroSub:        { fontSize: 10, color: '#555', marginTop: 2 },
  botonNumeroSubActivo:  { color: '#5A9E2F' },
  toggleFila:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2a2a2a', borderRadius: 10, padding: 15, marginBottom: 14, borderWidth: 1, borderColor: '#383838' },
  toggleLabel:           { fontSize: 15, color: '#d0d0d0' },
  btn:                   { backgroundColor: '#5A9E2F', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 6, elevation: 4, shadowColor: '#5A9E2F', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  btnDisabled:           { opacity: 0.5 },
  btnText:               { color: '#fff', fontSize: 17, fontWeight: '800' },
});