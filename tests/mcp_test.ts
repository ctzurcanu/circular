import { strict as assert } from 'node:assert';
import { Client } from 'npm:@modelcontextprotocol/sdk@1.32.1/client/index.js';
import { StdioClientTransport } from 'npm:@modelcontextprotocol/sdk@1.32.1/client/stdio.js';
import type { Tool, Resource } from 'npm:@modelcontextprotocol/sdk@1.32.1/types.js';
import postgres from 'npm:postgres@3.4.9';

const databaseUrl = Deno.env.get('BIZ_DATABASE_URL') || `postgresql://${Deno.env.get('USER')}@localhost:5432/biz`;
if (!['localhost','127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('MCP tests require local PostgreSQL.');
const root = new URL('../',import.meta.url).pathname;
async function connect(user='') {
  const client=new Client({name:'biz-integration-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:Deno.execPath(),
    args:['run','--config',root+'deno.json','--allow-env','--allow-read','--allow-net=127.0.0.1,localhost',root+'mcp/server.ts'],cwd:'/private/tmp',stderr:'pipe',
    env:{...Deno.env.toObject(),BIZ_DATABASE_URL:databaseUrl,BIZ_MCP_USER_ID:user,BIZ_MCP_API_URL:'',BIZ_MCP_ACCESS_TOKEN:'',BIZ_MCP_PUBLISHABLE_KEY:''}});
  await client.connect(transport);return client;
}
async function call<T>(client:Client,name:string,args:Record<string,unknown>={}):Promise<T> {
  const result=await client.callTool({name,arguments:args});
  assert.ok(!result.isError,JSON.stringify(result));
  return (result.structuredContent as {data:T}).data;
}

Deno.test('MCP stdio: handshake, schemas, resources, catalog, and read-only identity boundary',async()=>{
  const client=await connect();
  try {
    const tools=await client.listTools();assert.equal(tools.tools.length,16);
    assert.equal(tools.tools.find((t:Tool)=>t.name==='search_catalog')?.annotations?.readOnlyHint,true);
    assert.equal(tools.tools.find((t:Tool)=>t.name==='send_message')?.annotations?.readOnlyHint,false);
    const resources=await client.listResources();assert.ok(resources.resources.some((r:Resource)=>r.uri==='biz://guide'));
    const guide=await client.readResource({uri:'biz://guide'});assert.ok(JSON.stringify(guide).includes('us_en'));
    const stats=await call<{classes:number;keywords:number}>(client,'catalog_stats');assert.equal(stats.classes,41647);assert.equal(stats.keywords,54992);
    const rows=await call<{node_id:number|string;code:string}[]>(client,'search_catalog',{query:'13030204'});
    assert.equal(rows.length,1);assert.equal(rows[0].code,'13030204');
    const picked=await call<{node_id:string|number;code:string}>(client,'get_catalog_category',{node_id:Number(rows[0].node_id)});
    assert.equal(picked.code,'13030204');
    const invalid=await client.callTool({name:'get_catalog_category',arguments:{node_id:2147483647}});assert.equal(invalid.isError,true);
    const prompts=await client.listPrompts();assert.ok(prompts.prompts.some((p:{name:string})=>p.name==='choose_category'));
    const decision=await client.getPrompt({name:'choose_category',arguments:{description:'software development'}});
    assert.ok(JSON.stringify(decision).includes('get_catalog_category'));
    const children=await call<{is_other:boolean}[]>(client,'browse_catalog');assert.ok(children.some(c=>c.is_other));
    const denied=await client.callTool({name:'list_businesses',arguments:{}});assert.equal(denied.isError,true);
    assert.ok(JSON.stringify(denied).includes('BIZ_MCP_USER_ID'));
  }finally{await client.close();}
});

Deno.test('MCP stdio: draft, publish, edit, match, withdraw, membership checks, and cleanup',async()=>{
  const user=crypto.randomUUID();const client=await connect(user);
  const sql=postgres(databaseUrl,{max:1,prepare:false});const businessIds:number[]=[];
  try {
    const business=await call<{business_id:number|string}>(client,'create_business',{name:"MCP integration buyer's company",representative_name:'MCP integration representative'});
    const business_id=Number(business.business_id);businessIds.push(business_id);
    const classes=await call<{node_id:number|string}[]>(client,'search_catalog',{query:'13030204'});
    const args={business_id,direction:'input',kind:'service',class_node_id:Number(classes[0].node_id),title:'MCP software need',attributes:{language:'python'}};
    const draft=await call<{listing_id:string;state:string;locale:string}>(client,'create_listing_draft',args);
    assert.equal(draft.state,'draft');assert.equal(draft.locale,'us_en');
    const published=await call<{state:string}>(client,'publish_listing',{listing_id:draft.listing_id});assert.equal(published.state,'published');
    const matches=await call<unknown[]>(client,'match_businesses',{business_id});assert.ok(Array.isArray(matches));
    const updated=await call<{state:string}>(client,'edit_listing_draft',{...args,listing_id:draft.listing_id,title:'Updated MCP need'});assert.equal(updated.state,'draft');
    await call(client,'publish_listing',{listing_id:draft.listing_id});
    const withdrawn=await call<{state:string}>(client,'withdraw_listing',{listing_id:draft.listing_id});assert.equal(withdrawn.state,'withdrawn');
    const listings=await call<{listing_id:string}[]>(client,'list_listings',{business_id});assert.equal(listings.length,1);
    const invalid=await client.callTool({name:'create_listing_draft',arguments:{...args,quantity:10}});assert.equal(invalid.isError,true);
    const denied=await client.callTool({name:'read_messages',arguments:{conversation_id:crypto.randomUUID()}});assert.equal(denied.isError,true);
    const conversations=await call<unknown[]>(client,'list_conversations');assert.equal(conversations.length,0);
    const [count]=await sql`SELECT count(*)::int AS n FROM business_listing WHERE business_id=${business_id}`;assert.equal(count.n,1);
  }finally{
    await client.close();
    await sql.begin(async tx=>{
      await tx`DELETE FROM business_listing WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM business_representative WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM business WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM node_name WHERE node_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM ontology_node WHERE node_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM individual WHERE user_id=${user}`;
      await tx`DELETE FROM auth.users WHERE id=${user}`;
    });
    await sql.end({timeout:5});
  }
});
