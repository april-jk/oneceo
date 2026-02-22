import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { OsacClient } from '../src/clients/osac-client';

const url='ws://192.168.10.172:20078/ws';
const token='234a6ab360b943a3fc40cae58e0274c3b1efc42ad2b29669';

(async()=>{
  const client=new OsacClient(url,{authToken:token,connectTimeoutMs:6000,requestTimeoutMs:10000});
  const started=Date.now();
  client.on('close',()=>{
    const sec=Math.floor((Date.now()-started)/1000);
    console.log('closed_at_s=',sec);
  });
  try{
    await client.connect();
    console.log('connected');
  }catch(e:any){
    console.log('connect_fail',e?.message||String(e));
    process.exit(1);
  }
  await new Promise((resolve)=>setTimeout(resolve,30000));
  console.log('still_open=',client.isOpen());
  client.close();
})();
