export type ConnectorKey =
  | 'github'
  | 'notion'
  | 'slack'
  | 'supabase'
  | 'figma'
  | 'vercel'
  | 'postgres';

export type ConnectorCategory = 'app' | 'custom_api' | 'custom_mcp';

export type ConnectorAuthMode = 'oauth' | 'token' | 'dsn' | 'none';

export type ConnectorConfigField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  required?: boolean;
  placeholder?: string;
  description?: string;
  secret?: boolean;
};

export type ConnectorOauthProvider = {
  provider: 'github' | 'slack' | 'notion' | 'supabase' | 'figma' | 'vercel';
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopeParam?: string;
  scopes: string[];
  tokenRequestBodyFormat?: 'json' | 'form';
  tokenClientAuth?: 'body' | 'basic';
  tokenExtraParams?: Record<string, string>;
  authorizationExtraParams?: Record<string, string>;
};

export type ConnectorDefinition = {
  key: ConnectorKey;
  category: ConnectorCategory;
  name: string;
  description: string;
  icon: string;
  featured?: boolean;
  isNew?: boolean;
  sortOrder?: number;
  authMode: ConnectorAuthMode;
  available: boolean;
  availabilityReason?: string;
  configFields: ConnectorConfigField[];
  oauth?: {
    supported: boolean;
    provider?: ConnectorOauthProvider['provider'];
  };
  activityMatcherVerified: boolean;
  visibleInMenu: boolean;
  deprecated?: boolean;
  runtime: {
    type: 'local' | 'remote';
    urlEnv?: string;
    urlDefault?: string;
    headersEnv?: string;
    headerTemplate?: 'bearer-token' | 'supabase' | 'figma' | 'none';
  };
};
