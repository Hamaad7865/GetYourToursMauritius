'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { DEFAULT_DIAL_CODE, composePhone, splitPhone } from '@/lib/phone/dial-codes';
import { DialCodeSelect } from './DialCodeSelect';

/*
 * A whole phone control — the dial-code picker beside the national digits — that stores ONE
 * international string ("+230 5xxx xxxx") but edits as two fields, so a visitor's home-format number
 * ("07700 900123") never reaches the driver undiallable. See src/lib/phone/dial-codes.ts.
 *
 * Controlled by the composed string. `national` is held locally rather than recomputed from `value`
 * each render: recomposing on every keystroke would strip the space the customer is mid-typing
 * between digit groups. An external change to `value` (a profile load) that doesn't match what we
 * currently show re-seeds both halves; our own edits do not, so the caret never jumps.
 */
export function PhoneField({
  value,
  onChange,
  id,
  placeholder = '5xxx xxxx',
  ariaDescribedby,
  ariaInvalid,
}: {
  value: string;
  onChange: (composed: string) => void;
  id?: string;
  placeholder?: string;
  ariaDescribedby?: string;
  ariaInvalid?: boolean;
}) {
  const t = useT();
  const initial = splitPhone(value);
  const [dialCode, setDialCode] = useState(initial.dialCode ?? DEFAULT_DIAL_CODE);
  const [national, setNational] = useState(initial.national);
  // The last string we emitted upward, so a re-seed fires only on a REAL external change.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return; // our own edit echoing back — leave the fields alone
    const parsed = splitPhone(value);
    if (parsed.dialCode) setDialCode(parsed.dialCode);
    setNational(parsed.national);
    lastEmitted.current = value;
  }, [value]);

  function emit(code: string, nat: string) {
    const composed = composePhone(code, nat);
    lastEmitted.current = composed;
    onChange(composed);
  }

  return (
    <div className="flex gap-2">
      <DialCodeSelect
        value={dialCode}
        onChange={(code) => {
          setDialCode(code);
          emit(code, national);
        }}
      />
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        onChange={(e) => {
          setNational(e.target.value);
          emit(dialCode, e.target.value);
        }}
        placeholder={placeholder}
        aria-label={t('Mobile phone number')}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
      />
    </div>
  );
}
