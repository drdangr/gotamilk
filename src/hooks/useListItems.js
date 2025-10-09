import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchItems, addItem as addItemFn, deleteItem as deleteItemFn, toggleItemChecked } from '../services/items';

export function useListItems(listId) {
  const qc = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ['list-items', listId],
    queryFn: () => fetchItems(listId),
    enabled: !!listId,
  });

  const addItem = useMutation({
    mutationFn: ({ name, quantity, department }) => addItemFn(listId, name, quantity, department),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['list-items', listId] });
      const prev = qc.getQueryData(['list-items', listId]);
      const optimistic = [
        ...(prev || []),
        { id: `optimistic-${Date.now()}`, list_id: listId, name: vars.name, quantity: vars.quantity, department: vars.department, checked: false },
      ];
      qc.setQueryData(['list-items', listId], optimistic);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['list-items', listId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['list-items', listId] }),
  });

  const toggleChecked = useMutation({
    mutationFn: ({ id, checked, version }) => toggleItemChecked(id, checked, version),
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: ['list-items', listId] });
      const prev = qc.getQueryData(['list-items', listId]);
      qc.setQueryData(['list-items', listId], (prev || []).map(i => i.id === id ? { ...i, checked: !checked } : i));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['list-items', listId], ctx.prev);
      if (e?.code === 'version_conflict') {
        // Отметим конфликт в кэше флагом, чтобы UI подсветил
        qc.setQueryData(['list-items', listId], (prev || []).map(i => i.id === _v.id ? { ...i, __conflict: true } : i));
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['list-items', listId] }),
  });

  const deleteItem = useMutation({
    mutationFn: (id) => deleteItemFn(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['list-items', listId] });
      const prev = qc.getQueryData(['list-items', listId]);
      qc.setQueryData(['list-items', listId], (prev || []).filter(i => i.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['list-items', listId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['list-items', listId] }),
  });

  return { itemsQuery, addItem, toggleChecked, deleteItem };
}


