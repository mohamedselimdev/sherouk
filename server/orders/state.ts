/** Order, payment and fulfilment are separate state machines. Every change goes through these tables. */

export type OrderStatus = "pending_payment" | "confirmed" | "processing" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "awaiting_collection" | "paid" | "failed" | "refunded";
export type FulfillmentStatus =
  "unfulfilled" | "packing" | "ready_for_pickup" | "shipped" | "delivered" | "picked_up" | "returned";

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ["paid", "failed", "awaiting_collection"],
  awaiting_collection: ["paid", "failed"],
  paid: ["refunded"],
  failed: ["paid"], // a retried attempt can still succeed while the order is open
  refunded: [],
};

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  unfulfilled: ["packing"],
  packing: ["ready_for_pickup", "shipped"],
  ready_for_pickup: ["picked_up", "returned"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  picked_up: ["returned"],
  returned: [],
};

export class InvalidTransition extends Error {
  constructor(kind: string, from: string, to: string) {
    super(`Invalid ${kind} transition ${from} -> ${to}`);
    this.name = "InvalidTransition";
  }
}

function check<T extends string>(kind: string, table: Record<T, T[]>, from: T, to: T): void {
  if (!table[from].includes(to)) throw new InvalidTransition(kind, from, to);
}

export const assertOrderTransition = (from: OrderStatus, to: OrderStatus) =>
  check("order", ORDER_TRANSITIONS, from, to);
export const assertPaymentTransition = (from: PaymentStatus, to: PaymentStatus) =>
  check("payment", PAYMENT_TRANSITIONS, from, to);
export const assertFulfillmentTransition = (from: FulfillmentStatus, to: FulfillmentStatus) =>
  check("fulfillment", FULFILLMENT_TRANSITIONS, from, to);

/** Shipping and delivery steps only make sense for the matching delivery method. */
export function fulfillmentAllowedFor(method: "delivery" | "pickup", to: FulfillmentStatus): boolean {
  if (method === "delivery") return to !== "ready_for_pickup" && to !== "picked_up";
  return to !== "shipped" && to !== "delivered";
}
