/**
 * Escapa texto para interpolarlo en el HTML de un correo. Nombre, razón social
 * y RUT vienen de formularios: sin esto, un `<img onerror>` en el nombre de
 * una empresa terminaría renderizado en el cliente de correo del destinatario.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
