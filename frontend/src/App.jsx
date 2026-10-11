import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Gate, CustomerShell, AdminShell, PublicLayout } from './layouts/Layouts.jsx';
import { SkeletonCard } from './components/ui/Feedback.jsx';
import Home from './pages/public/Home.jsx';
import { Privacy, Terms, Cookies, SecurityInfo, Accessibility, About, Contact, NotFound } from './pages/public/Legal.jsx';
import { Login, Register, VerifyEmail, ForgotPassword, ResetPassword } from './pages/auth/Auth.jsx';

// Authenticated areas are code-split so the public site stays light.
const Overview = lazy(() => import('./pages/app/Overview.jsx'));
const Accounts = lazy(() => import('./pages/app/Overview.jsx').then((m) => ({ default: m.Accounts })));
const Transactions = lazy(() => import('./pages/app/Transactions.jsx').then((m) => ({ default: m.Transactions })));
const TransactionDetail = lazy(() => import('./pages/app/Transactions.jsx').then((m) => ({ default: m.TransactionDetail })));
const TH = (n) => lazy(() => import('./pages/app/TransferHub.jsx').then((m) => ({ default: m[n] })));
const TransferHub = TH('TransferHub'); const BankTransfer = TH('BankTransfer'); const SavePage = TH('SavePage');
const Transfers = lazy(() => import('./pages/app/Money.jsx').then((m) => ({ default: m.Transfers })));
const Verification = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Verification })));
const Notifications = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Notifications })));
const ST = (n) => lazy(() => import('./pages/app/Settings.jsx').then((m) => ({ default: m[n] })));
const SettingsLayout = ST('SettingsLayout'); const Profile = ST('Profile'); const AccountSettings = ST('AccountSettings'); const PasswordSettings = ST('PasswordSettings');
const SessionSettings = ST('SessionSettings'); const SecurityCenterSettings = ST('SecurityCenterSettings'); const EmailSettings = ST('EmailSettings');
const NotificationSettings = ST('NotificationSettings'); const DisplaySettings = ST('DisplaySettings'); const AccessibilitySettings = ST('AccessibilitySettings');
const RegionalSettings = ST('RegionalSettings'); const DashboardSettings = ST('DashboardSettings'); const FeedbackSettings = ST('FeedbackSettings'); const AboutSettings = ST('AboutSettings');
const Security = lazy(() => import('./pages/app/Security.jsx'));
const SupportList = lazy(() => import('./pages/app/Support.jsx').then((m) => ({ default: m.SupportList })));
const NewTicket = lazy(() => import('./pages/app/Support.jsx').then((m) => ({ default: m.NewTicket })));
const SupportTicket = lazy(() => import('./pages/app/Support.jsx').then((m) => ({ default: m.SupportTicket })));

const A = (n) => lazy(() => import('./pages/admin/Customers.jsx').then((m) => ({ default: m[n] })));
const O = (n) => lazy(() => import('./pages/admin/Operations.jsx').then((m) => ({ default: m[n] })));
const R = (n) => lazy(() => import('./pages/admin/Review.jsx').then((m) => ({ default: m[n] })));
const AdminDashboard = A('AdminDashboard'); const Customers = A('Customers'); const CustomerDetail = A('CustomerDetail');
const AdminWithdrawals = O('AdminWithdrawals'); const AdminWithdrawalDetail = O('AdminWithdrawalDetail'); const Ledger = O('Ledger');
const AdminVerification = R('AdminVerification'); const AdminVerificationDetail = R('AdminVerificationDetail'); const AdminSupport = R('AdminSupport');
const W = (n) => lazy(() => import('./pages/admin/Website.jsx').then((m) => ({ default: m[n] })));
const AdminWebsite = W('AdminWebsite'); const AdminLegal = W('AdminLegal'); const AdminLegalEditor = W('AdminLegalEditor');
const AdminFeatures = lazy(() => import('./pages/admin/Features.jsx').then((m) => ({ default: m.AdminFeatures })));
const AdminClosures = lazy(() => import('./pages/admin/Closures.jsx').then((m) => ({ default: m.AdminClosures })));
const AdminTicket = R('AdminTicket'); const AdminSecurity = R('AdminSecurity'); const AdminAudit = R('AdminAudit'); const AdminStaff = R('AdminStaff');

const Fallback = <div className="stack" role="status" aria-label="Loading page"><SkeletonCard lines={2} /><SkeletonCard /></div>;

export default function App() {
  return (
    <Suspense fallback={Fallback}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="security-info" element={<SecurityInfo />} />
          <Route path="accessibility" element={<Accessibility />} />
          <Route path="cookies" element={<Cookies />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
        </Route>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />

        <Route path="app" element={<Gate><CustomerShell /></Gate>}>
          <Route index element={<Overview />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="transactions/:id" element={<TransactionDetail />} />
          <Route path="transfers" element={<TransferHub />} />
          <Route path="transfers/ewb" element={<Transfers />} />
          <Route path="transfers/bank" element={<BankTransfer />} />
          <Route path="transfers/save" element={<SavePage />} />
          <Route path="withdrawals" element={<Navigate to="/app/transfers" replace />} />
          <Route path="profile" element={<Navigate to="/app/settings/profile" replace />} />
          <Route path="verification" element={<Verification />} />
          <Route path="security" element={<Security />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="support" element={<SupportList />} />
          <Route path="support/new" element={<NewTicket />} />
          <Route path="support/:id" element={<SupportTicket />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route path="profile" element={<Profile />} />
            <Route path="accounts" element={<AccountSettings />} />
            <Route path="security" element={<PasswordSettings />} />
            <Route path="sessions" element={<SessionSettings />} />
            <Route path="security-center" element={<SecurityCenterSettings />} />
            <Route path="email" element={<EmailSettings />} />
            <Route path="notifications" element={<NotificationSettings />} />
            <Route path="display" element={<DisplaySettings />} />
            <Route path="accessibility" element={<AccessibilitySettings />} />
            <Route path="regional" element={<RegionalSettings />} />
            <Route path="dashboard" element={<DashboardSettings />} />
            <Route path="feedback" element={<FeedbackSettings />} />
            <Route path="about" element={<AboutSettings />} />
            <Route path="*" element={<Navigate to="/app/settings" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>

        <Route path="admin" element={<Gate staff><AdminShell /></Gate>}>
          <Route index element={<AdminDashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="withdrawals/:id" element={<AdminWithdrawalDetail />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="verification" element={<AdminVerification />} />
          <Route path="verification/:id" element={<AdminVerificationDetail />} />
          <Route path="support" element={<AdminSupport />} />
          <Route path="support/:id" element={<AdminTicket />} />
          <Route path="security" element={<AdminSecurity />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="staff" element={<AdminStaff />} />
          <Route path="features" element={<AdminFeatures />} />
          <Route path="closures" element={<AdminClosures />} />
          <Route path="website" element={<AdminWebsite />} />
          <Route path="legal" element={<AdminLegal />} />
          <Route path="legal/:slug" element={<AdminLegalEditor />} />
          <Route path="security-center" element={<Security />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<PublicLayout />}><Route path="*" element={<NotFound />} /></Route>
      </Routes>
    </Suspense>
  );
}
