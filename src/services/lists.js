import { supabase } from '../lib/supabaseClient';

export async function fetchListsForUser() {
  // Возвращаем списки, где пользователь является участником
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createList(name) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ name: name.trim(), owner_id: user?.id })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function acceptJoinCode(code) {
  const { data, error } = await supabase.rpc('accept_join_code', { p_code: code });
  if (error) throw error;
  return data; // list_id
}


