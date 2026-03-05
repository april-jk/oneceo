import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const sid = process.argv[2];
if (!sid) throw new Error('sid required');

(async()=>{
  const { sandboxExecutionEnvironmentDAO } = await import('../src/db/dao');

  const metadata = {
    osacHost: '192.168.10.172',
    taskTitle: '创建单文件 HTML 贪吃蛇游戏',
    fixedSandbox: {
      vmName: 'test_session_manual_use',
      enabled: true,
      sessionId: sid,
    },
    osacEndpoint: 'ws://127.0.0.1:18080/ws',
    osacHostPort: 18080,
    osacAuthToken: 'manual_fix_session_35ff',
    osacMappingId: 'portmap:sess_4471f12d0bc444d3:18080',
    sandboxStatus: 'ready',
    taskSessionId: 'b3534c14-8ffd-4ddb-9994-8b036c919872',
    allocationSource: 'fixed_session',
    osacMappingEpoch: 1,
    osacConnectionMode: 'kvm-tcp-relay',
  };

  await sandboxExecutionEnvironmentDAO.updateMetadata(sid, metadata);
  console.log('METADATA_RESTORED', JSON.stringify(metadata, null, 2));
})();
