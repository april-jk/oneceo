type PortMappingPayload = Record<string, unknown>;

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function getSandboxPortWaitSeconds(): number {
  const fallback = 30;
  const parsed = Number(process.env.OSAC_PORT_MAPPING_WAIT_SECONDS || fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(Math.floor(parsed), 0, 60);
}

export function getSandboxPortCheckCount(): number {
  return toPositiveInt(process.env.OSAC_PORT_MAPPING_CHECKS, 4);
}

export function buildSandboxPortProbeQuery(waitSeconds?: number): Record<string, string> {
  const seconds = Number.isFinite(waitSeconds as number)
    ? clamp(Math.floor(waitSeconds as number), 0, 60)
    : getSandboxPortWaitSeconds();
  return {
    refresh: 'true',
    verify: 'true',
    wait_seconds: String(seconds),
  };
}

export function extractSandboxPortMappings(payload: unknown): PortMappingPayload[] {
  const data = payload as any;
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data?.items)) return data.data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

export function normalizeSandboxPortMapping(entry: PortMappingPayload | null | undefined) {
  const detail = (entry?.portReadyDetail || entry?.port_ready_detail || {}) as Record<string, unknown>;
  const vmPort = toNumberOrNull(entry?.vmPort ?? entry?.vm_port ?? entry?.vmPortNumber);
  const hostPort = toNumberOrNull(entry?.hostPort ?? entry?.host_port ?? entry?.port);
  const hostIp =
    typeof (entry?.hostIp ?? entry?.host_ip) === 'string'
      ? String(entry?.hostIp ?? entry?.host_ip)
      : null;
  const directReady = toBooleanOrNull(entry?.portReady ?? entry?.port_ready);
  const hostPortReady =
    toBooleanOrNull(entry?.hostPortReady ?? entry?.host_port_ready) ??
    toBooleanOrNull(detail?.hostPortReady ?? detail?.host_port_ready);
  const vmPortReady =
    toBooleanOrNull(entry?.vmPortReady ?? entry?.vm_port_ready) ??
    toBooleanOrNull(detail?.vmPortReady ?? detail?.vm_port_ready);
  const mappingIdRaw =
    entry?.mappingId ??
    entry?.mapping_id ??
    entry?.portMappingId ??
    entry?.port_mapping_id ??
    detail?.mappingId ??
    detail?.mapping_id;
  const mappingId = typeof mappingIdRaw === 'string' && mappingIdRaw.trim() ? mappingIdRaw.trim() : null;
  const mappingEpoch =
    toNumberOrNull(
      entry?.mappingEpoch ??
      entry?.mapping_epoch ??
      detail?.mappingEpoch ??
      detail?.mapping_epoch
    );

  const portReady =
    directReady === true || (hostPortReady === true && (vmPortReady === null || vmPortReady === true));

  return {
    vmPort,
    hostPort,
    hostIp,
    portReady,
    hostPortReady,
    vmPortReady,
    mappingId,
    mappingEpoch,
  };
}

export function isSandboxPortReady(entry: PortMappingPayload | null | undefined): boolean {
  return normalizeSandboxPortMapping(entry).portReady;
}

export function findSandboxPortMapping(
  entries: PortMappingPayload[] | null | undefined,
  targetVmPort: number,
  preferredHostPort?: number | null
): PortMappingPayload | null {
  const candidates = (entries || [])
    .map((entry) => ({
      entry,
      normalized: normalizeSandboxPortMapping(entry),
    }))
    .filter(
      ({ normalized }) =>
        normalized.vmPort !== null &&
        Number(normalized.vmPort) === Number(targetVmPort) &&
        normalized.hostPort !== null
    );

  if (preferredHostPort !== undefined && preferredHostPort !== null) {
    const preferred = candidates.find(
      ({ normalized }) => Number(normalized.hostPort) === Number(preferredHostPort)
    );
    if (preferred) {
      return preferred.entry;
    }
  }

  const ready = candidates.find(({ normalized }) => normalized.portReady);
  if (ready) {
    return ready.entry;
  }

  return candidates[0]?.entry || null;
}
