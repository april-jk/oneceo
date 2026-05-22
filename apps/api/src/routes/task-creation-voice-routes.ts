import express from 'express';
import multer from 'multer';
import { currentUserResolver } from '../services/current-user-resolver';
import { getPublicErrorMessage } from '../utils/error-response';
import { getVolcengineSpeechService } from '../services/volcengine-speech-service';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

function resolveCurrentUserError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('无法识别当前用户')) {
    return { status: 401, message };
  }
  return null;
}

function runUploadMiddleware(req: express.Request, res: express.Response) {
  return new Promise<void>((resolve, reject) => {
    upload.single('audio')(req, res, (error) => {
      if (!error) {
        resolve();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          reject(new Error('语音文件不能超过 10 MB'));
          return;
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          reject(new Error('一次只能上传一个语音文件'));
          return;
        }
      }
      reject(error);
    });
  });
}

router.post('/transcribe', async (req, res) => {
  try {
    await runUploadMiddleware(req, res);
    const currentUser = currentUserResolver.require(req);
    const speechService = getVolcengineSpeechService();
    if (!speechService) {
      return res.status(503).json({
        success: false,
        error: '火山语音识别未配置',
      });
    }

    const audioFile = req.file;
    if (!audioFile?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: '缺少语音文件',
      });
    }

    const transcript = await speechService.transcribeAudio(
      new Uint8Array(audioFile.buffer),
      `oneceo-${currentUser.userId}`,
    );

    return res.json({
      success: true,
      data: transcript,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[TASK_CREATION_VOICE_TRANSCRIBE_FAILED]', error);
    return res.status(authError?.status || 400).json({
      success: false,
      error: getPublicErrorMessage(
        authError?.message || error?.message || '语音转写失败',
      ),
    });
  }
});

export default router;
