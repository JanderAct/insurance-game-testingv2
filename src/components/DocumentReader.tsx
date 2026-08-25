import type { ReactNode } from 'react';
import { FileText, Lock } from 'lucide-react';
import { renderMarkdown } from '../utils/renderMarkdown';

export interface DocumentEntry {
  id: string;
  title: string;
  summary: string;
  // Raw markdown (already template-substituted, if applicable). Omitted for
  // an entry that isn't built yet — see notBuiltNote.
  content?: string;
  // Shown in place of the reader pane, and disables selection, when content
  // is absent — e.g. a department whose document doesn't exist yet.
  notBuiltNote?: string;
}

interface DocumentReaderProps {
  documents: DocumentEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  // Rendered above the document list in the left rail (e.g. a year selector).
  listHeader?: ReactNode;
}

// Document list + reader, shared by the Introduction and Departments tabs.
// A single long scroll doesn't survive a growing document count; this does —
// the list stays a fixed-width rail regardless of how many entries it holds.
export default function DocumentReader({ documents, selectedId, onSelect, listHeader }: DocumentReaderProps) {
  const selected = documents.find(d => d.id === selectedId) ?? documents[0];

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-3">
          {listHeader}
          <nav className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {documents.map(doc => {
              const isSelected = doc.id === selected?.id;
              const isBuilt = doc.content !== undefined;
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={!isBuilt}
                  onClick={() => isBuilt && onSelect(doc.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition-colors flex items-start gap-2.5 ${
                    !isBuilt
                      ? 'cursor-not-allowed opacity-50'
                      : isSelected
                        ? 'bg-blue-50 border-l-2 border-l-blue-600'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`mt-0.5 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                    {isBuilt ? <FileText size={16} /> : <Lock size={16} />}
                  </span>
                  <span>
                    <span className={`block text-sm font-semibold ${isSelected ? 'text-blue-800' : 'text-gray-800'}`}>
                      {doc.title}
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">{doc.summary}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 min-h-[400px]">
          {selected?.content !== undefined ? (
            <div
              className="prose prose-sm sm:prose-base prose-slate max-w-none prose-headings:font-bold prose-a:text-blue-600"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.content) }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center text-gray-400">
              <Lock size={28} className="mb-3" />
              <p className="text-sm font-medium text-gray-500">{selected?.title}</p>
              <p className="text-sm mt-1 max-w-sm">{selected?.notBuiltNote ?? 'Not built yet.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
