// All money is handled as integer minor units (cents). Floats never touch balances.
import { badRequest } from './errors.js';

export function parseAmountToMinor(input) {
  const s = String(input).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw badRequest('Enter a valid amount with at most two decimal places.');
  const [whole, frac = ''] = s.split('.');
  const minor = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw badRequest('Amount must be greater than zero.');
  return minor;
}
export const formatMinor = (minor, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(minor) / 100);
