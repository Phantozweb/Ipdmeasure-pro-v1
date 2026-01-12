import React, { useState } from 'react';
import { Lightbulb, Check, ChevronDown, ChevronUp } from 'lucide-react';

const Instructions: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);

    const tips = [
        "Face inside oval guide",
        "Distance approx. 30cm",
        "Even lighting, no shadows",
        "Look at camera",
        "Remove glasses"
    ];

    return (
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl overflow-hidden transition-all">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 text-left"
            >
                <div className="flex items-center gap-2">
                    <Lightbulb size={16} className="text-amber-500" />
                    <span className="text-sm font-semibold text-blue-900">Tips for Best Results</span>
                </div>
                {isOpen ? <ChevronUp size={16} className="text-blue-400" /> : <ChevronDown size={16} className="text-blue-400" />}
            </button>
            
            {isOpen && (
                <div className="px-3 pb-3 pt-0">
                    <ul className="grid grid-cols-2 gap-2">
                        {tips.map((tip, index) => (
                            <li key={index} className="flex items-start gap-1.5 text-xs text-blue-800/80">
                                <Check size={12} className="mt-0.5 text-blue-500 shrink-0" />
                                {tip}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default Instructions;