import { Sandbox } from 'e2b';

async function main() {
  const filter = process.argv[2];
  const paginator = Sandbox.list({});
  const items: any[] = [];
  while (paginator.hasNext) {
    const page = await paginator.nextItems();
    const list = Array.isArray(page) ? page : (page as any)?.items || (page as any)?.sandboxes || [];
    if (Array.isArray(list)) items.push(...list);
  }
  const filtered = filter
    ? items.filter((item) => String(item?.sandboxId || item?.id || '').includes(filter))
    : items;
  console.log(JSON.stringify(filtered, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
