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

function toPublicVoiceErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (!raw) {
    return '语音识别暂时不可用';
  }
  if (
    /volcengine|x-api-|websocket|asr/i.test(raw) ||
    raw.includes('语音识别未配置')
  ) {
    return '语音识别服务暂时不可用';
  }
  return raw;
}

function normalizeClientTranscript(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveVoiceErrorStatus(error: unknown): number {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (
    raw.includes('缺少语音文件') ||
    raw.includes('语音文件不能超过') ||
    raw.includes('一次只能上传一个语音文件')
  ) {
    return 400;
  }
  if (raw.includes('无法识别当前用户')) {
    return 401;
  }
  if (
    raw.includes('语音输入暂未配置') ||
    raw.includes('语音识别未配置')
  ) {
    return 503;
  }
  return 502;
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
    currentUserResolver.require(req);
    const clientTranscript = normalizeClientTranscript(
      req.body?.clientTranscript,
    );
    const speechService = getVolcengineSpeechService();
    if (!speechService && !clientTranscript) {
      return res.status(503).json({
        success: false,
        error: '语音输入暂未配置',
      });
    }

    const audioFile = req.file;
    if (!audioFile?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: '缺少语音文件',
      });
    }

    if (!speechService) {
      return res.json({
        success: true,
        data: { text: clientTranscript },
      });
    }

    let transcript;
    try {
      transcript = await speechService.transcribeAudio(
        new Uint8Array(audioFile.buffer),
      );
    } catch (speechError) {
      console.warn('[TASK_CREATION_VOICE_TRANSCRIBE_FALLBACK]', speechError);
      if (!clientTranscript) {
        throw speechError;
      }
      transcript = { text: clientTranscript };
    }

    return res.json({
      success: true,
      data: transcript,
    });
  } catch (error: any) {
    const authError = resolveCurrentUserError(error);
    console.error('[TASK_CREATION_VOICE_TRANSCRIBE_FAILED]', error);
    return res.status(authError?.status || resolveVoiceErrorStatus(error)).json({
      success: false,
      error: getPublicErrorMessage(
        authError?.message || toPublicVoiceErrorMessage(error) || '语音转写失败',
      ),
    });
  }
});

router.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[TASK_CREATION_VOICE_ROUTE_ERROR]', error);
    return res.status(resolveVoiceErrorStatus(error)).json({
      success: false,
      error: getPublicErrorMessage(
        toPublicVoiceErrorMessage(error) || '语音转写失败',
      ),
    });
  },
);

export default router;
