import React from 'react';

export type TabId =
  | 'setup'
  | 'history'
  | 'dashboard'
  | 'decisions'
  | 'financials'
  | 'results'
  | 'spreadsheet'
  | 'audit'
  | 'membership';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

export default function TabNav({ tabs, activeTab, onSelect }: TabNavProps) {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-[60px] z-30 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex gap-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onSelect(tab.id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap
                ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : tab.disabled
                    ? 'border-transparent text-gray-300 cursor-not-allowed'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50'
                }`}
            >
              <span className={activeTab === tab.id ? 'text-blue-600' : 'text-gray-400'}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
