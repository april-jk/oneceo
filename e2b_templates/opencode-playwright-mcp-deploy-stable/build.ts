import { Template, defaultBuildLogger } from 'e2b';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildTemplate } from './template';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../apps/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env') });

async function main() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }

  const templateName = process.env.E2B_TEMPLATE_NAME || 'opencode-browseruse-playwright-mcp-stable';
  const patchUrl = await resolvePatchUrl();
  const osacSpec = await resolveOsacBuildSpec();

  const template = buildTemplate({
    patchUrl,
    osacDownloadUrl: osacSpec.presignedUrl,
    osacSha256: osacSpec.sha256,
    osacVersion: osacSpec.version,
  });

  await Template.build(template, templateName, {
    cpuCount: 2,
    memoryMB: 4096,
    onBuildLogs: defaultBuildLogger(),
  });
}

async function resolveOsacBuildSpec() {
  const explicitUrl = process.env.E2B_TEMPLATE_OSAC_URL?.trim();
  const explicitSha256 = process.env.E2B_TEMPLATE_OSAC_SHA256?.trim();
  const explicitVersion = process.env.E2B_TEMPLATE_OSAC_VERSION?.trim();
  if (explicitUrl && explicitSha256) {
    return {
      presignedUrl: explicitUrl,
      sha256: explicitSha256,
      version: explicitVersion || 'custom',
    };
  }

  const { platformRuntimeArtifactService } = await import(
    '../../apps/api/src/services/platform-runtime-artifact-service'
  );
  const { getPresignedDownloadUrl } = await import('../../apps/api/src/services/r2-client');
  const published = await platformRuntimeArtifactService.getPublishedOsacDownloadSpec();
  const expiresIn = Number(process.env.E2B_TEMPLATE_OSAC_EXPIRES || 60 * 60 * 24 * 7);
  return {
    presignedUrl: await getPresignedDownloadUrl(published.objectKey, expiresIn),
    sha256: published.sha256,
    version: published.version,
  };
}

async function resolvePatchUrl(): Promise<string | undefined> {
  const explicit = process.env.NEKO_UI_PATCH_URL;
  if (explicit) {
    return explicit;
  }

  const patchPath =
    process.env.NEKO_UI_PATCH_PATH ||
    path.resolve(__dirname, '..', 'opencode-playwright-mcp', 'patches', 'neko-client-minimal.patch');
  const patchKey = process.env.NEKO_UI_PATCH_KEY || 'neko-ui/neko-client-minimal.patch';
  const expiresIn = Number(process.env.NEKO_UI_PATCH_EXPIRES || 60 * 60 * 24 * 7);

  const patchBuffer = await readFile(patchPath);
  const { uploadToR2, getPresignedDownloadUrl } = await import(
    '../../apps/api/src/services/r2-client'
  );
  await uploadToR2(patchKey, patchBuffer);
  return getPresignedDownloadUrl(patchKey, expiresIn);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
