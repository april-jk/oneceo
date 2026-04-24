import assert from 'node:assert/strict';

import { AltusManagedToolRuntime } from '../src/services/altus-managed-tool-runtime';
import { listPlatformSkillGovernanceOptions } from '../src/services/platform-skill-governance-options';
import type { ManagedSkillCatalogEntry } from '../src/services/altus-managed-shared';
import { userSkillService } from '../src/services/user-skill-service';
import { sandboxSkillSyncService } from '../src/services/sandbox-skill-sync-service';
import { altusManagedDeploymentToolService } from '../src/services/altus-managed-deployment-tool-service';

async function main() {
  const options = listPlatformSkillGovernanceOptions();
  assert.equal(options.systemRoles.some((item) => item.value === 'deployment_orchestrator'), true);
  assert.equal(options.toolNames.some((item) => item.value === 'deploy_application'), true);

  const availableSkill: ManagedSkillCatalogEntry = {
    sourceType: 'platform',
    skillId: 'deploy-skill-1',
    revisionId: 'deploy-rev-1',
    slug: 'deployment-orchestrator',
    name: '部署编排',
    description: '自动处理部署工作流',
    category: 'deployment',
    revisionNumber: 1,
    governance: {
      systemRole: 'deployment_orchestrator',
      adminManaged: true,
      required: true,
      autoActivation: {
        enabled: true,
        triggers: ['deploy'],
        toolNames: ['deploy_application'],
      },
    },
    resourceSummary: null,
  };

  const originalResolve = userSkillService.resolveSelectionsForSession.bind(userSkillService);
  const originalSync = sandboxSkillSyncService.syncResolvedSkills.bind(sandboxSkillSyncService);
  const originalDeployExecute = altusManagedDeploymentToolService.execute.bind(altusManagedDeploymentToolService);

  try {
    userSkillService.resolveSelectionsForSession = (async () => [
      {
        ...availableSkill,
        renderedMarkdown: '# deployment-orchestrator',
      },
    ]) as typeof userSkillService.resolveSelectionsForSession;

    sandboxSkillSyncService.syncResolvedSkills = (async () => ({
      taskSessionId: 'session-1',
      orchestratorSessionId: 'sandbox-1',
      signature: 'sig-1',
      restartTriggered: true,
      changed: true,
      items: [],
      syncedAt: new Date().toISOString(),
    })) as typeof sandboxSkillSyncService.syncResolvedSkills;

    altusManagedDeploymentToolService.execute = (async () => ({
      action: 'deploy_application',
      status: 'success',
      summary: 'deployment ok',
      deploymentId: 'deploy-1',
      projectId: 'project-1',
      environmentId: 'env-1',
      projectName: 'sample-project',
      projectDomain: 'sample.oneceo.test',
    })) as typeof altusManagedDeploymentToolService.execute;

    const runtime = new AltusManagedToolRuntime({
      sessionId: 'session-1',
      userId: 'user-1',
      sandboxId: 'sandbox-1',
      workspaceRoot: '/workspace/session-1',
      availableSkills: [availableSkill],
      activeSkills: [],
      mcpProviders: [],
    });

    const result = await runtime.execute('deploy_application', {
      notes: '帮我部署当前项目',
    });

    assert.equal(result.type, 'result');
    assert.deepEqual(
      result.activatedSkills?.map((item) => item.slug),
      ['deployment-orchestrator'],
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          verifiedAt: new Date().toISOString(),
          systemRoles: options.systemRoles.map((item) => item.value),
          deploymentToolAutoAttachedSkill: result.activatedSkills?.map((item) => item.slug) || [],
        },
        null,
        2,
      ),
    );
  } finally {
    userSkillService.resolveSelectionsForSession = originalResolve as typeof userSkillService.resolveSelectionsForSession;
    sandboxSkillSyncService.syncResolvedSkills = originalSync as typeof sandboxSkillSyncService.syncResolvedSkills;
    altusManagedDeploymentToolService.execute =
      originalDeployExecute as typeof altusManagedDeploymentToolService.execute;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
