import { Sandbox } from 'e2b';

async function main() {
  const dryRun = process.argv.includes('--dry');
  const paginator = Sandbox.list({});
  const sandboxIds: string[] = [];

  while (paginator.hasNext) {
    const page = await paginator.nextItems();
    const keys = page && typeof page === 'object' ? Object.keys(page as any) : [];
    const items = Array.isArray(page)
      ? page
      : (page as any)?.items || (page as any)?.sandboxes || (page as any)?.data || [];
    if (sandboxIds.length === 0) {
      console.log('[debug] page keys=', keys);
      console.log('[debug] first page item keys=', Array.isArray(items) && items[0] ? Object.keys(items[0]) : []);
    }
    if (Array.isArray(items)) {
      for (const item of items) {
        const id = (item?.sandboxId || item?.sandboxID || item?.id) as string | undefined;
        if (id) sandboxIds.push(id);
      }
    }
  }

  console.log(`[debug] total sandboxes=${sandboxIds.length}`);
  if (dryRun) return;

  for (const id of sandboxIds) {
    try {
      await Sandbox.kill(id);
      console.log('[debug] killed', id);
    } catch (error) {
      console.warn('[debug] kill failed', id, error instanceof Error ? error.message : String(error));
    }
  }
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
