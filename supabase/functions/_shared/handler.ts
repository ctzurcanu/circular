import postgres from 'npm:postgres@3.4.9';

type Options = { databaseUrl: string; allowedOrigins: string[]; supabaseUrl?: string; publishableKey?: string; localUser?: string };
type User = { id: string; email?: string };
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function text(value: unknown, label: string, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, `${label} is required (up to ${max} characters).`);
  return value.trim();
}
function id(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'Choose a valid business or category.');
  return n;
}
function uuid(value: unknown) {
  const v = text(value, 'Listing ID', 40);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)) throw new ApiError(400, 'Invalid listing ID.');
  return v;
}
export function listingFields(body: Record<string, unknown>) {
  const direction = text(body.direction, 'Direction'), kind = text(body.kind, 'Kind');
  if (!['input','output'].includes(direction) || !['product','service'].includes(kind)) throw new ApiError(400, 'Choose an input/output and product/service.');
  const quantity = body.quantity == null || body.quantity === '' ? null : Number(body.quantity);
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new ApiError(400, 'Quantity must be greater than zero.');
  const unit = quantity == null ? null : text(body.quantity_unit, 'Quantity unit', 50);
  const regions = body.regions ?? [];
  if (!Array.isArray(regions) || regions.length > 30 || !regions.every(x => typeof x === 'string' && x.length <= 50)) throw new ApiError(400, 'Invalid delivery regions.');
  const attributes = body.attributes ?? {};
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes) || Object.keys(attributes).length > 30) throw new ApiError(400, 'Invalid specifications.');
  const date = (v: unknown) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ApiError(400, 'Dates must use YYYY-MM-DD.');
    return v;
  };
  return {direction, kind, category: id(body.class_node_id), title: text(body.title, 'Title'),
    description: body.description ? text(body.description, 'Description', 4000) : null,
    quantity, unit, regions, attributes: attributes as Record<string, postgres.JSONValue>,
    from: date(body.available_from), until: date(body.available_until)};
}

