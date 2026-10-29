export class AccountRepository {
  constructor(client) {
    this.client = client;
  }

  async lockAccount(companyId, accountType) {
    const result = await this.client.query(
      `SELECT account_id, company_id, currency, account_type
         FROM public.ledger_accounts
        WHERE company_id = $1 AND currency = 'TRY' AND account_type = $2
        FOR UPDATE`,
      [companyId, accountType],
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, companyId: row.company_id, currency: row.currency, accountType: row.account_type } : null;
  }

  async getBalance(accountId) {
    const result = await this.client.query(
      `SELECT COALESCE(SUM(amount_kurus), 0)::text AS balance
         FROM public.ledger_entries
        WHERE account_id = $1`,
      [accountId],
    );
    // SUM(bigint) is numeric: preserve sums exceeding a single entry's bigint range.
    return BigInt(result.rows[0].balance);
  }
}
