import { randomUUID } from 'node:crypto';

export class JournalRepository {
  constructor(client, idGenerator = randomUUID) {
    this.client = client;
    this.idGenerator = idGenerator;
  }

  async record(journal) {
    const journalId = this.idGenerator();
    await this.client.query(
      `INSERT INTO public.journal_transactions (journal_id, company_id, payment_id, entry_type)
       VALUES ($1, $2, $3, $4)`,
      [journalId, journal.companyId, journal.paymentId, journal.entryType],
    );
    for (const entry of journal.entries) {
      await this.client.query(
        `INSERT INTO public.ledger_entries (entry_id, journal_id, account_id, amount_kurus)
         VALUES ($1, $2, $3, $4)`,
        [this.idGenerator(), journalId, entry.accountId, entry.amountKurus.toString()],
      );
    }
    return journalId;
  }
}
