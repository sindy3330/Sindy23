import { createClient } from '@supabase/supabase-js';
import { nowDatetime, genId } from './utils/date';
import { toSnake, toCamel, toNum, assembleData, diffFields } from './lib/transform.js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

// ── Table name mapping ────────────────────────────

const TABLE = {
  '人物':    'persons',
  '物件':    'properties',
  '追蹤線':  'trackings',
  '買方':    'buyers',
  '成交客戶': 'closed_clients',
  '維護紀錄': 'maintenance_logs',
  '業務紀錄': 'business_logs',
  '追蹤物件': 'tracking_properties',
  '買方物件': 'buyer_properties',
};

// ── Generic CRUD ──────────────────────────────────

export const sheetApi = {
  add: async (sheet, data) => {
    const { error } = await supabase
      .from(TABLE[sheet])
      .insert(toSnake(data));
    if (error) throw new Error(error.message);
  },

  update: async (sheet, id, data) => {
    const { error } = await supabase
      .from(TABLE[sheet])
      .update(toSnake(data))
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  delete: async (sheet, id) => {
    const { error } = await supabase
      .from(TABLE[sheet])
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  },
};

// ── Auth ──────────────────────────────────────────

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await supabase.auth.signOut();
}

// 目前登入者的 staff 名，供 sync 寫入 updated_by（whoever is operating now）。
let currentStaffName = '';

export function onAuthChange(callback) {
  supabase.auth.getSession().then(({ data }) => {
    currentStaffName = getCurrentStaffName(data.session);
    callback(data.session);
  });
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    currentStaffName = getCurrentStaffName(session);
    callback(session);
  });
  return () => sub.subscription.unsubscribe();
}

export function getCurrentStaffName(session) {
  return session?.user?.user_metadata?.staff_name || '';
}

// ── Real-time subscription ────────────────────────

