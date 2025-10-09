import { supabase } from '../lib/supabaseClient';

export async function fetchItems(listId) {
  const { data, error } = await supabase
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function addItem(listId, name, quantity, department) {
  const op_id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('list_items')
    .insert({ list_id: listId, name: name.trim(), quantity: quantity?.trim(), department, op_id })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function toggleItemChecked(id, checked, baseVersion) {
  const { data, error } = await supabase
    .from('list_items')
    .update({ checked: !checked })
    .eq('id', id)
    .eq('version', baseVersion)
    .select('id, version');
  if (error) throw error;
  if (!data || data.length === 0) {
    const conflict = new Error('Конфликт версий');
    conflict.code = 'version_conflict';
    throw conflict;
  }
  return data[0];
}

export async function deleteItem(id) {
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
}


