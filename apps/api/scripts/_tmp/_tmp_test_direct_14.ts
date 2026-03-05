import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { OsacClient } from '../src/clients/osac-client';
const token='234a6ab360b943a3fc40cae58e0274c3b1efc42ad2b29669';
const url='ws://172.28.0.14:18080/ws';
(async()=>{
  const c=new OsacClient(url,{authToken:token,connectTimeoutMs:5000,requestTimeoutMs:8000});
  try{await c.connect(); console.log('connect ok'); const r=await c.request({type:'GET_SESSION_LIST',payload:{maxCount:1,format:'json'}},m=>m.type==='SESSION_LIST_RESPONSE'); console.log('reply',r.type);}
  catch(e:any){console.log('fail',e?.message||String(e));}
  finally{try{c.close();}catch{}}
})();
