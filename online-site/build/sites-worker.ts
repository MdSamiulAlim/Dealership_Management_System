import appShell from "../public/offline-shell.txt?raw";
import {securityHeaders,recordRequest} from "../lib/operations";
import {operationsMcp} from "../lib/operations-mcp";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const started=Date.now();let response:Response;
    if(new URL(request.url).pathname==='/mcp'){
      response=await operationsMcp(request,env);
    }else if(new URL(request.url).pathname==='/'&&['GET','HEAD'].includes(request.method)){
      response=new Response(request.method==='HEAD'?null:appShell,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
    }else if(new URL(request.url).pathname==='/healthz'){
      try{if(!env.DB)throw Error('Unavailable');await env.DB.prepare('SELECT 1 AS ok').first();response=Response.json({status:'ok'});}
      catch{response=Response.json({status:'unavailable'},{status:503});}
    }else response=await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    if(env.DB&&(new URL(request.url).pathname.startsWith('/api/')||new URL(request.url).pathname==='/healthz'))ctx.waitUntil(recordRequest(env.DB,request,response.status,Date.now()-started).catch(()=>console.error(JSON.stringify({event:'monitor_write_failed'}))));
    return securityHeaders(request,response);
  },
};
