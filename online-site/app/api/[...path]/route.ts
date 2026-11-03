import {auditedDatabase,auditPage} from '../../../lib/audit';
import {replicaStart,replicaPage,replicaBundle,replicaChanges,revision} from '../../../lib/replica';
import {createCloudBackup,downloadCloudBackup} from '../../../lib/cloud-backup';
import {operationsStatus} from '../../../lib/operations';
import {configureBackupSchedule,runDailyBackup} from '../../../lib/backup-automation';
import {reserveLoginAttempt,releaseVerifiedBasic} from '../../../lib/login-limiter';
import { getCustomerDue } from "../../../lib/customer-due";
import { authenticateAppRequest, createAppSession, revokeAppSession, sessionCookie } from "../../../lib/app-session";
import { guardWorkspaceWrites, requireWorkspaceEpoch, resetWorkspace } from "../../../lib/workspace-access";
import { executeCommand, getInvoice, workspaceBootstrap, ensureWorkspace } from "../../../lib/workspace";
import { createReceipt, saleForReceipt } from "../../../lib/receipt";
import { env } from "cloudflare:workers";
import { authenticateAppUser, type AppUser } from "../../../lib/app-access";
import { applyAlertLevelUpdate, deleteRecord, ensureSeeded, InputError, insertRecord, wholeBags, syncCodes, updateSale } from "../../../lib/ledger";

export const dynamic = "force-dynamic";
const maximumBody = 1024 * 1024;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

