import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  customApiDefinitionDAO,
  customApiEndpointToolDAO,
  taskSessionConnectorBindingDAO,
} from '../src/db/dao';
import { customApiMcpToolService, buildCustomApiToolName, parseCustomApiToolName } from '../src/services/custom-api-mcp-tool-service';

test('custom API MCP tool names are stable and parseable', () => {
  const toolName = buildCustomApiToolName('CRM Hub', 'Get Customer');
  assert.equal(toolName, 'custom_api__crm_hub__get_customer');
  assert.deepEqual(parseCustomApiToolName(toolName), {
    definitionSlug: 'crm_hub',
    toolSlug: 'get_customer',
  });
});

test('custom API MCP tools expose only published endpoint tools explicitly selected for the session', async () => {
  const bindingMock = mock.method(
    taskSessionConnectorBindingDAO,
    'getByTaskSessionAndConnectorKey',
    async () =>
      ({
        desiredState: 'attached',
        sessionConfigJson: {
          definitionId: 'definition-1',
          endpointToolIds: ['tool-1'],
        },
      }) as any
  );
  const definitionMock = mock.method(
    customApiDefinitionDAO,
    'getById',
    async () =>
      ({
        id: 'definition-1',
        slug: 'crm_hub',
        status: 'active',
      }) as any
  );
  const toolsMock = mock.method(
    customApiEndpointToolDAO,
    'listByDefinition',
    async () =>
      [
        {
          id: 'tool-1',
          definitionId: 'definition-1',
          toolSlug: 'get_customer',
          displayName: 'Get customer',
          description: 'Read a customer profile',
          method: 'GET',
          inputSchemaJson: {
            type: 'object',
            additionalProperties: false,
            properties: {
              customerId: { type: 'string', maxLength: 64 },
            },
          },
          riskLevel: 'low',
          computedRiskLevel: 'low',
          confirmationPolicy: 'none',
          operationType: 'read',
          reviewStatus: 'published',
        },
        {
          id: 'tool-2',
          definitionId: 'definition-1',
          toolSlug: 'delete_customer',
          displayName: 'Delete customer',
          description: 'Delete a customer',
          method: 'DELETE',
          inputSchemaJson: { type: 'object', additionalProperties: false, properties: {} },
          riskLevel: 'high',
          computedRiskLevel: 'high',
          confirmationPolicy: 'require_admin_approved_template',
          operationType: 'delete',
          reviewStatus: 'published',
        },
        {
          id: 'tool-3',
          definitionId: 'definition-1',
          toolSlug: 'draft_customer',
          displayName: 'Draft customer',
          description: 'Draft endpoint',
          method: 'GET',
          inputSchemaJson: { type: 'object', additionalProperties: false, properties: {} },
          riskLevel: 'low',
          computedRiskLevel: 'low',
          confirmationPolicy: 'none',
          operationType: 'read',
          reviewStatus: 'draft',
        },
      ] as any
  );

  try {
    const tools = await customApiMcpToolService.listToolsForSession('task-session-1');

    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'custom_api__crm_hub__get_customer');
    assert.equal(tools[0].metadata.endpointToolId, 'tool-1');
    assert.deepEqual(tools[0].inputSchema, {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', maxLength: 64 },
      },
    });
  } finally {
    bindingMock.mock.restore();
    definitionMock.mock.restore();
    toolsMock.mock.restore();
  }
});

test('custom API MCP tools are empty when the session has no explicit endpoint subset', async () => {
  const bindingMock = mock.method(
    taskSessionConnectorBindingDAO,
    'getByTaskSessionAndConnectorKey',
    async () =>
      ({
        desiredState: 'attached',
        sessionConfigJson: {
          definitionId: 'definition-1',
          endpointToolIds: [],
        },
      }) as any
  );
  const definitionMock = mock.method(
    customApiDefinitionDAO,
    'getById',
    async () =>
      ({
        id: 'definition-1',
        slug: 'crm_hub',
        status: 'active',
      }) as any
  );
  const toolsMock = mock.method(
    customApiEndpointToolDAO,
    'listByDefinition',
    async () =>
      [
        {
          id: 'tool-1',
          definitionId: 'definition-1',
          toolSlug: 'get_customer',
          displayName: 'Get customer',
          method: 'GET',
          inputSchemaJson: { type: 'object', additionalProperties: false, properties: {} },
          riskLevel: 'low',
          computedRiskLevel: 'low',
          confirmationPolicy: 'none',
          operationType: 'read',
          reviewStatus: 'published',
        },
      ] as any
  );

  try {
    const tools = await customApiMcpToolService.listToolsForSession('task-session-1');
    assert.deepEqual(tools, []);
  } finally {
    bindingMock.mock.restore();
    definitionMock.mock.restore();
    toolsMock.mock.restore();
  }
});
