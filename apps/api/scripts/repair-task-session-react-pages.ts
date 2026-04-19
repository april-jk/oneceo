import '../src/config/env';

import { taskCreationSessionDAO } from '../src/db/dao';
import { taskCreationFileMemoryStore } from '../src/agents/task-creation/file-memory-store';
import { e2bConnector } from '../src/connectors/e2b-connector';
import { resolveOpencodeWorkspacePath } from '../src/utils/opencode-workspace';
import {
  executeTaskSessionDeploymentAction,
  resolveTaskSessionEnvironment,
} from '../src/services/task-session-deployment-runtime-service';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const PAGE_TEMPLATES: Record<string, string> = {
  ProductsPage: `import React from 'react';

const groups = [
  {
    title: 'Acrylic Sheets',
    items: ['Clear cast sheets', 'Colored panels', 'UV resistant outdoor sheets'],
  },
  {
    title: 'Retail Displays',
    items: ['Countertop stands', 'Cosmetics fixtures', 'Jewelry presentation sets'],
  },
  {
    title: 'Signage and Branding',
    items: ['Backlit letters', 'Wayfinding panels', 'Custom logo fabrication'],
  },
  {
    title: 'OEM Fabrication',
    items: ['CNC cutting', 'Diamond polishing', 'Assembly and export packing'],
  },
];

export default function ProductsPage() {
  return (
    <main className="page-shell">
      <section className="hero-section">
        <div className="container">
          <p className="section-kicker">Products</p>
          <h1>Engineered acrylic products for retail, interior, and brand projects.</h1>
          <p>
            We support custom thickness, color matching, laser cutting, polishing, bending, and export packaging
            for buyers who need stable production quality and responsive sampling.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid grid-2">
            {groups.map((group) => (
              <article key={group.title} className="card">
                <h2>{group.title}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
`,
  CompanyPage: `import React from 'react';

const metrics = [
  ['15+', 'years of acrylic manufacturing experience'],
  ['50+', 'countries served across North America, Europe, and the Middle East'],
  ['72h', 'average quotation turnaround for standard inquiries'],
];

export default function CompanyPage() {
  return (
    <main className="page-shell">
      <section className="hero-section">
        <div className="container">
          <p className="section-kicker">Company</p>
          <h1>Export-oriented acrylic manufacturing with stable delivery discipline.</h1>
          <p>
            We combine in-house fabrication, quality inspection, and shipment coordination to support wholesalers,
            brand teams, and project buyers who need reliable execution instead of sample-only suppliers.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid grid-3">
            {metrics.map(([value, label]) => (
              <article key={value} className="card">
                <strong>{value}</strong>
                <p>{label}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <div className="grid grid-2">
            <article className="card">
              <h2>Production workflow</h2>
              <p>Material confirmation, sampling, mass production, pre-shipment inspection, and export packaging.</p>
            </article>
            <article className="card">
              <h2>Quality control</h2>
              <p>Dimension checks, surface inspection, protective film verification, and carton drop-test review.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
`,
  ContactPage: `import React from 'react';

export default function ContactPage() {
  return (
    <main className="page-shell">
      <section className="hero-section">
        <div className="container">
          <p className="section-kicker">Contact</p>
          <h1>Send drawings, quantities, and target market details for a focused quotation.</h1>
          <p>
            Share material thickness, finish, packaging standard, and shipping destination. Our export team will
            respond with a practical sampling and production plan.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid grid-2">
            <article className="card">
              <h2>Business contact</h2>
              <p>Email: sales@oneceo-acrylic.example</p>
              <p>WhatsApp: +86 138 0000 0000</p>
              <p>Hours: Monday to Saturday, 09:00 to 19:00 CST</p>
            </article>
            <article className="card">
              <h2>Inquiry checklist</h2>
              <ul>
                <li>Product type and reference images</li>
                <li>Estimated order quantity</li>
                <li>Target market and compliance requirements</li>
                <li>Preferred trade term and delivery timeline</li>
              </ul>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
`,
};

async function readUtf8(sandboxId: string, filePath: string): Promise<string | null> {
  try {
    const bytes = await e2bConnector.readFile(sandboxId, filePath);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return null;
  }
}

function parseCommandResult(result: unknown) {
  const stdout = asText((result as any)?.stdout);
  const stderr = asText((result as any)?.stderr);
  const match = stdout.match(/__ONECEO_EXIT_CODE__=(\d+)/);
  const exitCode = match ? Number(match[1]) : null;
  const cleanedStdout = stdout.replace(/\n?__ONECEO_EXIT_CODE__=\d+\s*$/, '').trim();
  return { exitCode, stdout: cleanedStdout, stderr };
}

