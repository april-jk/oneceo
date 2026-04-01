import { Router } from 'express';
import type { OsacReleaseManagementService } from '../services/osac-release-management-service';
import { asyncHandler, ok } from '../utils/http';

export function createOsacReleaseRoutes(service: OsacReleaseManagementService) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const result = await service.listReleases({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
      });
      return ok(res, result);
    })
  );

  router.get(
    '/:releaseId',
    asyncHandler(async (req, res) => {
      const result = await service.getRelease(req.params.releaseId);
      return ok(res, result);
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const fileBase64 = typeof req.body?.fileBase64 === 'string' ? req.body.fileBase64 : '';
      if (!fileBase64.trim()) {
        throw new Error('缺少 OSAC 二进制文件');
      }
      const result = await service.uploadRelease({
        version: typeof req.body?.version === 'string' ? req.body.version : '',
        releaseNotes: typeof req.body?.releaseNotes === 'string' ? req.body.releaseNotes : undefined,
        sourceCommit: typeof req.body?.sourceCommit === 'string' ? req.body.sourceCommit : undefined,
        uploadedBy: typeof req.body?.uploadedBy === 'string' ? req.body.uploadedBy : 'admin_management',
        channel: typeof req.body?.channel === 'string' ? req.body.channel : undefined,
        fileBase64,
      });
      res.status(201);
      return ok(res, result);
    })
  );

  router.post(
    '/:releaseId/validate',
    asyncHandler(async (req, res) => {
      const result = await service.validateRelease(req.params.releaseId);
      return ok(res, result);
    })
  );

  router.post(
    '/:releaseId/publish',
    asyncHandler(async (req, res) => {
      const result = await service.publishRelease(
        req.params.releaseId,
        typeof req.body?.publishedBy === 'string' ? req.body.publishedBy : 'admin_management'
      );
      return ok(res, result);
    })
  );

  router.post(
    '/:releaseId/rollback',
    asyncHandler(async (req, res) => {
      const result = await service.rollbackRelease(
        req.params.releaseId,
        typeof req.body?.publishedBy === 'string' ? req.body.publishedBy : 'admin_management'
      );
      return ok(res, result);
    })
  );

  return router;
}
