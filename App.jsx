import { useState, useEffect, useRef, useMemo } from 'react';
import TabBar from './components/TabBar';
import ClientRow from './components/ClientRow';
import BuyerRow from './components/BuyerRow';
import ClosedClientRow from './components/ClosedClientRow';
import PropertyManagementRow from './components/PropertyManagementRow';
import { loadAllData, syncClient, syncBuyer, syncClosedClient, addProperty, syncProperty, sheetApi, subscribeToChanges, signOut, getCurrentStaffName, createPerson } from './api';
import { applyRealtimeEvent } from './lib/transform';
import { nowDatetime, genId } from './utils/date';
import { exportClients, exportBuyers, exportClosed, exportAll, getLastExportAt } from './utils/exportExcel';
import './App.css';

const DEFAULT_VISIBLE    = { businessLog: true, maintenanceLog: true, createdAt: true, updatedAt: true, nextPlan: true };
const BUYER_DEFAULT_VISIBLE  = { createdAt: true, updatedAt: true, watchedProps: true };
const CLOSED_DEFAULT_VISIBLE = { createdAt: true };

const EMPTY_CLIENT = { staff: '', trackType: '追蹤', name: '', phone: '', notes: '' };
const EMPTY_BUYER  = { staff: '', name: '', phone: '', birthday: '', address: '', mailingAddress: '', budgetMin: '', budgetMax: '', desiredLayout: '', desiredDistrict: '', community: '' };
const EMPTY_CLOSED = { type: '買', name: '', phone: '', birthday: '', address: '', mailingAddress: '', dealAddress: '', community: '', notes: '' };
const EMPTY_PROP   = { dealType: '賣', address: '', totalPrice: '', layout: '', floor: '', saleType: '同業', purpose: '住宅', community: '', area: '', mainBuildingArea: '', attachedBuildingArea: '', propertyType: '大樓', transactionRecord: '', parkingSpace: '', notes: '' };

