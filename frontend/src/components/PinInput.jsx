import { forwardRef } from 'react';
import { Input } from './ui/Controls.jsx';

/**
 * Six-digit PIN field. Masked, digits only (non-digits are dropped as you type or paste), numeric keyboard on phones, never
 * auto-filled or remembered by the browser. `onComplete` fires once six digits are present.
 */
const PinInput = forwardRef(function PinInput({ value, onChange, onComplete, autoFocus, ...rest }, ref) {
  return (
    <Input ref={ref} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      name="session-pin" data-lpignore="true" className="pin-input" autoFocus={autoFocus} value={value}
      onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); onChange(v); if (v.length === 6) onComplete?.(v); }} {...rest} />
  );
});
export default PinInput;