async function readPayload(request: Request) {
  if (Number(request.headers.get("Content-Length")) > maximumBody) throw new InputError("Request too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximumBody) { await reader.cancel(); throw new InputError("Request too large", 413); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(body) || "{}"); }
  catch { throw new InputError("Invalid JSON"); }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new InputError("Expected a JSON object");
  return data;
}

async function handle(request: Request) {
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean).slice(1);
  let user:AppUser|null=null;
  try {
    if (!env.APP_LOGIN_USERNAME || !env.APP_LOGIN_PASSWORD_RECORD) return json({error:'App login is not configured.'},503);
    if (!['GET','HEAD'].includes(request.method)) {
      const origin=request.headers.get('Origin');
      if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(origin&&origin!==url.origin))throw new InputError("Use this app's own website to save changes.",403);
      if(request.method!=='DELETE'&&request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new InputError('Expected application/json',415);
    }
    if (parts.length===1&&parts[0]==='login'&&request.method==='POST') {
      if(!env.DB)throw new Error('Login database unavailable');
      await reserveLoginAttempt(env.DB,request.headers.get('CF-Connecting-IP')||'unknown-client');
      const payload=await readPayload(request),username=String(payload.username||'').trim(),password=String(payload.password||'');
      if(username.length>200||password.length>1000)throw new InputError('Incorrect User ID or password.',401);
      const basic='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(username+':'+password)));
      user=await authenticateAppUser(basic,env);
      if(!user)throw new InputError('Incorrect User ID or password.',401);
      await revokeAppSession(request,env);
      return Response.json({ok:true,user},{headers:{...headers,'Set-Cookie':sessionCookie(await createAppSession(user,env),request.url)}});
    }
    if(parts.length===1&&parts[0]==='logout'&&request.method==='POST'){await revokeAppSession(request,env);return Response.json({ok:true},{headers:{...headers,'Set-Cookie':sessionCookie('signed-out',request.url)}});}
    const legacyAttempt=!!request.headers.get('Authorization')&&!request.headers.get('Cookie')?.split(';').some(value=>value.trim().startsWith('arafat_session='));
    if(!env.DB)throw new Error('Login database unavailable');
    const reservation=legacyAttempt?await reserveLoginAttempt(env.DB,request.headers.get('CF-Connecting-IP')||'unknown-client'):null;
    user=await authenticateAppRequest(request,env);
    if(!user)return json({error:'Please log in to continue.'},401);
    if(reservation)await releaseVerifiedBasic(env.DB,reservation);
    if((request.method==='GET'||request.method==='HEAD')&&parts.length===1&&parts[0]==='check-login')return json({ok:true,user,sync_protocol:2});
    if (!env.DB) throw new Error("Database binding unavailable");
    let db = env.DB;
    if(parts[0]==='replica'&&request.method==='GET'){
      if(parts[1]==='start'){return json({...await replicaStart(db,url.searchParams.get('packed')==='1'),user});}
      if(parts[1]==='bundle')return json(await replicaBundle(db,url));
      if(parts[1]==='rows')return json(await replicaPage(db,url));
      if(parts[1]==='changes')return json(await replicaChanges(db,url));
      return json({error:'Not found'},404);
    }
    await ensureSeeded(db);
    await applyAlertLevelUpdate(db);
    if(parts[0]==='admin'){
      if(user.role!=='admin')throw new InputError('Only the Admin can access operations and audit records.',403);
      if(parts[1]==='audit'&&request.method==='GET')return json(await auditPage(db,url));
      if(parts[1]==='operations'&&request.method==='GET')return json(await operationsStatus(db,!!env.BACKUPS));
      if(parts[1]==='backups'&&parts[2]==='daily'&&parts.length===3&&request.method==='POST')return json(await runDailyBackup(db,env.BACKUPS));
      if(parts[1]==='backup-schedule'&&parts.length===2&&request.method==='POST'){
        const payload=await readPayload(request);
        return json(await configureBackupSchedule(db,payload.schedule_id));
      }
      if(parts[1]==='backups'&&parts.length===2&&request.method==='POST')return json(await createCloudBackup(db,env.BACKUPS,user),201);
      if(parts[1]==='backups'&&parts.length===3&&request.method==='GET'){
        const backup=await downloadCloudBackup(db,env.BACKUPS,parts[2]);
        return new Response(backup.text,{headers:{...headers,'Content-Type':'application/json','Content-Disposition':`attachment; filename="Arafat-cloud-backup-${parts[2]}.json"`,'X-Backup-SHA256':backup.sha256}});
      }
      return json({error:'Not found'},404);
    }
    if(!['GET','HEAD'].includes(request.method)){await ensureWorkspace(db);db=auditedDatabase(db,user,crypto.randomUUID());}
    const snapshot = async () => ({...await workspaceBootstrap(db),user});
    if (parts[0] === 'reset-workspace') {
      if (user.role !== 'admin') throw new InputError('Only the Admin can reset all app data.',403);
      if (request.method !== 'POST' || parts.length !== 1) return json({error:'Not found'},404);
      const result=await resetWorkspace(db,user,await readPayload(request));
      return json({...await snapshot(),reset_result:result});
    }
    // Legacy write routes also enforce the epoch inside each atomic write.
    // Commands carry their own epoch, including operations saved Offline.
    if (!['GET','HEAD'].includes(request.method) && parts[0] !== 'commands') {
      const supplied=request.headers.get('X-Workspace-Epoch');
      const epoch=await requireWorkspaceEpoch(db,supplied===null?undefined:Number(supplied));
      db=guardWorkspaceWrites(db,epoch);
    }
    if (request.method === "POST" && parts.length === 1 && parts[0] === "commands") {
      const command=await readPayload(request);
      const result = await executeCommand(auditedDatabase(env.DB,user,String(command.id||crypto.randomUUID())),command);
      if(request.headers.get("X-Workspace-Protocol")==="2")return json({sync_protocol:2,command_result:result,sync_revision:await revision(env.DB)});
      return json({ ...await snapshot(), command_result: result });
    }
    if(['GET','HEAD'].includes(request.method)&&parts[0]==='customers'&&parts[2]==='due'&&(parts.length===3||(parts.length===4&&parts[3]==='receipt'))){
      const statement=await getCustomerDue(db,parts[1]);
      if(parts.length===3)return json(statement);
      const pdf=request.method==='HEAD'?null:await createReceipt({...statement,document_type:'customer_due'},url.searchParams.get('lang')==='bn'?'bn':'en');
      return new Response(pdf?new Uint8Array(pdf).buffer:null,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Arafat-Customer-Due-${parts[1]}.pdf"`}});
    }
    if ((request.method === "GET" || request.method === "HEAD") && parts[0] === "invoices" && (parts.length === 2 || (parts.length === 3 && parts[2] === "receipt"))) {
      const invoice = await getInvoice(db, parts[1]);
      if (parts.length === 2) return json(invoice);
      const pdf = request.method === "HEAD" ? null : await createReceipt(invoice, url.searchParams.get("lang") === "bn" ? "bn" : "en");
      return new Response(pdf ? new Uint8Array(pdf).buffer : null, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Arafat-Invoice-${invoice.id}.pdf"` } });
    }
    if ((request.method === "GET" || request.method === "HEAD") && parts.length === 2 && parts[0] === "sales") {
      return json(await saleForReceipt(db, parts[1]));
    }
    if ((request.method === "GET" || request.method === "HEAD") && parts.length === 3 && parts[0] === "sales" && parts[2] === "receipt") {
      const sale = await saleForReceipt(db, parts[1]);
      const pdf = request.method === "HEAD" ? null : await createReceipt(sale, url.searchParams.get("lang") === "bn" ? "bn" : "en");
      return new Response(pdf ? new Uint8Array(pdf).buffer : null, { headers: { ...headers, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Arafat-Traders-Memo-${String(sale.id).padStart(6, "0")}.pdf"` } });
    }
    if ((request.method === "GET" || request.method === "HEAD") && parts.length === 1 && ["bootstrap", "export"].includes(parts[0])) {
      const payload = await snapshot();
      if (parts[0] === "export") return new Response(JSON.stringify(payload, null, 2), {
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": "attachment; filename=dealership-export.json" },
      });
      return json(payload);
    }
    if (request.method === "POST" && parts.length === 1 && parts[0] === "sync-akij") {
      const sync = await syncCodes(db);
      return json({ ...await snapshot(), sync });
    }
    if (request.method === "POST" && parts.length === 1) {
      const payload=await readPayload(request);if(parts[0]==="adjustments")payload.quantity=wholeBags(payload.quantity,"Quantity",1);
      if(['payments','transactions'].includes(parts[0])){
        const operation=request.headers.get('X-Operation-ID')||payload.operation_id;
        if(!operation)throw new InputError('Provide a stable operation ID or use the app to save this payment.');
        await executeCommand(db,{id:operation,workspace_epoch:Number(request.headers.get('X-Workspace-Epoch')||0),method:'POST',path:url.pathname,payload});
      }else await insertRecord(db, parts[0], payload);
      return json(await snapshot(), 201);
    }
    if (request.method === "PATCH" && parts.length === 2 && parts[0] === "sales") {
      const linked = await db.prepare("SELECT invoice_id FROM invoice_items WHERE sale_id=?").bind(parts[1]).first();
      if (linked) throw new InputError("Refresh the app and use the invoice editor.", 409);
      await updateSale(db, parts[1], await readPayload(request));
      return json(await snapshot());
    }
    if (request.method === "PATCH" && parts.length === 2 && parts[0] === "products") {
      const payload=await readPayload(request);
      await executeCommand(db,{id:crypto.randomUUID(),workspace_epoch:Number(request.headers.get("X-Workspace-Epoch")||0),method:"PATCH",path:url.pathname,payload});
      return json(await snapshot());
    }
    if (request.method === "PATCH" && parts.length === 2 && parts[0] === "customers") {
      await executeCommand(db,{id:crypto.randomUUID(),workspace_epoch:Number(request.headers.get("X-Workspace-Epoch")||0),method:"PATCH",path:url.pathname,payload:await readPayload(request)});
      return json(await snapshot());
    }
    if (request.method === "DELETE" && parts.length === 2) {
      if (parts[0] === "sales" && await db.prepare("SELECT invoice_id FROM invoice_items WHERE sale_id=?").bind(parts[1]).first()) throw new InputError("Refresh the app and cancel the invoice instead.", 409);
      await deleteRecord(db, parts[0], parts[1]);
      return json(await snapshot());
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof InputError) return Response.json({error:error.message},{status:error.status,headers:{...headers,...(error.status===429?{'Retry-After':'60'}:{})}});
    if (error instanceof Error && /constraint failed/i.test(error.message)) {
      return json({ error: "Check the product/customer, duplicate names, account, and entry type." }, 400);
    }
    console.error(JSON.stringify({event:"request_failure",route:parts[0]||"unknown",method:request.method,request_id:crypto.randomUUID(),status:500}));
    return json({ error: "Could not complete the request. Please try again." }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

export const HEAD = handle;
