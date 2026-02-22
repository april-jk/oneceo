import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2] || 'sess_35ff684915754d7c';
const reqId = `boot_${Date.now()}`;

async function sleep(ms:number){ await new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const { osacConnector } = await import('../src/connectors/osac-connector');
  const { osacConnectionManager } = await import('../src/services/osac-connection-manager');

  const handle = await osacConnector.connectForSession(sid, {
    bootstrapMessage: {
      type: 'GET_SESSION_LIST',
      requestId: reqId,
      payload: { requestId: reqId, maxCount: 1, format: 'json' }
    }
  });
  console.log('connected', handle.endpoint);
  const start = Date.now();
  let done = false;
  handle.onMessage((msg:any)=>{
    osacConnectionManager.emitExternalMessage(sid, msg);
    const rid = String(msg?.requestId || msg?.payload?.requestId || '');
    console.log('[msg]', msg.type, rid || '-');
    if ((msg.type === 'SESSION_LIST_RESPONSE' || msg.type === 'ERROR') && (!rid || rid === reqId)) {
      done = true;
      console.log('response', JSON.stringify(msg, null, 2));
      handle.close();
    }
  });
  handle.onClose(()=>{
    console.log('closed');
  });

  while(!done && Date.now()-start < 45000){
    await sleep(1000);
  }
  if(!done){
    console.log('timeout no response');
    handle.close();
    process.exit(2);
  }
}

main().catch((e)=>{ console.error(e); process.exit(1);});
