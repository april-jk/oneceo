import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

type AdminButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft' | 'link';
type AdminButtonSize = 'sm' | 'md' | 'lg' | 'icon';

type AdminButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
};

export function AdminButton({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconOnly = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: AdminButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'admin-button',
        `admin-button-${variant}`,
        `admin-button-${size}`,
        iconOnly && 'admin-button-icon-only',
        loading && 'admin-button-loading',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="admin-button-spinner" size={15} aria-hidden="true" /> : icon ? <span className="admin-button-icon">{icon}</span> : null}
      {children ? <span className="admin-button-label">{children}</span> : null}
    </button>
  );
}
