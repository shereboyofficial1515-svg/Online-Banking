import { Link } from 'react-router-dom';

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

export default function Logo({ to = '/', light = false, compact = false }) {
  return (
    <Link to={to} className={`logo ${light ? 'logo-light' : ''}`} aria-label="EWB Bank home">
      <LogoMark />
      {!compact && <span className="logo-word">EWB<span> Bank</span></span>}
    </Link>
  );
}
