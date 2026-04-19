import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManagedToolDefinitions, asText } from '../src/services/altus-managed-shared';
import { listPlatformSkillGovernanceOptions } from '../src/services/platform-skill-governance-options';

test('platform skill governance options expose all managed tool names and known system roles', () => {
  const options = listPlatformSkillGovernanceOptions();
  const toolNames = new Set(options.toolNames.map((item) => item.value));
  const roleNames = new Set(options.systemRoles.map((item) => item.value));

  for (const tool of buildManagedToolDefinitions()) {
    const functionRecord =
      tool && typeof tool === 'object' && !Array.isArray(tool) && tool.function && typeof tool.function === 'object'
        ? (tool.function as Record<string, unknown>)
        : null;
    const name = asText(functionRecord?.name);
    if (!name) continue;
    assert.equal(toolNames.has(name), true, `missing governance option for tool ${name}`);
  }

  assert.equal(roleNames.has('deployment_orchestrator'), true);
  assert.equal(roleNames.has('ppt_builder'), true);
  assert.equal(roleNames.has('docx_builder'), true);
  assert.equal(roleNames.has('xlsx_builder'), true);
});
