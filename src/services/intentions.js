import { supabase } from '../lib/supabaseClient';

export async function upsertIntention(listItemId, storeId = null) {
  const { data, error } = await supabase
    .from('item_intentions')
    .upsert({ list_item_id: listItemId, user_id: (await supabase.auth.getUser()).data.user?.id, store_id: storeId })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function clearIntention(listItemId) {
  const { error } = await supabase
    .from('item_intentions')
    .delete()
    .eq('list_item_id', listItemId);
  if (error) throw error;
}


