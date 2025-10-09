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

// Генерирует код приглашения для списка (RPC на стороне БД должен существовать)
export async function generateJoinCode(listId) {
  const { data, error } = await supabase.rpc('generate_join_code', { p_list_id: listId });
  if (error) throw error;
  // Supabase RPC with RETURNS TABLE возвращает массив записей
  if (Array.isArray(data)) {
    return data[0]?.code || '';
  }
  // Или объект { code, expires_at }
  if (data && typeof data === 'object' && 'code' in data) {
    return data.code;
  }
  // Или просто строка
  return typeof data === 'string' ? data : '';
}

// Возвращает участников для набора списков: { [listId]: [{user_id, nickname}] }
export async function fetchMembersForLists(listIds) {
  if (!Array.isArray(listIds) || listIds.length === 0) return {};
  // 1) Получаем связи список↔пользователь
  const { data: lm, error: lmErr } = await supabase
    .from('list_members')
    .select('list_id, user_id')
    .in('list_id', listIds);
  if (lmErr) throw lmErr;

  const map = {};
  (lm || []).forEach(r => { if (!map[r.list_id]) map[r.list_id] = []; });
  const userIds = Array.from(new Set((lm || []).map(r => r.user_id)));

  // 2) Тянем никнеймы пачкой (если политика профилей ограничивает — мягко проигнорируем)
  let profilesByUser = {};
  if (userIds.length > 0) {
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, nickname')
        .in('user_id', userIds);
      (profiles || []).forEach(p => { profilesByUser[p.user_id] = p.nickname; });
    } catch {
      profilesByUser = {};
    }
  }

  (lm || []).forEach(r => {
    map[r.list_id].push({ user_id: r.user_id, nickname: profilesByUser[r.user_id] || 'Участник' });
  });
  return map;
}

// Удаляет участника из списка
export async function removeMember(listId, userId) {
  const { error } = await supabase
    .from('list_members')
    .delete()
    .eq('list_id', listId)
    .eq('user_id', userId);
  if (error) throw error;
}

// Переназначает владельца списка
export async function reassignOwner(listId, newOwnerUserId) {
  const { error } = await supabase
    .from('shopping_lists')
    .update({ owner_id: newOwnerUserId })
    .eq('id', listId);
  if (error) throw error;
}

// Удаляет список для всех (только владелец)
export async function deleteListEverywhere(listId) {
  // Используем RPC, чтобы обойти защитный триггер "last member" при каскадном удалении
  const { error } = await supabase.rpc('owner_delete_list', { p_list_id: listId });
  if (error) throw error;
}


