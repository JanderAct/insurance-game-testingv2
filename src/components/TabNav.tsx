import React from 'react';

export type TabId =
  | 'setup'
  | 'introduction'
  | 'departments'
  | 'history'
  | 'dashboard'
  | 'decisions'
  | 'decisionHistory'
  | 'financials'
  | 'results'
  | 'spreadsheet'
  | 'audit'
  | 'membership';

export interface Tab<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface TabNavProps<T extends string> {
  tabs: Tab<T>[];
  activeTab: T;
  onSelect: (tab: T) => void;
  stickyTop?: number; // px offset from viewport top when stacking multiple nav bars
  zIndex?: number;
}

export default function TabNav<T extends string>({ tabs, activeTab, onSelect, stickyTop = 60, zIndex = 30 }: TabNavProps<T>) {
  return (
    <nav className="bg-white border-b border-gray-200 sticky shadow-sm" style={{ top: stickyTop, zIndex }}>
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
