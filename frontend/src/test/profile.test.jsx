import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const store = { upload: vi.fn(), reload: vi.fn(), user: { id: 'u1', firstName: 'Avery', lastName: 'Morgan', email: 'avery.morgan.with.a.very.long.address@example-company-name.test', createdAt: '2026-01-01T00:00:00Z', hasProfilePhoto: false } };
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig()), api: { upload: (...a) => store.upload(...a), get: vi.fn(), post: vi.fn() } }));
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: store.user, reload: store.reload }) }));

const { default: ProfileHeader, checkPhoto } = await import('../components/ProfileHeader.jsx');
const { ToastProvider } = await import('../components/ui/Toast.jsx');

const mount = () => render(<MemoryRouter><ToastProvider><ProfileHeader /></ToastProvider></MemoryRouter>);
const file = (name, type, size = 1000) => new File([new Uint8Array(size)], name, { type });
const pick = (f) => fireEvent.change(screen.getByLabelText('Choose a profile photo'), { target: { files: [f] } });

beforeEach(() => {
  store.upload.mockReset(); store.reload.mockReset(); store.user.hasProfilePhoto = false;
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn();
});

describe('profile photo client checks', () => {
  it('accepts JPEG/PNG/WebP and rejects other types, oversize and empty files', () => {
    expect(checkPhoto(file('a.png', 'image/png'))).toBeNull();
    expect(checkPhoto(file('a.jpg', 'image/jpeg'))).toBeNull();
    expect(checkPhoto(file('a.webp', 'image/webp'))).toBeNull();
    expect(checkPhoto(file('a.svg', 'image/svg+xml'))).toMatch(/JPEG, PNG or WebP/);
    expect(checkPhoto(file('a.exe', 'application/x-msdownload'))).toMatch(/JPEG, PNG or WebP/);
    expect(checkPhoto(file('big.png', 'image/png', 6 * 1024 * 1024))).toMatch(/5 MB/);
    expect(checkPhoto(file('e.png', 'image/png', 0))).toMatch(/empty/);
  });
});

describe('profile header', () => {
  it('shows initials when there is no photo, and the name and email as text', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Avery Morgan' })).toBeInTheDocument();
    expect(screen.getByText(/avery.morgan.with.a.very.long/)).toBeInTheDocument();
    expect(screen.getByText('AM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
  });

  it('shows an inline error for an invalid file and never opens the preview or calls the API', async () => {
    mount();
    pick(file('x.svg', 'image/svg+xml'));
    expect(await screen.findByText('Please choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('previews the chosen photo; cancel discards it without uploading', async () => {
    mount();
    pick(file('me.png', 'image/png'));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('Use this photo?');
    expect(screen.getByAltText('Preview of your new profile photo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('shows a loading state, and reports success only after the backend confirms', async () => {
    let finish; store.upload.mockReturnValue(new Promise((r) => { finish = r; }));
    mount();
    pick(file('me.png', 'image/png'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save photo' }));
    expect(screen.getByRole('button', { name: /Save photo/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Profile photo updated.')).toBeNull(); // not yet
    store.user.hasProfilePhoto = true;
    finish({ ok: true });
    expect(await screen.findByText('Profile photo updated.')).toBeInTheDocument();
    expect(store.reload).toHaveBeenCalled();
    expect(store.upload).toHaveBeenCalledWith('/api/users/me/photo', expect.any(FormData));
  });

  it('keeps the dialog open with the server message when the upload fails, with no success message', async () => {
    store.upload.mockRejectedValue(Object.assign(new Error('Profile photos must be JPEG, PNG or WebP images.'), { status: 400 }));
    mount();
    pick(file('me.png', 'image/png'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save photo' }));
    expect(await screen.findByText('Profile photos must be JPEG, PNG or WebP images.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Profile photo updated.')).toBeNull();
    expect(store.reload).not.toHaveBeenCalled();
  });
});

describe('profile layout CSS', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/styles/layout.css'), 'utf8');
  it('stacks the action below the details on phones and beside them on wide screens, without overflow', () => {
    expect(css).toMatch(/\.profile-head \{[^}]*display: grid/);
    expect(css).toMatch(/\.profile-actions \.btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/@media \(min-width: 640px\) \{[\s\S]*\.profile-head \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.profile-email \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.profile-id \{[^}]*minmax\(0, 1fr\)/);
  });
});
