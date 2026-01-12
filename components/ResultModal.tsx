import React from 'react';
import { Save, X, Check, Activity, TrendingUp } from 'lucide-react';
import { Metrics } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface ResultModalProps {
    isOpen: boolean;
    metrics: Metrics | null;
    samples?: Metrics[];
    onSave: () => void;
    onClose: () => void;
}

const ResultModal: React.FC<ResultModalProps> = ({ isOpen, metrics, samples, onSave, onClose }) => {
    if (!isOpen || !metrics) return null;

    // Prepare chart data
    const data = samples?.map((s, i) => ({
        index: i + 1,
        ipd: parseFloat(s.ipd.toFixed(2)), // Ensure number
        leftPd: parseFloat(s.leftPd.toFixed(2)),
        rightPd: parseFloat(s.rightPd.toFixed(2))
    })) || [];

    // Calculate domain for chart to zoom in on the variation
    const minIpd = Math.min(...data.map(d => d.ipd));
    const maxIpd = Math.max(...data.map(d => d.ipd));
    const buffer = 1.0; // 1mm buffer

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
                onClick={onClose}
            />
            {/* Widened the modal to fit the graph nicely */}
            <div className="relative bg-white rounded-2xl w-full max-w-2xl p-6 shadow-2xl transform transition-all animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="text-center mb-6 border-b border-gray-100 pb-4">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-300">
                        <Check size={32} className="text-success" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Measurement Complete</h2>
                    <p className="text-gray-500 text-sm mt-1">High-precision scan analyzed</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Left Col: Summary Stats */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Final Results</h3>
                        
                        <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                            <span className="text-blue-600/70 text-xs font-bold uppercase tracking-wider block mb-1">Total IPD</span>
                            <span className="text-3xl font-black text-blue-900">{metrics.ipd.toFixed(1)} <span className="text-lg font-medium text-blue-600/60">mm</span></span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                <span className="text-gray-400 text-[10px] font-bold uppercase block mb-1">Left Mono</span>
                                <span className="text-lg font-bold text-gray-700">{metrics.leftPd.toFixed(1)}</span>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                <span className="text-gray-400 text-[10px] font-bold uppercase block mb-1">Right Mono</span>
                                <span className="text-lg font-bold text-gray-700">{metrics.rightPd.toFixed(1)}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm font-medium border border-green-100">
                            <Activity size={16} />
                            <span>Confidence Score: {metrics.accuracy}%</span>
                        </div>
                    </div>

                    {/* Right Col: Real-time Graph */}
                    <div className="flex flex-col h-full min-h-[200px]">
                        <div className="flex items-center justify-between mb-2">
                             <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                <TrendingUp size={14} />
                                Scan Stability (100 Samples)
                            </h3>
                        </div>
                        
                        <div className="flex-1 bg-gray-900 rounded-xl p-4 shadow-inner border border-gray-800 relative overflow-hidden group">
                             {/* Grid Background Effect */}
                             <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                    <XAxis 
                                        dataKey="index" 
                                        hide={true} 
                                    />
                                    <YAxis 
                                        domain={[minIpd - buffer, maxIpd + buffer]} 
                                        hide={true} 
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6', fontSize: '12px' }}
                                        itemStyle={{ color: '#67e8f9' }}
                                        labelStyle={{ color: '#9ca3af' }}
                                        formatter={(value: number) => [`${value} mm`, 'IPD']}
                                        labelFormatter={(label) => `Sample #${label}`}
                                    />
                                    <ReferenceLine y={metrics.ipd} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'right',  value: 'AVG', fill: '#ef4444', fontSize: 10 }} />
                                    <Line 
                                        type="monotone" 
                                        dataKey="ipd" 
                                        stroke="#22d3ee" 
                                        strokeWidth={2} 
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#fff' }}
                                        animationDuration={1500}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                            
                            {/* Overlay Stats */}
                            <div className="absolute top-2 right-2 text-[10px] text-gray-500 font-mono text-right bg-gray-900/80 px-2 py-1 rounded">
                                <div>MAX: {maxIpd.toFixed(1)}</div>
                                <div>MIN: {minIpd.toFixed(1)}</div>
                            </div>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2 text-center">
                            Graph shows real-time fluctuations during the 3-second scan window. 
                            <br/>Flat line indicates high stability.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 mt-4 border-t border-gray-100 pt-4">
                     <button 
                        onClick={onClose}
                        className="flex-1 flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-semibold transition-colors"
                    >
                        <X size={18} />
                        Discard
                    </button>
                    <button 
                        onClick={onSave}
                        className="flex-[2] flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white py-3 rounded-xl font-semibold transition-colors shadow-lg shadow-blue-500/30"
                    >
                        <Save size={18} />
                        Save Measurement
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ResultModal;