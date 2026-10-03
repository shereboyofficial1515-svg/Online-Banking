import { useId, useMemo } from 'react';
import { money, date } from '../../lib/format.js';

/** Running-balance line chart derived from ledger entries (never from client-side guesses). */
export function BalanceChart({ history, currency = 'USD' }) {
  const id = useId();
  const W = 640; const H = 200; const pad = { t: 14, r: 12, b: 26, l: 12 };
  const pts = useMemo(() => {
    if (!history?.length) return [];
    const data = history.length === 1 ? [{ ...history[0], balance: 0 }, history[0]] : history;
    const vals = data.map((d) => d.balance);
    const min = Math.min(...vals, 0); const max = Math.max(...vals, 1);
    const x = (i) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
    return data.map((d, i) => ({ x: x(i), y: y(d.balance), ...d }));
  }, [history]);
  if (!pts.length) return null;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts.at(-1).x} ${H - pad.b} L${pts[0].x} ${H - pad.b} Z`;
  const last = pts.at(-1);
  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="sr-only">Balance history. Latest balance {money(last.balance, currency)} on {date(last.at)}.</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="false" preserveAspectRatio="none" className="chart-svg">
        <defs><linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} className="chart-grid" />)}
        <path d={area} fill={`url(#${id}-g)`} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={last.x} cy={last.y} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
      </svg>
      <div className="chart-axis"><span>{date(pts[0].at)}</span><span>{date(last.at)}</span></div>
    </figure>
  );
}

/** Money in / money out per month. Shown with a text table alternative for screen readers. */
export function InOutChart({ monthly, currency = 'USD' }) {
  const id = useId();
  if (!monthly?.length) return null;
  const max = Math.max(...monthly.flatMap((m) => [m.in, m.out]), 1);
  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="sr-only">
        Monthly money in and out: {monthly.map((m) => `${m.month}: in ${money(m.in, currency)}, out ${money(m.out, currency)}`).join('; ')}
      </figcaption>
      <div className="bars" aria-hidden="true">
        {monthly.map((m) => (
          <div key={m.month} className="bar-group">
            <div className="bar-pair">
              <span className="bar bar-in" style={{ height: `${Math.max((m.in / max) * 100, m.in ? 3 : 0)}%` }} title={`In ${money(m.in, currency)}`} />
              <span className="bar bar-out" style={{ height: `${Math.max((m.out / max) * 100, m.out ? 3 : 0)}%` }} title={`Out ${money(m.out, currency)}`} />
            </div>
            <span className="bar-label">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
          </div>
        ))}
      </div>
      <div className="legend" aria-hidden="true"><span><i className="dot dot-in" /> Money in</span><span><i className="dot dot-out" /> Money out</span></div>
    </figure>
  );
}

export function Sparkbars({ values, label }) {
  const max = Math.max(...values, 1);
  return (
    <div className="sparkbars" role="img" aria-label={label}>
      {values.map((v, i) => <span key={i} style={{ height: `${Math.max((v / max) * 100, v ? 6 : 2)}%` }} />)}
    </div>
  );
}
