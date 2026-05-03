import type { ReactNode } from 'react';
import clsx from 'clsx';
import { getAdminModuleIcon } from './adminDetailIcons';
import type { AdminModuleIconKey } from './adminDetailIcons';

export type RelationNode = {
  id: string;
  label: string;
  type: AdminModuleIconKey | 'session' | 'runtime' | 'artifact' | 'other';
  status?: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  onOpen?: () => void;
};

export type RelationEdge = {
  from: string;
  to: string;
  label?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
};

type RelationTopologyProps = {
  nodes: RelationNode[];
  edges?: RelationEdge[];
  focusNodeId?: string;
  maxVisibleNodes?: number;
  compact?: boolean;
  className?: string;
};

function iconType(type: RelationNode['type']): AdminModuleIconKey {
  if (type === 'session') return 'conversation';
  if (type === 'runtime') return 'terminal';
  if (type === 'artifact') return 'osac';
  if (type === 'other') return 'audit';
  return type;
}

export function RelationTopology({ nodes, edges = [], focusNodeId, maxVisibleNodes = 8, compact = false, className }: RelationTopologyProps) {
  const visibleNodes = nodes.slice(0, maxVisibleNodes);
  const hiddenCount = Math.max(0, nodes.length - visibleNodes.length);
  return (
    <div className={clsx('admin-relation-topology', compact && 'admin-relation-topology-compact', className)}>
      <div className="admin-relation-node-row">
        {visibleNodes.map((node, index) => {
          const isActive = node.active || node.id === focusNodeId;
          const nodeBody = (
            <>
              <span className="admin-relation-node-icon">{getAdminModuleIcon(iconType(node.type), { size: compact ? 14 : 16 })}</span>
              <span className="admin-relation-node-copy">
                <strong>{node.label}</strong>
                {node.meta ? <small>{node.meta}</small> : null}
              </span>
              {node.status ? <span className="admin-relation-node-status">{node.status}</span> : null}
            </>
          );
          return (
            <div key={node.id} className="admin-relation-node-wrap">
              {index > 0 ? <span className="admin-relation-edge" aria-hidden="true" /> : null}
              {node.onOpen ? (
                <button type="button" className={clsx('admin-relation-node', isActive && 'is-active')} onClick={node.onOpen}>
                  {nodeBody}
                </button>
              ) : (
                <div className={clsx('admin-relation-node', isActive && 'is-active')}>{nodeBody}</div>
              )}
            </div>
          );
        })}
        {hiddenCount ? <span className="admin-relation-more">+{hiddenCount}</span> : null}
      </div>
      {edges.length ? (
        <div className="admin-relation-edge-list" aria-label="关系说明">
          {edges.slice(0, maxVisibleNodes).map((edge) => (
            <span key={`${edge.from}-${edge.to}-${edge.label || ''}`} className={clsx('admin-relation-edge-chip', `admin-relation-edge-chip-${edge.tone || 'neutral'}`)}>
              {edge.label || `${edge.from} → ${edge.to}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
