# Path to regulated operation

EWB Bank is currently an **internal software ledger**. Do not enable real money movement, or describe the product as a
bank, until the items below are complete. This is an engineering checklist, **not legal advice**.

## Hard stops in code today
* `PaymentProvider` / `BankingProvider` are inert and throw `PROVIDER_NOT_CONFIGURED`.
* `LEDGER_MODE=live` is refused at startup.
* Withdrawals create requests only; UI and email copy state that no funds were sent.
* The footer, marketing pages and emails carry no licensing or insurance claims or disclaimers. The Terms of Service (section 1) state neutrally that balances are maintained by EWB Bank and are not bank deposits or covered by deposit insurance; keep that statement accurate and have counsel review it.
  No FDIC/regulator/insurance claim exists anywhere; add one **only** after it is true and legally approved.

## Before enabling real funds (owner: legal/compliance)
1. Legal structure and licensing (or a sponsor-bank / BaaS partnership) for your jurisdiction(s).
2. Written KYC/AML/sanctions programme; appoint a compliance officer; transaction monitoring and SAR procedures.
3. Banking-partner / payment-processor agreements, settlement and reconciliation procedures.
4. Contract a KYC vendor; implement `IdentityVerificationProvider` and map its webhook (signature scheme is already
   verified in `providers/identity.js`).
5. Privacy impact assessment; data-retention schedule; DSAR process; sub-processor list in the Privacy Policy.
6. Disclosures and terms approved by counsel; replace the draft pages in `frontend/src/pages/public/Legal.jsx`.
7. Independent penetration test and a SOC 2 / ISO 27001 plan as appropriate.

## Engineering work to add real rails
* Implement `PaymentProvider` / `BankingProvider` as a **separate service**; keep the ledger isolated.
* Add provider-reference columns, a settlement-reconciliation job (provider reports ⇄ ledger entries) and pending/failed
  states driven by provider webhooks (signature-verified, idempotent).
* Add holds/authorisations to the ledger if the partner requires them; keep the append-only invariants.
* Add velocity limits, step-up authentication per payout, dual approval for large payouts, and out-of-band alerts.
* Only then flip `LEDGER_MODE=live`, and register enabled providers so the startup guard passes.
