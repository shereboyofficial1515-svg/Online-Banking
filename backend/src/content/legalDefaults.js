// Default text for each legal / policy document. Seeded once as version 1 (flagged needs_review) so the site has complete
// documents from day one. These are DRAFTS prepared for the business: they have not been reviewed by legal counsel, and the
// admin console says so until an administrator publishes their own reviewed version. Format: restricted Markdown (no raw HTML).
export const LEGAL_DOCS = {
  terms: { title: 'Terms of Service', route: '/terms', description: 'The agreement between EWB Bank and its customers.' },
  privacy: { title: 'Privacy Policy', route: '/privacy', description: 'What personal information we collect and why.' },
  cookies: { title: 'Cookie Policy', route: '/cookies', description: 'How the website uses cookies and similar technologies.' },
  security: { title: 'Security Policy', route: '/security-info', description: 'How accounts are protected and what customers can do.' },
  accessibility: { title: 'Accessibility Statement', route: '/accessibility', description: 'Our accessibility commitments and how to report a barrier.' },
};
export const DEFAULT_EFFECTIVE_DATE = '2026-10-01';

export const LEGAL_DEFAULTS = {
  terms: `By creating a profile you agree to these terms. Please read them together with our [Privacy Policy](/privacy).

## 1. Our service and important information
EWB Bank provides digital account services. Balances are **maintained by EWB Bank**; they are not deposits with a bank and are not insured by any government scheme. EWB Bank does not currently hold a banking licence, and nothing on this platform is an offer of regulated banking, payment, card or investment services. Regulated services, when introduced, will be provided through appropriately licensed partners and will carry additional terms and eligibility checks.

## 2. Your profile
- You must be at least 18 and provide accurate information.
- Keep your credentials secret. We will never ask for your password or one-time codes.
- You are responsible for activity on your profile until you report unauthorised access.

## 3. Transfers
Transfers move funds between EWB accounts and are available after identity verification. Each transfer has a unique reference and cannot be edited; if a correction is needed, our team adds a new, traceable entry.

## 4. Withdrawal requests
A withdrawal request is a request for review by Customer Support. Submitting a request does not itself move funds. We show the true status of every request and may ask for additional verification.

## 5. Acceptable use
Do not attempt to access other profiles, interfere with the service, or use it for unlawful activity. We may restrict a profile while we investigate unusual activity and will explain next steps through Customer Support.

## 6. Availability and changes
We work to keep the service available but do not guarantee uninterrupted access. We may update these terms; material changes will be communicated by email or in the app, and the version in effect when you accepted is always recorded.

## 7. Future regulated services
If EWB Bank introduces regulated services, additional terms, disclosures and eligibility checks will apply and will be presented to you before you can use them.`,

  privacy: `This policy explains what personal information EWB Bank collects, why we collect it and the choices you have. We collect only what we need to run your profile securely.

## Information we collect
- **Profile details:** name, email, phone number, date of birth, address, state and country.
- **Security data:** a salted Argon2id hash of your password (never the password itself), sign-in history, device labels, IP addresses and passkey public keys.
- **Identity verification:** status and, when you use document review, the ID and selfie files you upload to private storage.
- **Account activity:** transaction, transfer and withdrawal-request records and support conversations.
- **Your preferences:** theme, language, accessibility and regional display settings.

## What we never collect
We never receive or store raw fingerprints or face scans. Passkeys work on your device; we receive only a cryptographic public key. We do not store full external bank account numbers for withdrawal requests, only the bank name, account holder name and last four digits.

## How we use information
- To provide and secure your profile, including detecting unusual activity.
- To verify identity and meet legal and compliance obligations as they apply.
- To send transactional emails such as verification codes, security alerts and request updates.
- To provide customer support.

## Sharing
We use service providers to operate the platform (for example database hosting, file storage and transactional email). They process data on our instructions. We do not sell personal information. Where an identity-verification provider is connected, we will describe it here before it is enabled.

## Retention and security
Audit and transaction records are retained because they must be tamper-evident. Verification files are retained only as long as required for review and compliance. Data is encrypted in transit, access is limited by role, and staff access to sensitive documents is logged.

## Your choices
You can update contact details, notification and display preferences in your settings. Security notifications cannot be turned off. To request access, correction or deletion, open a request with Customer Support; some records may need to be retained for legal reasons.`,

  cookies: `This policy explains how the EWB Bank website uses cookies and similar browser storage.

## Cookies we use
These are strictly necessary for the site to work and are not used for advertising or tracking:
- **Session cookies** keep you signed in securely. They are HttpOnly, so scripts on the page cannot read them.
- **Security token cookie** protects forms and requests from forgery.
- **Device cookie** lets us recognise a browser you have used before, so we can alert you to sign-ins from new devices.

## Browser storage we use
- Your **display preferences** (theme, text size, contrast, motion) and the most recent site branding are stored in your browser so pages look right immediately. They contain no personal or financial information.

## What we do not do
We do not use advertising cookies or third-party tracking cookies on this website.

## Your choices
You can clear cookies and site data in your browser at any time; you will be signed out and your device will be treated as new on your next sign-in.`,

  security: `Security is built into every layer of EWB Bank. This page summarises how your profile is protected and what you can do to help.

## How we protect your profile
- **Passwords:** hashed with Argon2id; we cannot see them. Password reset links are single-use and expire in 30 minutes.
- **Passkeys:** sign in with fingerprint, face or device PIN using WebAuthn. We store only public keys, never biometric data.
- **Multi-factor authentication:** authenticator-app codes with single-use recovery codes. Administrators are required to use it.
- **Sessions:** short-lived access tokens in HttpOnly cookies, rotating refresh tokens, and instant revocation from your settings.
- **Monitoring:** lock-outs after repeated failures, new-device alerts, and an append-only audit trail of privileged actions.
- **Data isolation:** every request is checked so you can only access your own records.

## What you can do
- Register a passkey and enable multi-factor authentication in your security settings.
- Use a unique, long password.
- Review active sessions and devices regularly.
- Never share one-time codes. EWB Bank staff will never ask for them.

## Reporting a concern
If you suspect unauthorised access, change your password, end other sessions and contact Customer Support right away.`,

  accessibility: `EWB Bank aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 level AA. Everyone should be able to manage their accounts regardless of ability or device.

## What we do
- Semantic HTML, landmarks and a "skip to main content" link on every page.
- Full keyboard operation with clearly visible focus indicators; dialogs trap focus and close with Escape.
- Labels, hints and error messages are programmatically associated with form fields and announced by screen readers.
- Text and controls meet colour-contrast requirements in both light and dark themes; status is never conveyed by colour alone.
- Touch targets are at least 44 px and layouts adapt to small screens and zoom up to 200%.
- **Settings you control:** text size, high contrast, reduced motion, and light, dark or device-matched themes.
- Animations are subtle and are disabled when your device or your settings request reduced motion.
- Charts include text alternatives.

## Feedback
If you encounter a barrier, please open a Customer Support request and tell us the page and the assistive technology you use. We will respond and work to fix the issue.`,
};
