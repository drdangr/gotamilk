import { supabase } from '../lib/supabaseClient';
import { normalizeName } from './prices';

export async function fetchCatalog() {
  const { data, error } = await supabase
    .from('catalog_items')
    .select('id, short_name, display_name, name_normalized, unit')
    .order('short_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addCatalogItem(displayName) {
  const { data, error } = await supabase
    .from('catalog_items')
    .insert({ short_name: displayName.trim(), name_normalized: normalizeName(displayName), display_name: displayName.trim() })
    .select('id, short_name, display_name, name_normalized, unit')
    .single();
  if (error) throw error;
  return data;
}

export async function renameCatalogItem(id, newName) {
  const { data, error } = await supabase
    .from('catalog_items')
    .update({ short_name: newName.trim(), name_normalized: normalizeName(newName), display_name: newName.trim() })
    .eq('id', id)
    .select('id, short_name, display_name, name_normalized, unit')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCatalogItem(id) {
  const { error } = await supabase
    .from('catalog_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function upsertCatalogNames(names) {
  const rows = (names || []).map(n => ({ short_name: (n || '').trim(), name_normalized: normalizeName(n), display_name: (n || '').trim() })).filter(r => r.short_name && r.name_normalized);
  if (rows.length === 0) return [];

  // Избегаем on_conflict, чтобы не получать 400. Делаем: SELECT существующих -> INSERT недостающих
  const normalizedList = Array.from(new Set(rows.map(r => r.name_normalized)));
  const { data: existing, error: selErr } = await supabase
    .from('catalog_items')
    .select('id, short_name, display_name, name_normalized, unit')
    .in('name_normalized', normalizedList);
  if (selErr) throw selErr;
  const existingSet = new Set((existing || []).map(r => r.name_normalized));
  const toInsert = rows.filter(r => !existingSet.has(r.name_normalized));
  if (toInsert.length === 0) return existing || [];
  const { data: inserted, error: insErr } = await supabase
    .from('catalog_items')
    .insert(toInsert)
    .select('id, short_name, display_name, name_normalized, unit');
  if (insErr) throw insErr;
  return [ ...(existing || []), ...(inserted || []) ];
}

export async function updateCatalogUnit(id, unit) {
  try {
    const { data, error } = await supabase
      .from('catalog_items')
      .update({ unit })
      .eq('id', id)
      .select('id, short_name, display_name, name_normalized, unit')
      .single();
    if (error) throw error;
    return data;
  } catch (_) {
    // Колонки может не быть — тихо игнорируем
    return null;
  }
}

export async function updateCatalogDisplayName(id, displayName) {
  const { data, error } = await supabase
    .from('catalog_items')
    .update({ display_name: (displayName || '').trim() || null })
    .eq('id', id)
    .select('id, short_name, display_name, name_normalized, unit')
    .single();
  if (error) throw error;
  return data;
}

// Поиск подсказок по каталогу и алиасам
export async function searchCatalogSuggestions(term, limit = 10) {
  const q = (term || '').trim();
  if (!q) return [];
  const ilike = `${q}%`;
  // 1) По short_name как prefix
  const { data: byShort, error: e1 } = await supabase
    .from('catalog_items')
    .select('id, short_name, display_name, unit')
    .ilike('short_name', ilike)
    .limit(limit);
  if (e1) throw e1;

  // 2) По алиасам как prefix, исключая уже найденные id
  const foundIds = new Set((byShort || []).map(r => r.id));
  const { data: aliasRows, error: e2 } = await supabase
    .from('item_aliases')
    .select('catalog_item_id')
    .ilike('full_name', ilike)
    .limit(limit);
  if (e2) throw e2;
  const aliasIds = Array.from(new Set((aliasRows || []).map(r => r.catalog_item_id))).filter(id => !foundIds.has(id));
  let byAlias = [];
  if (aliasIds.length > 0) {
    const { data, error } = await supabase
      .from('catalog_items')
      .select('id, short_name, display_name, unit')
      .in('id', aliasIds)
      .limit(Math.max(0, limit - (byShort?.length || 0)));
    if (error) throw error;
    byAlias = data || [];
  }

  return [ ...(byShort || []), ...byAlias ].slice(0, limit);
}

export async function mapDisplayNamesForItems(names) {
  // names: массив коротких имён из list_items
  const unique = Array.from(new Set((names || []).map(n => (n || '').trim()).filter(Boolean)));
  if (unique.length === 0) return {};
  const norm = unique.map(normalizeName);
  // найдём соответствующие catalog_items по name_normalized
  const { data, error } = await supabase
    .from('catalog_items')
    .select('name_normalized, display_name')
    .in('name_normalized', norm);
  if (error) throw error;
  const byNorm = Object.fromEntries((data || []).map(r => [r.name_normalized, r.display_name]));
  const result = {};
  unique.forEach(n => { result[n] = byNorm[normalizeName(n)] || null; });
  return result; // { short_name: display_name|null }
}

// Aliases
export async function fetchAliases(catalogItemId) {
  const { data, error } = await supabase
    .from('item_aliases')
    .select('id, full_name')
    .eq('catalog_item_id', catalogItemId)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addAlias(catalogItemId, fullName) {
  const { data, error } = await supabase
    .from('item_aliases')
    .insert({ catalog_item_id: catalogItemId, full_name: fullName.trim(), full_name_normalized: normalizeName(fullName) })
    .select('id, full_name')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAlias(aliasId) {
  const { error } = await supabase
    .from('item_aliases')
    .delete()
    .eq('id', aliasId);
  if (error) throw error;
}


