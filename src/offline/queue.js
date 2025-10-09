import { putOp, getOpsByStatus, updateOpStatus, countPending } from './db';
import { supabase } from '../lib/supabaseClient';

const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function enqueueOp(op) {
  const id = genId();
  await putOp({ id, status: 'pending', createdAt: Date.now(), ...op });
}

export async function syncOnce() {
  const ops = await getOpsByStatus('pending');
  for (const op of ops) {
    try {
      if (op.entity === 'item' && op.type === 'add') {
        const { error } = await supabase
          .from('items')
          .insert({ list_id: op.listId, name: op.name, quantity: op.quantity, department: op.department, op_id: op.op_id });
        if (error) throw error;
      }
      if (op.entity === 'item' && op.type === 'toggle') {
        const { data, error } = await supabase
          .from('items')
          .update({ checked: op.checked })
          .eq('id', op.id)
          .eq('version', op.baseVersion)
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('version_conflict');
      }
      if (op.entity === 'item' && op.type === 'delete') {
        const { error } = await supabase
          .from('items')
          .delete()
          .eq('id', op.id);
        if (error) throw error;
      }
      if (op.entity === 'item' && op.type === 'move') {
        const { error } = await supabase
          .from('items')
          .update({ department: op.department })
          .eq('id', op.id);
        if (error) throw error;
      }

      await updateOpStatus(op.id, 'done', { doneAt: Date.now() });
    } catch (e) {
      await updateOpStatus(op.id, 'error', { error: e.message, failedAt: Date.now() });
    }
  }
}

export { countPending };


