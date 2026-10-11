-- Account-level "additional security review" marker. NULL = normal. Set and cleared only by staff through an audited
-- action; while set, new withdrawal requests on the account are routed to review and cannot be approved. Additive.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS security_review_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS security_review_reason text;
