import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const jobId = process.argv[2];
if (!jobId) {
  throw new Error('missing job id');
}

(async () => {
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  for (let i = 0; i < 10; i++) {
    const res = await kvmConnector.getJob(jobId).catch((error: any) => ({ error: String(error?.message || error) }));
    console.log(JSON.stringify(res, null, 2));
    const status = (res as any)?.data?.status;
    if (status && status !== 'running' && status !== 'pending') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})();
