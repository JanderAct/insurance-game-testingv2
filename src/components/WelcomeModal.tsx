import { useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';
import { WELCOME_GUIDE, WELCOME_GUIDE_TITLE, type WelcomeBlock } from '../data/welcomeGuide';

interface WelcomeModalProps {
  onClose: () => void;
}

// Renders **bold** markers from the content data as <strong> spans.
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

function renderBlock(block: WelcomeBlock, i: number) {
  switch (block.type) {
    case 'heading':
      return <h3 key={i} className="text-lg font-bold text-gray-900 mt-6 first:mt-0">{block.text}</h3>;
    case 'subheading':
      return <h4 key={i} className="text-sm font-semibold text-gray-800 mt-4">{renderInline(block.text)}</h4>;
    case 'paragraph':
      return <p key={i} className="text-sm text-gray-600 leading-relaxed mt-2">{renderInline(block.text)}</p>;
    case 'list':
      return (
        <ul key={i} className="list-disc list-inside text-sm text-gray-600 leading-relaxed mt-2 space-y-1">
          {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>
      );
  }
}

// Explains the setup screen and the three coverage lines before a player
// fills anything in. Purely informational — dismissible any way, never
// gates Start Simulation.
export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-[840px] w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2 bg-blue-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">{WELCOME_GUIDE_TITLE}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {WELCOME_GUIDE.map(renderBlock)}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
