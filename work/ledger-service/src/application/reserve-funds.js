import { errorCodes, LedgerError } from '../domain/errors.js';
import { createTransferJournal } from '../domain/journal.js';
import { ReservationPolicy } from '../domain/reservation-policy.js';

export class ReserveFunds {
  constructor({ transactionManager, reservationPolicy = new ReservationPolicy() }) {
    this.transactionManager = transactionManager;
    this.reservationPolicy = reservationPolicy;
  }

  async execute(input) {
    const request = this.reservationPolicy.validate(input);
    try {
      return await this.transactionManager.run(async ({ accounts, reservations, journals }) => {
        // Check identity before account lookup, including a conflicting company with no accounts.
        const existing = await reservations.findByPaymentId(request.paymentId);
        if (existing) return this.sameRequest(existing, request);

        // All AVAILABLE balance writers must acquire this lock before reading the balance.
        const available = await accounts.lockAccount(request.companyId, 'AVAILABLE');
        if (!available) {
          throw new LedgerError(errorCodes.ACCOUNT_NOT_FOUND, 'AVAILABLE TRY account was not found for the company');
        }

        // A concurrent reservation may have committed while this transaction waited on the account.
        const afterLock = await reservations.findByPaymentId(request.paymentId);
        if (afterLock) return this.sameRequest(afterLock, request);

        const reserved = await accounts.lockAccount(request.companyId, 'RESERVED');
        if (!reserved) {
          throw new LedgerError(errorCodes.ACCOUNT_NOT_FOUND, 'RESERVED TRY account was not found for the company');
        }
        const balance = await accounts.getBalance(available.accountId);
        this.reservationPolicy.assertSufficientBalance(balance, request.amountKurus);

        const journal = createTransferJournal({
          ...request, entryType: 'RESERVE', source: available, destination: reserved,
        });
        const reserveJournalId = await journals.record(journal);
        return reservations.create({ ...request, reserveJournalId });
      });
    } catch (error) {
      if (error.code !== errorCodes.RESERVATION_ALREADY_EXISTS) throw error;
      // Only the verified payment_id unique violation takes this path. The failed
      // transaction has already rolled back its journal; resolve the winner read-only.
      return this.transactionManager.run(async ({ reservations }) => {
        const existing = await reservations.findByPaymentId(request.paymentId);
        if (!existing) throw error;
        return this.sameRequest(existing, request);
      });
    }
  }

  sameRequest(existing, request) {
    this.reservationPolicy.assertSameRequest(existing, request);
    return existing;
  }
}
