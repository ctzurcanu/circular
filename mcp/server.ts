#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.32.1/server/mcp.js';
import { StdioServerTransport } from 'npm:@modelcontextprotocol/sdk@1.32.1/server/stdio.js';
import { z } from 'npm:zod@4.6.5';
import { createHandler } from '../supabase/functions/_shared/handler.ts';

const remoteUrl = Deno.env.get('BIZ_MCP_API_URL');
const localUser = Deno.env.get('BIZ_MCP_USER_ID');
if (localUser && !z.uuid().safeParse(localUser).success) throw new Error('BIZ_MCP_USER_ID must be a UUID.');
const databaseUrl = Deno.env.get('BIZ_DATABASE_URL') || `postgresql://${Deno.env.get('USER')}@localhost:5432/biz`;
if (!remoteUrl && !['localhost','127.0.0.1','::1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Direct MCP access is local-only. For hosted access, configure BIZ_MCP_API_URL and a verified user token.');
}
if (remoteUrl && new URL(remoteUrl).protocol !== 'https:' && !['localhost','127.0.0.1'].includes(new URL(remoteUrl).hostname)) {
  throw new Error('Hosted MCP API access requires HTTPS.');
}
// Reuse the same handlers and membership checks as the website, without needing
// a separate HTTP process for the local stdio server.
const local = remoteUrl ? null : createHandler({databaseUrl,allowedOrigins:[],localUser});
async function invoke(action: string, params: Record<string,unknown>) {
  if (!remoteUrl && !localUser && !['stats','catalog','catalog_children','catalog_category'].includes(action)) {
    throw new Error('Set BIZ_MCP_USER_ID to your local development identity to use business and conversation tools.');
  }
  const token = Deno.env.get('BIZ_MCP_ACCESS_TOKEN'), key = Deno.env.get('BIZ_MCP_PUBLISHABLE_KEY');
  const req = new Request(remoteUrl || 'http://127.0.0.1:8787',{
    method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(key?{apikey:key}:{})},
    body:JSON.stringify({action,...params}),signal:AbortSignal.timeout(30000),
  });
  const response = remoteUrl ? await fetch(req) : await local!.handler(req);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Business API returned ${response.status}.`);
  return result.data;
}

const server = new McpServer({name:'biz',version:'1.0.0'},{instructions:
  'B2B networking with an ECLASS catalog. Default locale is us_en. Classifications are neutral categories; explicitly choose product or service for listings. Other is scoped to a collection, never a wildcard. Create/edit drafts before publishing. Publish, withdraw, or send messages only when the user requests that action. A category match is a candidate, not proof of technical or commercial compatibility.'});
function tool(name:string,title:string,description:string,schema:z.ZodRawShape,action:string,
  readOnly=true,idempotent=true,destructive=false,messaging=false) {
  server.registerTool(name,{title,description,inputSchema:schema,
    annotations:{readOnlyHint:readOnly,idempotentHint:idempotent,destructiveHint:destructive,openWorldHint:messaging}},
    async (params: Record<string,unknown>) => {
      try {
        const data=await invoke(action,params);
        return {content:[{type:'text' as const,text:JSON.stringify(data,null,2)}],structuredContent:{data}};
      } catch(error) {
        return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'The operation failed.'}]};
      }
    });
}
const businessId = z.number().int().positive().describe('Business ID returned by list_businesses or create_business.');
const listingId = z.uuid();
const listingSchema = {
  business_id:businessId,
  direction:z.enum(['input','output']).describe('Input = need; output = offering.'),
  kind:z.enum(['product','service']),
  class_node_id:z.number().int().positive().describe('Category node ID from catalog search/browsing, including a collection-specific Other.'),
  title:z.string().trim().min(1).max(200), description:z.string().max(4000).optional(),
  quantity:z.number().positive().finite().optional(),quantity_unit:z.string().min(1).max(50).optional(),
  regions:z.array(z.string().min(1).max(50)).max(30).optional(),
  available_from:z.iso.date().optional(), available_until:z.iso.date().optional(),
  attributes:z.record(z.string(),z.json()).optional().describe('Required exact values for inputs; supplied values for outputs. Unknown values are not assumed satisfied.'),
};
tool('catalog_stats','Catalog statistics','Count imported classifications and keyword associations.',{},'stats');
tool('search_catalog','Search product/service classifications','Search us_en names, keywords, or ECLASS codes. Returns category IDs, labels, and Other context.',{query:z.string().trim().min(1).max(100)},'catalog');
tool('browse_catalog','Browse a classification collection','List child categories and the collection’s Other node. Omit parent_id for ECLASS root categories.',{parent_id:z.number().int().positive().optional()},'catalog_children');
tool('get_catalog_category','Verify a catalog category','Look up a published catalog category by node ID before recommending it for the website.',{node_id:z.number().int().positive()},'catalog_category');
tool('list_businesses','List your businesses','List businesses represented by the configured identity, with representative IDs.',{},'workspace');
tool('create_business','Create a business workspace','Create a new business and link the configured identity as its representative. This creates persistent records; do not invent companies.',{name:z.string().trim().min(1).max(200),representative_name:z.string().trim().min(1).max(200)},'create_business',false,false);
tool('list_listings','List business inputs and outputs','List your business’s drafts, published listings, and withdrawn listings.',{business_id:businessId},'listings');
tool('create_listing_draft','Draft an input or output','Create a draft, not a publication. A quantity requires its unit. Choose an imported category or collection-specific Other.',listingSchema,'save_listing',false,false);
tool('edit_listing_draft','Edit a listing','Replace the specified listing’s fields and return it to draft, including previously published listings. Re-publish explicitly after review.',{...listingSchema,listing_id:listingId},'save_listing',false,true,true);
server.registerTool('publish_listing',{title:'Publish an input/output',description:'Make a listing discoverable to other businesses. Use only when the user asks to publish it.',inputSchema:{listing_id:listingId},annotations:{readOnlyHint:false,idempotentHint:true,destructiveHint:false,openWorldHint:true}},
  async (params: {listing_id:string}) => stateResult(params.listing_id,'published'));
server.registerTool('withdraw_listing',{title:'Withdraw an input/output',description:'Remove a listing from public discovery without deleting it. Use only when requested.',inputSchema:{listing_id:listingId},annotations:{readOnlyHint:false,idempotentHint:true,destructiveHint:true,openWorldHint:true}},
  async (params: {listing_id:string}) => stateResult(params.listing_id,'withdrawn'));
async function stateResult(listing_id:string,state:string) {
  try {const data=await invoke('listing_state',{listing_id,state});return {content:[{type:'text' as const,text:JSON.stringify(data,null,2)}],structuredContent:{data}};}
  catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'State update failed.'}]};}
}
tool('match_businesses','Find suppliers or buyers','Match published inputs to other businesses’ outputs. Returns exact/specific/broad/nearby/unclassified candidates, unknown requirements, scores, and representatives. Does not send messages.',{business_id:businessId,direction:z.enum(['input','output']).default('input'),distance:z.number().int().min(0).max(6).default(2)},'matches');
tool('start_conversation','Open a representative conversation','Create or reuse a private conversation for a current matched input/output pair. No message is sent. The configured identity must represent the specified business.',{business_id:businessId,direction:z.enum(['input','output']).default('input'),request_listing_id:listingId,offer_listing_id:listingId},'start_conversation',false,true);
tool('list_conversations','List your private conversations','List up to 50 conversations in which your representative identity is a member.',{},'conversations');
tool('read_messages','Read conversation messages','Read the most recent 100 messages, oldest first, only for a conversation you belong to.',{conversation_id:z.uuid()},'messages');
tool('send_message','Send a representative message','Send the specified message to members of a private business conversation. Requires direct user authorization for the recipient and message; never send automatically from a match.',{conversation_id:z.uuid(),content:z.string().trim().min(1).max(4000)},'send_message',false,false,false,true);
server.registerResource('biz-guide','biz://guide',{title:'Business networking workflow',mimeType:'text/plain'},async (uri: URL)=>({contents:[{uri:uri.href,mimeType:'text/plain',text:
  'Locale: us_en. Search/browse the catalog; use returned node IDs. Create a business only for the user’s actual business. Draft individual needs (input) and offers (output), including quantity/unit, acceptable/service regions, availability, and exact-value specifications. Publish after the user requests publication. Match inputs to suppliers or outputs to buyers. Explain category relationship and unknown requirements; Other is never a wildcard. Open a private conversation for a current match. Read/send messages only for member conversations; sending requires an explicit user request. Edits return listings to draft. Withdraw instead of deleting. Local access is trusted administrator access under the configured identity; hosted access uses a verified Supabase user token.'}]}));

server.registerPrompt('choose_category',{title:'Decide on a business category',description:'Compare actual catalog categories for a need or offering; return a verified node ID for the website.',argsSchema:{description:z.string()}},async (args: {description:string})=>({messages:[{role:'user' as const,content:{type:'text' as const,text:`Choose the best biz catalog category for: ${args.description}. Use search_catalog with multiple focused keywords, browse_catalog to compare children, and get_catalog_category to verify your choice. Ask clarifying questions when needed. Explain alternatives and uncertainty. Use collection-specific Other only when no named child fits; never as a wildcard. Use us_en. Return the chosen name, code and numeric node ID for the website. Do not create or publish anything.`}}]}));

const transport=new StdioServerTransport();
server.server.onclose=()=>{void local?.close();};
await server.connect(transport);
