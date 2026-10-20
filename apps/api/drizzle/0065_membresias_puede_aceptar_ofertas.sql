-- Migration 0065 — Permiso de membresía para aceptar o rechazar ofertas.
--
-- Expand-only. Columna nueva con DEFAULT false: Postgres rellena las filas
-- que ya existen sin reescribirlas a mano y sin dejar el valor en NULL.
-- El dueño y el admin aceptan por rol y no leen esta columna.
-- No borra ni cambia el tipo de ninguna columna anterior.

ALTER TABLE "membresias" ADD COLUMN "puede_aceptar_ofertas" boolean DEFAULT false NOT NULL;