export function subscribeToChanges(onAnyChange) {
  const channel = supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, onAnyChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Load all ──────────────────────────────────────

export async function loadAllData() {
  // 共用主檔 properties 已淘汰（改用 tracking_properties / buyer_properties 獨立快照），不再撈取。
  const [
    { data: persons, error: e0 },
    { data: trackings, error: e2 },
    { data: buyers, error: e3 },
    { data: closed, error: e4 },
    { data: tp, error: e5 },
    { data: bp, error: e6 },
    { data: maint, error: e7 },
    { data: biz, error: e8 },
  ] = await Promise.all([
    supabase.from('persons').select('*'),
    supabase.from('trackings').select('*'),
    supabase.from('buyers').select('*'),
    supabase.from('closed_clients').select('*'),
    supabase.from('tracking_properties').select('*'),
    supabase.from('buyer_properties').select('*'),
    supabase.from('maintenance_logs').select('*'),
    supabase.from('business_logs').select('*'),
  ]);
  const firstError = [e0, e2, e3, e4, e5, e6, e7, e8].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  return assembleData({
    persons, trackings, buyers, closed_clients: closed,
    tracking_properties: tp, buyer_properties: bp,
    maintenance_logs: maint, business_logs: biz,
  });
}

// ── Sync helpers ──────────────────────────────────

async function updatePerson(personId, fields) {
  if (personId == null) return;
  const snake = toSnake(fields);
  if (Object.keys(snake).length === 0) return;
  const { error } = await supabase.from('persons').update(snake).eq('id', personId);
  if (error) throw new Error(error.message);
}

export async function createPerson(fields) {
  const id = genId();
  const { error } = await supabase.from('persons').insert(toSnake({ id, createdAt: nowDatetime(), ...fields }));
  if (error) throw new Error(error.message);
  return id;
}

export async function syncClient(updated, prev) {
  const ops = [];

  const PERSON_FIELDS = ['name','phone','address','mailingAddress'];
  const personDiff = diffFields(updated, prev, PERSON_FIELDS);
  if (Object.keys(personDiff).length > 0) ops.push(updatePerson(updated.personId, personDiff));

  const TRACK_SCALARS = ['staff','trackType','notes','nextPlan'];
  const trackDiff = diffFields(updated, prev, TRACK_SCALARS);
  // 只有「客戶層級」變動（維護紀錄、下次計劃、備註、追/募…）才戳 trackings.updated_at；
  // 純物件層級的編輯不動客戶的最後修改日（它有自己的 tracking_properties.updated_at）。
  const clientTouched = !prev
    || Object.keys(trackDiff).length > 0
    || (updated.maintenanceLogs?.length || 0) !== (prev.maintenanceLogs?.length || 0)
    || updated.updatedAt !== prev.updatedAt;
  if (clientTouched) {
    trackDiff.updatedAt = updated.updatedAt ?? nowDatetime();
    trackDiff.updatedBy = currentStaffName;
  }
  if (Object.keys(trackDiff).length > 0) ops.push(sheetApi.update('追蹤線', updated.id, trackDiff));

  // 追蹤物件＝獨立手key快照（比照 buyer_properties）：整筆規格直接存在 tracking_properties，
  // 以 id 配對；master 編輯也收斂成同一筆更新，不再動共用 properties 表。
  const TP_FIELDS = ['address','dealType','totalPrice','layout','floor','saleType','purpose','community','area','mainBuildingArea','attachedBuildingArea','propertyType','parkingSpace','transactionRecord','createdAt','clientNotes'];
  const pickTp = p => Object.fromEntries(TP_FIELDS.map(f => [f, p[f] ?? null]));

  const prevProps = prev?.properties || [];
  const nextProps = updated.properties || [];
  const prevById = new Map(prevProps.map(p => [p.id, p]));
  const nextById = new Map(nextProps.map(p => [p.id, p]));
  nextProps.forEach(p => {
    const was = prevById.get(p.id);
    if (!was) {
      ops.push(supabase.from('tracking_properties').insert(toSnake({
        id: p.id, trackingId: updated.id, propertyNo: p.propertyNo || null,
        ...pickTp(p), updatedAt: p.updatedAt || nowDatetime(), updatedBy: currentStaffName,
      })).then(r => { if (r.error) throw new Error(r.error.message); }));
    } else if (TP_FIELDS.some(f => (p[f] ?? null) !== (was[f] ?? null)) || p.updatedAt !== was.updatedAt) {
      // 該追蹤物件任一欄位變更 → 整筆更新、戳自己的 updated_at
      ops.push(supabase.from('tracking_properties')
        .update(toSnake({ ...pickTp(p), updatedAt: p.updatedAt ?? nowDatetime(), updatedBy: currentStaffName }))
        .eq('id', p.id)
        .then(r => { if (r.error) throw new Error(r.error.message); }));
    }
  });
  prevProps.forEach(p => {
    if (!nextById.has(p.id)) {
      ops.push(supabase.from('tracking_properties').delete()
        .eq('id', p.id)
        .then(r => { if (r.error) throw new Error(r.error.message); }));
    }
  });

  const prevMaintIds = new Set((prev?.maintenanceLogs || []).map(l => String(l.id)));
  const nextMaintIds = new Set((updated.maintenanceLogs || []).map(l => String(l.id)));
  (updated.maintenanceLogs || []).forEach(log => {
    if (!prevMaintIds.has(String(log.id))) ops.push(sheetApi.add('維護紀錄', { ...log, trackingId: updated.id }));
  });
  (prev?.maintenanceLogs || []).forEach(log => {
    if (!nextMaintIds.has(String(log.id))) ops.push(sheetApi.delete('維護紀錄', log.id));
  });

  nextProps.forEach(p => {
    const was = prevById.get(p.id);
    const prevBiz = was?.businessLogs || [];
    const prevBizIds = new Set(prevBiz.map(l => String(l.id)));
    const nextBizIds = new Set((p.businessLogs || []).map(l => String(l.id)));
    (p.businessLogs || []).forEach(log => {
      if (!prevBizIds.has(String(log.id))) ops.push(sheetApi.add('業務紀錄', { ...log, trackingId: updated.id, trackingPropertyId: p.id }));
    });
    prevBiz.forEach(log => { if (!nextBizIds.has(String(log.id))) ops.push(sheetApi.delete('業務紀錄', log.id)); });
  });

  await Promise.all(ops);
}

export async function syncBuyer(updated, prev) {
  const ops = [];
  const PERSON_FIELDS = ['name','phone','birthday','address','mailingAddress'];
  const personDiff = diffFields(updated, prev, PERSON_FIELDS);
  if (Object.keys(personDiff).length > 0) ops.push(updatePerson(updated.personId, personDiff));

  const BUYER_SCALARS = ['staff','budgetMin','budgetMax','desiredLayout','desiredDistrict','community','notes'];
  const diff = diffFields(updated, prev, BUYER_SCALARS);
  diff.updatedAt = nowDatetime(); diff.updatedBy = currentStaffName;
  ops.push(sheetApi.update('買方', updated.id, diff));

  const WP_FIELDS = ['address','dealType','totalPrice','layout','floor','community','purpose','area','mainBuildingArea','attachedBuildingArea','propertyType','parkingSpace','transactionRecord','notes'];
  const pick = wp => Object.fromEntries(WP_FIELDS.map(f => [f, wp[f] ?? null]));

  const prevWP = prev?.watchingProperties || [];
  const nextWP = updated.watchingProperties || [];
  const prevById = new Map(prevWP.map(p => [p.id, p]));
  const nextById = new Map(nextWP.map(p => [p.id, p]));

  nextWP.forEach(wp => {
    const was = prevById.get(wp.id);
    if (!was) {
      ops.push(supabase.from('buyer_properties').insert(toSnake({ id: wp.id, buyerId: updated.id, ...pick(wp) }))
        .then(r => { if (r.error) throw new Error(r.error.message); }));
    } else if (WP_FIELDS.some(f => (wp[f] ?? null) !== (was[f] ?? null))) {
      ops.push(supabase.from('buyer_properties').update(toSnake(pick(wp))).eq('id', wp.id)
        .then(r => { if (r.error) throw new Error(r.error.message); }));
    }
  });
  prevWP.forEach(wp => {
    if (!nextById.has(wp.id)) {
      ops.push(supabase.from('buyer_properties').delete().eq('id', wp.id)
        .then(r => { if (r.error) throw new Error(r.error.message); }));
    }
  });

  await Promise.all(ops);
}

export async function syncClosedClient(updated, prev) {
  const ops = [];
  const PERSON_FIELDS = ['name','phone','birthday','address','mailingAddress'];
  const personDiff = diffFields(updated, prev, PERSON_FIELDS);
  if (Object.keys(personDiff).length > 0) ops.push(updatePerson(updated.personId, personDiff));

  const CLOSED_SCALARS = ['type','dealAddress','community','notes'];
  const diff = diffFields(updated, prev, CLOSED_SCALARS);
  if (Object.keys(diff).length > 0 || Object.keys(personDiff).length > 0) {
    diff.updatedAt = updated.updatedAt ?? nowDatetime();
    diff.updatedBy = currentStaffName;
    ops.push(sheetApi.update('成交客戶', updated.id, diff));
  }
  await Promise.all(ops);
}

export async function addProperty(prop) {
  // 不送 property_no，交由 DB trigger（13_property_no_trigger.sql）配號避免併發碰撞。
  // select() 取回伺服器配發的編號，回填樂觀列。
  const { data, error } = await supabase
    .from('properties')
    .insert(toSnake(prop))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { ...toCamel(data), id: Number(data.id), totalPrice: toNum(data.total_price), area: toNum(data.area), mainBuildingArea: toNum(data.main_building_area), attachedBuildingArea: toNum(data.attached_building_area) };
}

export async function syncProperty(prop, prev) {
  const { businessLogs, showingDate, clientNotes, ...flat } = prop;
  const PROP_SCALARS = ['propertyNo','address','totalPrice','layout','floor','saleType','purpose','community','area','mainBuildingArea','attachedBuildingArea','propertyType','transactionRecord','parkingSpace','dealType','notes','updatedAt'];
  const diff = diffFields(flat, prev, PROP_SCALARS);
  if (Object.keys(diff).length === 0) return;
  diff.updatedBy = currentStaffName;
  return sheetApi.update('物件', prop.id, diff);
}
