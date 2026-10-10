import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const post = vi.fn();
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig()), api: { get: vi.fn(), post: (...a) => post(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() } }));

const { VerifyEmail } = await import('../pages/auth/Auth.jsx');
const { ToastProvider } = await import('../components/ui/Toast.jsx');

const mount = (state) => render(
  <MemoryRouter initialEntries={[{ pathname: '/verify-email', state }]}><ToastProvider><VerifyEmail /></ToastProvider></MemoryRouter>,
);
const codeInput = () => screen.getByLabelText(/Verification code/);

describe('VerifyEmail page (6-digit code)', () => {
  beforeEach(() => { post.mockReset(); });

  it('shows where the code was sent and has an accessible code field with a Verify button', () => {
    mount({ email: 'ana@example.test', justRegistered: true });
    expect(screen.getByText('ana@example.test', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email address/)).toHaveValue('ana@example.test');
    const input = codeInput();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', '6');
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeInTheDocument();
  });

  it('accepts digits only and validates before calling the API', async () => {
    mount({ email: 'ana@example.test' });
    fireEvent.change(codeInput(), { target: { value: '12ab34' } });
    expect(codeInput()).toHaveValue('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 6-digit code');
    expect(post).not.toHaveBeenCalled();
  });

  it('submits email + code when the button is clicked and then shows the success state', async () => {
    post.mockResolvedValue({ ok: true });
    mount({ email: 'ana@example.test' });
    fireEvent.change(codeInput(), { target: { value: '482917' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/auth/verify-email', { email: 'ana@example.test', code: '482917' }));
    expect(await screen.findByText(/your email address is confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to sign in' })).toHaveAttribute('href', '/login');
  });

  it('never reports success when the server rejects the code, and clears the field for a retry', async () => {
    const { ApiError } = await import('../lib/api.js');
    post.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'That code is incorrect or has expired. Please check it or request a new code.'));
    mount({ email: 'ana@example.test' });
    fireEvent.change(codeInput(), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect or has expired');
    expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument();
    expect(codeInput()).toHaveValue('');
  });

  it('resend is rate-limited in the UI right after registration and works afterwards', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue({ message: 'ok' });
    mount({ email: 'ana@example.test', justRegistered: true });
    const resend = screen.getByRole('button', { name: /Resend code in 60s/ });
    expect(resend).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    const ready = screen.getByRole('button', { name: 'Resend code' });
    expect(ready).toBeEnabled();
    await act(async () => { fireEvent.click(ready); });
    expect(post).toHaveBeenCalledWith('/api/auth/resend-verification', { email: 'ana@example.test' });
    expect(screen.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
    vi.useRealTimers();
  });

  it('asks for the email when the page is opened from the email button (no address in the URL)', () => {
    mount(undefined);
    expect(screen.getByLabelText(/Email address/)).toHaveValue('');
    expect(screen.getByText(/Enter the 6-digit code from your verification email/)).toBeInTheDocument();
  });
});
