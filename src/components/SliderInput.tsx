import React from 'react';
import { HelpCircle } from 'lucide-react';

interface SliderInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  helpText?: string;
  leftLabel?: string;
  rightLabel?: string;
  valueColor?: string;
  disabled?: boolean;
}

export default function SliderInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  helpText,
  leftLabel,
  rightLabel,
  valueColor = 'text-blue-600',
  disabled = false,
}: SliderInputProps) {
  const [showHelp, setShowHelp] = React.useState(false);
  const display = formatValue ? formatValue(value) : String(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          {helpText && (
            <div className="relative">
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                onMouseEnter={() => setShowHelp(true)}
                onMouseLeave={() => setShowHelp(false)}
                onClick={() => setShowHelp(h => !h)}
                aria-label="Help"
              >
                <HelpCircle size={14} />
              </button>
              {showHelp && (
                <div className="absolute z-50 left-6 top-0 w-72 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl leading-relaxed">
                  {helpText}
                </div>
              )}
            </div>
          )}
        </div>
        <span className={`text-sm font-bold ${valueColor}`}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-gray-400">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}