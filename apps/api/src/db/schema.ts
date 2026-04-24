import { index, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Drizzle schema del thin slice.
 *
 * Solo `whatsapp_intake_drafts` por ahora — ver decisión en task #45:
 * mantenemos esta tabla separada del modelo canónico `cargo_requests` para
 * no contaminarlo con drafts incompletos. El slice 2 transforma drafts
 * → cargo_requests después de enriquecimiento asíncrono.
 *
 * Cambios de schema: usar drizzle-kit generate + incluir en migrations/
 * y aplicar automáticamente al startup (ver db/migrator.ts).
 */

export const whatsAppIntakeStatusEnum = pgEnum('whatsapp_intake_status', [
  'in_progress',
  'captured',
  'converted',
  'abandoned',
  'cancelled',
]);

export const cargoTypeEnum = pgEnum('cargo_type', [
  'dry_goods',
  'perishable',
  'refrigerated',
  'frozen',
  'fragile',
  'dangerous',
  'liquid',
  'construction',
  'agricultural',
  'livestock',
  'other',
]);

export const whatsAppIntakeDrafts = pgTable(
  'whatsapp_intake_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: varchar('tracking_code', { length: 10 }).notNull().unique(),
    shipperWhatsapp: varchar('shipper_whatsapp', { length: 20 }).notNull(),
    originAddressRaw: text('origin_address_raw').notNull(),
    destinationAddressRaw: text('destination_address_raw').notNull(),
    cargoType: cargoTypeEnum('cargo_type').notNull(),
    pickupDateRaw: varchar('pickup_date_raw', { length: 200 }).notNull(),
    status: whatsAppIntakeStatusEnum('status').notNull().default('captured'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shipperIdx: index('idx_whatsapp_intake_shipper').on(table.shipperWhatsapp),
    statusIdx: index('idx_whatsapp_intake_status').on(table.status),
    createdIdx: index('idx_whatsapp_intake_created').on(table.createdAt),
  }),
);

export type WhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferSelect;
export type NewWhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferInsert;
