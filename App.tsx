import React, { useEffect, useState, useCallback } from 'react';
import { ScanFace, Play, ShieldCheck, Cpu } from 'lucide-react';
import CameraView from './components/CameraView';
import MetricsPanel from './components/MetricsPanel';
import HistoryPanel from './components/HistoryPanel';
import ResultModal from './components/ResultModal';
import Instructions from './components/Instructions';
import { FaceDetectionService } from './services/faceDetection';
import { Metrics, MeasurementHistoryItem, LoadingState } from './types';

const App: React.FC = () => {
    // Start in 'idle' to defer heavy loading
    const [loadingState, setLoadingState] = useState<LoadingState>('idle');
    const [currentMetrics, setCurrentMetrics] = useState<Metrics | null>(null);
    const [history, setHistory] = useState<MeasurementHistoryItem[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [capturedMetrics, setCapturedMetrics] = useState<Metrics | null>(null);
    const [capturedSamples, setCapturedSamples] = useState<Metrics[]>([]);
    const [status, setStatus] = useState<{ text: string; type: 'success' | 'warning' | 'error' }>({ text: 'Standby', type: 'warning' });
    const [isEmbedded, setIsEmbedded] = useState(false);
    const [cameraKey, setCameraKey] = useState(0);

    // Initialize Embed State & History on Mount
    useEffect(() => {
        // Check for embed mode via URL query param
        const searchParams = new URLSearchParams(window.location.search);
        const embedded = searchParams.get('embed') === 'true';
        setIsEmbedded(embedded);

        if (embedded) {
            // Set styles for transparent embedding
            document.documentElement.style.background = 'transparent';
            document.body.style.background = 'transparent';
        }

        // Load history
        const savedHistory = localStorage.getItem('ipdHistory');
        if (savedHistory) {
            try {
                setHistory(JSON.parse(savedHistory));
            } catch (e) {
                console.error("Failed to parse history", e);
            }
        }

        return () => {
            FaceDetectionService.getInstance().close();
        };
    }, []);

    // Explicit Start Function to Trigger Heavy Loading
    const startSystem = useCallback(async () => {
        setLoadingState('loading');
        setStatus({ text: 'Initializing...', type: 'warning' });

        try {
            // Add a timeout to prevent infinite loading
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Model initialization timed out (20s)")), 20000)
            );

            await Promise.race([
                FaceDetectionService.getInstance().initialize(true),
                timeoutPromise
            ]);

            setLoadingState('ready');
            setStatus({ text: 'Ready', type: 'success' });
        } catch (error) {
            console.error("Failed to load model", error);
            setLoadingState('error');
            setStatus({ text: 'System Error', type: 'error' });
        }
    }, []);

    const handleMetricsUpdate = useCallback((metrics: Metrics) => {
        setCurrentMetrics(metrics);
    }, []);

    const handleStatusUpdate = useCallback((newStatus: { text: string; type: 'success' | 'warning' | 'error' }) => {
        setStatus(newStatus);
    }, []);

    // Called automatically by CameraView when samples are collected
    const handleAutoCapture = useCallback((finalMetrics: Metrics, samples: Metrics[]) => {
        setCapturedMetrics(finalMetrics);
        setCapturedSamples(samples);
        setIsModalOpen(true);
    }, []);

    const handleSave = useCallback(() => {
        if (capturedMetrics) {
            const newItem: MeasurementHistoryItem = {
                id: Date.now().toString(),
                ipd: parseFloat(capturedMetrics.ipd.toFixed(1)),
                leftPd: parseFloat(capturedMetrics.leftPd.toFixed(1)),
                rightPd: parseFloat(capturedMetrics.rightPd.toFixed(1)),
                accuracy: Math.round(capturedMetrics.accuracy),
                timestamp: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
            
            const newHistory = [newItem, ...history].slice(0, 100); 
            setHistory(newHistory);
            localStorage.setItem('ipdHistory', JSON.stringify(newHistory));
            setIsModalOpen(false);

            // Notify parent window if embedded
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'IPD_RESULT',
                    data: newItem
                }, '*');
            }
        }
    }, [capturedMetrics, history]);

    const handleClearHistory = useCallback(() => {
        setHistory([]);
        localStorage.removeItem('ipdHistory');
    }, []);

    const handleCloseModal = () => {
        setIsModalOpen(false);
        // Force reset camera to restart tracking fresh
        setCameraKey(prev => prev + 1);
    };

    // --- RENDER STATES ---

    if (loadingState === 'idle') {
        return (
            <div className={`flex flex-col items-center justify-center p-6 text-center transition-all duration-500 ${isEmbedded ? 'h-full bg-transparent' : 'min-h-screen bg-gray-50'}`}>
                <div className="bg-white/80 backdrop-blur-md p-8 rounded-2xl shadow-xl border border-white/50 max-w-sm w-full animate-in fade-in zoom-in-95 duration-500">
                    <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-600/30">
                        <ScanFace size={40} className="text-white" />
                    </div>
                    
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">IPD Pro</h1>
                    <p className="text-gray-500 text-sm mb-8 leading-relaxed">
                        Clinical-grade interpupillary distance measurement using on-device AI.
                    </p>

                    <div className="space-y-3 mb-8">
                        <div className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100">
                            <ShieldCheck size={14} className="text-green-500" />
                            <span>Privacy First: No images leave your device</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100">
                            <Cpu size={14} className="text-blue-500" />
                            <span>Hardware Accelerated WebGPU Engine</span>
                        </div>
                    </div>

                    <button 
                        onClick={startSystem}
                        className="w-full group relative flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-blue-600/30 active:scale-95"
                    >
                        <Play size={18} className="fill-current" />
                        <span>Initialize System</span>
                    </button>
                    
                    <p className="text-[10px] text-gray-400 mt-4">
                        Requires camera access • V2.5.0
                    </p>
                </div>
            </div>
        );
    }

    if (loadingState === 'loading') {
        return (
            <div className={`flex flex-col items-center justify-center p-4 transition-colors duration-500 ${isEmbedded ? 'h-full' : 'min-h-screen bg-white'}`}>
                <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Cpu size={20} className="text-blue-600 animate-pulse" />
                    </div>
                </div>
                <h2 className="text-xl font-semibold text-gray-800">Initializing Neural Engine</h2>
                <p className="text-gray-500 mt-2 text-center text-sm max-w-xs animate-pulse">
                    Loading WebGPU kernels and models...
                </p>
            </div>
        );
    }

    if (loadingState === 'error') {
        return (
            <div className={`flex flex-col items-center justify-center p-4 text-center transition-colors duration-500 ${isEmbedded ? 'h-full' : 'min-h-screen bg-white'}`}>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                    <ScanFace size={32} className="text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Initialization Failed</h2>
                <p className="text-gray-500 mt-2 max-w-md mx-auto">
                    We couldn't load the necessary components. Please ensure you are connected to the internet and that your browser supports WebGL/WebGPU.
                </p>
                <button 
                    onClick={() => window.location.reload()}
                    className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className={`transition-all duration-300 text-gray-900 ${isEmbedded ? 'bg-transparent' : 'min-h-screen bg-gray-50 pb-12'}`}>
            {/* Header - Hidden in embed mode */}
            {!isEmbedded && (
                <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-blue-600 rounded-lg text-white">
                                <ScanFace size={20} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold leading-none">IPD Pro</h1>
                            </div>
                        </div>
                        <div className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                            status.type === 'success' ? 'bg-green-100 text-green-700' : 
                            status.type === 'warning' ? 'bg-amber-100 text-amber-700' : 
                            'bg-red-100 text-red-700'
                        }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${status.type === 'success' ? 'bg-green-500 animate-pulse' : 'bg-current'}`}></div>
                            {status.text}
                        </div>
                    </div>
                </header>
            )}

            <main className={`max-w-4xl mx-auto ${isEmbedded ? 'p-2 md:p-4' : 'p-4 md:p-6'} animate-in fade-in duration-500`}>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-4 md:gap-8">
                    {/* Left Column: Camera */}
                    <div className="flex flex-col gap-4">
                        <CameraView 
                            key={cameraKey} // Force reset on modal close
                            isModelReady={loadingState === 'ready'}
                            onMetricsUpdate={handleMetricsUpdate}
                            onStatusUpdate={handleStatusUpdate}
                            onCapture={handleAutoCapture}
                            canCapture={true}
                        />

                        {/* Mobile: Metrics appear below camera */}
                        <div className="block md:hidden">
                            <MetricsPanel metrics={currentMetrics} />
                        </div>
                    </div>

                    {/* Right Column: Desktop Metrics & History & Instructions */}
                    <div className="space-y-6">
                        <div className="hidden md:block">
                            <MetricsPanel metrics={currentMetrics} />
                        </div>
                        
                        <HistoryPanel history={history} onClear={handleClearHistory} />

                        <Instructions />
                    </div>
                </div>
            </main>

            <ResultModal 
                isOpen={isModalOpen}
                metrics={capturedMetrics}
                samples={capturedSamples}
                onSave={handleSave}
                onClose={handleCloseModal}
            />
        </div>
    );
};

export default App;