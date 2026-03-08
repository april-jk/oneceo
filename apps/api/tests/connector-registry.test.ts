import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  connectorRegistry,
  type ConnectorAccountMaterial,
} from '../src/services/connector-registry';

const envBackup = {
  GITHUB_CONNECTOR_CLIENT_ID: process.env.GITHUB_CONNECTOR_CLIENT_ID,
  GITHUB_CONNECTOR_CLIENT_SECRET: process.env.GITHUB_CONNECTOR_CLIENT_SECRET,
  SLACK_MCP_REMOTE_URL: process.env.SLACK_MCP_REMOTE_URL,
  SLACK_MCP_REMOTE_HEADERS_JSON: process.env.SLACK_MCP_REMOTE_HEADERS_JSON,
  SLACK_CONNECTOR_CLIENT_ID: process.env.SLACK_CONNECTOR_CLIENT_ID,
  SLACK_CONNECTOR_CLIENT_SECRET: process.env.SLACK_CONNECTOR_CLIENT_SECRET,
  NOTION_MCP_REMOTE_URL: process.env.NOTION_MCP_REMOTE_URL,
  NOTION_MCP_REMOTE_HEADERS_JSON: process.env.NOTION_MCP_REMOTE_HEADERS_JSON,
  NOTION_CONNECTOR_CLIENT_ID: process.env.NOTION_CONNECTOR_CLIENT_ID,
  NOTION_CONNECTOR_CLIENT_SECRET: process.env.NOTION_CONNECTOR_CLIENT_SECRET,
};

beforeEach(() => {
  process.env.GITHUB_CONNECTOR_CLIENT_ID = 'github-client';
  process.env.GITHUB_CONNECTOR_CLIENT_SECRET = 'github-secret';
  process.env.SLACK_MCP_REMOTE_URL = 'https://slack-mcp.example.com';
  process.env.SLACK_MCP_REMOTE_HEADERS_JSON = '{"Authorization":"Bearer ${token}"}';
  process.env.SLACK_CONNECTOR_CLIENT_ID = 'slack-client';
  process.env.SLACK_CONNECTOR_CLIENT_SECRET = 'slack-secret';
  process.env.NOTION_MCP_REMOTE_URL = 'https://notion-mcp.example.com';
  process.env.NOTION_MCP_REMOTE_HEADERS_JSON = '{"Authorization":"Bearer ${token}"}';
  process.env.NOTION_CONNECTOR_CLIENT_ID = 'notion-client';
  process.env.NOTION_CONNECTOR_CLIENT_SECRET = 'notion-secret';
});

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function buildAccount(
  connectorKey: ConnectorAccountMaterial['connectorKey'],
  secret: ConnectorAccountMaterial['secret']
): ConnectorAccountMaterial {
  return {
    connectorKey,
    authMode: connectorKey === 'postgres' ? 'dsn' : 'oauth',
    authStatus: 'authorized',
    configJson: {},
    secret,
  };
}

test('connector registry exposes built-in connectors with availability metadata', () => {
  const catalog = connectorRegistry.listCatalog();
  assert.equal(catalog.length, 4);
  assert.equal(catalog.find((item) => item.key === 'github')?.oauth?.supported, true);
  assert.equal(catalog.find((item) => item.key === 'slack')?.available, true);
  assert.equal(catalog.find((item) => item.key === 'notion')?.available, true);
});

test('connector registry materializes local and remote MCP configs', () => {
  const githubConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'github',
    account: buildAccount('github', { accessToken: 'gh-token' }),
  });
  assert.equal(githubConfig.type, 'local');
  assert.equal(githubConfig.environment?.GITHUB_PERSONAL_ACCESS_TOKEN, 'gh-token');

  const postgresConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'postgres',
    account: buildAccount('postgres', {
      dsn: 'postgresql://user:pass@db.example.com:5432/prod',
    }),
  });
  assert.equal(postgresConfig.type, 'local');
  assert.equal(postgresConfig.command[3], 'postgresql://user:pass@db.example.com:5432/prod');

  const slackConfig = connectorRegistry.materializeRuntimeConfig({
    connectorKey: 'slack',
    account: buildAccount('slack', { accessToken: 'slack-token' }),
  });
  assert.equal(slackConfig.type, 'remote');
  assert.equal(slackConfig.headers?.Authorization, 'Bearer slack-token');
});

test('connector registry fails fast when remote adapter is unavailable', () => {
  delete process.env.SLACK_MCP_REMOTE_URL;
  assert.throws(() => {
    connectorRegistry.materializeRuntimeConfig({
      connectorKey: 'slack',
      account: buildAccount('slack', { accessToken: 'slack-token' }),
    });
  }, /adapter/);
});
