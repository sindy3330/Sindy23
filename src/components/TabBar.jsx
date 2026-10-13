import React from 'react';

export default function TabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'buyers', label: '買方' },
    { id: 'sellers', label: '賣方' },
    { id: 'properties', label: '物件' },
    { id: 'closed', label: '成交' },
    { id: 'schedule', label: '行事曆' },
  ];

  return (
    <div className="flex border-b border-gray-200 bg-white shadow-sm">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex-1 py-3 text-center font-medium text-sm transition-colors ${
            activeTab === tab.id
              ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50/50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
