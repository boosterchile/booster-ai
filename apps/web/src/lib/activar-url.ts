/** Dirección absoluta de `/activar`, para entregarla junto al código de activación. */
export function urlActivar(origin: string = window.location.origin): string {
  return `${origin}/activar`;
}
