'use client';
import { useState } from 'react';
import { request, type Category } from '../lib/api';
export default function CategoryHandoff({query,onSelect}:{query:string;onSelect:(category:Category)=>void}) {
  const [open,setOpen]=useState(false),[description,setDescription]=useState(''),[result,setResult]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const prompt=`Help me choose a biz catalog category for this business need or offering: ${description||query}\nUse the connected biz MCP server, not a guessed taxonomy. Use search_catalog with several focused keywords and browse_catalog to compare specific categories. Use get_catalog_category to verify the chosen node ID. Ask me about any ambiguity, explain your choice and alternatives, and use a collection-specific Other only when appropriate. Default locale: us_en. Do not create or publish a listing. Finish with the chosen category name, code, and a numeric category node ID that I can paste into biz.`;
  async function apply() {
    setBusy(true);setStatus('');
    try {
      if(!/^\d+$/.test(result.trim())) throw new Error('Paste the numeric category node ID returned by the assistant.');
      const category=await request<Category>('catalog_category',{node_id:Number(result)});
      onSelect(category);setStatus(`Selected ${category.name}.`);setOpen(false);
    } catch(e) {setStatus((e as Error).message);} finally {setBusy(false);}
  }
  return <div className="category-handoff"><button className="text-button" type="button" onClick={()=>{setOpen(!open);if(!description)setDescription(query);}}>Choose with AI · ChatGPT / Claude</button>{open&&<div className="handoff-panel"><label>Describe what you need or offer<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={4000} placeholder="Describe the purpose, product or service, and important distinctions."/></label><p className="muted">Connect the circular MCP server in your assistant first. Copy this request, discuss the category, then paste its category node ID below.</p><textarea aria-label="AI category request" readOnly value={prompt} rows={5}/><div className="handoff-actions"><button type="button" className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(prompt);setStatus('Request copied. Paste it into your assistant.');}catch{setStatus('Select and copy the request above.');}}}>Copy request</button><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Open ChatGPT ↗</a><a href="https://claude.ai/" target="_blank" rel="noreferrer">Open Claude ↗</a></div><label>Category node ID<input inputMode="numeric" value={result} onChange={e=>setResult(e.target.value)} placeholder="Paste the assistant’s category node ID"/></label><button type="button" className="secondary" disabled={busy||!result.trim()} onClick={apply}>{busy?'Checking…':'Use recommended category'}</button></div>}{status&&<p role="status" className="muted">{status}</p>}</div>;
}
