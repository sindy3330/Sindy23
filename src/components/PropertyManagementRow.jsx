import React from 'react';

export default function PropertyManagementRow({ property, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <div className="flex flex-col space-y-1">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-gray-900">{property.title || property.name || '未命名物件'}</span>
          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">{property.type || '一般物件'}</span>
        </div>
        <div className="text-sm text-gray-500 space-x-3">
          {property.price && <span>開價: {property.price} 萬</span>}
          {property.location && <span>地點: {property.location}</span>}
        </div>
      </div>
      <div className="flex space-x-2">
        {onEdit && (
          <button onClick={() => onEdit(property)} className="px-3 py-1 text-xs text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
            編輯
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(property.id)} className="px-3 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors">
            刪除
          </button>
        )}
      </div>
    </div>
  );
}
