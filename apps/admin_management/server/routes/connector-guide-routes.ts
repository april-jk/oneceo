import { Router } from 'express';
import type { ConnectorGuideManagementService } from '../services/connector-guide-management-service';
import { asyncHandler, ok } from '../utils/http';

export function createConnectorGuideRoutes(service: ConnectorGuideManagementService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.listPolicies({
        connectorKey: typeof req.query.connectorKey === 'string' ? req.query.connectorKey : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
      });
      return ok(res, result);
    })
  );

  router.get(
    '/catalog-summary',
    asyncHandler(async (_req, res) => {
      const result = await service.getCatalogSummary();
      return ok(res, result);
    })
  );

  router.get(
    '/:policyId',
    asyncHandler(async (req, res) => {
      const result = await service.getPolicy(req.params.policyId);
      return ok(res, result);
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.createPolicy(req.body || {});
      res.status(201);
      return ok(res, result);
    })
  );

  router.put(
    '/:policyId',
    asyncHandler(async (req, res) => {
      const result = await service.updatePolicy(req.params.policyId, req.body || {});
      return ok(res, result);
    })
  );

  router.post(
    '/:policyId/revisions',
    asyncHandler(async (req, res) => {
      const result = await service.createRevision(req.params.policyId, req.body || {});
      res.status(201);
      return ok(res, result);
    })
  );

  router.get(
    '/:policyId/revisions/:revisionId',
    asyncHandler(async (req, res) => {
      const result = await service.getRevision(req.params.policyId, req.params.revisionId);
      return ok(res, result);
    })
  );

  router.put(
    '/:policyId/revisions/:revisionId',
    asyncHandler(async (req, res) => {
      const result = await service.updateRevision(req.params.policyId, req.params.revisionId, req.body || {});
      return ok(res, result);
    })
  );

  router.post(
    '/:policyId/revisions/:revisionId/validate',
    asyncHandler(async (req, res) => {
      const result = await service.validateRevision(req.params.policyId, req.params.revisionId);
      return ok(res, result);
    })
  );

  router.post(
    '/:policyId/revisions/:revisionId/publish',
    asyncHandler(async (req, res) => {
      const result = await service.publishRevision(req.params.policyId, req.params.revisionId);
      return ok(res, result);
    })
  );

  router.post(
    '/:policyId/revisions/:revisionId/rollback',
    asyncHandler(async (req, res) => {
      const result = await service.rollbackRevision(req.params.policyId, req.params.revisionId);
      return ok(res, result);
    })
  );

  return router;
}
