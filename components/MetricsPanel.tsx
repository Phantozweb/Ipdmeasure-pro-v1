import React from 'react';
import { Ruler, Move, Sun, Target, CheckCircle, AlertTriangle } from 'lucide-react';
import { Metrics } from '../types';

interface MetricsPanelProps {
    metrics: Metrics | null;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({ metrics }) => {
    const getValue = (val: number | undefined, suffix: string = '') => 
        val !== undefined && !isNaN(val) ? `${val.toFixed(1)}${suffix}` : '--';

    const ipdStatus = () => {
        if (!metrics) return { text: '', color: 'text-gray-400', bg: 'bg-gray-100', icon: null };
        if (metrics.ipd >= 54 && metrics.ipd <= 74) 
            return { text: 'Normal', color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle };
        return { text: 'Unusual', color: 'text-amber-700', bg: 'bg-amber-100', icon: AlertTriangle };
    };

    const status = ipdStatus();
    const StatusIcon = status.icon;

    // Calculate circular progress for accuracy
    const radius = 24;
    const circumference = 2 * Math.PI * radius;
    const accuracyOffset = metrics 
        ? circumference - (metrics.accuracy / 100) * circumference 
        : circumference;

    return (
        <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
            {/* IPD Card */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                <div className="flex items-center gap-2 mb-1">
                    <div className="p-1.5 bg-blue-50 text-blue-600 rounded-md">
                        <Ruler size={16} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">IPD</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 leading-none mt-1">
                    {getValue(metrics?.ipd)}<span className="text-xs font-medium text-gray-500 ml-0.5">mm</span>
                </div>
                {metrics && StatusIcon && (
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold mt-2 ${status.bg} ${status.color}`}>
                        <StatusIcon size={10} />
                        {status.text}
                    </div>
                )}
            </div>

            {/* Distance Card */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                    <div className="p-1.5 bg-green-50 text-green-600 rounded-md">
                        <Move size={16} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Distance</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 leading-none mt-1">
                    {getValue(metrics?.distance, '')}<span className="text-xs font-medium text-gray-500 ml-0.5">cm</span>
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-300 ${metrics && metrics.distance >= 30 && metrics.distance <= 50 ? 'bg-green-500' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, (metrics?.distance || 0) / 60 * 100)}%` }}
                    />
                </div>
                {metrics && (
                    <div className="mt-1 text-[10px] font-medium text-gray-400">
                        {metrics.distance < 30 ? 'Too Close' : metrics.distance > 50 ? 'Too Far' : 'Optimal'}
                    </div>
                )}
            </div>

            {/* Lighting Card */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                    <div className="p-1.5 bg-amber-50 text-amber-600 rounded-md">
                        <Sun size={16} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Light</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 leading-none mt-1">
                    {getValue(metrics?.lighting, '')}<span className="text-xs font-medium text-gray-500 ml-0.5">%</span>
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-300 ${metrics && metrics.lighting > 60 ? 'bg-amber-400' : 'bg-red-300'}`}
                        style={{ width: `${metrics?.lighting || 0}%` }}
                    />
                </div>
            </div>

            {/* Accuracy Card */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="p-1.5 bg-purple-50 text-purple-600 rounded-md">
                            <Target size={16} />
                        </div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mt-1">Accuracy</span>
                </div>
                
                <div className="relative w-12 h-12">
                    <svg className="w-full h-full -rotate-90">
                        <circle cx="24" cy="24" r={radius} className="stroke-gray-100" strokeWidth="4" fill="none" />
                        <circle 
                            cx="24" cy="24" r={radius} 
                            className={`transition-all duration-500 ${metrics && metrics.accuracy > 80 ? 'stroke-purple-500' : 'stroke-amber-400'}`}
                            strokeWidth="4" 
                            fill="none" 
                            strokeDasharray={circumference}
                            strokeDashoffset={accuracyOffset}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-bold text-gray-900">{metrics?.accuracy || 0}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MetricsPanel;