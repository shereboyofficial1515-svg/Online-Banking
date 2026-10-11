# Account numbers: standard, migration plan and rollback

## The standard
Every customer account number is **12 digits**: the bank code `605` followed by **9 random digits** (`605XXXXXXXXX`).

* Generated only by the backend (`newAccountNumber()` in `backend/src/utils/crypto.js`, using `crypto.randomInt`). Clients can never supply one.
* Unique: `accounts.account_number` has a unique index. Creation uses `INSERT … ON CONFLICT DO NOTHING` and retries with a new number, so two concurrent signups can never end up sharing one.
* Not a secret and not derived from anything personal. 10⁹ possible values per bank code; a collision is handled, not assumed impossible.
* **Immutable**: a database trigger (`accounts_number_guard_trg`, migration `005`) rejects any change to `account_number` unless a transaction explicitly sets `ewb.allow_account_renumber = on` (only the remediation script does). It also rejects inserting a customer account whose number does not match `^605[0-9]{9}$`.
* Customer-facing screens show the number in full to its owner (Account settings, with a Copy button) and masked (`••••1234`) in lists and emails.

## Existing accounts (what was and was not changed)
Before this change accounts were `EWB` + 10 digits. **Migration `005` does not rewrite any existing account.** It only adds the guard trigger and a `legacy_account_number` column.
The production database had one legacy-format account at the time of writing. Whether it can be renumbered automatically depends on whether it has any activity (the dry run says so); if it does, it simply keeps its legacy number, which continues to work.

Transfers continue to accept the old format (`EWB##########`) as well as the new one, and look the recipient up by either `account_number` or `legacy_account_number`, so nobody loses the ability to receive money.

## Renumbering existing accounts (optional, needs explicit approval)
`backend/src/db/remediateAccountNumbers.js` is **dry-run by default**:

```bash
cd backend
node src/db/remediateAccountNumbers.js            # prints the plan, changes nothing
node src/db/remediateAccountNumbers.js --apply    # only after you approve the plan
```
`--apply` renumbers **only accounts that have never had any activity** (no ledger entries, transactions or withdrawal requests). Accounts with activity are listed in the plan and left untouched, so a number that appears on a past transaction is never altered. The whole run is one transaction: for each safe account it moves the old number into `legacy_account_number`, assigns a fresh `605…` number and writes an `account.renumber` audit record. Everything else references an account by its internal id, so no history, balance or ledger entry changes either way. The old number keeps resolving in transfers.

### Before applying
1. Take a database backup (Supabase: Database → Backups, or `pg_dump`).
2. Run the dry run and read the list.
3. Tell affected customers (the number printed on any statement or saved elsewhere will change).

### Rollback
The old number is preserved in `legacy_account_number`. To revert one account, run in a transaction:
```sql
BEGIN;
SET LOCAL ewb.allow_account_renumber = 'on';
UPDATE accounts SET account_number = legacy_account_number, legacy_account_number = NULL WHERE id = '<account id>' AND legacy_account_number IS NOT NULL;
COMMIT;
```
Migration `005` itself is additive (new column + trigger). To remove it entirely: `DROP TRIGGER accounts_number_guard_trg ON accounts; DROP FUNCTION accounts_number_guard(); ALTER TABLE accounts DROP COLUMN legacy_account_number;` (do this only if no account has been renumbered).

## Tests
`backend/tests/accounts.test.js` covers: the 12-digit `605` format and validation, creation through registration and "open another account", the client being unable to choose a number, the database rejecting non-conforming numbers and duplicates, collision handling inside a transaction, giving up cleanly when numbers keep colliding, immutability against ordinary updates, legacy-number lookups in transfers, and the remediation dry run, apply (safe accounts only, audited) and full rollback of a failed run.
