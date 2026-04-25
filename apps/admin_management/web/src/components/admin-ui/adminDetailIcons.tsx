import type { ReactNode } from 'react';
import {
  Activity,
  Archive,
  Binary,
  BookOpenText,
  Bot,
  Box,
  Cable,
  CheckCircle2,
  Clock3,
  Container,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  KeyRound,
  Lock,
  MessagesSquare,
  MoreHorizontal,
  Package,
  PackageCheck,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Receipt,
  RefreshCcw,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  ScrollText,
  Server,
  ShieldUser,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  UserRound,
  WifiOff,
  Workflow,
  XCircle,
} from 'lucide-react';

export type AdminModuleIconKey =
  | 'user'
  | 'admin'
  | 'sandbox'
  | 'conversation'
  | 'agent'
  | 'skill'
  | 'connector'
  | 'connectorGuide'
  | 'osac'
  | 'billing'
  | 'audit'
  | 'deployment'
  | 'kvm'
  | 'terminal';

export type AdminStatusIconKey =
  | 'healthy'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'failed'
  | 'warning'
  | 'archived'
  | 'locked'
  | 'connected'
  | 'disconnected';

export type AdminActionIconKey =
  | 'edit'
  | 'save'
  | 'copy'
  | 'refresh'
  | 'sync'
  | 'start'
  | 'pause'
  | 'restart'
  | 'archive'
  | 'delete'
  | 'terminal'
  | 'logs'
  | 'external'
  | 'more';

type IconOptions = {
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
};

const defaultOptions: Required<Pick<IconOptions, 'size' | 'aria-hidden'>> = {
  size: 16,
  'aria-hidden': true,
};

function withDefaults(options: IconOptions = {}) {
  return { ...defaultOptions, ...options };
}

export function getAdminModuleIcon(key: AdminModuleIconKey, options?: IconOptions): ReactNode {
  const props = withDefaults(options);
  switch (key) {
    case 'user': return <UserRound {...props} />;
    case 'admin': return <ShieldUser {...props} />;
    case 'sandbox': return <Container {...props} />;
    case 'conversation': return <MessagesSquare {...props} />;
    case 'agent': return <Bot {...props} />;
    case 'skill': return <Sparkles {...props} />;
    case 'connector': return <Cable {...props} />;
    case 'connectorGuide': return <BookOpenText {...props} />;
    case 'osac': return <PackageCheck {...props} />;
    case 'billing': return <Receipt {...props} />;
    case 'audit': return <ScrollText {...props} />;
    case 'deployment': return <Rocket {...props} />;
    case 'kvm': return <Server {...props} />;
    case 'terminal': return <Terminal {...props} />;
    default: return <Box {...props} />;
  }
}

export function getAdminStatusIcon(key: AdminStatusIconKey, options?: IconOptions): ReactNode {
  const props = withDefaults(options);
  switch (key) {
    case 'healthy': return <CheckCircle2 {...props} />;
    case 'running': return <Activity {...props} />;
    case 'waiting': return <Clock3 {...props} />;
    case 'paused': return <PauseCircle {...props} />;
    case 'failed': return <XCircle {...props} />;
    case 'warning': return <TriangleAlert {...props} />;
    case 'archived': return <Archive {...props} />;
    case 'locked': return <Lock {...props} />;
    case 'connected': return <PlugZap {...props} />;
    case 'disconnected': return <WifiOff {...props} />;
    default: return <CheckCircle2 {...props} />;
  }
}

export function getAdminActionIcon(key: AdminActionIconKey, options?: IconOptions): ReactNode {
  const props = withDefaults(options);
  switch (key) {
    case 'edit': return <Pencil {...props} />;
    case 'save': return <Save {...props} />;
    case 'copy': return <Copy {...props} />;
    case 'refresh': return <RefreshCw {...props} />;
    case 'sync': return <RefreshCcw {...props} />;
    case 'start': return <Play {...props} />;
    case 'pause': return <Pause {...props} />;
    case 'restart': return <RotateCcw {...props} />;
    case 'archive': return <Archive {...props} />;
    case 'delete': return <Trash2 {...props} />;
    case 'terminal': return <Terminal {...props} />;
    case 'logs': return <FileText {...props} />;
    case 'external': return <ExternalLink {...props} />;
    case 'more': return <MoreHorizontal {...props} />;
    default: return <MoreHorizontal {...props} />;
  }
}

export const adminDetailIconCatalog = {
  module: { UserRound, ShieldUser, KeyRound, Container, Box, MessagesSquare, Bot, Workflow, Sparkles, Package, Cable, Plug, BookOpenText, Binary, PackageCheck, Receipt, CreditCard, ScrollText, History, Rocket, Server, Terminal },
  status: { CheckCircle2, Activity, Clock3, PauseCircle, XCircle, TriangleAlert, Archive, Lock, PlugZap, WifiOff },
  action: { Pencil, Save, Copy, RefreshCw, RefreshCcw, Play, Pause, RotateCcw, Archive, Trash2, Terminal, FileText, ExternalLink, MoreHorizontal },
};
