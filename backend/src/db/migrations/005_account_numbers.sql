-- EWB Bank account numbers: exactly 12 digits, "605" + 9 digits.
--
-- * New customer accounts must follow the format (enforced by a trigger on INSERT, so even a buggy caller cannot create
--   a non-conforming number). System accounts (internal funding) are exempt.
-- * Existing accounts keep working untouched: nothing is rewritten here. If a legacy number is ever replaced (see
--   src/db/remediateAccountNumbers.js) the old value is kept in legacy_account_number and still resolves in lookups.
-- * An account number can never change by accident: UPDATEs are rejected unless the session explicitly opts in with
--   SET LOCAL ewb.allow_account_renumber = 'on' (only the audited remediation script does).
-- Additive; safe on a live database.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legacy_account_number text;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_legacy_number_uq ON accounts (legacy_account_number) WHERE legacy_account_number IS NOT NULL;

CREATE OR REPLACE FUNCTION accounts_number_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'customer' AND NEW.account_number !~ '^605[0-9]{9}$' THEN
      RAISE EXCEPTION 'customer account numbers must be 12 digits starting with 605' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.account_number IS DISTINCT FROM OLD.account_number THEN
    IF current_setting('ewb.allow_account_renumber', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'account numbers are immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.kind = 'customer' AND NEW.account_number !~ '^605[0-9]{9}$' THEN
      RAISE EXCEPTION 'customer account numbers must be 12 digits starting with 605' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS accounts_number_guard_trg ON accounts;
CREATE TRIGGER accounts_number_guard_trg BEFORE INSERT OR UPDATE OF account_number ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_number_guard();
