/**
 * Elige a quién se le escribe por WhatsApp.
 *
 * Oferta y chat: la persona que despacha. Si la empresa no tiene
 * despachador con número, los dueños. Seguridad: dueños y despachadores
 * juntos. El conductor no entra en ninguno de los dos: va al volante.
 *
 * Un número, un mensaje, aunque haya dos fichas con el mismo WhatsApp.
 */

export interface WhatsappMembershipRow {
  userId: string;
  role: string;
  whatsappE164: string | null;
}

export interface WhatsappRecipient {
  userId: string;
  whatsappE164: string;
}

export function pickOperationalWhatsappRecipients(
  rows: readonly WhatsappMembershipRow[],
): WhatsappRecipient[] {
  const dispatchers = dedupePhones(rows.filter((row) => row.role === 'despachador'));
  if (dispatchers.length > 0) {
    return dispatchers;
  }
  return dedupePhones(rows.filter((row) => row.role === 'dueno'));
}

export function pickSafetyWhatsappRecipients(
  rows: readonly WhatsappMembershipRow[],
): WhatsappRecipient[] {
  return dedupePhones(rows.filter((row) => row.role === 'dueno' || row.role === 'despachador'));
}

function dedupePhones(rows: readonly WhatsappMembershipRow[]): WhatsappRecipient[] {
  const seen = new Set<string>();
  const out: WhatsappRecipient[] = [];
  for (const row of rows) {
    if (!row.whatsappE164 || seen.has(row.whatsappE164)) {
      continue;
    }
    seen.add(row.whatsappE164);
    out.push({ userId: row.userId, whatsappE164: row.whatsappE164 });
  }
  return out;
}
