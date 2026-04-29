import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildTaskSessionProjectProfileFromDirectory } from '../src/services/task-session-project-profile-service';

test('project profile detects vite frontend runtime and deployment commands', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-profile-vite-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        scripts: {
          build: 'vite build',
          start: 'node server.js',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.0.0',
          vite: '^7.0.0',
        },
      }),
      'utf-8'
    );
    await writeFile(
      join(workspace, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf-8'
    );

    const profile = await buildTaskSessionProjectProfileFromDirectory(workspace, {
      sessionId: 'session-1',
      compliance: null,
    });

    assert.equal(profile.sessionId, 'session-1');
    assert.equal(profile.runtimeFamily, 'frontend_dist');
    assert.equal(profile.artifactType, 'web_app');
    assert.equal(profile.commands.build, 'vite build');
    assert.equal(profile.commands.start, 'node server.js');
    assert.equal(profile.commands.preview, 'vite preview');
    assert.equal(profile.analyticsStatus, 'platform_injectable');
    assert.equal(profile.configFiles.packageJson, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('project profile treats php html entry as platform injectable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-profile-php-'));
  try {
    await writeFile(
      join(workspace, 'index.php'),
      '<?php $title = "Demo"; ?><!doctype html><html><body>Demo</body></html>',
      'utf-8'
    );

    const profile = await buildTaskSessionProjectProfileFromDirectory(workspace, {
      compliance: null,
    });

    assert.equal(profile.runtimeFamily, 'php');
    assert.equal(profile.artifactType, 'web_app');
    assert.equal(profile.analyticsStatus, 'platform_injectable');
    assert.deepEqual(profile.entrypoints.some((item) => item.path === 'index.php'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('project profile detects java project without marking it ready by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneceo-profile-java-'));
  try {
    await writeFile(
      join(workspace, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion></project>',
      'utf-8'
    );

    const profile = await buildTaskSessionProjectProfileFromDirectory(workspace, {
      compliance: null,
    });

    assert.equal(profile.runtimeFamily, 'java');
    assert.equal(profile.deployability, 'repairable');
    assert.equal(profile.configFiles.pomXml, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