export default function App({ session }) {
  const [activeTab, setActiveTab]         = useState('追蹤線');
  const [clients, setClients]             = useState([]);
  const [buyers, setBuyers]               = useState([]);
  const [closedClients, setClosedClients] = useState([]);
  const [properties, setProperties]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [syncError, setSyncError]         = useState(null);

  const [addingClient, setAddingClient]   = useState(false);
  const [newClientForm, setNewClientForm] = useState({ ...EMPTY_CLIENT, staff: getCurrentStaffName(session) });
  const [addingBuyer, setAddingBuyer]     = useState(false);
  const [newBuyerForm, setNewBuyerForm]   = useState({ ...EMPTY_BUYER, staff: getCurrentStaffName(session) });
  const [addingClosed, setAddingClosed]   = useState(false);
  const [newClosedForm, setNewClosedForm] = useState(EMPTY_CLOSED);
  const [addingProp, setAddingProp]       = useState(false);
  const [newPropForm, setNewPropForm]     = useState(EMPTY_PROP);
  const [clientSearch, setClientSearch]  = useState('');
  const [lastExportAt, setLastExportAt]  = useState(getLastExportAt());
  const [exporting, setExporting]        = useState(false);

  const visible       = DEFAULT_VISIBLE;
  const buyerVisible  = BUYER_DEFAULT_VISIBLE;
  const closedVisible = CLOSED_DEFAULT_VISIBLE;
  const prevClientsRef = useRef({});
  const prevBuyersRef  = useRef({});
  const prevClosedRef  = useRef({});
  const buyersRef      = useRef([]);
  const propertiesRef  = useRef([]);
  const clientsRef     = useRef([]);
  const closedRef      = useRef([]);
  const refetchRef     = useRef(() => {});

  useEffect(() => { buyersRef.current = buyers; }, [buyers]);
  useEffect(() => { propertiesRef.current = properties; }, [properties]);
  useEffect(() => { clientsRef.current = clients; }, [clients]);
  useEffect(() => { closedRef.current = closedClients; }, [closedClients]);

  useEffect(() => {
    function fetchAll(isFirst = false) {
      loadAllData()
        .then(data => {
          setClients(data.clients);
          setBuyers(data.buyers);
          setClosedClients(data.closedClients);
          setProperties(data.properties);
          prevClientsRef.current = Object.fromEntries(data.clients.map(c => [c.id, c]));
          prevBuyersRef.current = Object.fromEntries(data.buyers.map(b => [b.id, b]));
          prevClosedRef.current = Object.fromEntries(data.closedClients.map(r => [r.id, r]));
          if (isFirst) setLoading(false);
        })
        .catch(err => { if (isFirst) setError(err.message); });
    }

    fetchAll(true);
    refetchRef.current = () => fetchAll(false);
    let debounceTimer;
    function scheduleFullRefetch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchAll(false), 400);
    }
    const unsub = subscribeToChanges((payload) => {
      applyEvent(prev => {
        const next = applyRealtimeEvent(prev, payload);
        if (next === null) { scheduleFullRefetch(); return prev; }
        return next;
      });
    });
    return () => { clearTimeout(debounceTimer); unsub(); };
  }, [session?.user?.id]);

  // 寫入失敗時：浮現錯誤給使用者，並重抓伺服器真實狀態（回滾樂觀更新），避免「以為存了其實沒存」。
  function handleSyncError(err) {
    console.error(err);
    setSyncError(err?.message || '同步失敗，已重新載入最新資料');
    refetchRef.current();
  }

  function applyEvent(updater) {
    const prev = { clients: clientsRef.current, buyers: buyersRef.current, closedClients: closedRef.current, properties: propertiesRef.current };
    const next = updater(prev);
    if (!next || next === prev) return;
    if (next.clients !== prev.clients) setClients(next.clients);
    if (next.buyers !== prev.buyers) setBuyers(next.buyers);
    if (next.closedClients !== prev.closedClients) setClosedClients(next.closedClients);
    if (next.properties !== prev.properties) setProperties(next.properties);
  }

  function handleClientUpdate(updated) {
    const prev = prevClientsRef.current[updated.id];
    setClients(list => list.map(c => c.id === updated.id ? updated : c));
    prevClientsRef.current[updated.id] = updated;
    syncClient(updated, prev).catch(handleSyncError);
  }

  function handleBuyerUpdate(updated) {
    const prev = prevBuyersRef.current[updated.id];
    setBuyers(list => list.map(b => b.id === updated.id ? updated : b));
    prevBuyersRef.current[updated.id] = updated;
    syncBuyer(updated, prev).catch(handleSyncError);
  }

  function handleClosedUpdate(updated) {
    const prev = prevClosedRef.current[updated.id];
    setClosedClients(list => list.map(r => r.id === updated.id ? updated : r));
    prevClosedRef.current[updated.id] = updated;
    syncClosedClient(updated, prev).catch(handleSyncError);
  }

  function handleDeleteClient(id) {
    if (!window.confirm('確定刪除此客戶？')) return;
    setClients(list => list.filter(c => c.id !== id));
    sheetApi.delete('追蹤線', id).catch(handleSyncError);
  }

  function handleDeleteBuyer(id) {
    if (!window.confirm('確定刪除此買方？')) return;
    setBuyers(list => list.filter(b => b.id !== id));
    sheetApi.delete('買方', id).catch(handleSyncError);
  }

  function handleDeleteClosed(id) {
    if (!window.confirm('確定刪除此成交紀錄？')) return;
    setClosedClients(list => list.filter(r => r.id !== id));
    sheetApi.delete('成交客戶', id).catch(handleSyncError);
  }

  function handleUpdateProperty(updated) {
    setProperties(list => list.map(p => p.id === updated.id ? updated : p));
    // Propagate master-property changes to every client row that references it,
    // preserving per-client fields (showingDate / clientNotes / businessLogs).
    setClients(list => list.map(c => {
      if (!c.properties.some(p => p.id === updated.id)) return c;
      return {
        ...c,
        properties: c.properties.map(p =>
          p.id === updated.id
            ? { ...updated, showingDate: p.showingDate, clientNotes: p.clientNotes, businessLogs: p.businessLogs }
            : p
        ),
      };
    }));
    const prevProp = properties.find(p => p.id === updated.id);
    syncProperty(updated, prevProp).catch(handleSyncError);
  }

  function handleDeleteProperty(id) {
    if (!window.confirm('確定刪除此物件？')) return;
    setProperties(list => list.filter(p => p.id !== id));
    sheetApi.delete('物件', id).catch(handleSyncError);
  }

  function handleAddClient(e) {
    e.preventDefault();
    if (!newClientForm.name.trim()) return;
    (async () => {
      const personId = await createPerson({ name: newClientForm.name.trim(), phone: newClientForm.phone });
      await sheetApi.add('追蹤線', {
        id: genId(), personId, staff: newClientForm.staff, trackType: newClientForm.trackType,
        notes: newClientForm.notes, createdAt: nowDatetime(), updatedAt: nowDatetime(), updatedBy: getCurrentStaffName(session),
      });
    })().catch(handleSyncError);
    setNewClientForm({ ...EMPTY_CLIENT, staff: getCurrentStaffName(session) });
    setAddingClient(false);
  }

  function handleAddBuyer(e) {
    e.preventDefault();
    if (!newBuyerForm.name.trim()) return;
    (async () => {
      const personId = await createPerson({
        name: newBuyerForm.name.trim(), phone: newBuyerForm.phone, birthday: newBuyerForm.birthday,
        address: newBuyerForm.address, mailingAddress: newBuyerForm.mailingAddress,
      });
      await sheetApi.add('買方', {
        id: genId(), personId, staff: newBuyerForm.staff,
        budgetMin: Number(newBuyerForm.budgetMin) || null, budgetMax: Number(newBuyerForm.budgetMax) || null,
        desiredLayout: newBuyerForm.desiredLayout, desiredDistrict: newBuyerForm.desiredDistrict,
        community: newBuyerForm.community, createdAt: nowDatetime(), updatedAt: nowDatetime(), updatedBy: getCurrentStaffName(session),
      });
    })().catch(handleSyncError);
    setNewBuyerForm({ ...EMPTY_BUYER, staff: getCurrentStaffName(session) });
    setAddingBuyer(false);
  }

  function handleAddClosed(e) {
    e.preventDefault();
    if (!newClosedForm.name.trim()) return;
    (async () => {
      const personId = await createPerson({
        name: newClosedForm.name.trim(), phone: newClosedForm.phone, birthday: newClosedForm.birthday,
        address: newClosedForm.address, mailingAddress: newClosedForm.mailingAddress,
      });
      await sheetApi.add('成交客戶', {
        id: genId(), personId, type: newClosedForm.type, dealAddress: newClosedForm.dealAddress,
        community: newClosedForm.community, notes: newClosedForm.notes,
        createdAt: nowDatetime(), updatedAt: nowDatetime(), updatedBy: getCurrentStaffName(session),
      });
    })().catch(handleSyncError);
    setNewClosedForm(EMPTY_CLOSED);
    setAddingClosed(false);
  }

  function generatePropertyNo(dealType) {
    const prefix = dealType === '賣' ? 'A' :'B';
    const maxNo = properties
      .filter(p => p.propertyNo?.startsWith(prefix))
      .reduce((max, p) => {
        const n = parseInt(p.propertyNo.slice(prefix.length), 10);
        return Number.isNaN(n) ? max : Math.max(max, n);
      }, 0);
    return `${prefix}${String(maxNo + 1).padStart(3, '0')}`;
  }

  function handleAddNewProp(e) {
    e.preventDefault();
    if (!newPropForm.address.trim()) return;
    const prop = {
      id: genId(),
      // property_no 不在前端產生：交由 DB trigger 配號（避免雙人同時新增撞號）。
      dealType:          newPropForm.dealType,
      address:           newPropForm.address.trim(),
      totalPrice:        Number(newPropForm.totalPrice) || 0,
      layout:            newPropForm.layout.trim(),
      floor:             newPropForm.floor.trim(),
      saleType:          newPropForm.saleType,
      purpose:           newPropForm.purpose,
      community:         newPropForm.community.trim(),
      area:              Number(newPropForm.area) || 0,
      mainBuildingArea:     Number(newPropForm.mainBuildingArea) || 0,
      attachedBuildingArea: Number(newPropForm.attachedBuildingArea) || 0,
      propertyType:      newPropForm.propertyType.trim(),
      transactionRecord: newPropForm.transactionRecord.trim(),
      parkingSpace:      newPropForm.parkingSpace,
      notes:             newPropForm.notes.trim(),
      createdAt:         nowDatetime(),
    };
    setProperties(prev => [...prev, { ...prop, propertyNo: '配號中…' }]);
    setNewPropForm(EMPTY_PROP);
    setAddingProp(false);
    addProperty(prop)
      .then(saved => setProperties(prev => prev.map(p => p.id === prop.id ? { ...p, ...saved } : p)))
      .catch(handleSyncError);
  }

  const visibleClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    const filtered = term
      ? clients.filter(c => c.properties.some(p =>
          (p.address   || '').toLowerCase().startsWith(term) ||
          (p.community || '').toLowerCase().startsWith(term) ||
          String(p.totalPrice ?? '').startsWith(term)
        ))
      : clients;
    return filtered.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [clients, clientSearch]);

  const visibleBuyers = useMemo(
    () => buyers.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [buyers]
  );
  const visibleClosed = useMemo(
    () => closedClients.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')),
    [closedClients]
  );
  const visibleProperties = useMemo(
    () => properties.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')),
    [properties]
  );

  // 距上次匯出天數（null = 從未匯出）；超過 90 天（約 3 個月）或從未匯出 → 顯示備份提醒橫幅。
  const exportDays = lastExportAt ? Math.floor((Date.now() - lastExportAt.getTime()) / 86400000) : null;
  const showBackupNag = exportDays === null || exportDays > 90;

  async function runExport(fn) {
    if (exporting) return;
    setExporting(true);
    try {
      const saved = await fn();
      if (saved) setLastExportAt(getLastExportAt());
    } catch (err) {
      setSyncError('匯出失敗：' + (err?.message || err));
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="app-loading">載入中…</div>;
  if (error)   return <div className="app-error">載入失敗：{error}</div>;

  return (
    <div className="app">
      {syncError && (
        <div className="sync-error-banner" onClick={() => setSyncError(null)}>
          ⚠ 儲存失敗：{syncError} — 已重新載入最新資料，請確認後重試。（點此關閉）
        </div>
      )}
      {showBackupNag && (
        <div className="backup-nag-banner">
          <span>
            {exportDays === null
              ? '尚未匯出備份，建議定期匯出 Excel 並存到安全的地方。'
              : `距上次備份已 ${exportDays} 天，建議匯出備份並存到安全的地方。`}
          </span>
          <button
            className="backup-nag-btn"
            disabled={exporting}
            onClick={() => runExport(() => exportAll({ clients, buyers, closed: closedClients }))}
          >
            {exporting ? '匯出中…' : '立即匯出全部'}
          </button>
        </div>
      )}
      <div className="topbar">
        <span className="topbar-staff">業務：{getCurrentStaffName(session) || '—'}</span>
        <button className="logout-btn" onClick={() => signOut()}>登出</button>
      </div>
      <div className="app-header">
        <h1>蔡Sindy</h1>
        <TabBar activeTab={activeTab} onChange={setActiveTab} />
        <button
          className="export-btn export-btn--all"
          disabled={exporting}
          onClick={() => runExport(() => exportAll({ clients, buyers, closed: closedClients }))}
        >
          ⬇ 匯出全部
        </button>
        <div className="pagination">每頁 30 筆</div>
      </div>

      {activeTab === '追蹤線' && (
        <>
          <div className="tab-toolbar">
            <button className="add-row-btn" onClick={() => setAddingClient(v => !v)}>
              {addingClient ? '✕ 取消' : '+ 新增客戶'}
            </button>
            <input
              className="search-input"
              placeholder="搜尋社區 / 地址 / 總價"
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
            />
            <button className="export-btn" disabled={exporting} onClick={() => runExport(() => exportClients(clients))}>
              ⬇ 匯出 Excel
            </button>
          </div>
          <div className="table-wrapper">
            <table className="client-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th style={{ width: 72 }}>刪</th>
                  <th style={{ width: 72 }}>人員</th>
                  <th style={{ width: 72 }}>追/募</th>
                  <th style={{ minWidth: 70 }}>客戶姓名</th>
                  <th style={{ width: 100 }}>客戶電話</th>
                  {visible.maintenanceLog && <th style={{ width: 100 }}>維護紀錄</th>}
                  {visible.nextPlan       && <th style={{ width: 96 }}>下次計劃</th>}
                  <th style={{ width: 72 }}>同業/自售</th>
                  {visible.businessLog && <th style={{ width: 90 }}>業務紀錄</th>}
                  <th style={{ minWidth: 120 }}>備註</th>
                  {visible.createdAt   && <th style={{ width: 130 }}>建檔日</th>}
                  {visible.updatedAt   && <th style={{ width: 130 }}>最後修改日</th>}
                </tr>
              </thead>
              <tbody>
                {addingClient && (
                  <tr className="add-inline-row">
                    <td colSpan={13}>
                      <form className="add-inline-form" onSubmit={handleAddClient}>
                        <input placeholder="姓名*" value={newClientForm.name} onChange={e => setNewClientForm(f => ({ ...f, name: e.target.value }))} required />
                        <input placeholder="電話" value={newClientForm.phone} onChange={e => setNewClientForm(f => ({ ...f, phone: e.target.value }))} />
                        <input placeholder="人員" value={newClientForm.staff} onChange={e => setNewClientForm(f => ({ ...f, staff: e.target.value }))} />
                        <select value={newClientForm.trackType} onChange={e => setNewClientForm(f => ({ ...f, trackType: e.target.value }))}>
                          <option>追蹤</option><option>募集</option>
                        </select>
                        <input placeholder="備註" value={newClientForm.notes} onChange={e => setNewClientForm(f => ({ ...f, notes: e.target.value }))} />
                        <button type="submit">儲存</button>
                        <button type="button" onClick={() => setAddingClient(false)}>取消</button>
                      </form>
                    </td>
                  </tr>
                )}
                {visibleClients.map((client, i) => (
                  <ClientRow
                    key={client.id}
                    index={i + 1}
                    client={client}
                    onUpdate={handleClientUpdate}
                    onDelete={handleDeleteClient}
                    visible={visible}
                    staffName={getCurrentStaffName(session)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === '買方' && (
        <>
          <div className="tab-toolbar">
            <button className="add-row-btn" onClick={() => setAddingBuyer(v => !v)}>
              {addingBuyer ? '✕ 取消' : '+ 新增買方'}
            </button>
            <button className="export-btn" disabled={exporting} onClick={() => runExport(() => exportBuyers(buyers))}>
              ⬇ 匯出 Excel
            </button>
          </div>
          <div className="table-wrapper">
            <table className="client-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>刪</th>
                  <th style={{ width: 60 }}>人員</th>
                  <th style={{ minWidth: 96 }}>客戶姓名</th>
                  <th style={{ width: 96 }}>電話</th>
                  <th style={{ width: 60 }}>生日</th>
                  <th style={{ minWidth: 120 }}>戶籍地</th>
                  <th style={{ minWidth: 120 }}>通訊地</th>
                  <th style={{ width: 72 }}>預算(萬)</th>
                  <th style={{ width: 72 }}>期望格局</th>
                  <th style={{ width: 72 }}>期望地區</th>
                  {buyerVisible.watchedProps && <th style={{ width: 110 }}>已看過物件</th>}
                  <th style={{ minWidth: 120 }}>備註</th>
                  {buyerVisible.createdAt    && <th style={{ width: 72 }}>建檔日</th>}
                  {buyerVisible.updatedAt    && <th style={{ width: 72 }}>修改日</th>}
                </tr>
              </thead>
              <tbody>
                {addingBuyer && (
                  <tr className="add-inline-row">
                    <td colSpan={16}>
                      <form className="add-inline-form" onSubmit={handleAddBuyer}>
                        <input placeholder="姓名*" value={newBuyerForm.name} onChange={e => setNewBuyerForm(f => ({ ...f, name: e.target.value }))} required />
                        <input placeholder="電話" value={newBuyerForm.phone} onChange={e => setNewBuyerForm(f => ({ ...f, phone: e.target.value }))} />
                        <input placeholder="人員" value={newBuyerForm.staff} onChange={e => setNewBuyerForm(f => ({ ...f, staff: e.target.value }))} />
                        <input placeholder="生日 (YYYY-MM-DD)" value={newBuyerForm.birthday} onChange={e => setNewBuyerForm(f => ({ ...f, birthday: e.target.value }))} />
                        <input placeholder="戶籍地" value={newBuyerForm.address} onChange={e => setNewBuyerForm(f => ({ ...f, address: e.target.value }))} />
                        <input placeholder="通訊地" value={newBuyerForm.mailingAddress} onChange={e => setNewBuyerForm(f => ({ ...f, mailingAddress: e.target.value }))} />
                        <input placeholder="預算下限(萬)" type="number" value={newBuyerForm.budgetMin} onChange={e => setNewBuyerForm(f => ({ ...f, budgetMin: e.target.value }))} />
                        <input placeholder="預算上限(萬)" type="number" value={newBuyerForm.budgetMax} onChange={e => setNewBuyerForm(f => ({ ...f, budgetMax: e.target.value }))} />
                        <input placeholder="期望格局" value={newBuyerForm.desiredLayout} onChange={e => setNewBuyerForm(f => ({ ...f, desiredLayout: e.target.value }))} />
                        <input placeholder="期望地區" value={newBuyerForm.desiredDistrict} onChange={e => setNewBuyerForm(f => ({ ...f, desiredDistrict: e.target.value }))} />
                        <input placeholder="社區" value={newBuyerForm.community} onChange={e => setNewBuyerForm(f => ({ ...f, community: e.target.value }))} />
                        <button type="submit">儲存</button>
                        <button type="button" onClick={() => setAddingBuyer(false)}>取消</button>
                      </form>
                    </td>
                  </tr>
                )}
                {visibleBuyers.map(buyer => (
                  <BuyerRow key={buyer.id} buyer={buyer} onUpdate={handleBuyerUpdate} onDelete={handleDeleteBuyer} visible={buyerVisible} staffName={getCurrentStaffName(session)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === '成交客戶' && (
        <>
          <div className="tab-toolbar">
            <button className="add-row-btn" onClick={() => setAddingClosed(v => !v)}>
              {addingClosed ? '✕ 取消' : '+ 新增成交客戶'}
            </button>
            <button className="export-btn" disabled={exporting} onClick={() => runExport(() => exportClosed(closedClients))}>
              ⬇ 匯出 Excel
            </button>
          </div>
          <div className="table-wrapper">
            <table className="client-table">
              <thead>
                <tr>
                  <th style={{ width: 72 }}>刪</th>
                  <th style={{ width: 72 }}>選項</th>
                  <th style={{ minWidth: 72 }}>姓名</th>
                  <th style={{ width: 72 }}>電話</th>
                  <th style={{ width: 72 }}>生日</th>
                  <th style={{ width: 140 }}>戶籍地</th>
                  <th style={{ width: 140 }}>通訊地</th>
                  <th style={{ width: 140 }}>成交地址</th>
                  
                  <th style={{ width: 72 }}>社區</th>
                  <th style={{ minWidth: 160 }}>備註</th>
                  {closedVisible.createdAt && <th style={{ width: 72 }}>建檔日</th>}

                </tr>
              </thead>
              <tbody>
                {addingClosed && (
                  <tr className="add-inline-row">
                    <td colSpan={11}>
                      <form className="add-inline-form" onSubmit={handleAddClosed}>
                        <input placeholder="姓名*" value={newClosedForm.name} onChange={e => setNewClosedForm(f => ({ ...f, name: e.target.value }))} required />
                        <select value={newClosedForm.type} onChange={e => setNewClosedForm(f => ({ ...f, type: e.target.value }))}>
                          <option>買</option><option>賣</option><option>租</option>
                        </select>
                        <input placeholder="電話" value={newClosedForm.phone} onChange={e => setNewClosedForm(f => ({ ...f, phone: e.target.value }))} />
                        <input placeholder="生日 (YYYY-MM-DD)" value={newClosedForm.birthday} onChange={e => setNewClosedForm(f => ({ ...f, birthday: e.target.value }))} />
                        <input placeholder="戶籍地" value={newClosedForm.address} onChange={e => setNewClosedForm(f => ({ ...f, address: e.target.value }))} />
                        <input placeholder="通訊地" value={newClosedForm.mailingAddress} onChange={e => setNewClosedForm(f => ({ ...f, mailingAddress: e.target.value }))} />
                        <input placeholder="成交地址" value={newClosedForm.dealAddress} onChange={e => setNewClosedForm(f => ({ ...f, dealAddress: e.target.value }))} />
                        <input placeholder="社區" value={newClosedForm.community} onChange={e => setNewClosedForm(f => ({ ...f, community: e.target.value }))} />
                        <input placeholder="備註" value={newClosedForm.notes} onChange={e => setNewClosedForm(f => ({ ...f, notes: e.target.value }))} />
                        <button type="submit">儲存</button>
                        <button type="button" onClick={() => setAddingClosed(false)}>取消</button>
                      </form>
                    </td>
                  </tr>
                )}
                {visibleClosed.map(record => (
                  <ClosedClientRow key={record.id} record={record} onUpdate={handleClosedUpdate} onDelete={handleDeleteClosed} visible={closedVisible} buyers={buyers} staffName={getCurrentStaffName(session)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* {activeTab === '物件管理' && (
        <>
          <div className="tab-toolbar">
            <button className="add-row-btn" onClick={() => setAddingProp(v => !v)}>
              {addingProp ? '✕ 取消' : '+ 新增物件'}
            </button>
          </div>
          <div className="table-wrapper">
            <table className="client-table">
              <thead>
                <tr>
                  <th style={{ width: 72 }}>刪</th>
                  <th style={{ width: 80 }}>物件編號</th>
                  <th style={{ width: 72 }}>租/賣</th>
                  <th style={{ minWidth: 105 }}>物件地址</th>
                  <th style={{ width: 80 }}>總價/月租金</th>
                  <th style={{ width: 40 }}>格局(房/廳/衛)</th>
                  <th style={{ width: 40 }}>樓高/樓別</th>
                  <th style={{ width: 96 }}>社區</th>
                  <th style={{ width: 72 }}>用途</th>
                  <th style={{ width: 64 }}>總坪數</th>
                  <th style={{ width: 64 }}>主建物</th>
                  <th style={{ width: 64 }}>附屬建物</th>
                  <th style={{ width: 88 }}>物件類型</th>
                  <th style={{ width: 88 }}>車位</th>
                  <th style={{ width: 100 }}>交易紀錄</th>
                  <th style={{ minWidth: 120 }}>備註</th>
                </tr>
              </thead>
              <tbody>
                {visibleProperties.map(p => (
                  <PropertyManagementRow key={p.id} property={p} onUpdate={handleUpdateProperty} onDelete={handleDeleteProperty} staffName={getCurrentStaffName(session)} />
                ))}
                {addingProp && (
                  <tr className="prop-mgmt-add-row">
                    <td colSpan={16}>
                      <form className="prop-mgmt-add-form" onSubmit={handleAddNewProp}>
                        <select value={newPropForm.dealType} onChange={e => setNewPropForm(p => ({ ...p, dealType: e.target.value }))}>
                          <option>賣</option><option>租</option>
                        </select>
                        <select value={newPropForm.purpose} onChange={e => setNewPropForm(p => ({ ...p, purpose: e.target.value }))}>
                          <option>住宅</option><option>店面</option><option>商辦</option>
                        </select>
                        <input placeholder="地址*" value={newPropForm.address} onChange={e => setNewPropForm(p => ({ ...p, address: e.target.value }))} required />
                        <input placeholder={newPropForm.dealType === '租' ? '月租金' : '總價(萬)'} type="number" value={newPropForm.totalPrice} onChange={e => setNewPropForm(p => ({ ...p, totalPrice: e.target.value }))} />
                        <input placeholder="格局 房/廳/衛" value={newPropForm.layout} onChange={e => setNewPropForm(p => ({ ...p, layout: e.target.value }))} />
                        <input placeholder="樓高/樓別" value={newPropForm.floor} onChange={e => setNewPropForm(p => ({ ...p, floor: e.target.value }))} />
                        <input placeholder="社區" value={newPropForm.community} onChange={e => setNewPropForm(p => ({ ...p, community: e.target.value }))} />
                        <input placeholder="總坪數" type="number" value={newPropForm.area} onChange={e => setNewPropForm(p => ({ ...p, area: e.target.value }))} />
                        <input placeholder="主建物" type="number" value={newPropForm.mainBuildingArea} onChange={e => setNewPropForm(p => ({ ...p, mainBuildingArea: e.target.value }))} />
                        <input placeholder="附屬建物" type="number" value={newPropForm.attachedBuildingArea} onChange={e => setNewPropForm(p => ({ ...p, attachedBuildingArea: e.target.value }))} />
                        <input placeholder="物件類型" value={newPropForm.propertyType} onChange={e => setNewPropForm(p => ({ ...p, propertyType: e.target.value }))} />
                        <input placeholder="交易紀錄" value={newPropForm.transactionRecord} onChange={e => setNewPropForm(p => ({ ...p, transactionRecord: e.target.value }))} />
                        <select value={newPropForm.parkingSpace} onChange={e => setNewPropForm(p => ({ ...p, parkingSpace: e.target.value }))}>
                          <option value="">無車位</option>
                          <option value="坡道平面">坡道平面</option>
                          <option value="機械式">機械式</option>
                          <option value="坡道機械">坡道機械</option>
                        </select>
                        <input placeholder="備註" value={newPropForm.notes} onChange={e => setNewPropForm(p => ({ ...p, notes: e.target.value }))} />
                        <span className="prop-no-preview">編號：系統自動配號（約 {generatePropertyNo(newPropForm.dealType)}）</span>
                        <button type="submit">儲存</button>
                        <button type="button" onClick={() => setAddingProp(false)}>取消</button>
                      </form>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )} */}
    </div>
  );
}
