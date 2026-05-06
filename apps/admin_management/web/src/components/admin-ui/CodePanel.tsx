import { Check, Copy, Download, WrapText } from 'lucide-react';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AdminButton } from './AdminButton';

type CodePanelProps = {
  title: string;
  value: unknown;
  language?: string;
  maxHeight?: number;
  className?: string;
  downloadName?: string;
  theme?: 'dark' | 'light';
};

function stringifyCode(value: unknown, language?: string) {
  if (typeof value === 'string') {
    if (language === 'json') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function highlightJsonLine(line: string, idx: number): React.ReactNode {
  const keyMatch = line.match(/^(\s*)("(?:\\.|[^"\\])*")(\s*:)(.*)$/);
  if (!keyMatch) {
    // Try to highlight standalone values (array items, root values)
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return (
        <span key={idx}>
          {line.slice(0, line.indexOf(trimmed))}
          <span className="json-string">{trimmed}</span>
          {line.slice(line.indexOf(trimmed) + trimmed.length)}
        </span>
      );
    }
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      return (
        <span key={idx}>
          {line.slice(0, line.indexOf(trimmed))}
          <span className="json-number">{trimmed}</span>
          {line.slice(line.indexOf(trimmed) + trimmed.length)}
        </span>
      );
    }
    if (/^(true|false|null)$/.test(trimmed)) {
      return (
        <span key={idx}>
          {line.slice(0, line.indexOf(trimmed))}
          <span className="json-boolean">{trimmed}</span>
          {line.slice(line.indexOf(trimmed) + trimmed.length)}
        </span>
      );
    }
    return <span key={idx}>{line}</span>;
  }

  const [, indent, key, colon, rest] = keyMatch;
  let valueNode: React.ReactNode = rest;
  const trimmed = rest.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    valueNode = (
      <>
        {rest.slice(0, rest.indexOf(trimmed))}
        <span className="json-string">{trimmed}</span>
        {rest.slice(rest.indexOf(trimmed) + trimmed.length)}
      </>
    );
  } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    valueNode = (
      <>
        {rest.slice(0, rest.indexOf(trimmed))}
        <span className="json-number">{trimmed}</span>
        {rest.slice(rest.indexOf(trimmed) + trimmed.length)}
      </>
    );
  } else if (/^(true|false|null)$/.test(trimmed)) {
    valueNode = (
      <>
        {rest.slice(0, rest.indexOf(trimmed))}
        <span className="json-boolean">{trimmed}</span>
        {rest.slice(rest.indexOf(trimmed) + trimmed.length)}
      </>
    );
  }

  return (
    <span key={idx}>
      {indent}
      <span className="json-key">{key}</span>
      {colon}
      {valueNode}
    </span>
  );
}

function JsonHighlight({ code }: { code: string }): React.ReactNode {
  const lines = code.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="json-line">
          {highlightJsonLine(line, i)}
        </div>
      ))}
    </>
  );
}

export function CodePanel({ title, value, language = 'text', maxHeight = 360, className, downloadName, theme = 'dark' }: CodePanelProps) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => stringifyCode(value, language), [language, value]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName || `${title}.${language === 'json' ? 'json' : 'txt'}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const isJson = language === 'json';

  return (
    <section className={clsx('admin-code-panel', theme === 'light' && 'admin-code-panel-light', wrap && 'admin-code-panel-wrap', className)}>
      <header className="admin-code-panel-header">
        <div>
          <strong>{title}</strong>
          <span>{language.toUpperCase()}</span>
        </div>
        <div className="admin-code-panel-actions">
          <AdminButton size="icon" variant="ghost" iconOnly icon={<WrapText size={14} />} onClick={() => setWrap((next) => !next)} aria-label="切换自动换行" />
          <AdminButton size="icon" variant="ghost" iconOnly icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void handleCopy()} aria-label="复制代码" />
          <AdminButton size="icon" variant="ghost" iconOnly icon={<Download size={14} />} onClick={handleDownload} aria-label="下载内容" />
        </div>
      </header>
      <pre className="admin-code-panel-body" style={{ maxHeight }}>
        <code>{isJson ? <JsonHighlight code={code} /> : (code || '暂无内容')}</code>
      </pre>
    </section>
  );
}