export function createHandler(options: Options) {
  const databaseHost = new URL(options.databaseUrl).hostname;
  const sql = postgres(options.databaseUrl, {max: 3, prepare: false, connect_timeout: 10,
    ssl: ['localhost','127.0.0.1','::1'].includes(databaseHost) ? false : 'require',
    connection: {statement_timeout: 20000}, idle_timeout: 20});
  async function authenticate(req: Request): Promise<User> {
    // This bypass is passed ONLY by local.ts, never by the hosted entry point.
    if (options.localUser && ['localhost','127.0.0.1'].includes(new URL(req.url).hostname)) return {id: options.localUser};
    const token = req.headers.get('Authorization');
    if (!token?.startsWith('Bearer ') || !options.supabaseUrl || !options.publishableKey) throw new ApiError(401, 'Sign in to manage your business.');
    const response = await fetch(`${options.supabaseUrl}/auth/v1/user`, {
      headers: {Authorization: token, apikey: options.publishableKey}, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ApiError(401, 'Your session has expired. Please sign in again.');
    const user = await response.json();
    if (typeof user.id !== 'string') throw new ApiError(401, 'Invalid session.');
    return {id: user.id, email: user.email};
  }
  async function actor(user: User, business: number) {
    const rows = await sql`SELECT i.individual_id FROM public.individual i JOIN public.business_representative r USING(individual_id)
      WHERE i.user_id=${user.id} AND r.business_id=${business}`;
    if (!rows.length) throw new ApiError(403, 'You do not represent this business.');
    return rows[0].individual_id as string;
  }
  async function route(body: Record<string, unknown>, req: Request): Promise<unknown> {
    const action = text(body.action, 'Action');
    if (action === 'stats') return (await sql`SELECT (SELECT count(*) FROM ontology_node_source)::int AS classes,
      (SELECT count(*) FROM ontology_node_alias)::int AS keywords`)[0];
    if (action === 'catalog') return await sql`SELECT * FROM search_catalog(${text(body.query,'Search',100)},50,'us_en')`;
    if (action === 'catalog_category') {
      const [category] = await sql`SELECT n.node_id,nn.name,nn.description,s.code,s.level,n.is_other,
        pn.name AS parent_name,ps.code AS parent_code
        FROM ontology_node n JOIN node_name nn ON nn.node_id=n.node_id AND nn.locale='us_en'
        LEFT JOIN ontology_node_source s ON s.node_id=n.node_id
        LEFT JOIN ontology_collection c ON c.other_node_id=n.node_id
        LEFT JOIN node_name pn ON pn.node_id=c.parent_id AND pn.locale='us_en'
        LEFT JOIN ontology_node_source ps ON ps.node_id=c.parent_id
        WHERE n.node_id=${id(body.node_id)} AND n.status='published'
          AND (s.node_id IS NOT NULL OR c.other_node_id IS NOT NULL)`;
      if(!category) throw new ApiError(404,'That category was not found in the published catalog.');
      return category;
    }
    if (action === 'catalog_children') {
      const parent = body.parent_id == null ? null : id(body.parent_id);
      return await sql`SELECT n.node_id, nn.name, nn.description, s.code, s.level, n.is_other,
        CASE WHEN n.is_other THEN pn.name END AS parent_name, CASE WHEN n.is_other THEN ps.code END AS parent_code
        FROM ontology_edge e JOIN edge_type t USING(edge_type_id) JOIN ontology_node n ON n.node_id=e.target_id
        JOIN node_name nn ON nn.node_id=n.node_id AND nn.locale='us_en' LEFT JOIN ontology_node_source s ON s.node_id=n.node_id
        LEFT JOIN node_name pn ON pn.node_id=e.source_id AND pn.locale='us_en'
        LEFT JOIN ontology_node_source ps ON ps.node_id=e.source_id
        WHERE t.code='subtype' AND n.status='published' AND e.source_id=coalesce(${parent},
          (SELECT root_node_id FROM catalog_release WHERE source='ECLASS' AND version='10.0.1' AND locale='us_en'))
        ORDER BY n.is_other, s.code NULLS LAST, nn.name LIMIT 250`;
    }
    if (action === 'category_path') {
      return await sql`SELECT a.ancestor_id AS node_id, nn.name
        FROM catalog_ancestor a JOIN node_name nn ON nn.node_id=a.ancestor_id AND nn.locale='us_en'
        WHERE a.descendant_id=${id(body.node_id)} ORDER BY a.distance DESC`;
    }
    const user = await authenticate(req);
    if (action.startsWith('admin_')) {
      const localAdmin = options.localUser === '00000000-0000-4000-8000-000000000001';
      if (!localAdmin && !(await sql`SELECT 1 FROM biz_admin WHERE user_id=${user.id}`).length)
        throw new ApiError(403,'Taxonomy administrator access is required.');
      const offset=body.offset==null?0:Number(body.offset);
      if(!Number.isSafeInteger(offset)||offset<0) throw new ApiError(400,'Invalid page.');
      if(action==='admin_overview') return {
        ...(await sql`SELECT (SELECT count(*)::int FROM ontology_node) AS nodes,
          (SELECT count(*)::int FROM ontology_edge) AS edges,
          (SELECT count(*)::int FROM ontology_collection) AS collections`)[0],
        relations:await sql`SELECT * FROM edge_type ORDER BY edge_type_id`};
      if(action==='admin_nodes') {
        const query=typeof body.query==='string'?body.query.trim().slice(0,100):'';
        return await sql`SELECT n.node_id,n.node_kind,n.status,n.is_other,nn.name,nn.description,s.code
          FROM ontology_node n LEFT JOIN node_name nn ON nn.node_id=n.node_id AND nn.locale='us_en'
          LEFT JOIN ontology_node_source s ON s.node_id=n.node_id
          WHERE (${query}<>'' AND (nn.name ILIKE ${'%'+query+'%'} OR s.code=${query} OR n.node_id::text=${query}))
            OR (${query}='' AND NOT EXISTS(SELECT 1 FROM ontology_edge e JOIN edge_type t USING(edge_type_id)
              WHERE e.target_id=n.node_id AND t.is_hierarchy))
          ORDER BY n.node_id LIMIT 101 OFFSET ${offset}`;
      }
      if(action==='admin_node') {
        const node=id(body.node_id);
        const [selected]=await sql`SELECT n.*,nn.name,nn.description,s.code FROM ontology_node n
          LEFT JOIN node_name nn ON nn.node_id=n.node_id AND nn.locale='us_en'
          LEFT JOIN ontology_node_source s ON s.node_id=n.node_id WHERE n.node_id=${node}`;
        if(!selected) throw new ApiError(404,'Node not found.');
        const direction=body.direction==='incoming'?'incoming':'outgoing';
        const relation=body.relation_id==null?null:id(body.relation_id);
        const links=await sql`SELECT e.edge_id,t.edge_type_id,t.name AS relation_name,t.is_hierarchy,
          n.node_id,n.node_kind,n.status,n.is_other,nn.name,nn.description,s.code
          FROM ontology_edge e JOIN edge_type t USING(edge_type_id)
          JOIN ontology_node n ON n.node_id=CASE WHEN ${direction}='incoming' THEN e.source_id ELSE e.target_id END
          LEFT JOIN node_name nn ON nn.node_id=n.node_id AND nn.locale='us_en'
          LEFT JOIN ontology_node_source s ON s.node_id=n.node_id
          WHERE (CASE WHEN ${direction}='incoming' THEN e.target_id ELSE e.source_id END)=${node}
            AND (${relation}::int IS NULL OR t.edge_type_id=${relation})
          ORDER BY t.edge_type_id,n.is_other,n.node_id LIMIT 101 OFFSET ${offset}`;
        return {node:selected,links};
      }
      if(action==='admin_create_node') {
        const name=text(body.name,'Name'),kind=text(body.kind,'Node kind');
        if(!['root','topic','product','service','organization'].includes(kind)) throw new ApiError(400,'Invalid node kind.');
        const parent=body.parent_id==null?null:id(body.parent_id);
        const relation=parent===null?null:id(body.relation_id);
        return await sql.begin(async tx=>{
          if(localAdmin) await tx`INSERT INTO auth.users(id) VALUES (${user.id}) ON CONFLICT DO NOTHING`;
          const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'node';
          const [node]=await tx`INSERT INTO ontology_node(slug,node_kind,created_by) VALUES (${slug},${kind},${user.id}) RETURNING *`;
          await tx`INSERT INTO node_name(node_id,locale,name,description,source) VALUES (${node.node_id},'us_en',${name},${body.description?text(body.description,'Description',4000):null},'human')`;
          if(['product','service'].includes(kind)) await tx`INSERT INTO product_service(node_id,node_kind,is_category) VALUES (${node.node_id},${kind},true)`;
          if(parent!==null) await tx`INSERT INTO ontology_edge(source_id,target_id,edge_type_id) VALUES (${parent},${node.node_id},${relation})`;
          return {...node,name};
        });
      }
      if(action==='admin_create_edge') {
        return (await sql`INSERT INTO ontology_edge(source_id,target_id,edge_type_id)
          VALUES (${id(body.source_id)},${id(body.target_id)},${id(body.relation_id)}) RETURNING *`)[0];
      }
      if(action==='admin_create_relation') {
        const code=text(body.code,'Relation code',50);
        if(!/^[a-z][a-z0-9_]*$/.test(code)||typeof body.is_hierarchy!=='boolean') throw new ApiError(400,'Use a lowercase relation code and choose its hierarchy setting.');
        return (await sql`INSERT INTO edge_type(code,name,is_hierarchy) VALUES (${code},${text(body.name,'Relation name')},${body.is_hierarchy}) RETURNING *`)[0];
      }
      throw new ApiError(400,'Unknown administrator action.');
    }

    if (action === 'workspace') return await sql`SELECT b.business_id, coalesce(nn.name,b.legal_name,'Business') AS name,
      i.individual_id FROM business b JOIN business_representative r USING(business_id)
      JOIN individual i USING(individual_id) JOIN ontology_node n ON n.node_id=b.business_id
      LEFT JOIN node_name nn ON nn.node_id=b.business_id AND nn.locale='us_en'
      WHERE i.user_id=${user.id} AND n.status='published' ORDER BY b.business_id`;
    if (action === 'conversations') return await sql`SELECT c.*, a.title AS buyer_title,o.title AS seller_title,
      bi.display_name AS buyer_name,si.display_name AS seller_name,
      (SELECT content FROM biz_message m WHERE m.conversation_id=c.conversation_id ORDER BY created_at DESC,message_id DESC LIMIT 1) AS last_message
      FROM biz_conversation c JOIN biz_conversation_member cm USING(conversation_id)
      JOIN individual me ON me.individual_id=cm.individual_id JOIN business_listing a ON a.listing_id=c.request_listing_id
      JOIN business_listing o ON o.listing_id=c.offer_listing_id
      JOIN individual bi ON bi.individual_id=c.buyer_representative_id JOIN individual si ON si.individual_id=c.seller_representative_id
      WHERE me.user_id=${user.id} ORDER BY c.created_at DESC LIMIT 50`;
    if (action === 'messages' || action === 'send_message') {
      const room = uuid(body.conversation_id);
      const [member] = await sql`SELECT i.individual_id FROM biz_conversation_member cm JOIN individual i USING(individual_id)
        WHERE cm.conversation_id=${room} AND i.user_id=${user.id}`;
      if (!member) throw new ApiError(403,'You are not a member of this conversation.');
      if (action === 'send_message') return (await sql`INSERT INTO biz_message(conversation_id,sender_id,content)
        VALUES (${room},${member.individual_id},${text(body.content,'Message',4000)}) RETURNING *`)[0];
      const rows = await sql`SELECT m.*,i.display_name AS sender_name FROM biz_message m JOIN individual i ON i.individual_id=m.sender_id
        WHERE conversation_id=${room} ORDER BY created_at DESC,message_id DESC LIMIT 100`;
      return rows.reverse();
    }
    if (action === 'create_business') {
      const name = text(body.name, 'Business name'), person = text(body.representative_name,'Your name');
      return await sql.begin(async tx => {
        if (options.localUser) await tx`INSERT INTO auth.users(id) VALUES (${user.id}) ON CONFLICT DO NOTHING`;
        const [profile] = await tx`INSERT INTO individual(user_id,display_name,email) VALUES (${user.id},${person},${user.email ?? null})
          ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name RETURNING individual_id`;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'business';
        const [node] = await tx`INSERT INTO ontology_node(slug,node_kind) VALUES (${slug},'organization') RETURNING node_id`;
        await tx`INSERT INTO business(business_id,legal_name) VALUES (${node.node_id},${name})`;
        await tx`INSERT INTO node_name(node_id,name,source) VALUES (${node.node_id},${name},'human')`;
        await tx`INSERT INTO business_representative(business_id,individual_id,is_primary)
          VALUES (${node.node_id},${profile.individual_id},true)`;
        return {business_id: node.node_id, name, individual_id: profile.individual_id};
      });
    }
    if (action === 'delete_business') return await sql.begin(async tx => {
      const bid = id(body.business_id);
      await actor(user, bid);
      const [exists] = await tx`SELECT 1 FROM business WHERE business_id=${bid}`;
      if (!exists) throw new ApiError(404, 'Business not found.');
      await tx`DELETE FROM biz_message WHERE conversation_id IN
        (SELECT conversation_id FROM biz_conversation WHERE buyer_business_id=${bid} OR seller_business_id=${bid})`;
      await tx`DELETE FROM biz_conversation_member WHERE conversation_id IN
        (SELECT conversation_id FROM biz_conversation WHERE buyer_business_id=${bid} OR seller_business_id=${bid})`;
      await tx`DELETE FROM biz_conversation WHERE buyer_business_id=${bid} OR seller_business_id=${bid}`;
      await tx`DELETE FROM business_listing WHERE business_id=${bid}`;
      await tx`DELETE FROM business_input WHERE business_id=${bid}`;
      await tx`DELETE FROM business_output WHERE business_id=${bid}`;
      await tx`DELETE FROM business_representative WHERE business_id=${bid}`;
      await tx`DELETE FROM business WHERE business_id=${bid}`;
      await tx`DELETE FROM node_name WHERE node_id=${bid}`;
      await tx`DELETE FROM ontology_edge WHERE source_id=${bid} OR target_id=${bid}`;
      await tx`DELETE FROM ontology_node WHERE node_id=${bid}`;
      return {deleted: bid};
    });
    if (action === 'listing_state') {
      const listing = uuid(body.listing_id), state = text(body.state,'State');
      const [row] = await sql`SELECT business_id FROM business_listing WHERE listing_id=${listing}`;
      if (!row) throw new ApiError(404, 'Listing not found.');
      const representative = await actor(user, Number(row.business_id));
      return (await sql`SELECT r.* FROM set_listing_state(${listing}::uuid,${representative}::uuid,${state}) r`)[0];
    }
    const business = id(body.business_id), representative = await actor(user,business);
    if (action === 'start_conversation') {
      const need = uuid(body.request_listing_id), offer = uuid(body.offer_listing_id);
      return await sql.begin(async tx => {
        const [match] = await tx`SELECT * FROM match_businesses(${business},${body.direction === 'output' ? 'output' : 'input'},6,500)
          WHERE request_listing_id=${need} AND offer_listing_id=${offer}`;
        if (!match) throw new ApiError(400,'These listings are no longer a current match.');
        const buyerRep = Number(match.buyer_business_id) === business ? representative : match.buyer_representative_id;
        const sellerRep = Number(match.seller_business_id) === business ? representative : match.seller_representative_id;
        const [room] = await tx`INSERT INTO biz_conversation(request_listing_id,offer_listing_id,buyer_business_id,seller_business_id,buyer_representative_id,seller_representative_id)
          VALUES (${need},${offer},${match.buyer_business_id},${match.seller_business_id},${buyerRep},${sellerRep})
          ON CONFLICT(request_listing_id,offer_listing_id,buyer_representative_id,seller_representative_id)
          DO UPDATE SET conversation_id=biz_conversation.conversation_id RETURNING *`;
        await tx`INSERT INTO biz_conversation_member(conversation_id,individual_id) VALUES
          (${room.conversation_id},${buyerRep}),(${room.conversation_id},${sellerRep}) ON CONFLICT DO NOTHING`;
        return room;
      });
    }
    if (action === 'listings') return await sql`SELECT l.*, nn.name AS class_name, s.code FROM business_listing l
      JOIN node_name nn ON nn.node_id=l.class_node_id AND nn.locale='us_en'
      LEFT JOIN ontology_node_source s ON s.node_id=l.class_node_id WHERE l.business_id=${business} ORDER BY l.created_at DESC`;
    if (action === 'save_listing') {
      const f = listingFields(body);
      if (body.listing_id) {
        const listing = uuid(body.listing_id);
        const rows = await sql`UPDATE business_listing SET direction=${f.direction},kind=${f.kind},class_node_id=${f.category},
          title=${f.title},description=${f.description},quantity=${f.quantity},quantity_unit=${f.unit},regions=${sql.array(f.regions)},
          available_from=${f.from},available_until=${f.until},attributes=${sql.json(f.attributes)},state='draft'
          WHERE listing_id=${listing} AND business_id=${business} RETURNING *`;
        if (!rows.length) throw new ApiError(404, 'Listing not found.');
        return rows[0];
      }
      return (await sql`SELECT r.* FROM create_business_listing(${business},${representative}::uuid,${f.direction},${f.kind},${f.category},
        ${f.title},${f.description},${f.quantity}::numeric,${f.unit},${sql.array(f.regions)}::text[],
        ${f.from}::date,${f.until}::date,${sql.json(f.attributes)}::jsonb) r`)[0];
    }
    if (action === 'matches') {
      const direction = body.direction === 'output' ? 'output' : 'input';
      const distance = body.distance == null ? 2 : Number(body.distance);
      if (!Number.isInteger(distance) || distance < 0 || distance > 6) throw new ApiError(400,'Distance must be 0–6.');
      return await sql`SELECT m.*, coalesce(bn.name,bb.legal_name,'Business') AS buyer_business_name,
        coalesce(sn.name,sb.legal_name,'Business') AS seller_business_name
        FROM match_businesses(${business},${direction},${distance},50) m
        JOIN business bb ON bb.business_id=m.buyer_business_id JOIN business sb ON sb.business_id=m.seller_business_id
        LEFT JOIN node_name bn ON bn.node_id=bb.business_id AND bn.locale='us_en'
        LEFT JOIN node_name sn ON sn.node_id=sb.business_id AND sn.locale='us_en'`;
    }
    throw new ApiError(400,'Unknown action.');
  }
  const handler = async (req: Request) => {
    const origin = req.headers.get('Origin');
    const allowed = !origin || options.allowedOrigins.includes(origin);
    const headers = {'Content-Type':'application/json', 'Vary':'Origin',
      ...(origin && allowed ? {'Access-Control-Allow-Origin':origin}:{}),
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS'};
    if (!allowed) return new Response(JSON.stringify({error:'Origin not allowed.'}),{status:403,headers});
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (req.method !== 'POST') return new Response(JSON.stringify({error:'Use POST.'}),{status:405,headers});
    try {
      // Bound streaming bodies as well as bodies with a Content-Length header.
      const reader = req.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
      if (reader) while (true) {
        const {done,value} = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > 32768) {await reader.cancel(); throw new ApiError(413,'Request too large.');}
        chunks.push(value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) {joined.set(chunk,offset); offset += chunk.length;}
      let body: Record<string,unknown>;
      try {body = JSON.parse(new TextDecoder().decode(joined));} catch {throw new ApiError(400,'Invalid JSON.');}
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400,'Expected a request object.');
      return new Response(JSON.stringify({data:await route(body,req)}),{headers});
    } catch (error) {
      if (error instanceof ApiError) return new Response(JSON.stringify({error:error.message}),{status:error.status,headers});
      if (error instanceof postgres.PostgresError && ['23505','23514','23502','23503','22007','22008','P0001'].includes(error.code)) {
        return new Response(JSON.stringify({error:error.code==='23505' ? 'That relationship or relation code already exists.' : error.code==='P0001' ? error.message : 'Check the category, quantity, dates, and representative.'}),{status:400,headers});
      }
      console.error('biz-api request failed',error instanceof Error ? error.name : 'Unknown error');
      return new Response(JSON.stringify({error:'The request could not be completed. Please try again.'}),{status:500,headers});
    }
  };
  return {handler, close: () => sql.end({timeout:5})};
}
