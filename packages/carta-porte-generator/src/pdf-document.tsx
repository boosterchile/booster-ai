/**
 * Componente React PDF para la Carta de Porte.
 *
 * Layout pensado para una hoja A4 portrait:
 *   - Header con título + tracking code + folio guia (si existe).
 *   - Bloque "Remitente" (shipper).
 *   - Bloque "Transportista" + bloque "Conductor".
 *   - Bloque "Vehículo".
 *   - Bloque "Ruta" (origen → destino + duración estimada).
 *   - Tabla de cargas (descripción / cantidad / unidad / peso).
 *   - Observaciones (opcional).
 *   - Footer legal con referencia a Ley 18.290 Art. 174.
 *
 * No incluye QR — el caller (apps/document-service) puede embeber uno
 * adicional pre-render via `<Image>` con un buffer PNG generado externamente,
 * o el verificador escanea el `trackingCode` impreso.
 *
 * Ningún dato sensible (passwords, tokens) entra acá. RUTs sí — son
 * públicos por naturaleza tributaria pero igual no se loguean.
 */

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { CartaPorteInput } from './types.js';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingHorizontal: 36,
    paddingVertical: 36,
    lineHeight: 1.4,
  },
  header: {
    borderBottom: '1px solid #1FA058',
    marginBottom: 14,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  trackingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: '#444',
  },
  section: {
    marginTop: 10,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#F1F8F4',
    padding: 4,
    marginBottom: 4,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 12,
  },
  col: {
    flex: 1,
  },
  kv: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  kvLabel: {
    width: 90,
    fontFamily: 'Helvetica-Bold',
    color: '#555',
  },
  kvValue: {
    flex: 1,
  },
  table: {
    marginTop: 4,
    borderTop: '1px solid #ddd',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1px solid #eee',
    paddingVertical: 3,
  },
  tableHeader: {
    backgroundColor: '#FAFAFA',
    fontFamily: 'Helvetica-Bold',
  },
  cellDescripcion: { flex: 4, paddingHorizontal: 4 },
  cellCantidad: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
  cellUnidad: { flex: 1, paddingHorizontal: 4 },
  cellPeso: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
  observaciones: {
    marginTop: 8,
    padding: 6,
    backgroundColor: '#FFFCF0',
    border: '1px solid #EFE0A0',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 8,
    color: '#888',
    borderTop: '1px solid #eee',
    paddingTop: 6,
  },
});

function formatRut(rut: string): string {
  // Inserta puntos: 76123456-7 → 76.123.456-7
  const [body, dv] = rut.split('-');
  if (!body || !dv) {
    return rut;
  }
  const reversed = body.split('').reverse();
  const grouped: string[] = [];
  for (let i = 0; i < reversed.length; i += 3) {
    grouped.push(
      reversed
        .slice(i, i + 3)
        .reverse()
        .join(''),
    );
  }
  return `${grouped.reverse().join('.')}-${dv.toUpperCase()}`;
}

function formatDate(d: Date): string {
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString('es-CL');
}

export interface CartaPorteDocumentProps {
  input: CartaPorteInput;
}

