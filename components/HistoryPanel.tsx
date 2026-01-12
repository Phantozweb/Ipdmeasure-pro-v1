import React from 'react';
import { History, Trash2, Inbox, Calendar, Activity, Eye } from 'lucide-react';
import { MeasurementHistoryItem } from '../types';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface HistoryPanelProps {
    history: MeasurementHistoryItem[];
    onClear: () => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length >= 2) {
        // payload order depends on stack order. Usually 0 is bottom, 1 is top.
        const rightVal = payload[0].value;
        const leftVal = payload[1].value;
        const total = rightVal + leftVal;
        
        return (
            <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-xl text-xs font-mono z-50">
                <p className="text-slate-400 mb-2 border-b border-slate-600 pb-1">SCAN ID: {label ? label.substring(label.length - 6) : '...'}</p>
                
                <div className="flex items-center justify-between gap-4 text-cyan-400 mb-1">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-cyan-400"></div> LEFT EYE</span>
                    <span className="font-bold">{leftVal.toFixed(1)}mm</span>
                </div>
                
                <div className="flex items-center justify-between gap-4 text-purple-400 mb-2">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-400"></div> RIGHT EYE</span>
                    <span className="font-bold">{rightVal.toFixed(1)}mm</span>
                </div>
                
                <div className="flex items-center justify-between gap-4 text-white font-bold pt-2 border-t border-slate-600">
                    <span>TOTAL IPD</span>
                    <span>{total.toFixed(1)}mm</span>
                </div>
            </div>
        );
    }
    return null;
};

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, onClear }) => {
    // Reverse history for chart (chronological left-to-right)
    const chartData = [...history].reverse();

    return (
        <div className="mt-8 pt-0 border-t border-gray-100">
            <div className="flex items-center justify-between mb-6 pt-6">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <History size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-gray-900 leading-tight">Scan Log</h3>
                        <p className="text-xs text-gray-500 font-medium">{history.length} records stored</p>
                    </div>
                </div>
                {history.length > 0 && (
                    <button 
                        onClick={onClear}
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-50 text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all text-xs font-semibold border border-gray-200 hover:border-red-200"
                    >
                        <Trash2 size={12} className="group-hover:scale-110 transition-transform" />
                        Clear
                    </button>
                )}
            </div>

            {history.length > 0 ? (
                <div className="space-y-6">
                    {/* Stacked Trend Chart */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                <Activity size={10} />
                                Binocular Trend (L/R)
                            </span>
                            <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                DATA POINTS: {history.length}
                            </span>
                        </div>
                        <div className="h-40 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorLeft" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorRight" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }} />
                                    
                                    {/* Right Eye (Bottom Layer) */}
                                    <Area 
                                        type="monotone" 
                                        dataKey="rightPd" 
                                        stackId="1" 
                                        stroke="#7c3aed" 
                                        fill="url(#colorRight)" 
                                        strokeWidth={2}
                                        isAnimationActive={false} // Disable animation for smoother 100-point rendering
                                    />
                                    
                                    {/* Left Eye (Top Layer) */}
                                    <Area 
                                        type="monotone" 
                                        dataKey="leftPd" 
                                        stackId="1" 
                                        stroke="#0891b2" 
                                        fill="url(#colorLeft)" 
                                        strokeWidth={2}
                                        isAnimationActive={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Data List */}
                    <div className="space-y-3">
                        {history.map((item) => {
                            // Accuracy Color Logic
                            const isHighAcc = item.accuracy >= 90;
                            const isMedAcc = item.accuracy >= 75 && item.accuracy < 90;
                            const borderColor = isHighAcc ? 'border-l-emerald-500' : isMedAcc ? 'border-l-amber-400' : 'border-l-red-400';
                            const badgeColor = isHighAcc ? 'text-emerald-700 bg-emerald-50 ring-emerald-600/20' : isMedAcc ? 'text-amber-700 bg-amber-50 ring-amber-600/20' : 'text-red-700 bg-red-50 ring-red-600/20';

                            return (
                                <div key={item.id} className={`group bg-white rounded-lg border border-gray-200 border-l-4 ${borderColor} p-4 hover:shadow-md transition-all duration-200`}>
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium mb-0.5">
                                                <Calendar size={10} />
                                                {item.timestamp}
                                            </div>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-gray-900 tracking-tight">{item.ipd.toFixed(1)}</span>
                                                <span className="text-sm text-gray-500 font-medium">mm</span>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${badgeColor}`}>
                                            {item.accuracy}% Acc
                                        </div>
                                    </div>

                                    {/* Monocular Grid */}
                                    <div className="grid grid-cols-2 gap-px bg-gray-100 rounded-md overflow-hidden border border-gray-100">
                                        <div className="bg-gray-50 p-2 group-hover:bg-white transition-colors relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500/50"></div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 pl-1">Left Eye</div>
                                            <div className="font-mono text-sm font-semibold text-gray-700 pl-1">{item.leftPd ? item.leftPd.toFixed(1) : '--'}</div>
                                        </div>
                                        <div className="bg-gray-50 p-2 group-hover:bg-white transition-colors relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50"></div>
                                            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 pl-1">Right Eye</div>
                                            <div className="font-mono text-sm font-semibold text-gray-700 pl-1">{item.rightPd ? item.rightPd.toFixed(1) : '--'}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="text-center py-12 px-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100">
                        <Inbox className="text-gray-400" size={24} />
                    </div>
                    <h4 className="text-sm font-semibold text-gray-900">No scans recorded</h4>
                    <p className="text-xs text-gray-500 mt-1 max-w-[200px] mx-auto">
                        Your measurement history and trends will appear here.
                    </p>
                </div>
            )}
        </div>
    );
};

export default HistoryPanel;