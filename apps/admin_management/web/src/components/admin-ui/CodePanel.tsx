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

export function CodePanel({ title, value, language = 'text', maxHeight = 360, className, downloadName }: CodePanelProps) {
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

  return (
    <section className={clsx('admin-code-panel', wrap && 'admin-code-panel-wrap', className)}>
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
      <pre className="admin-code-panel-body" style={{ maxHeight }}><code>{code || '暂无内容'}</code></pre>
    </section>
  );
}
