import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const localMode = process.env.NEXT_PUBLIC_LOCAL_MODE === 'true';
export const auth = url && key ? createClient(url, key) : null;
const endpoint = process.env.NEXT_PUBLIC_BIZ_API_URL || (url ? `${url}/functions/v1/biz-api` : '');
export const configured = Boolean(endpoint);
export async function request<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!endpoint) throw new Error('This workspace is not connected yet. Configure the Supabase settings described in the project README.');
  const session = auth ? (await auth.auth.getSession()).data.session : null;
  const response = await fetch(endpoint, {
    method: 'POST', headers: {'Content-Type':'application/json', ...(key ? {apikey:key}:{}),
      ...(session ? {Authorization:`Bearer ${session.access_token}`} : {})},
    body: JSON.stringify({action, ...params}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result.data as T;
}
export type Category = {node_id:number; code:string|null; name:string; description:string|null; level:number|null; is_other:boolean; parent_name?:string; parent_code?:string};
export type Business = {business_id:number; name:string; individual_id:string};
export type Listing = {listing_id:string; business_id:number; direction:'input'|'output'; kind:'product'|'service'; class_node_id:number; title:string; description:string|null; state:'draft'|'published'|'withdrawn'; quantity:number|null; quantity_unit:string|null; regions:string[]; attributes:Record<string,unknown>; class_name:string; code:string|null; available_from:string|null; available_until:string|null};
export type Match = {request_listing_id:string; offer_listing_id:string; buyer_business_id:number; seller_business_id:number; buyer_title:string; seller_title:string; match_type:string; taxonomy_distance:number; score:number; assessment:string; unknown_requirements:string[]; seller_representative_id:string; seller_representative_name:string; buyer_representative_id:string; buyer_representative_name:string; buyer_business_name:string; seller_business_name:string};
