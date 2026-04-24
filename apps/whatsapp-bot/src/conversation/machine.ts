import type { CargoType } from '@booster-ai/shared-schemas';
import { assign, setup } from 'xstate';

/**
 * Máquina de estados de la conversación shipper → bot.
 *
 * Flujo lineal menu-driven:
 *
 *   idle
 *     ├─ "hola" / mensaje cualquiera → greeting
 *     └─ (timeout TTL) → reset a idle
 *
 *   greeting
 *     ├─ "1" → askOrigin
 *     ├─ "2" → menuLookupNotImplemented → greeting
 *     ├─ "cancelar" → cancelled (terminal)
 *     └─ otro → invalidMenuOption (stay)
 *
 *   askOrigin → askDestination
 *   askDestination → askCargoType
 *   askCargoType (valid enum) → askPickupDate
 *   askPickupDate → submitted (terminal, dispara API call)
 *
 * En cualquier estado, "cancelar" → cancelled.
 *
 * La persistencia del estado la maneja store.ts — esta máquina es pura y
 * determinística (sin side effects en transiciones).
 */

export interface ConversationContext {
  originAddressRaw: string | null;
  destinationAddressRaw: string | null;
  cargoType: CargoType | null;
  pickupDateRaw: string | null;
}

export type ConversationEvent = { type: 'USER_MESSAGE'; text: string } | { type: 'CANCEL' };

export const conversationMachine = setup({
  types: {
    context: {} as ConversationContext,
    events: {} as ConversationEvent,
  },
  actions: {
    setOrigin: assign({
      originAddressRaw: (_, params: { text: string }) => params.text,
    }),
    setDestination: assign({
      destinationAddressRaw: (_, params: { text: string }) => params.text,
    }),
    setCargoType: assign({
      cargoType: (_, params: { value: CargoType }) => params.value,
    }),
    setPickupDate: assign({
      pickupDateRaw: (_, params: { text: string }) => params.text,
    }),
  },
}).createMachine({
  id: 'conversation',
  initial: 'idle',
  context: {
    originAddressRaw: null,
    destinationAddressRaw: null,
    cargoType: null,
    pickupDateRaw: null,
  },
  on: {
    CANCEL: '.cancelled',
  },
  states: {
    idle: {
      on: {
        USER_MESSAGE: 'greeting',
      },
    },
    greeting: {
      on: {
        USER_MESSAGE: [
          { guard: ({ event }) => isCancelText(event.text), target: 'cancelled' },
          { guard: ({ event }) => event.text.trim() === '1', target: 'askOrigin' },
          { guard: ({ event }) => event.text.trim() === '2', target: 'menuLookupNotImplemented' },
          { target: 'greetingInvalid' },
        ],
      },
    },
    greetingInvalid: {
      // Estado de feedback — vuelve a esperar menu input
      on: {
        USER_MESSAGE: [
          { guard: ({ event }) => isCancelText(event.text), target: 'cancelled' },
          { guard: ({ event }) => event.text.trim() === '1', target: 'askOrigin' },
          { guard: ({ event }) => event.text.trim() === '2', target: 'menuLookupNotImplemented' },
          { target: 'greetingInvalid' },
        ],
      },
    },
    menuLookupNotImplemented: {
      // Re-muestra menú greeting tras informar que no está disponible
      on: {
        USER_MESSAGE: [
          { guard: ({ event }) => isCancelText(event.text), target: 'cancelled' },
          { guard: ({ event }) => event.text.trim() === '1', target: 'askOrigin' },
          { target: 'greetingInvalid' },
        ],
      },
    },
    askOrigin: {
      on: {
        USER_MESSAGE: [
          {
            guard: ({ event }) => isCancelText(event.text),
            target: 'cancelled',
          },
          {
            target: 'askDestination',
            actions: {
              type: 'setOrigin',
              params: ({ event }) => ({ text: event.text.trim() }),
            },
          },
        ],
      },
    },
    askDestination: {
      on: {
        USER_MESSAGE: [
          {
            guard: ({ event }) => isCancelText(event.text),
            target: 'cancelled',
          },
          {
            target: 'askCargoType',
            actions: {
              type: 'setDestination',
              params: ({ event }) => ({ text: event.text.trim() }),
            },
          },
        ],
      },
    },
    askCargoType: {
      on: {
        USER_MESSAGE: [
          {
            guard: ({ event }) => isCancelText(event.text),
            target: 'cancelled',
          },
          {
            guard: ({ event }) => isValidCargoMenuOption(event.text),
            target: 'askPickupDate',
            actions: {
              type: 'setCargoType',
              params: ({ event }) => ({
                value: cargoMenuToEnum(event.text) as CargoType,
              }),
            },
          },
          { target: 'askCargoTypeInvalid' },
        ],
      },
    },
    askCargoTypeInvalid: {
      on: {
        USER_MESSAGE: [
          {
            guard: ({ event }) => isCancelText(event.text),
            target: 'cancelled',
          },
          {
            guard: ({ event }) => isValidCargoMenuOption(event.text),
            target: 'askPickupDate',
            actions: {
              type: 'setCargoType',
              params: ({ event }) => ({
                value: cargoMenuToEnum(event.text) as CargoType,
              }),
            },
          },
          { target: 'askCargoTypeInvalid' },
        ],
      },
    },
    askPickupDate: {
      on: {
        USER_MESSAGE: [
          {
            guard: ({ event }) => isCancelText(event.text),
            target: 'cancelled',
          },
          {
            target: 'submitted',
            actions: {
              type: 'setPickupDate',
              params: ({ event }) => ({ text: event.text.trim() }),
            },
          },
        ],
      },
    },
    submitted: {
      // Terminal — el router de webhook dispara el API call y rotate la sesión.
      type: 'final',
    },
    cancelled: {
      type: 'final',
    },
  },
});

// ---- helpers ----

const CARGO_MENU_TO_ENUM: Record<string, CargoType> = {
  '1': 'dry_goods',
  '2': 'perishable',
  '3': 'refrigerated',
  '4': 'frozen',
  '5': 'fragile',
  '6': 'dangerous',
  '7': 'liquid',
  '8': 'construction',
  '9': 'agricultural',
  '10': 'livestock',
  '0': 'other',
};

export function isValidCargoMenuOption(text: string): boolean {
  return CARGO_MENU_TO_ENUM[text.trim()] !== undefined;
}

export function cargoMenuToEnum(text: string): CargoType | null {
  return CARGO_MENU_TO_ENUM[text.trim()] ?? null;
}

/**
 * "cancelar" en cualquier capitalización es el keyword de salida.
 * Se chequea en cada estado de input — más explícito que un handler global
 * (en XState v5 las transiciones de estado shadowean las machine-level).
 */
export function isCancelText(text: string): boolean {
  return text.trim().toLowerCase() === 'cancelar';
}
