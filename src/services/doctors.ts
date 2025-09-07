import { supa } from '../lib/supabase.js';

type Spec = { name?: string; tags?: string[]; synonyms?: string[] };
type Doc = {
  id: string; name: string; specialty?: string; city?: string;
  languages?: string[]; tags?: string[]; description?: string; price_first?: number; price_return?: number;
  telemedicine?: boolean; specialty_id?: string | null; specialties?: Spec | null;
};

export function scoreDoctor(
  doc: Doc,
  p: { city?: string; need?: string; specialty?: string; language?: string }
) {
  let score = 0;

  // 1) specialty match (doctor.specialty OR specialties.name)
  const docSpec = (doc.specialty || doc.specialties?.name || '').toLowerCase();
  if (p.specialty && docSpec.includes(p.specialty.toLowerCase())) score += 4;

  // 2) city match
  if (p.city && doc.city && doc.city.toLowerCase() === p.city.toLowerCase()) score += 2;

  // 3) language match
  if (p.language && Array.isArray(doc.languages) &&
      doc.languages.some(l => l.toLowerCase().startsWith(p.language!.toLowerCase()))) score += 2;

  // 4) need ↔ tags/synonyms (doctor.tags ∪ specialty.tags ∪ specialty.synonyms)
  if (p.need) {
    const toks = p.need.toLowerCase().split(/[^a-zá-ú0-9]+/i).filter(Boolean);
    const hay = new Set<string>([
      ...(doc.tags || []),
      ...((doc.specialties?.tags || []) as string[]),
      ...((doc.specialties?.synonyms || []) as string[])
    ].map(t => String(t).toLowerCase()));
    if (toks.some(t => hay.has(t))) score += 3;
  }

  // IMPORTANT: no price/duration bias in this ranking.
  return score;
}

export async function pickDoctorForLead(p: { city?: string; need?: string; specialty?: string; language?: string }) {
  // Supabase nested select via FK doctors.specialty_id -> specialties.id
  const { data, error } = await supa
    .from('doctors')
    .select('id,name,specialty,city,languages,tags,description,telemedicine,price_first, price_return, specialty_id,specialties(name,tags,synonyms)')
    .eq('is_active', true)
    .limit(200);
  if (error) throw new Error(error.message);

  const ranked = (data as Doc[] || [])
    .map(d => ({ d, s: scoreDoctor(d, p) }))
    .sort((a, b) => b.s - a.s);

  return ranked[0]?.d || null;
}
