import { Link } from 'react-router-dom';
import { useSite } from '../../lib/site.jsx';

/** Original EWB Bank mark: a rising "W" stroke on a navy tile. Not derived from any other institution's identity. */
export function LogoMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--navy-900)" />
      <path d="M7 10.500 11.500 22 16 13.500 20.500 22 25 10.500" fill="none" stroke="#fff" strokeWidth="2.600" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25.500" cy="7.500" r="2.200" fill="var(--accent)" />
    </svg>
  );
}

/**
 * Brand logo. Uses the administrator-uploaded images when set (one for light backgrounds, one for dark ones, switching with the
 * theme) and otherwise the built-in mark plus the configured name. `light` means "placed on a navy background".
 */
export default function Logo({ to = '/', light = false, compact = false }) {
  const { config, assetUrl } = useSite();
  const { siteName, logoText, logoLightAssetId, logoDarkAssetId } = config.brand;
  const onLight = assetUrl(logoLightAssetId); const onDark = assetUrl(logoDarkAssetId);
  const [first, ...rest] = String(logoText || siteName).split(' ');
  return (
    <Link to={to} className={`logo ${light ? 'logo-light' : ''}`} aria-label={`${siteName} home`}>
      {onLight || onDark ? (
        light
          ? <img className="logo-img" src={onDark || onLight} alt="" />
          : (<>
            <img className="logo-img logo-img-onlight" src={onLight || onDark} alt="" />
            <img className="logo-img logo-img-ondark" src={onDark || onLight} alt="" />
          </>)
      ) : <LogoMark />}
      {!compact && !(onLight || onDark) && <span className="logo-word">{first}{rest.length > 0 && <span> {rest.join(' ')}</span>}</span>}
    </Link>
  );
}
