import React from 'react';

export default function ClientRow({ client, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-gray-900">{client.name}</span>
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{client.staff || '未指定'}</span>
        </div>
        <div className="text-sm text-gray-500 space-x-3">
          {client.phone && <span>電話: {client.phone}</span>}
          {client.budgetMax && <span>預算: {client.budgetMin || 0} ~ {client.budgetMax} 萬</span>}
        </div>
      </div>
      <div className="flex space-x-2">
        {onEdit && (
          <button onClick={() => onEdit(client)} className="px-3 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
            編輯
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(client.id)} className="px-3 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors">
            刪除
          </button>
        )}
      </div>
    </div>
  );
}
