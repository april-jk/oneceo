import { OsacClient } from '../src/clients/osac-client';
const endpoint='ws://192.168.10.172:20086/ws';
const tokens=[
  {name:'b20', token:'63e2fddc29175c946db348c70809301574f9786e63c31e64'},
  {name:'6aaf', token:'94cfa25a169edcfc390bcf48e7330c237b0549441f18dd4a'},
];
async function attempt(name:string, token:string, i:number){
  const c=new OsacClient(endpoint,{authToken:token,connectTimeoutMs:3000,requestTimeoutMs:5000});
  try{await c.connect(); console.log(name,i,'ok'); c.close();}
  catch(e:any){console.log(name,i,'fail',e?.message||String(e)); try{c.close();}catch{}}
}
(async()=>{
  for(const t of tokens){
    for(let i=1;i<=5;i++){
      await attempt(t.name,t.token,i);
      await new Promise(r=>setTimeout(r,500));
    }
  }
})();
