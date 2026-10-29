import { errorCodes, LedgerError } from './errors.js';
import { parseAmountKurus } from './money.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReservationPolicy {
  validate(input) {
    const { paymentId, companyId, amountKurus, currency } = input ?? {};
    if (
      typeof paymentId !== 'string' || !uuid.test(paymentId) ||
      typeof companyId !== 'string' || !uuid.test(companyId) ||
      currency !== 'TRY'
    ) {
      throw new LedgerError(
        errorCodes.INVALID_INPUT,
        'UUID paymentId and companyId, positive safe integer amountKurus and TRY currency are required',
      );
    }
    return Object.freeze({
      paymentId: paymentId.toLowerCase(),
      companyId: companyId.toLowerCase(),
      amountKurus: parseAmountKurus(amountKurus),
      currency,
    });
  }

  assertSameRequest(existing, input) {
    if (
      existing.companyId !== input.companyId ||
      BigInt(existing.amountKurus) !== BigInt(input.amountKurus)
    ) {
      throw new LedgerError(
        errorCodes.RESERVATION_CONFLICT,
        'paymentId is already reserved for a different company or amount',
      );
    }
  }

  assertSufficientBalance(balance, amountKurus) {
    if (balance < BigInt(amountKurus)) {
      throw new LedgerError(
        errorCodes.INSUFFICIENT_FUNDS,
        'available balance is insufficient for this reservation',
      );
    }
  }
}
