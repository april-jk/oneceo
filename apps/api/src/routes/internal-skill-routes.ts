import express from 'express';
import { getPublicErrorMessage } from '../utils/error-response';
import { platformSkillService } from '../services/platform-skill-service';
import { platformSkillImportService } from '../services/platform-skill-import-service';
import { platformSkillImportJobService } from '../services/platform-skill-import-job-service';
import { sandboxSkillSyncService } from '../services/sandbox-skill-sync-service';

const router = express.Router();

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseResources(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      resourcePath: item?.resourcePath,
      resourceType: item?.resourceType,
      contentMarkdown: item?.contentMarkdown,
    }))
    .filter((item) => asText(item.resourcePath) && asText(item.contentMarkdown));
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

router.post('/skills/import/folder-preview', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const data = platformSkillImportService.parseFolderImport({
      rootFolderName: asText(req.body?.rootFolderName) || 'imported-skill',
      files: files.map((item) => ({
        relativePath: item?.relativePath,
        content: item?.content,
      })),
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '导入 skill 文件夹预览失败'),
    });
  }
});

router.post('/skills/import/folder', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const data = await platformSkillService.importSkillFolder({
      rootFolderName: asText(req.body?.rootFolderName) || 'imported-skill',
      files: files.map((item) => ({
        relativePath: item?.relativePath,
        content: item?.content,
      })),
      createdBy: asText(req.body?.createdBy) || 'admin_management',
      skillId: asText(req.body?.skillId) || null,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '导入 skill 文件夹失败'),
    });
  }
});

router.post('/skills/import/folder-jobs', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const data = await platformSkillImportJobService.start({
      rootFolderName: asText(req.body?.rootFolderName) || 'imported-skill',
      files: files.map((item) => ({
        relativePath: item?.relativePath,
        content: item?.content,
      })),
      createdBy: asText(req.body?.createdBy) || 'admin_management',
      skillId: asText(req.body?.skillId) || null,
    });
    return res.status(202).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建 skill 文件夹导入任务失败'),
    });
  }
});

router.get('/skills/import/folder-jobs/:jobId', async (req, res) => {
  const data = platformSkillImportJobService.get(req.params.jobId);
  if (!data) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage('导入任务不存在'),
    });
  }
  return res.json({ success: true, data });
});

router.get('/skills', async (req, res) => {
  try {
    const data = await platformSkillService.listAdminSkills({
      query: asText(req.query.query),
      status: asText(req.query.status),
      category: asText(req.query.category),
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 skills 失败'),
    });
  }
});

router.get('/skills/:skillId', async (req, res) => {
  try {
    const data = await platformSkillService.getAdminSkill(req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 skill 失败'),
    });
  }
});

router.post('/skills', async (req, res) => {
  try {
    const data = await platformSkillService.createSkill({
      slug: req.body?.slug,
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      bodyMarkdown: req.body?.bodyMarkdown,
      resources: parseResources(req.body?.resources),
      createdBy: asText(req.body?.createdBy) || 'admin_management',
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '创建 skill 失败'),
    });
  }
});

router.put('/skills/:skillId', async (req, res) => {
  try {
    const data = await platformSkillService.updateSkill(req.params.skillId, {
      name: req.body?.name,
      description: req.body?.description,
      category: req.body?.category,
      bodyMarkdown: req.body?.bodyMarkdown,
      resources: parseResources(req.body?.resources),
      createdBy: asText(req.body?.createdBy) || 'admin_management',
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '更新 skill 失败'),
    });
  }
});

router.post('/skills/:skillId/archive', async (req, res) => {
  try {
    const data = await platformSkillService.archiveSkill(req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '归档 skill 失败'),
    });
  }
});

router.post('/skills/:skillId/activate', async (req, res) => {
  try {
    const data = await platformSkillService.activateSkill(req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '启用 skill 失败'),
    });
  }
});

router.get('/skills/:skillId/revisions', async (req, res) => {
  try {
    const data = await platformSkillService.listSkillRevisions(req.params.skillId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 revisions 失败'),
    });
  }
});

router.get('/skills/:skillId/revisions/:revisionId/rendered', async (req, res) => {
  try {
    const rendered = await platformSkillService.renderRevisionById(req.params.skillId, req.params.revisionId);
    return res.json({
      success: true,
      data: {
        skillId: rendered.skill.id,
        revisionId: rendered.revision.id,
        revisionNumber: rendered.revision.revisionNumber,
        slug: rendered.revision.slugSnapshot,
        renderedMarkdown: rendered.renderedMarkdown,
        signature: rendered.signature,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '渲染 revision 失败'),
    });
  }
});

router.get('/skills/:skillId/revisions/:revisionId/resources', async (req, res) => {
  try {
    const data = await platformSkillService.listRevisionResources(req.params.skillId, req.params.revisionId);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || '获取 revision resources 失败'),
    });
  }
});

router.post('/skills/:skillId/revisions/:revisionId/validate', async (req, res) => {
  try {
    const sessionId = asText(req.body?.sessionId);
    if (!sessionId) {
      throw new Error('sessionId 不能为空');
    }
    const data = await sandboxSkillSyncService.syncPlatformRevisionForValidation({
      taskSessionId: sessionId,
      skillId: req.params.skillId,
      revisionId: req.params.revisionId,
    });
    const first = data.items[0];
    return res.json({
      success: true,
      data: {
        sessionId,
        skillId: req.params.skillId,
        revisionId: req.params.revisionId,
        slug: first?.slug || null,
        skillPath: first?.skillPath || null,
        signature: data.signature,
        restartTriggered: data.restartTriggered,
        syncedAt: data.syncedAt,
      },
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: getPublicErrorMessage(error?.message || 'sandbox 验证失败'),
    });
  }
});

export default router;