async function main() {
  const sessionId = asText(process.argv[2] || process.env.ONECEO_E2E_SESSION_ID);
  const shouldDeploy = hasFlag('--deploy');
  if (!sessionId) {
    throw new Error('missing task session id');
  }

  const fileSession = await taskCreationFileMemoryStore.getSession(sessionId);
  if (!fileSession) {
    throw new Error(`task session not found: ${sessionId}`);
  }

  const dbSession = await taskCreationSessionDAO.getSession(sessionId);
  const userId = asText(dbSession?.userId);
  if (!userId) {
    throw new Error(`task session missing userId: ${sessionId}`);
  }

  const { orchestratorSessionId, environment } = await resolveTaskSessionEnvironment({ session: fileSession });
  const sandboxId = asText(orchestratorSessionId);
  if (!sandboxId) {
    throw new Error(`task session missing sandbox binding: ${sessionId}`);
  }

  const workspaceRoot = asText(fileSession.runtime?.workspaceRoot) || resolveOpencodeWorkspacePath(sessionId);
  if (!workspaceRoot) {
    throw new Error(`task session missing workspaceRoot: ${sessionId}`);
  }

  const mainPath = `${workspaceRoot}/src/main.jsx`;
  const rootIndexPath = `${workspaceRoot}/index.html`;
  const publicIndexPath = `${workspaceRoot}/public/index.html`;
  const mainSource = await readUtf8(sandboxId, mainPath);
  if (!mainSource) {
    throw new Error(`missing src/main.jsx in workspace: ${workspaceRoot}`);
  }
  const rootIndexSource = await readUtf8(sandboxId, rootIndexPath);
  if (!rootIndexSource) {
    const publicIndexSource = await readUtf8(sandboxId, publicIndexPath);
    if (publicIndexSource) {
      await e2bConnector.writeFile(sandboxId, rootIndexPath, Buffer.from(publicIndexSource, 'utf-8'));
    }
  }

  const importMatches = [...mainSource.matchAll(/from ['"]\.\/pages\/([^'"]+)['"]/g)].map((match) => match[1] || '');
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const pageName of importMatches) {
    const template = PAGE_TEMPLATES[pageName];
    if (!template) {
      continue;
    }
    const filePath = `${workspaceRoot}/src/pages/${pageName}.jsx`;
    const existing = await readUtf8(sandboxId, filePath);
    if (existing) {
      skippedFiles.push(filePath);
      continue;
    }
    await e2bConnector.writeFile(sandboxId, filePath, Buffer.from(template, 'utf-8'));
    writtenFiles.push(filePath);
  }

  const installProbe = await e2bConnector.runCommand(
    sandboxId,
    'set +e; npm install > /tmp/oneceo_repair_install.log 2>&1; status=$?; cat /tmp/oneceo_repair_install.log; echo "__ONECEO_EXIT_CODE__=$status"; exit 0',
    {
      cwd: workspaceRoot,
      timeoutMs: 180_000,
    },
  );
  const installResult = parseCommandResult(installProbe);
  const buildProbe = await e2bConnector.runCommand(
    sandboxId,
    'set +e; npm run build > /tmp/oneceo_repair_build.log 2>&1; status=$?; cat /tmp/oneceo_repair_build.log; echo "__ONECEO_EXIT_CODE__=$status"; exit 0',
    {
      cwd: workspaceRoot,
      timeoutMs: 180_000,
    },
  );
  const buildResult = parseCommandResult(buildProbe);

  if ((installResult.exitCode ?? 1) !== 0) {
    throw new Error(`npm install failed: ${installResult.stdout.slice(0, 1500)}`);
  }
  if ((buildResult.exitCode ?? 1) !== 0) {
    throw new Error(`npm run build failed: ${buildResult.stdout.slice(0, 1500)}`);
  }

  let deploySummary: Record<string, unknown> | null = null;
  if (shouldDeploy) {
    const deployResult = await executeTaskSessionDeploymentAction({
      action: 'deploy',
      taskSessionId: sessionId,
      userId,
      session: fileSession,
      workspacePath: workspaceRoot,
      resolvedEnvironment: environment,
      resolvedOrchestratorSessionId: sandboxId,
    });
    deploySummary = {
      action: deployResult.actionResult.action,
      deploymentId: deployResult.panel.deploymentId,
      latestStatus: deployResult.panel.latestStatus,
      latestUrl: deployResult.panel.latestStaticUrl || deployResult.panel.latestUrl || null,
      panelMessage: deployResult.panel.message || null,
    };
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionId,
        sandboxId,
        workspaceRoot,
        imports: importMatches,
        writtenFiles,
        skippedFiles,
        installExitCode: installResult.exitCode,
        installStdout: installResult.stdout.slice(0, 4000),
        installStderr: installResult.stderr.slice(0, 2000),
        buildExitCode: buildResult.exitCode,
        buildStdout: buildResult.stdout.slice(0, 4000),
        buildStderr: buildResult.stderr.slice(0, 2000),
        deploy: deploySummary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const maybeError = error as Error & { cause?: unknown };
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        cause:
          maybeError?.cause instanceof Error
            ? {
                message: maybeError.cause.message,
                stack: maybeError.cause.stack,
              }
            : maybeError?.cause ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
