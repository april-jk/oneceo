import { Router } from 'express';
import type { SkillManagementService } from '../services/skill-management-service';
import { asyncHandler, ok } from '../utils/http';

export function createSkillManagementRoutes(service: SkillManagementService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.listSkills({
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
      });
      return ok(res, result);
    })
  );

  router.get(
    '/:skillId',
    asyncHandler(async (req, res) => {
      const result = await service.getSkill(req.params.skillId);
      return ok(res, result);
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.createSkill(req.body || {});
      res.status(201);
      return ok(res, result);
    })
  );

  router.put(
    '/:skillId',
    asyncHandler(async (req, res) => {
      const result = await service.updateSkill(req.params.skillId, req.body || {});
      return ok(res, result);
    })
  );

  router.post(
    '/:skillId/archive',
    asyncHandler(async (req, res) => {
      const result = await service.archiveSkill(req.params.skillId);
      return ok(res, result);
    })
  );

  router.post(
    '/:skillId/activate',
    asyncHandler(async (req, res) => {
      const result = await service.activateSkill(req.params.skillId);
      return ok(res, result);
    })
  );

  router.get(
    '/:skillId/revisions',
    asyncHandler(async (req, res) => {
      const result = await service.listRevisions(req.params.skillId);
      return ok(res, result);
    })
  );

  router.get(
    '/:skillId/revisions/:revisionId/rendered',
    asyncHandler(async (req, res) => {
      const result = await service.getRenderedRevision(req.params.skillId, req.params.revisionId);
      return ok(res, result);
    })
  );

  router.post(
    '/:skillId/revisions/:revisionId/validate',
    asyncHandler(async (req, res) => {
      const result = await service.validateRevision(
        req.params.skillId,
        req.params.revisionId,
        typeof req.body?.sessionId === 'string' ? req.body.sessionId : ''
      );
      return ok(res, result);
    })
  );

  return router;
}
