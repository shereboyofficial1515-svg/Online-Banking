import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { apiUrl } from '../lib/api.js';
import { initials } from '../lib/format.js';

/**
 * The signed-in user's avatar. It reads the ONE shared profile in the auth state (user.hasProfilePhoto / profilePhotoVersion),
 * so every place that shows it changes together the moment a new photo is confirmed. The version is part of the URL, so a
 * new photo is never hidden by a cached old one while an unchanged photo stays cached. If the image fails to load the
 * initials are shown instead.
 */
export default function Avatar({ size, className = '', alt = '' }) {
  const { user } = useAuth();
  const [broken, setBroken] = useState(false);
  const version = user?.profilePhotoVersion;
  useEffect(() => { setBroken(false); }, [version]);
  const style = size ? { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) } : undefined;
  const photo = user?.hasProfilePhoto && version && !broken;
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden={alt ? undefined : true}>
      {photo ? <img src={apiUrl(`/api/users/me/photo?v=${encodeURIComponent(version)}`)} alt={alt} onError={() => setBroken(true)} /> : initials(user)}
    </span>
  );
}
