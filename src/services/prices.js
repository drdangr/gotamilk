import { supabase } from '../lib/supabaseClient';

export const normalizeName = (s) => (s || '').toLowerCase().trim();

export async function fetchBestPricesForItemNames(itemNames) {
  const normalized = Array.from(new Set(itemNames.map(normalizeName))).filter(Boolean);
  if (normalized.length === 0) return {};

  const { data: prices, error } = await supabase
    .from('item_prices')
    .select('store_id, item_name_normalized, price')
    .in('item_name_normalized', normalized);
  if (error) throw error;

  const bestByName = {};
  const storeIds = new Set();
  for (const row of prices || []) {
    const key = row.item_name_normalized;
    if (!bestByName[key] || Number(row.price) < Number(bestByName[key].price)) {
      bestByName[key] = { store_id: row.store_id, price: row.price };
      if (row.store_id) storeIds.add(row.store_id);
    }
  }

  if (storeIds.size > 0) {
    const { data: stores, error: sErr } = await supabase
      .from('stores')
      .select('id, name')
      .in('id', Array.from(storeIds));
    if (sErr) throw sErr;
    const storeNameById = Object.fromEntries((stores || []).map(s => [s.id, s.name]));
    for (const key of Object.keys(bestByName)) {
      const sId = bestByName[key].store_id;
      bestByName[key].store_name = storeNameById[sId] || 'Магазин';
    }
  }

  return bestByName; // { normalizedName: { store_id, store_name, price } }
}

export async function upsertItemPrice(storeId, itemName, price, quantity) {
  const normalized = normalizeName(itemName);
  const { data, error } = await supabase
    .from('item_prices')
    .upsert({ store_id: storeId, item_name_normalized: normalized, item_full_name: itemName, price, quantity })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPricesMapForStore(storeId) {
  if (!storeId) return {};
  const { data, error } = await supabase
    .from('item_prices')
    .select('item_name_normalized, price, quantity')
    .eq('store_id', storeId);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.item_name_normalized] = { price: r.price, quantity: r.quantity }; });
  return map;
}

export async function fetchDistinctItemNames() {
  const names = new Set();
  // from list_items
  const { data: li, error: e1 } = await supabase
    .from('list_items')
    .select('name');
  if (!e1 && li) li.forEach(r => names.add((r.name || '').trim()));
  // from item_prices (use item_full_name fallback to normalized)
  const { data: ip, error: e2 } = await supabase
    .from('item_prices')
    .select('item_full_name, item_name_normalized');
  if (!e2 && ip) ip.forEach(r => names.add((r.item_full_name || r.item_name_normalized || '').trim()));
  return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
}

export async function deleteItemPrice(storeId, itemName) {
  const normalized = normalizeName(itemName);
  const { error } = await supabase
    .from('item_prices')
    .delete()
    .eq('store_id', storeId)
    .eq('item_name_normalized', normalized);
  if (error) throw error;
}

// New: work by catalog_item_id instead of names
export async function upsertItemPriceByCatalogId(storeId, catalogItemId, price, quantity) {
  const { data, error } = await supabase
    .from('item_prices')
    .upsert({ store_id: storeId, catalog_item_id: catalogItemId, price, quantity })
    .select('store_id, catalog_item_id, price, quantity')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPricesForCatalogItem(catalogItemId) {
  const { data, error } = await supabase
    .from('item_prices')
    .select('store_id, price, quantity')
    .eq('catalog_item_id', catalogItemId);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.store_id] = { price: r.price, quantity: r.quantity }; });
  return map;
}

export async function deletePriceByCatalogId(storeId, catalogItemId) {
  const { error } = await supabase
    .from('item_prices')
    .delete()
    .eq('store_id', storeId)
    .eq('catalog_item_id', catalogItemId);
  if (error) throw error;
}


