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
  const [clientSearch, setClientSearch]   = useState('');
  const [lastExportAt, setLastExportAt]   = useState(getLastExportAt());
  const [exporting, setExporting]         = useState(false);

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
    if (!window.confirm('確定刪除此客戶？')) return;
    setBuyers(list => list.filter(b => b.id !== id));
    sheetApi.delete('買方', id).catch(handleSyncError);
  }

  function handleDeleteClosed(id) {
    if (!window.confirm('確定刪除此成交紀錄？')) return;
    setClosedClients(list => list.filter(r => r.id !== id));
    sheetApi.delete('成交客戶', id).catch(handleSyncError);
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
        name: newClosedForm.name.trim(),
        phone: newClosedForm.phone ? newClosedForm.phone.trim() : '',
        birthday: newClosedForm.birthday,
        address: newClosedForm.address,
        mailingAddress: newClosedForm.mailingAddress,
      });
      await sheetApi.add('成交', {
        id: genId(),
        personId,
        staff: newClosedForm.staff,
        type: newClosedForm.type || '買賣',
        property: newClosedForm.property ? newClosedForm.property.trim() : '',
        price: newClosedForm.price ? newClosedForm.price.trim() : '',
        date: newClosedForm.date || nowDatetime(),
        note: newClosedForm.note ? newClosedForm.note.trim() : '',
        createdAt: nowDatetime(),
        updatedAt: nowDatetime(),
        updatedBy: getCurrentStaffName(session),
      });
    })().catch(handleSyncError);
    setNewClosedForm({ ...EMPTY_CLOSED, staff: getCurrentStaffName(session) });
    setAddingClosed(false);
  }
