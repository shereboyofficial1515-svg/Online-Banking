import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Controls.jsx';
import { Alert } from './ui/Feedback.jsx';
import { Modal } from './ui/Overlay.jsx';
import { useToast } from './ui/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api, apiUrl } from '../lib/api.js';
import { dateTime, initials } from '../lib/format.js';
import { usePrefs } from '../lib/PreferencesProvider.jsx';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/** Client-side checks for a fast, friendly message. The server repeats them and also verifies the real file contents. */
export function checkPhoto(file) {
  if (!file) return 'Choose an image to upload.';
  if (!TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > MAX_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/**
 * Profile header: photo, name and email on one side, the photo action in its own area. On narrow screens the action drops
 * below the details (full width, 44px+ touch target); on wide screens it sits on the right, vertically centred.
 * The new photo is shown only after the server confirms the upload; until then the existing photo (or initials) stays.
 */
export default function ProfileHeader() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const { t } = usePrefs();
  const input = useRef(null);
  const [picked, setPicked] = useState(null); // { file, url }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const version = user.profilePhotoVersion;
  useEffect(() => { setBroken(false); }, [version]);

  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url); }, [picked]);

  const choose = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const problem = checkPhoto(file);
    if (problem) { setError(problem); return; }
    setError(null); setPicked({ file, url: URL.createObjectURL(file) });
  };
  const cancel = () => { if (!busy) { setPicked(null); setError(null); } };
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append('photo', picked.file);
      const r = await api.upload('/api/users/me/photo', fd);
      if (!r?.user?.hasProfilePhoto) throw new Error('The photo could not be saved. Please try again.');
      updateUser(r.user); // the confirmed profile from the server: header, sidebar and this page all read the same state
      setPicked(null);
      toast.success('Profile photo updated.');
    } catch (ex) { setError(ex.message || 'The photo could not be uploaded. Please try again.'); } finally { setBusy(false); }
  };

  const hasPhoto = user.hasProfilePhoto && version && !broken;
  return (
    <section className="profile-head" aria-label="Profile summary">
      <div className="profile-id">
        <span className="profile-avatar" aria-hidden={hasPhoto ? undefined : true}>
          {hasPhoto ? <img src={apiUrl(`/api/users/me/photo?v=${encodeURIComponent(version)}`)} alt={`Profile photo of ${user.firstName} ${user.lastName}`} onError={() => setBroken(true)} /> : initials(user)}
        </span>
        <div className="profile-names">
          <h2>{user.firstName} {user.lastName}</h2>
          <p className="profile-email">{user.email}</p>
          <p className="muted small">{t('profile.since', { date: dateTime(user.createdAt) })}</p>
        </div>
      </div>
      <div className="profile-actions">
        <input ref={input} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} aria-label="Choose a profile photo" tabIndex={-1} />
        <Button variant="secondary" icon="camera" onClick={() => input.current.click()}>{user.hasProfilePhoto ? t('profile.change') : t('profile.add')}</Button>
        <p className="muted small">{t('profile.hint')}</p>
      </div>
      {error && !picked && <div className="profile-error"><Alert tone="danger">{error}</Alert></div>}

      <Modal open={!!picked} onClose={cancel} title="Use this photo?" size="sm"
        footer={<><Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button><Button onClick={confirm} loading={busy}>Save photo</Button></>}>
        {picked && <div className="photo-preview"><img src={picked.url} alt="Preview of your new profile photo" /></div>}
        <p className="muted small center">Your photo is shown in a circle. It is only saved when you choose Save photo.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </Modal>
    </section>
  );
}
