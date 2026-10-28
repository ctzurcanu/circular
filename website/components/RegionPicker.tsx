'use client';
import { useState } from 'react';
import groups from '../lib/regions.json';
const names = new Intl.DisplayNames(['en-US'], {type:'region'});
const label = (code:string) => {
  if(code==='GLOBAL') return 'Global';
  if(code==='EU') return 'European Union';
  const group=groups.find(g=>g.code===code); if(group) return group.name;
  try {return names.of(code)||code;} catch {return code;}
};
export default function RegionPicker({value,onChange,title}:{value:string[];onChange:(regions:string[])=>void;title:string}) {
  const [open,setOpen]=useState(false);
  function toggle(code:string) {
    if(value.includes(code)) onChange(value.filter(r=>r!==code));
    else if(code==='GLOBAL') onChange(['GLOBAL']);
    else if(value.filter(r=>r!=='GLOBAL').length<30) onChange([...value.filter(r=>r!=='GLOBAL'),code]);
  }
  const choice=(code:string)=> <label className="region-choice" key={code}><input type="checkbox" checked={value.includes(code)} onChange={()=>toggle(code)}/>{label(code)}</label>;
  return <div className="region-picker"><span id="region-label">{title}</span><button type="button" className="region-toggle" aria-labelledby="region-label" aria-expanded={open} aria-controls="region-options" onClick={()=>setOpen(!open)}>{value.length?value.map(label).join(', '):'Choose regions (optional)'} <span aria-hidden="true">▾</span></button>
    {open&&<div id="region-options" className="region-options">{choice('GLOBAL')}{choice('EU')}{groups.map(g=><details key={g.code}><summary>{g.name}</summary>{choice(g.code)}<div className="region-countries">{g.countries.map(choice)}</div></details>)}{value.filter(c=>c!=='GLOBAL'&&c!=='EU'&&!groups.some(g=>g.code===c||g.countries.includes(c))).map(choice)}<button className="text-button" type="button" onClick={()=>setOpen(false)}>Done</button></div>}
    <small className="muted">Global covers all regions. Leave empty if coverage is unspecified.</small></div>;
}
