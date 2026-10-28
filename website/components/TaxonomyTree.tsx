'use client';
import { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
export type TreeNode={node_id:string;name:string|null;description:string|null;node_kind:string;status:string;is_other:boolean;code:string|null;relation_name?:string;edge_id?:string;edge_type_id?:number;is_hierarchy?:boolean};
type Relation={edge_type_id:number;name:string;code:string;is_hierarchy:boolean};
type Props={nodes:TreeNode[];relations:Relation[];selected:string|null;revision:number;onSelect:(node:TreeNode)=>void;onChange:()=>void;onError:(message:string)=>void};
export default function TaxonomyTree(props:Props) {
 return <ul className="taxonomy-tree" aria-label="Expandable taxonomy">{props.nodes.map(n=><Branch key={n.edge_id||n.node_id} {...props} node={n} ancestors={[]}/>)}</ul>;
}
function Branch(props:Props&{node:TreeNode;ancestors:string[]}) {
 const {node,relations,revision,onError,onChange}=props,name=node.name||node.node_kind;
 const [expanded,setExpanded]=useState(false),[children,setChildren]=useState<TreeNode[]>([]),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false);
 const [editor,setEditor]=useState<'child'|'link'|null>(null),[busy,setBusy]=useState(false);
 const [search,setSearch]=useState(''),[targets,setTargets]=useState<TreeNode[]>([]),[target,setTarget]=useState<TreeNode|null>(null);
 const [relation,setRelation]=useState(String(relations.find(r=>r.code==='subtype')?.edge_type_id||relations[0]?.edge_type_id||''));
 const repeated=props.ancestors.includes(String(node.node_id));
 useEffect(()=>{
  if(!expanded||repeated)return;let active=true;setLoading(true);
  request<{links:TreeNode[]}>('admin_node',{node_id:Number(node.node_id),offset:0})
   .then(r=>{if(active){setChildren(r.links.slice(0,100));setHasMore(r.links.length>100);}})
   .catch(e=>{if(active)onError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[expanded,revision,node.node_id,repeated]);
 useEffect(()=>{
  if(editor!=='link'||!search.trim()){setTargets([]);return;}let active=true;
  const timer=setTimeout(()=>request<TreeNode[]>('admin_nodes',{query:search}).then(r=>{if(active)setTargets(r.filter(n=>String(n.node_id)!==String(node.node_id)));}).catch(e=>{if(active)onError(e.message);}),200);
  return()=>{active=false;clearTimeout(timer);};
 },[search,editor,node.node_id]);
 async function more() {
  setLoading(true);try {
   const r=await request<{links:TreeNode[]}>('admin_node',{node_id:Number(node.node_id),offset:children.length});
   setChildren(xs=>[...xs,...r.links.slice(0,100)]);setHasMore(r.links.length>100);
  }catch(e){onError((e as Error).message);}finally{setLoading(false);}
 }
 async function save(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();setBusy(true);const form=e.currentTarget,data=new FormData(form);
  try {
   if(editor==='child') await request('admin_create_node',{name:data.get('name'),description:data.get('description'),kind:data.get('kind'),parent_id:Number(node.node_id),relation_id:Number(relation)});
   else {if(!target)throw new Error('Choose an existing target node.');await request('admin_create_edge',{source_id:Number(node.node_id),target_id:Number(target.node_id),relation_id:Number(relation)});}
   setEditor(null);setExpanded(true);setTarget(null);setSearch('');onChange();
  }catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 const grouped=new Map<number,TreeNode[]>();for(const child of children){const key=child.edge_type_id||0;grouped.set(key,[...(grouped.get(key)||[]),child]);}
 return <li className="taxonomy-branch"><div className={`tree-row ${String(node.node_id)===props.selected?'selected':''}`}>
  <button className="tree-toggle" type="button" aria-label={`${expanded?'Collapse':'Expand'} ${name}`} aria-expanded={expanded} disabled={repeated} onClick={()=>setExpanded(x=>!x)}>{repeated?'↩':expanded?'▾':'▸'}</button>
  <button type="button" className="tree-node-name" onClick={()=>props.onSelect(node)}><strong>{name}</strong><small>{node.is_other?'Other bucket':node.node_kind}{node.status!=='published'?` · ${node.status}`:''}{repeated?' · Already in this path':''}</small></button>
  <div className="tree-actions"><button type="button" aria-label={`Add child to ${name}`} title="Add a child node" onClick={()=>{setEditor(editor==='child'?null:'child');}}>+ Child</button><button type="button" aria-label={`Add relationship from ${name}`} title="Connect an existing node" onClick={()=>{setEditor(editor==='link'?null:'link');}}>+ Link</button></div></div>
  {editor&&<form className="tree-inline-editor" onSubmit={save}><h3>{editor==='child'?`Add child under ${name}`:`Add relationship from ${name}`}</h3>{editor==='child'?<><label>Child name<input name="name" required maxLength={200} autoFocus/></label><label>Description<textarea name="description" maxLength={4000} rows={2}/></label><label>Node kind<select name="kind" defaultValue="topic"><option value="topic">Topic / category</option><option value="product">Product</option><option value="service">Service</option><option value="organization">Organization concept</option><option value="root">Root</option></select></label></>:<><label>Find existing node<input value={search} autoFocus onChange={e=>{setSearch(e.target.value);setTarget(null);}} placeholder="Name, code, or node ID"/></label>{!target&&targets.length>0&&<div className="admin-targets">{targets.map(n=><button key={n.node_id} type="button" onClick={()=>{setTarget(n);setSearch(n.name||'');}}>{n.name}<small>{n.node_kind}</small></button>)}</div>}{target&&<p>To: {target.name}</p>}</>}
  <label>Relationship<select value={relation} onChange={e=>setRelation(e.target.value)}>{relations.map(r=><option value={r.edge_type_id} key={r.edge_type_id}>{r.name}{r.is_hierarchy?' · hierarchy':''}</option>)}</select></label><div className="tree-editor-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button><button type="submit" className="primary" disabled={busy||!relation||(editor==='link'&&!target)}>{busy?'Saving…':editor==='child'?'Create child':'Connect node'}</button></div></form>}
  {expanded&&!repeated&&<div className="tree-children">{loading&&!children.length&&<p className="muted">Loading…</p>}{!loading&&!children.length&&<p className="muted tree-empty">No outgoing relationships. Add a child or link above.</p>}{Array.from(grouped,([key,group])=><div className="tree-relation" key={key}><span className="tree-relation-label">{group[0].relation_name}{group[0].is_hierarchy?'':' · semantic links'}</span><ul>{group.map(child=><Branch key={child.edge_id} {...props} node={child} ancestors={[...props.ancestors,String(node.node_id)]}/>)}</ul></div>)}{hasMore&&<button type="button" className="text-button" disabled={loading} onClick={more}>{loading?'Loading…':'Load more relationships'}</button>}</div>}
 </li>;
}
