import React, { useState } from 'react';
import TabBar from './components/TabBar';
import ClientRow from './components/ClientRow';
import BuyerRow from './components/BuyerRow';
import ClosedClientRow from './components/ClosedClientRow';
import PropertyManagementRow from './components/PropertyManagementRow';

export default function App() {
  const [activeTab, setActiveTab] = useState('clients');
  const [clients, setClients] = useState([
    { id: 1, name: '王小明', phone: '0912345678', budgetMin: 1000, budgetMax: 2000, staff: '小廷' }
  ]);
  const [buyers, setBuyers] = useState([
    { id: 2, name: '李大華', phone: '0987654321', budgetMin: 1500, budgetMax: 2500, staff: '小廷' }
  ]);
  const [closed, setClosed] = useState([
    { id: 3, name: '張美玲', phone: '0933555777', price: 1800, staff: '小廷' }
  ]);
  const [properties, setProperties] = useState([
    { id: 4, title: '幸福路美三房', price: 2200, location: '新竹市東區', type: '住宅' }
  ]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white shadow-sm p-4 text-center font-bold text-lg text-gray-800">
        Sindy23 地產業務管理系統
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'clients' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 font-bold border-b">開發客戶清單</div>
            {clients.map(c => <ClientRow key={c.id} client={c} />)}
          </div>
        )}

        {activeTab === 'buyers' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 font-bold border-b">買方客戶清單</div>
            {buyers.map(b => <BuyerRow key={b.id} client={b} />)}
          </div>
        )}

        {activeTab === 'closed' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 font-bold border-b">已成交清單</div>
            {closed.map(c => <ClosedClientRow key={c.id} client={c} />)}
          </div>
        )}

        {activeTab === 'properties' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 font-bold border-b">物件管理清單</div>
            {properties.map(p => <PropertyManagementRow key={p.id} property={p} />)}
          </div>
        )}
      </main>

      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}
