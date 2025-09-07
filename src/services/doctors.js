import { supa } from '../lib/supabase.js';

export function scoreDoctor(doc, p){
  let score=0;
  const specName = (doc.specialty || doc.specialties?.name || '').toLowerCase();
  if(p.specialty && specName.includes(String(p.specialty).toLowerCase())) score+=4;
  if(p.city && doc.city && doc.city.toLowerCase()===String(p.city).toLowerCase()) score+=2;
  if(p.language && Array.isArray(doc.languages) && doc.languages.some(l=>String(l).toLowerCase().startsWith(String(p.language).toLowerCase()))) score+=2;
  if(p.need){
    const toks = String(p.need).toLowerCase().split(/[^a-zá-ú0-9]+/i).filter(Boolean);
    const hay = new Set([...(doc.tags||[]), ...((doc.specialties?.tags)||[]), ...((doc.specialties?.synonyms)||[])]
      .map(t=>String(t).toLowerCase()));
    if(toks.some(t=>hay.has(t))) score+=3;
  }
  return score; // no price/duration bias
}

export async function pickDoctorForLead(p){
  const { data, error } = await supa
    .from('doctors')
    .select('id,name,specialty,city,languages,tags,description,telemedicine,specialty_id,specialties(name,tags,synonyms)')
    .eq('is_active', true)
    .limit(200);
  if(error) throw new Error(error.message);
  const ranked = (data||[]).map(d=>({d,s:scoreDoctor(d,p)})).sort((a,b)=>b.s-a.s);
  return ranked[0]?.d || null;
}
