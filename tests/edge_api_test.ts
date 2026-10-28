import { strict as assert } from 'node:assert';
import postgres from 'npm:postgres@3.4.9';
import { createHandler } from '../supabase/functions/_shared/handler.ts';

Deno.test('Edge API: publishing, authorization, matching, private chat, and request boundaries', async () => {
  const databaseUrl = Deno.env.get('BIZ_DATABASE_URL') || `postgresql://${Deno.env.get('USER')}@localhost:5432/biz`;
  if (!['localhost','127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Tests require a local database.');
  const users = [crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const sql = postgres(databaseUrl,{prepare:false,max:1});
  const options = {databaseUrl,allowedOrigins:['http://127.0.0.1:3000']};
  const apps = users.map(localUser=>createHandler({...options,localUser}));
  const hosted = createHandler(options);
  const businessIds: number[] = [];
  async function call(app: typeof hosted, body: Record<string,unknown>, expected=200) {
    const response = await app.handler(new Request('http://127.0.0.1:8787',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000'},body:JSON.stringify(body)}));
    const result = await response.json();
    assert.equal(response.status,expected,JSON.stringify(result));return result.data;
  }
  try {
    const [category] = await sql`SELECT node_id FROM ontology_node_source WHERE code='13030204'`;
    const verified=await call(hosted,{action:'catalog_category',node_id:Number(category.node_id)});
    assert.equal(verified.code,'13030204');
    const trail=await call(hosted,{action:'category_path',node_id:Number(category.node_id)});
    assert.ok(trail.length >= 2);assert.equal(trail[trail.length-1].name,verified.name);
    await call(hosted,{action:'category_path',node_id:2147483647});
    await call(hosted,{action:'catalog_category',node_id:2147483647},404);
    const [regions]=await sql`SELECT biz_regions_overlap(ARRAY['GLOBAL'],ARRAY['JP']) AS global,
      biz_regions_overlap(ARRAY['EUROPE'],ARRAY['FR']) AS continent,
      biz_regions_overlap(ARRAY['EU'],ARRAY['DE']) AS union_match,
      biz_regions_overlap(ARRAY['EU'],ARRAY['JP']) AS separate,
      biz_regions_overlap(ARRAY[]::text[],ARRAY['FR']) AS unknown`;
    assert.deepEqual(regions,{global:true,continent:true,union_match:true,separate:false,unknown:true});
    const buyer = await call(apps[0],{action:'create_business',name:"API Test Buyer's Company",representative_name:'API buyer'});
    businessIds.push(Number(buyer.business_id));
    const seller = await call(apps[1],{action:'create_business',name:'API Test Supplier',representative_name:'API seller'});
    businessIds.push(Number(seller.business_id));
    const fields = {kind:'service',class_node_id:Number(category.node_id),title:'API integration listing',regions:['fr'],
      quantity:100,quantity_unit:'hour',attributes:{language:'python'}};
    const need = await call(apps[0],{action:'save_listing',business_id:buyer.business_id,direction:'input',...fields});
    const offer = await call(apps[1],{action:'save_listing',business_id:seller.business_id,direction:'output',...fields});
    assert.equal(need.available_until,null);assert.equal(offer.available_until,null);
    assert.equal(need.locale,'us_en');assert.equal(need.state,'draft');assert.deepEqual(need.regions,['FR']);
    const [counts] = await sql`SELECT count(*)::int AS n FROM business_listing WHERE business_id IN ${sql(businessIds)}`;
    assert.equal(counts.n,2,'Composite-return expansion must not create multiple listings');
    await call(apps[2],{action:'listing_state',listing_id:offer.listing_id,state:'published',actor_id:seller.individual_id},403);
    await call(hosted,{action:'workspace',user_id:users[0]},401);
    await call(apps[0],{action:'listing_state',listing_id:need.listing_id,state:'published'});
    await call(apps[1],{action:'listing_state',listing_id:offer.listing_id,state:'published'});
    const matches=await call(apps[0],{action:'matches',business_id:buyer.business_id});
    const match=matches.find((m: {offer_listing_id:string})=>m.offer_listing_id===offer.listing_id);
    assert.ok(match);assert.equal(match.match_type,'same_class');assert.equal(match.score,100);
    await call(apps[2],{action:'matches',business_id:buyer.business_id},403);
    const room=await call(apps[0],{action:'start_conversation',business_id:buyer.business_id,
      request_listing_id:need.listing_id,offer_listing_id:offer.listing_id});
    await call(apps[0],{action:'send_message',conversation_id:room.conversation_id,content:'Integration check: can you confirm availability?'});
    const messages=await call(apps[1],{action:'messages',conversation_id:room.conversation_id});
    assert.equal(messages.length,1);assert.equal(messages[0].sender_name,'API buyer');
    await call(apps[2],{action:'messages',conversation_id:room.conversation_id},403);
    await call(apps[2],{action:'send_message',conversation_id:room.conversation_id,content:'Unauthorized'},403);
    const outsiderRooms=await call(apps[2],{action:'conversations'});assert.equal(outsiderRooms.length,0);
    await call(apps[0],{action:'save_listing',listing_id:need.listing_id,business_id:buyer.business_id,
      direction:'input',...fields,title:'Updated draft'});
    const updated=await call(apps[0],{action:'listings',business_id:buyer.business_id});
    assert.equal(updated.length,1);assert.equal(updated[0].state,'draft');
    await call(apps[2],{action:'delete_business',business_id:buyer.business_id},403);
    const removed=await call(apps[0],{action:'delete_business',business_id:buyer.business_id});
    assert.equal(Number(removed.deleted),Number(buyer.business_id));
    await call(apps[0],{action:'listings',business_id:buyer.business_id},403);
    const gone=await sql`SELECT count(*)::int AS n FROM business WHERE business_id=${buyer.business_id}`;
    assert.equal(gone[0].n,0);
    const sellerRooms=await call(apps[1],{action:'conversations'});
    assert.equal(sellerRooms.length,0);
    const forbidden=await apps[0].handler(new Request('http://127.0.0.1:8787',{
      method:'POST',headers:{Origin:'https://untrusted.example'},body:'{"action":"stats"}'}));
    assert.equal(forbidden.status,403);await forbidden.text();
    const oversized=await apps[0].handler(new Request('http://127.0.0.1:8787',{method:'POST',body:'x'.repeat(40000)}));
    assert.equal(oversized.status,413);await oversized.text();
  } finally {
    await sql.begin(async tx=>{
      await tx`DELETE FROM biz_message WHERE conversation_id IN (SELECT conversation_id FROM biz_conversation WHERE buyer_business_id IN ${tx(businessIds)})`;
      await tx`DELETE FROM biz_conversation WHERE buyer_business_id IN ${tx(businessIds)} OR seller_business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM business_listing WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM business_representative WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM business WHERE business_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM node_name WHERE node_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM ontology_node WHERE node_id IN ${tx(businessIds)}`;
      await tx`DELETE FROM individual WHERE user_id IN ${tx(users)}`;
      await tx`DELETE FROM auth.users WHERE id IN ${tx(users)}`;
    });
    await Promise.all([...apps.map(app=>app.close()),hosted.close(),sql.end({timeout:5})]);
  }
});
