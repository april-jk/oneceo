export type AltusCapabilitySideEffect = 'none' | 'local_write' | 'external_read' | 'external_write';

export type AltusCapabilityPolicy = {
  capability: string;
  sideEffect: AltusCapabilitySideEffect;
  riskLevel: 'low' | 'medium' | 'high';
  requiresExplicitConfirmation: boolean;
  requiresCredential: boolean;
  requiresBoundResource?: boolean;
};

const CAPABILITY_POLICIES: Record<string, AltusCapabilityPolicy> = {
  'project.local_scaffold': {
    capability: 'project.local_scaffold',
    sideEffect: 'local_write',
    riskLevel: 'low',
    requiresExplicitConfirmation: false,
    requiresCredential: false,
  },
  'advisory.response': {
    capability: 'advisory.response',
    sideEffect: 'none',
    riskLevel: 'low',
    requiresExplicitConfirmation: false,
    requiresCredential: false,
  },
  'connector.external_read': {
    capability: 'connector.external_read',
    sideEffect: 'external_read',
    riskLevel: 'medium',
    requiresExplicitConfirmation: false,
    requiresCredential: true,
    requiresBoundResource: true,
  },
  'connector.external_write': {
    capability: 'connector.external_write',
    sideEffect: 'external_write',
    riskLevel: 'high',
    requiresExplicitConfirmation: true,
    requiresCredential: true,
    requiresBoundResource: true,
  },
  'deploy.preview': {
    capability: 'deploy.preview',
    sideEffect: 'external_write',
    riskLevel: 'medium',
    requiresExplicitConfirmation: true,
    requiresCredential: true,
    requiresBoundResource: true,
  },
  'deploy.production': {
    capability: 'deploy.production',
    sideEffect: 'external_write',
    riskLevel: 'high',
    requiresExplicitConfirmation: true,
    requiresCredential: true,
    requiresBoundResource: true,
  },
  'data.delete': {
    capability: 'data.delete',
    sideEffect: 'external_write',
    riskLevel: 'high',
    requiresExplicitConfirmation: true,
    requiresCredential: true,
    requiresBoundResource: true,
  },
};

export class AltusCapabilityPolicyService {
  getPolicy(capability?: string | null): AltusCapabilityPolicy | null {
    if (!capability) return null;
    return CAPABILITY_POLICIES[capability] || null;
  }

  listPolicies(): AltusCapabilityPolicy[] {
    return Object.values(CAPABILITY_POLICIES);
  }
}

export const altusCapabilityPolicyService = new AltusCapabilityPolicyService();
