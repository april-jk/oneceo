import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import clsx from 'clsx';

type IdTokenProps = {
  value?: string | number | null;
  label?: string;
  copyValue?: string;
  head?: number;
  tail?: number;
  className?: string;
  onCopied?: (value: string) => void;
};

function truncateMiddle(value: string, head: number, tail: number) {
  if (!value) return '-';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function IdToken({ value, label, copyValue, head = 10, tail = 7, className, onCopied }: IdTokenProps) {
  const raw = String(value ?? '').trim();
  const [copied, setCopied] = useState(false);
  const display = useMemo(() => truncateMiddle(raw, head, tail), [head, raw, tail]);

  const handleCopy = async () => {
    if (!raw) return;
    const next = copyValue || raw;
    await navigator.clipboard.writeText(next);
    setCopied(true);
    onCopied?.(next);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className={clsx('admin-id-token', className)} title={raw || undefined}>
      {label ? <span className="admin-id-token-label">{label}</span> : null}
      <code>{display}</code>
      {raw ? (
        <button type="button" className="admin-id-token-copy" onClick={() => void handleCopy()} aria-label={`复制${label || 'ID'}`}>
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
      ) : null}
    </span>
  );
}
