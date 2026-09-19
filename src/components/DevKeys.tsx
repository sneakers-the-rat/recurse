/**
 * What an instrument is made of: a key, a reading, and a field.
 *
 * There are two dev bars — one for a puzzle and one for a map — and they are separate because
 * almost everything either says is about its own game. What they share is the *look*: flat
 * mono, thin outlines, no ornament, so a screenshot of either is never mistaken for the real
 * thing. That look is three elements, and this is them.
 *
 * Split out rather than generalised: neither bar is a special case of the other, and widening
 * one to hold the other's controls would make a component that is mostly branches.
 */

import type { MessageDescriptor } from 'react-intl';
import { FormattedMessage } from 'react-intl';

/** Every control in either bar is the same flat outlined thing. */
export function Key({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
      aria-label={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** `name value`, the only other shape in a bar. */
export function Stat({
  name,
  children,
}: {
  name: MessageDescriptor;
  children: React.ReactNode;
}) {
  return (
    <span>
      <FormattedMessage {...name} /> <span className="text-neutral-200">{children}</span>
    </span>
  );
}

/** Somewhere to type a number or a word, in the same hand as the keys. */
export function Field({
  value,
  onChange,
  placeholder,
  label,
  width = 'w-16',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  width?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      className={`${width} border border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none focus:border-neutral-500`}
    />
  );
}