export function CartaPorteDocument({ input }: CartaPorteDocumentProps) {
  const totalPeso = input.cargas.reduce((acc, c) => acc + c.pesoKg, 0);

  return (
    <Document
      title={`Carta de Porte ${input.trackingCode}`}
      author="Booster AI"
      subject="Carta de Porte Ley 18.290 Art. 174"
      creator="@booster-ai/carta-porte-generator"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>CARTA DE PORTE</Text>
          <View style={styles.trackingRow}>
            <Text>Tracking: {input.trackingCode}</Text>
            <Text>Emisión: {formatDate(input.fechaEmision)}</Text>
          </View>
          {input.folioGuiaDte ? (
            <View style={styles.trackingRow}>
              <Text>Guía DTE asociada: Folio {input.folioGuiaDte}</Text>
              <Text>Salida prevista: {formatDate(input.fechaSalida)}</Text>
            </View>
          ) : (
            <View style={styles.trackingRow}>
              <Text> </Text>
              <Text>Salida prevista: {formatDate(input.fechaSalida)}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>REMITENTE (Generador de Carga)</Text>
          <EmpresaBlock empresa={input.remitente} />
        </View>

        <View style={styles.twoCol}>
          <View style={[styles.section, styles.col]}>
            <Text style={styles.sectionTitle}>TRANSPORTISTA</Text>
            <EmpresaBlock empresa={input.transportista} />
          </View>
          <View style={[styles.section, styles.col]}>
            <Text style={styles.sectionTitle}>CONDUCTOR</Text>
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>RUT:</Text>
              <Text style={styles.kvValue}>{formatRut(input.conductor.rut)}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>Nombre:</Text>
              <Text style={styles.kvValue}>{input.conductor.nombreCompleto}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>Licencia:</Text>
              <Text style={styles.kvValue}>
                {input.conductor.numeroLicencia} (Clase {input.conductor.claseLicencia})
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VEHÍCULO</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Patente:</Text>
                <Text style={styles.kvValue}>{input.vehiculo.patente}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Marca/Modelo:</Text>
                <Text style={styles.kvValue}>
                  {input.vehiculo.marca} {input.vehiculo.modelo} ({input.vehiculo.anio})
                </Text>
              </View>
            </View>
            <View style={styles.col}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Tipo:</Text>
                <Text style={styles.kvValue}>{input.vehiculo.tipoVehiculo}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Capacidad:</Text>
                <Text style={styles.kvValue}>{formatNumber(input.vehiculo.capacidadKg)} kg</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RUTA</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Origen:</Text>
                <Text style={styles.kvValue}>
                  {input.origen.direccion}, {input.origen.comuna}, {input.origen.region}
                </Text>
              </View>
            </View>
            <View style={styles.col}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Destino:</Text>
                <Text style={styles.kvValue}>
                  {input.destino.direccion}, {input.destino.comuna}, {input.destino.region}
                </Text>
              </View>
            </View>
          </View>
          {input.duracionEstimadaHoras !== undefined ? (
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>Duración est.:</Text>
              <Text style={styles.kvValue}>{input.duracionEstimadaHoras.toFixed(1)} horas</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CARGAS</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={styles.cellDescripcion}>Descripción</Text>
              <Text style={styles.cellCantidad}>Cantidad</Text>
              <Text style={styles.cellUnidad}>Unidad</Text>
              <Text style={styles.cellPeso}>Peso (kg)</Text>
            </View>
            {input.cargas.map((carga, idx) => (
              <View key={`carga-${idx}-${carga.descripcion.slice(0, 8)}`} style={styles.tableRow}>
                <Text style={styles.cellDescripcion}>{carga.descripcion}</Text>
                <Text style={styles.cellCantidad}>{formatNumber(carga.cantidad)}</Text>
                <Text style={styles.cellUnidad}>{carga.unidadMedida}</Text>
                <Text style={styles.cellPeso}>{formatNumber(carga.pesoKg)}</Text>
              </View>
            ))}
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={styles.cellDescripcion}>TOTAL</Text>
              <Text style={styles.cellCantidad}> </Text>
              <Text style={styles.cellUnidad}> </Text>
              <Text style={styles.cellPeso}>{formatNumber(totalPeso)}</Text>
            </View>
          </View>
        </View>

        {input.observaciones ? (
          <View style={styles.observaciones}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Observaciones</Text>
            <Text>{input.observaciones}</Text>
          </View>
        ) : null}

        <Text fixed style={styles.footer}>
          Documento conforme Ley 18.290 del Tránsito Art. 174 — Booster AI · Verificación online:
          https://app.boosterchile.com/v/{input.trackingCode}
        </Text>
      </Page>
    </Document>
  );
}

interface EmpresaBlockProps {
  empresa: CartaPorteInput['remitente'];
}

function EmpresaBlock({ empresa }: EmpresaBlockProps) {
  return (
    <>
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>RUT:</Text>
        <Text style={styles.kvValue}>{formatRut(empresa.rut)}</Text>
      </View>
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>Razón social:</Text>
        <Text style={styles.kvValue}>{empresa.razonSocial}</Text>
      </View>
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>Giro:</Text>
        <Text style={styles.kvValue}>{empresa.giro}</Text>
      </View>
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>Dirección:</Text>
        <Text style={styles.kvValue}>
          {empresa.direccion}, {empresa.comuna}
        </Text>
      </View>
      {empresa.telefono ? (
        <View style={styles.kv}>
          <Text style={styles.kvLabel}>Teléfono:</Text>
          <Text style={styles.kvValue}>{empresa.telefono}</Text>
        </View>
      ) : null}
      {empresa.email ? (
        <View style={styles.kv}>
          <Text style={styles.kvLabel}>Email:</Text>
          <Text style={styles.kvValue}>{empresa.email}</Text>
        </View>
      ) : null}
    </>
  );
}
