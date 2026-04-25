import type { ReactNode } from 'react';
import clsx from 'clsx';

export type AdminInspectorSection = {
  key: string;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
};

type AdminStickyInspectorProps = {
  title?: string;
  sections: AdminInspectorSection[];
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function AdminStickyInspector({ title = 'Inspector', sections, actions, compact = false, className }: AdminStickyInspectorProps) {
  return (
    <aside className={clsx('admin-sticky-inspector', compact && 'admin-sticky-inspector-compact', className)} aria-label={title}>
      <div className="admin-sticky-inspector-head">
        <h3>{title}</h3>
        {actions ? <div className="admin-sticky-inspector-actions">{actions}</div> : null}
      </div>
      <div className="admin-sticky-inspector-sections">
        {sections.map((section) => (
          <section key={section.key} className="admin-inspector-section">
            <div className="admin-inspector-section-head">
              <div className="admin-inspector-section-title">
                {section.icon ? <span className="admin-inspector-section-icon">{section.icon}</span> : null}
                <h4>{section.title}</h4>
              </div>
              {section.badge ? <div className="admin-inspector-section-badge">{section.badge}</div> : null}
            </div>
            {section.description ? <p className="admin-inspector-section-description">{section.description}</p> : null}
            <div className="admin-inspector-section-body">{section.children}</div>
          </section>
        ))}
      </div>
    </aside>
  );
}
