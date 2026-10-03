import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button } from '../../components/ui/Controls.jsx';
import { useAuth } from '../../lib/auth.jsx';

const UPDATED = 'Last updated: 1 October 2026';

function Doc({ title, children }) {
  useDocumentTitle(title);
  return <article className="prose"><h1>{title}</h1><p className="updated">{UPDATED}</p>{children}</article>;
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p>This policy explains what personal information EWB Bank collects, why we collect it and the choices you have. We collect only what we need to run your profile securely.</p>
      <h2>Information we collect</h2>
      <ul>
        <li><strong>Profile details:</strong> name, email, phone number, date of birth, address, state and country.</li>
        <li><strong>Security data:</strong> a salted Argon2id hash of your password (never the password itself), sign-in history, device labels, IP addresses and passkey public keys.</li>
        <li><strong>Identity verification:</strong> status and, when you use document review, the ID and selfie files you upload to private storage.</li>
        <li><strong>Account activity:</strong> ledger entries, transfer and withdrawal-request records and support conversations.</li>
      </ul>
      <h2>What we never collect</h2>
      <p>We never receive or store raw fingerprints or face scans. Passkeys work on your device; we receive only a cryptographic public key. We do not store full external bank account numbers for withdrawal requests, only the bank name, account holder name and last four digits.</p>
      <h2>How we use information</h2>
      <ul><li>To provide and secure your profile, including detecting unusual activity.</li><li>To verify identity and meet legal and compliance obligations as they apply.</li><li>To send transactional emails such as verification, security alerts and request updates.</li><li>To provide customer support.</li></ul>
      <h2>Sharing</h2>
      <p>We use service providers to operate the platform (for example database hosting, file storage and transactional email). They process data on our instructions. We do not sell personal information. Where an identity-verification provider is connected, we will describe it here before it is enabled.</p>
      <h2>Retention and security</h2>
      <p>Audit and ledger records are retained because they must be tamper-evident. Verification files are retained only as long as required for review and compliance. Data is encrypted in transit, access is limited by role, and staff access to sensitive documents is logged.</p>
      <h2>Your choices</h2>
      <p>You can update contact details and notification preferences in your dashboard. Security notices cannot be turned off. To request access, correction or deletion, open a request with customer support; some records may need to be retained for legal reasons.</p>
      <p>Questions? Contact customer support from your dashboard.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of Service">
      <p>By creating a profile you agree to these terms. Please read them with our <Link to="/privacy">Privacy Policy</Link>.</p>
      <h2>1. What EWB Bank is today</h2>
      <p>EWB Bank currently operates an <strong>internal software ledger</strong>. Balances shown are records within that ledger. They are <strong>not deposits</strong>, are not insured by any government scheme, and EWB Bank is not currently a licensed bank or depository institution. Nothing on this platform is an offer of regulated banking, payment, card or investment services.</p>
      <h2>2. Your profile</h2>
      <ul><li>You must be at least 18 and provide accurate information.</li><li>Keep your credentials secret. We will never ask for your password or one-time codes.</li><li>You are responsible for activity on your profile until you report unauthorised access.</li></ul>
      <h2>3. Transfers</h2>
      <p>Transfers move ledger value between EWB accounts and are available after identity verification. Each transfer has a unique reference and cannot be edited; if a correction is needed, our team appends a new, traceable ledger entry.</p>
      <h2>4. Withdrawal requests</h2>
      <p>A withdrawal request is a request for review by customer support. Submitting a request does not send money, and no external transfer is performed automatically. We will show the true status of every request and may ask for additional verification.</p>
      <h2>5. Acceptable use</h2>
      <p>Do not attempt to access other profiles, interfere with the service, or use it for unlawful activity. We may restrict a profile while we investigate unusual activity and will explain next steps through customer support.</p>
      <h2>6. Availability and changes</h2>
      <p>We work to keep the service available but do not guarantee uninterrupted access. We may update these terms; material changes will be communicated by email or in the app.</p>
      <h2>7. Future regulated services</h2>
      <p>If EWB Bank introduces regulated services, additional terms, disclosures and eligibility checks will apply and will be presented to you before you can use them.</p>
    </Doc>
  );
}

export function SecurityInfo() {
  const { user } = useAuth();
  return (
    <Doc title="Security information">
      <p>Security is built into every layer of EWB Bank. This page summarises how your profile is protected and what you can do to help.</p>
      <h2>How we protect your profile</h2>
      <ul>
        <li><strong>Passwords:</strong> hashed with Argon2id; we cannot see them. Password reset links are single-use and expire in 30 minutes.</li>
        <li><strong>Passkeys:</strong> sign in with fingerprint, face or device PIN using WebAuthn. We store only public keys, never biometric data.</li>
        <li><strong>Multi-factor authentication:</strong> authenticator-app codes with single-use recovery codes. Administrators are required to use it.</li>
        <li><strong>Sessions:</strong> short-lived access tokens in HttpOnly cookies, rotating refresh tokens, and instant revocation from the Security page.</li>
        <li><strong>Monitoring:</strong> lock-outs after repeated failures, new-device alerts, and an append-only audit trail of privileged actions.</li>
        <li><strong>Data isolation:</strong> every request is checked so you can only access your own records.</li>
      </ul>
      <h2>What you can do</h2>
      <ul><li>Register a passkey and enable MFA from <em>Security</em>.</li><li>Use a unique, long password.</li><li>Review active sessions and trusted devices regularly.</li><li>Never share one-time codes. EWB Bank staff will never ask for them.</li></ul>
      <h2>Reporting a concern</h2>
      <p>If you suspect unauthorised access, change your password, end other sessions and contact customer support right away.</p>
      <p><Button to={user ? '/app/security' : '/login'} variant="secondary">Go to Security settings</Button></p>
    </Doc>
  );
}

export function Accessibility() {
  return (
    <Doc title="Accessibility">
      <p>EWB Bank aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 level AA. Everyone should be able to manage their accounts regardless of ability or device.</p>
      <h2>What we do</h2>
      <ul>
        <li>Semantic HTML, landmarks and a “skip to main content” link on every page.</li>
        <li>Full keyboard operation with clearly visible focus indicators; dialogs trap focus and close with Escape.</li>
        <li>Labels, hints and error messages are programmatically associated with form fields and announced by screen readers.</li>
        <li>Text and controls meet colour-contrast requirements; status is never conveyed by colour alone.</li>
        <li>Touch targets are at least 44 px and layouts adapt to small screens and zoom up to 200%.</li>
        <li>Animations are subtle and are disabled when your device requests reduced motion.</li>
        <li>Charts include text alternatives.</li>
      </ul>
      <h2>Feedback</h2>
      <p>If you encounter a barrier, please open a customer support request and tell us the page and the assistive technology you use. We will respond and work to fix the issue.</p>
    </Doc>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="prose center" style={{ paddingTop: 96 }}>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or has moved.</p>
      <p><Button to="/" variant="primary">Back to home</Button></p>
    </div>
  );
}
