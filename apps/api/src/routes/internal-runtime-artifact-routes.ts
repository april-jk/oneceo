import express from 'express';
import { getPublicErrorMessage } from '../utils/error-response';
import { platformRuntimeArtifactService } from '../services/platform-runtime-artifact-service';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireInternalToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configured = asText(process.env.ONECEO_INTERNAL_TOKEN);
  if (!configured) {
    next();
    return;
  }
  const incoming = asText(req.header('x-oneceo-internal-token'));
  if (incoming !== configured) {
    res.status(401).json({
      success: false,
      error: getPublicErrorMessage('未授权的内部请求'),
    });
    return;
  }
  next();
}

router.use(requireInternalToken);

router.get('/runtime-artifacts/osac/releases', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.listOsacReleases({
      status: asText(req.query.status),
      query: asText(req.query.query),
      channel: asText(req.query.channel),
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 OSAC releases 失败'),
    });
  }
});

router.get('/runtime-artifacts/osac/releases/:releaseId', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.getOsacRelease(req.params.releaseId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 OSAC release 失败'),
    });
  }
});

router.post('/runtime-artifacts/osac/releases', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.uploadOsacRelease({
      version: req.body?.version,
      fileBase64: req.body?.fileBase64,
      releaseNotes: req.body?.releaseNotes,
      sourceCommit: req.body?.sourceCommit,
      uploadedBy: asText(req.body?.uploadedBy) || 'admin_management',
      channel: req.body?.channel,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '上传 OSAC release 失败'),
    });
  }
});

router.post('/runtime-artifacts/osac/releases/:releaseId/validate', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.validateOsacRelease(req.params.releaseId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '校验 OSAC release 失败'),
    });
  }
});

router.post('/runtime-artifacts/osac/releases/:releaseId/publish', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.publishOsacRelease(
      req.params.releaseId,
      asText(req.body?.publishedBy) || 'admin_management'
    );
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '发布 OSAC release 失败'),
    });
  }
});

router.post('/runtime-artifacts/osac/releases/:releaseId/rollback', async (req, res) => {
  try {
    const data = await platformRuntimeArtifactService.rollbackOsacRelease(
      req.params.releaseId,
      asText(req.body?.publishedBy) || 'admin_management'
    );
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '回滚 OSAC release 失败'),
    });
  }
});

export default router;
