'use client';
// ECLASS requires a per-URL cHash on GET item links. Its own release selector
// supports POST to the item endpoint without that hash.
export default function EclassLink({code,admin}:{code:string|null|undefined;admin?:boolean}) {
  if(!admin) return null;
  if(!code || !/^\d{8}$/.test(code)) return null;
  function openItem() {
    const form=document.createElement('form');
    form.action='https://eclass.eu/en/eclass-standard/search-content/show';
    form.method='POST';form.target='_blank';form.rel='noopener noreferrer';form.hidden=true;
    for(const [key,value] of Object.entries({discharge:'0',id:code!,language:'1',version:'16.0'})) {
      const field=document.createElement('input');field.type='hidden';
      field.name=`tx_eclasssearch_ecsearch[${key}]`;field.value=value;form.appendChild(field);
    }
    document.body.appendChild(form);form.submit();form.remove();
  }
  return <button type="button" className="text-button eclass-link" title="Open the ECLASS 16.0 definition" onClick={openItem}>View in ECLASS <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></button>;
}
