import {automationStatus,configureBackupSchedule,runDailyBackup} from './backup-automation.ts';
import {InputError} from './ledger.ts';

const emptyInput={type:'object',properties:{},additionalProperties:false};
const tools=[
 {name:'run_daily_backup',description:'Create and verify today’s private Arafat Traders backup. Safe to retry: one daily job across all devices. Returns status only; no business data or credentials.',inputSchema:emptyInput},
 {name:'get_backup_status',description:'Read the configured daily backup schedule and the last seven daily job results. Does not return backup contents.',inputSchema:emptyInput},
 {name:'record_backup_schedule',description:'After native Sites create_schedule succeeds, record its exact saved task ID for the Admin backup status. Does not create or enable a cloud schedule itself.',inputSchema:{type:'object',properties:{schedule_id:{type:'string',maxLength:200}},required:['schedule_id'],additionalProperties:false}},
];
export async function operationsMcp(request:Request,env:Cloudflare.Env){
 const headers={'Cache-Control':'private, no-store','Content-Type':'application/json'};
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
 if(request.method!=='POST')return reply({error:'Use POST.'},405);
 if(Number(request.headers.get('Content-Length'))>8192)return reply({error:'Request too large.'},413);
 let message;
 try{
  const reader=request.body?.getReader();let body='';const decoder=new TextDecoder();let bytes=0;
  if(reader)for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();return reply({error:'Request too large.'},413);}body+=decoder.decode(value,{stream:true});}
  message=JSON.parse(body+decoder.decode());
  if(!message||typeof message!=='object'||Array.isArray(message))throw Error('Invalid');
 }catch{return reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request.'}},400);}
 const result=(value:unknown)=>reply({jsonrpc:'2.0',id:message.id??null,result:value});
 if(message.method==='server/discover')return result({supportedVersions:['2026-07-28','2025-06-18','2025-03-26'],capabilities:{tools:{}}});
 if(message.method==='initialize')return result({protocolVersion:message.params?.protocolVersion||'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'arafat-private-backups',version:'1.0.0'}});
 if(message.method==='notifications/initialized')return new Response(null,{status:202,headers});
 if(message.method==='ping')return result({});
 if(message.method==='tools/list')return result({tools});
 if(message.method!=='tools/call')return reply({jsonrpc:'2.0',id:message.id??null,error:{code:-32601,message:'Method not found.'}});
 // Sites validates caller identity and supplies these headers. Public app users
 // (including the in-app Admin) cannot invoke the cloud service by app cookie.
 const owner=env.SITES_OPERATIONS_OWNER_EMAIL?.trim().toLowerCase();
 const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
 if(!owner||email!==owner)return reply({jsonrpc:'2.0',id:message.id??null,error:{code:-32001,message:'Site owner authorization required.'}},403);
 if(!env.DB)return result({isError:true,content:[{type:'text',text:'Backup database unavailable.'}]});
 try{
  const name=message.params?.name,args=message.params?.arguments??{};
  if(!args||typeof args!=='object'||Array.isArray(args))throw new InputError('Invalid arguments.');
  if(Object.keys(args).some(key=>name!=='record_backup_schedule'||key!=='schedule_id'))throw new InputError('Unexpected arguments.');
  let value;
  if(name==='run_daily_backup')value=await runDailyBackup(env.DB,env.BACKUPS);
  else if(name==='get_backup_status')value=await automationStatus(env.DB);
  else if(name==='record_backup_schedule')value=await configureBackupSchedule(env.DB,args.schedule_id);
  else throw new InputError('Unknown tool.');
  return result({content:[{type:'text',text:JSON.stringify(value)}]});
 }catch(error){
  // Never send raw database/provider exceptions to the MCP client.
  return result({isError:true,content:[{type:'text',text:error instanceof InputError?error.message:'Backup operation failed. Check Admin backup status and retry.'}]});
 }
}
