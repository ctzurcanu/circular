import {strict as assert} from 'node:assert';
import postgres from 'npm:postgres@3.4.9';
import {createHandler} from '../supabase/functions/_shared/handler.ts';
Deno.test('Taxonomy admin: authorization, full graph traversal, atomic creation, Other collections and cycle protection',async()=>{
 const databaseUrl=`postgresql://${Deno.env.get('USER')}@localhost:5432/biz`;
 const sql=postgres(databaseUrl,{max:1,prepare:false});
 const admin=createHandler({databaseUrl,allowedOrigins:[],localUser:'00000000-0000-4000-8000-000000000001'});
 const outsiderId=crypto.randomUUID();
 const outsider=createHandler({databaseUrl,allowedOrigins:[],localUser:outsiderId});
 const hosted=createHandler({databaseUrl,allowedOrigins:[]});
 const nodes:number[]=[];let relationId:number|null=null;
 async function call(app:typeof admin,action:string,params:Record<string,unknown>={},status=200) {
  const response=await app.handler(new Request('http://127.0.0.1:8787',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...params})}));
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;
 }
 try {
  for(const action of ['admin_overview','admin_nodes','admin_node','admin_create_node','admin_create_edge','admin_create_relation']) {
   await call(outsider,action,{},403);await call(hosted,action,{},401);
  }
  await sql`INSERT INTO auth.users(id) VALUES (${outsiderId})`;
  await sql`INSERT INTO biz_admin(user_id) VALUES (${outsiderId})`;
  assert.ok((await call(outsider,'admin_overview')).nodes>0);
  await sql`DELETE FROM biz_admin WHERE user_id=${outsiderId}`;
  await call(outsider,'admin_overview',{},403);
  const summary=await call(admin,'admin_overview');assert.ok(summary.nodes>41647);assert.ok(summary.edges>41647);
  const roots=await call(admin,'admin_nodes');assert.ok(roots.length>0);
  const key='admin_test_'+crypto.randomUUID().replaceAll('-','');
  const relation=await call(admin,'admin_create_relation',{code:key,name:'Test hierarchy',is_hierarchy:true});relationId=relation.edge_type_id;
  const root=await call(admin,'admin_create_node',{name:key,kind:'root'});nodes.push(Number(root.node_id));
  const child=await call(admin,'admin_create_node',{name:'Test custom service',kind:'service',description:'Admin test description',parent_id:Number(root.node_id),relation_id:relationId});nodes.push(Number(child.node_id));
  const detail=await call(admin,'admin_node',{node_id:Number(root.node_id)});
  assert.ok(detail.links.some((n:{node_id:string})=>Number(n.node_id)===Number(child.node_id)));
  const other=detail.links.filter((n:{is_other:boolean})=>n.is_other);assert.equal(other.length,1);
  const incoming=await call(admin,'admin_node',{node_id:Number(child.node_id),direction:'incoming'});assert.equal(incoming.links[0].name,key);
  await call(admin,'admin_create_edge',{source_id:Number(child.node_id),target_id:Number(root.node_id),relation_id:relationId},400);
  await call(admin,'admin_create_edge',{source_id:Number(root.node_id),target_id:Number(child.node_id),relation_id:relationId},400);
  const search=await call(admin,'admin_nodes',{query:key});assert.ok(search.some((n:{node_id:string})=>Number(n.node_id)===Number(root.node_id)));
  const invalidName='atomic_'+key;
  await call(admin,'admin_create_node',{name:invalidName,kind:'topic',parent_id:2147483647,relation_id:relationId},400);
  assert.equal((await call(admin,'admin_nodes',{query:invalidName})).length,0);
  const leaf=await call(admin,'admin_create_node',{name:'Test independent concept',kind:'topic'});nodes.push(Number(leaf.node_id));
  await call(admin,'admin_create_edge',{source_id:Number(child.node_id),target_id:Number(leaf.node_id),relation_id:relationId});
  const linked=await call(admin,'admin_node',{node_id:Number(child.node_id),relation_id:relationId});assert.equal(linked.links.length,2);
 }finally {
  // Temporarily remove only these test collections in one transaction. Their
  // mandatory edges cannot be removed until the collection records are gone.
  await sql.begin(async tx=>{
   await tx`SELECT pg_advisory_xact_lock(7310042)`;
   await tx`ALTER TABLE ontology_collection DISABLE TRIGGER ontology_collection_identity`;
   const others=await tx`SELECT other_node_id FROM ontology_collection WHERE parent_id IN ${tx(nodes)}`;
   const all=[...nodes,...others.map(n=>Number(n.other_node_id))];
   await tx`DELETE FROM ontology_collection WHERE parent_id IN ${tx(nodes)}`;
   await tx`DELETE FROM ontology_edge WHERE source_id IN ${tx(all)} OR target_id IN ${tx(all)}`;
   await tx`DELETE FROM product_service WHERE node_id IN ${tx(all)}`;
   await tx`DELETE FROM node_name WHERE node_id IN ${tx(all)}`;
   await tx`DELETE FROM ontology_node WHERE node_id IN ${tx(all)}`;
   await tx`ALTER TABLE ontology_collection ENABLE TRIGGER ontology_collection_identity`;
   if(relationId) await tx`DELETE FROM edge_type WHERE edge_type_id=${relationId}`;
   await tx`DELETE FROM biz_admin WHERE user_id=${outsiderId}`;
   await tx`DELETE FROM auth.users WHERE id=${outsiderId}`;
  });
  await Promise.all([admin.close(),outsider.close(),hosted.close(),sql.end({timeout:5})]);
 }
});
