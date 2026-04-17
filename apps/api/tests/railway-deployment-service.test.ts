import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRailwayBindingUnavailablePanel,
  classifyRailwayDeploymentError,
  isRailwayBindingNotFoundError,
  resolveRailwaySelectedDeploymentId,
  type RailwayDeploymentListItem,
} from '../src/services/railway-deployment-service';

function makeDeployment(id: string): RailwayDeploymentListItem {
  return {
    id,
    status: 'SUCCESS',
    createdAt: '2026-04-17T10:32:00.000Z',
  };
}

test('resolveRailwaySelectedDeploymentId keeps requested deployment when it still exists', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_old',
    deployments,
    fallbackDeploymentId: 'dep_latest',
  });

  assert.equal(result, 'dep_old');
});

test('resolveRailwaySelectedDeploymentId falls back when requested deployment is stale', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_missing',
    deployments,
    fallbackDeploymentId: 'dep_old',
  });

  assert.equal(result, 'dep_old');
});

test('resolveRailwaySelectedDeploymentId ignores stale fallback deployment ids', () => {
  const deployments = [makeDeployment('dep_latest'), makeDeployment('dep_old')];

  const result = resolveRailwaySelectedDeploymentId({
    requestedDeploymentId: 'dep_missing',
    deployments,
    fallbackDeploymentId: 'dep_stale',
  });

  assert.equal(result, 'dep_latest');
});

test('isRailwayBindingNotFoundError matches deleted railway resource messages', () => {
  assert.equal(isRailwayBindingNotFoundError('Project not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Environment not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Service not found'), true);
  assert.equal(isRailwayBindingNotFoundError('Deployment not found'), false);
});

test('buildRailwayBindingUnavailablePanel returns recoverable unconfigured panel state', () => {
  const panel = buildRailwayBindingUnavailablePanel({
    binding: {
      token: 'token',
      tokenKind: 'project',
      projectId: 'prj_123',
      environmentId: 'env_123',
      serviceId: 'svc_123',
      projectName: 'Demo Project',
      environmentName: 'production',
      serviceName: 'web',
    },
    providerErrorCode: 'railway_project_not_found',
    reason: '当前部署绑定的 Railway Project 已不存在，请重新发布以重建部署资源。',
  });

  assert.equal(panel.configured, false);
  assert.equal(panel.canDeploy, true);
  assert.equal(panel.bindingState, 'repair_required');
  assert.equal(panel.providerErrorCode, 'railway_project_not_found');
  assert.equal(panel.projectId, 'prj_123');
  assert.equal(panel.environmentId, 'env_123');
  assert.equal(panel.serviceId, 'svc_123');
  assert.equal(panel.message, '当前部署绑定的 Railway Project 已不存在，请重新发布以重建部署资源。');
  assert.deepEqual(panel.deployments, []);
  assert.deepEqual(panel.logs, []);
});

test('classifyRailwayDeploymentError returns repairable classification for missing project', () => {
  const result = classifyRailwayDeploymentError('Project not found');

  assert.equal(result.code, 'railway_project_not_found');
  assert.equal(result.bindingState, 'repair_required');
  assert.match(result.userMessage, /Railway Project 已不存在/);
});

test('classifyRailwayDeploymentError returns repairable classification for repo access denial', () => {
  const result = classifyRailwayDeploymentError('Railway 当前无权访问目标 GitHub 仓库。');

  assert.equal(result.code, 'railway_repo_access_denied');
  assert.equal(result.bindingState, 'repair_required');
});
