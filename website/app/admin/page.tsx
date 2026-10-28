'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { auth, localMode, request } from '../../lib/api';
import TaxonomyTree from '../../components/TaxonomyTree';
import EclassLink from '../../components/EclassLink';
import './admin.css';
type Node={node_id:string;name:string|null;description:string|null;node_kind:string;status:string;is_other:boolean;code:string|null;relation_name?:string;edge_id?:string};
type Relation={edge_type_id:number;name:string;code:string;is_hierarchy:boolean};
type Overview={nodes:number;edges:number;collections:number;relations:Relation[]};
type Detail={node:Node;links:Node[]};
export default function Admin() {
 const [signedIn,setSignedIn]=useState(localMode),[overview,setOverview]=useState<Overview|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [query,setQuery]=useState(''),[nodes,setNodes]=useState<Node[]>([]),[page,setPage]=useState(0);
 const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null),[trail,setTrail]=useState<Node[]>([]);
 const [direction,setDirection]=useState('outgoing'),[relation,setRelation]=useState(''),[linkPage,setLinkPage]=useState(0),[revision,setRevision]=useState(0);
 const [targetQuery,setTargetQuery]=useState(''),[targets,setTargets]=useState<Node[]>([]),[target,setTarget]=useState<Node|null>(null);
 useEffect(()=>{if(!auth)return;auth.auth.getSession().then(({data})=>setSignedIn(Boolean(data.session)));const {data}=auth.auth.onAuthStateChange((_e,s)=>setSignedIn(Boolean(s)));return()=>data.subscription.unsubscribe();},[]);
 useEffect(()=>{if(!signedIn)return;request<Overview>('admin_overview').then(setOverview).catch(e=>setError(e.message));},[signedIn,revision]);
 useEffect(()=>{
  if(!overview)return;let active=true;setLoading(true);
  const timer=setTimeout(()=>request<Node[]>('admin_nodes',{query,offset:page*100}).then(r=>{if(active)setNodes(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);}),200);
  return()=>{active=false;clearTimeout(timer);};
 },[overview,query,page]);
 useEffect(()=>{
  if(!selected||!overview){setDetail(null);return;}let active=true;setDetail(null);
  request<Detail>('admin_node',{node_id:Number(selected),direction,relation_id:relation?Number(relation):null,offset:linkPage*100}).then(r=>{if(active)setDetail(r);}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[overview,selected,direction,relation,linkPage,revision]);
 useEffect(()=>{
  if(!targetQuery.trim()){setTargets([]);return;}let active=true;
  const timer=setTimeout(()=>request<Node[]>('admin_nodes',{query:targetQuery}).then(r=>{if(active)setTargets(r);}).catch(e=>{if(active)setError(e.message);}),200);
  return()=>{active=false;clearTimeout(timer);};
 },[targetQuery]);
 function choose(node:Node,fromBranch=false) {
  setSelected(String(node.node_id));setDirection('outgoing');setLinkPage(0);setRelation('');setTarget(null);setTargetQuery('');
  setTrail(fromBranch&&detail?[...trail,detail.node]:[]);
 }
 async function mutate(action:string,params:Record<string,unknown>,message:string) {
  setBusy(true);setError('');setNotice('');
  try {const result=await request<Node>(action,params);setRevision(x=>x+1);setNotice(message);return result;} catch(e){setError((e as Error).message);} finally{setBusy(false);}
 }
 async function createNode(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();const form=e.currentTarget,data=new FormData(form);
  const result=await mutate('admin_create_node',{name:data.get('name'),description:data.get('description'),kind:data.get('kind'),
    parent_id:data.get('attach')==='on'?Number(selected):null,relation_id:Number(data.get('relation'))},'Node created. Other buckets are generated for new collections.');
  if(result){form.reset();choose(result);}
 }
 const nodeButton=(node:Node,branch=false)=><button type="button" className={`admin-node ${String(node.node_id)===selected?'selected':''}`} key={node.edge_id||node.node_id} onClick={()=>choose(node,branch)}><strong>{node.name||node.node_kind}</strong><small>{node.relation_name?`${node.relation_name} · `:''}{node.is_other?'Other bucket':node.node_kind} · {node.status}</small></button>;
 return <div className="admin-shell"><header className="admin-header"><Link href="/" className="admin-brand"><img src={`${process.env.NEXT_PUBLIC_BASE_PATH||''}/image/circular.svg`} alt="circular logo" width={24} height={24}/><span className="admin-name">circular</span></Link><span>Taxonomy administration</span><Link href="/">Back to workspace ↗</Link></header>
 <main><div className="admin-intro"><span className="eyebrow">THE SEMANTIC NETWORK</span><h1>Explore. Connect. Extend.</h1><p>Navigate every node and relationship. Add concepts to the shared taxonomy.</p></div>
 {error&&<div className="error" role="alert">{error}</div>}{notice&&<p className="admin-notice" role="status">{notice}</p>}
 {!signedIn&&<section className="admin-panel"><h2>Administrator sign-in</h2><p>Use an account granted taxonomy administrator access.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(!auth)throw new Error('Supabase sign-in is not configured.');const {error}=await auth.auth.signInWithOtp({email:String(new FormData(e.currentTarget).get('email')),options:{emailRedirectTo:window.location.href}});if(error)throw error;setNotice('Check your email for the sign-in link.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>Email<input name="email" type="email" required/></label><button className="primary" disabled={busy}>Send sign-in link</button></form></section>}
 {overview&&<><div className="admin-stats"><span><strong>{overview.nodes.toLocaleString('en-US')}</strong> nodes</span><span><strong>{overview.edges.toLocaleString('en-US')}</strong> relationships</span><span><strong>{overview.collections.toLocaleString('en-US')}</strong> collections</span><span>Default locale: us_en</span></div>
 <div className="admin-grid"><section className="admin-panel admin-explorer"><h2>Taxonomy explorer</h2><label>Find a node<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Name, classification code, or node ID"/></label><button type="button" className="text-button" onClick={()=>{setQuery('');setPage(0);setSelected(null);setTrail([]);}}>Show all roots</button><p className="muted">{query?'Search results across all node kinds and states.':'Expand branches to see the hierarchy. Add children and links directly on each node.'}</p>{loading&&<p>Loading…</p>}<div className="admin-tree-scroll"><TaxonomyTree nodes={nodes.slice(0,100)} relations={overview.relations} selected={selected} revision={revision} onSelect={n=>choose(n)} onChange={()=>{setRevision(x=>x+1);setNotice('Taxonomy updated. Other buckets are generated for new collections.');}} onError={setError}/>{!loading&&!nodes.length&&<p>No nodes found.</p>}</div><div className="admin-pagination"><button disabled={!page||loading} onClick={()=>setPage(p=>p-1)}>← Previous</button><span>Page {page+1}</span><button disabled={nodes.length<=100||loading} onClick={()=>setPage(p=>p+1)}>Next →</button></div></section>
 <section className="admin-panel admin-detail"><div className="admin-trail"><button onClick={()=>{setSelected(null);setTrail([]);}}>Roots</button>{trail.map((n,i)=><button key={`${n.node_id}-${i}`} onClick={()=>{setSelected(String(n.node_id));setTrail(trail.slice(0,i));setLinkPage(0);}}> / {n.name}</button>)}</div>{detail?<><h2>{detail.node.name||detail.node.node_kind}</h2><p className="muted">{detail.node.node_kind} · {detail.node.status}{detail.node.is_other?' · Generated Other bucket':''}</p><p>{detail.node.description||'No description yet.'}</p><EclassLink code={detail.node.code}/><div className="admin-controls"><label>Follow<select value={direction} onChange={e=>{setDirection(e.target.value);setLinkPage(0);}}><option value="outgoing">Outgoing relationships</option><option value="incoming">Incoming relationships</option></select></label><label>Relation<select value={relation} onChange={e=>{setRelation(e.target.value);setLinkPage(0);}}><option value="">All relation types</option>{overview.relations.map(r=><option key={r.edge_type_id} value={r.edge_type_id}>{r.name}</option>)}</select></label></div><div className="admin-node-list">{detail.links.slice(0,100).map(n=>nodeButton(n,true))}{!detail.links.length&&<p className="muted">No {direction} relationships. Add a node or connect an existing one.</p>}</div><div className="admin-pagination"><button disabled={!linkPage} onClick={()=>setLinkPage(p=>p-1)}>← Previous</button><span>Page {linkPage+1}</span><button disabled={detail.links.length<=100} onClick={()=>setLinkPage(p=>p+1)}>Next →</button></div></>:<div className="admin-placeholder"><h2>{selected?'Loading node…':'Choose a node'}</h2><p>Explore child collections, follow semantic links, and inspect incoming relationships.</p></div>}</section>
 <aside className="admin-panel admin-editor"><h2>Add a semantic node</h2><form onSubmit={createNode}><label>Name<input name="name" required maxLength={200}/></label><label>Description<textarea name="description" maxLength={4000} rows={3}/></label><label>Node kind<select name="kind" defaultValue="topic"><option value="topic">Topic / category</option><option value="product">Product</option><option value="service">Service</option><option value="organization">Organization concept</option><option value="root">Root</option></select></label>{detail&&<><label className="admin-check"><input name="attach" type="checkbox" defaultChecked/>Connect under {detail.node.name}</label><label>Relation<select name="relation">{overview.relations.map(r=><option key={r.edge_type_id} value={r.edge_type_id}>{r.name}</option>)}</select></label></>}<button className="primary full" disabled={busy}>Create node</button></form>
 <h2>Connect existing nodes</h2><p className="muted">From: {detail?.node.name||'Select a source node'}</p><form onSubmit={async e=>{e.preventDefault();if(!selected||!target)return;await mutate('admin_create_edge',{source_id:Number(selected),target_id:Number(target.node_id),relation_id:Number(new FormData(e.currentTarget).get('relation'))},'Relationship added.');}}><label>Find target node<input value={targetQuery} onChange={e=>{setTargetQuery(e.target.value);setTarget(null);}} placeholder="Search by name or ID"/></label>{!target&&targets.length>0&&<div className="admin-targets">{targets.map(n=><button type="button" key={n.node_id} onClick={()=>{setTarget(n);setTargetQuery(n.name||'');}}>{n.name}<small>{n.node_kind}</small></button>)}</div>}{target&&<p className="admin-notice">Selected: {target.name}</p>}<label>Relation<select name="relation">{overview.relations.map(r=><option key={r.edge_type_id} value={r.edge_type_id}>{r.name}</option>)}</select></label><button className="secondary full" disabled={busy||!selected||!target}>Add relationship</button></form>
 <details className="admin-new-relation"><summary>Create a relation type</summary><form onSubmit={async e=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);if(await mutate('admin_create_relation',{name:d.get('name'),code:d.get('code'),is_hierarchy:d.get('hierarchy')==='on'},'Relation type created.'))f.reset();}}><label>Name<input name="name" required maxLength={200} placeholder="Has capability"/></label><label>Code<input name="code" required pattern="[a-z][a-z0-9_]*" maxLength={50} placeholder="has_capability"/></label><label className="admin-check"><input name="hierarchy" type="checkbox"/>Hierarchical (cycles prohibited)</label><button className="secondary full" disabled={busy}>Create relation type</button></form></details><p className="muted admin-rules">Every collection receives an Other bucket. Hierarchy cycles and duplicate relationships are rejected.</p></aside></div></>}
 </main></div>;
}
