import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Gate, CustomerShell, AdminShell, PublicLayout } from './layouts/Layouts.jsx';
import { SkeletonCard } from './components/ui/Feedback.jsx';
import Home from './pages/public/Home.jsx';
import { Privacy, Terms, SecurityInfo, Accessibility, NotFound } from './pages/public/Legal.jsx';
import { Login, Register, VerifyEmail, ForgotPassword, ResetPassword } from './pages/auth/Auth.jsx';

// Authenticated areas are code-split so the public site stays light.
const Overview = lazy(() => import('./pages/app/Overview.jsx'));
const Accounts = lazy(() => import('./pages/app/Overview.jsx').then((m) => ({ default: m.Accounts })));
const Transactions = lazy(() => import('./pages/app/Transactions.jsx').then((m) => ({ default: m.Transactions })));
const TransactionDetail = lazy(() => import('./pages/app/Transactions.jsx').then((m) => ({ default: m.TransactionDetail })));
const Transfers = lazy(() => import('./pages/app/Money.jsx').then((m) => ({ default: m.Transfers })));
const Withdrawals = lazy(() => import('./pages/app/Money.jsx').then((m) => ({ default: m.Withdrawals })));
const Profile = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Profile })));
const Verification = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Verification })));
const Notifications = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Notifications })));
const Settings = lazy(() => import('./pages/app/Account.jsx').then((m) => ({ default: m.Settings })));
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
          <Route path="transfers" element={<Transfers />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="profile" element={<Profile />} />
          <Route path="verification" element={<Verification />} />
          <Route path="security" element={<Security />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="support" element={<SupportList />} />
          <Route path="support/new" element={<NewTicket />} />
          <Route path="support/:id" element={<SupportTicket />} />
          <Route path="settings" element={<Settings />} />
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
          <Route path="security-center" element={<Security />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<PublicLayout />}><Route path="*" element={<NotFound />} /></Route>
      </Routes>
    </Suspense>
  );
}
