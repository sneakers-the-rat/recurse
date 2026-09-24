/**
 * The controls shared by the two dev bars, `DevBar` and `AtlasDevBar`: a button, a readout and
 * a text field, all flat and outlined so a screenshot of either bar is never mistaken for the game.
 */

import type { MessageDescriptor } from 'react-intl';
import { FormattedMessage } from 'react-intl';

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

/** `name value`. */
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

export function Field({
  value,
  onChange,
  placeholder,
  label,
  width = 'w-16',
  wrong = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  width?: string;
  /** Draw the field in red: what is typed is something the bar cannot act on. */
  wrong?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={wrong || undefined}
      autoComplete="off"
      className={`${width} border bg-transparent px-1.5 py-0.5 outline-none ${
        wrong
          ? 'border-red-800 text-red-400 focus:border-red-600'
          : 'border-neutral-700 focus:border-neutral-500'
      }`}
    />
  );
}
