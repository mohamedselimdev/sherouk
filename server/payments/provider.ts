/** Provider-agnostic payment boundary. Domain code never imports a specific provider. */

export type CheckoutRequest = {
  /** Our merchant reference; the provider echoes it back, e.g. SH-7K2M9QXA-1. */
  reference: string;
  amountPiasters: number;
  description: string;
  customer: { name: string; phone: string; email?: string | null };
  /** Where the customer's browser returns. Never treated as proof of payment. */
  returnUrl: string;
  /** Server-to-server callback endpoint. */
  notificationUrl: string;
};

export type CheckoutResult = { intentionId: string; providerOrderId: string; redirectUrl: string };

/** A provider callback or inquiry result after authenticity was verified. */
export type NormalizedEvent = {
  provider: string;
  transactionId: string;
  providerOrderId: string | null;
  merchantReference: string | null;
  amountPiasters: number;
  currency: string;
  success: boolean;
  pending: boolean;
  errorOccurred: boolean;
  isVoided: boolean;
  isRefunded: boolean;
  isCaptured: boolean;
  refundedAmountPiasters: number;
  /** Sanitised subset kept for audit (no card token, no billing data). */
  payload: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  /** Looks a payment up at the provider (used to recover from missed webhooks). Optional. */
  inquire?(ref: { reference: string; providerOrderId: string | null }): Promise<NormalizedEvent | null>;
  /** Refunds part or all of a captured payment. Optional. */
  refund?(input: { transactionId: string; amountPiasters: number }): Promise<{ providerRefundId: string }>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
