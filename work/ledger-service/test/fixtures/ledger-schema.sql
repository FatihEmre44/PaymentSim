-- Test-only reproduction of the schema inspected in Ledger on 2026-10-28.
-- Not a migration. The test runner applies it only to a fresh isolated cluster.
CREATE TABLE public.ledger_accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  currency char(3) NOT NULL DEFAULT 'TRY',
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_company_currency_type_unique UNIQUE (company_id, currency, account_type),
  CONSTRAINT ledger_accounts_currency_check CHECK (currency = 'TRY'),
  CONSTRAINT ledger_accounts_type_check CHECK (account_type IN ('AVAILABLE', 'RESERVED', 'SIMULATED_OUTGOING'))
);
CREATE TABLE public.journal_transactions (
  journal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  payment_id uuid,
  entry_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_transactions_type_check CHECK (entry_type IN ('DEMO_FUNDING', 'RESERVE', 'RELEASE', 'CAPTURE'))
);
CREATE TABLE public.ledger_entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.journal_transactions(journal_id),
  account_id uuid NOT NULL REFERENCES public.ledger_accounts(account_id),
  amount_kurus bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_amount_nonzero CHECK (amount_kurus <> 0),
  CONSTRAINT ledger_entries_journal_account_unique UNIQUE (journal_id, account_id)
);
CREATE INDEX ledger_entries_account_created_idx ON public.ledger_entries (account_id, created_at DESC);
CREATE TABLE public.reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL CONSTRAINT reservations_payment_id_key UNIQUE,
  company_id uuid NOT NULL,
  amount_kurus bigint NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  reserve_journal_id uuid NOT NULL REFERENCES public.journal_transactions(journal_id),
  settlement_journal_id uuid REFERENCES public.journal_transactions(journal_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_amount_positive CHECK (amount_kurus > 0),
  CONSTRAINT reservations_status_check CHECK (status IN ('ACTIVE', 'RELEASED', 'CAPTURED')),
  CONSTRAINT reservations_settlement_check CHECK (
    (status = 'ACTIVE' AND settlement_journal_id IS NULL) OR
    (status IN ('RELEASED', 'CAPTURED') AND settlement_journal_id IS NOT NULL)
  )
);
CREATE INDEX reservations_company_status_idx ON public.reservations (company_id, status);
CREATE TABLE public.processed_events (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);
