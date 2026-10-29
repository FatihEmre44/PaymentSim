import { randomUUID } from 'node:crypto';
import { errorCodes, LedgerError } from '../../domain/errors.js';

function mapReservation(row) {
  return {
    reservationId: row.reservation_id,
    paymentId: row.payment_id,
    companyId: row.company_id,
    amountKurus: String(row.amount_kurus),
    status: row.status,
    reserveJournalId: row.reserve_journal_id,
    settlementJournalId: row.settlement_journal_id,
  };
}

export class ReservationRepository {
  constructor(client, idGenerator = randomUUID) {
    this.client = client;
    this.idGenerator = idGenerator;
  }

  async findByPaymentId(paymentId) {
    const result = await this.client.query(
      `SELECT reservation_id, payment_id, company_id, amount_kurus, status,
              reserve_journal_id, settlement_journal_id
         FROM public.reservations
        WHERE payment_id = $1`,
      [paymentId],
    );
    return result.rows[0] ? mapReservation(result.rows[0]) : null;
  }

  async create({ paymentId, companyId, amountKurus, reserveJournalId }) {
    try {
      const result = await this.client.query(
        `INSERT INTO public.reservations
           (reservation_id, payment_id, company_id, amount_kurus, status,
            reserve_journal_id, settlement_journal_id)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NULL)
         RETURNING reservation_id, payment_id, company_id, amount_kurus, status,
                   reserve_journal_id, settlement_journal_id`,
        [this.idGenerator(), paymentId, companyId, amountKurus.toString(), reserveJournalId],
      );
      return mapReservation(result.rows[0]);
    } catch (error) {
      // The payment_id unique constraint also protects concurrent companies.
      if (error.code === '23505' && error.constraint === 'reservations_payment_id_key') {
        throw new LedgerError(errorCodes.RESERVATION_ALREADY_EXISTS, 'A reservation for this payment already exists');
      }
      throw error;
    }
  }
}
