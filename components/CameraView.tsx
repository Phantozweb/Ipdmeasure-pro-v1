import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Activity, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Glasses, Target, MoveVertical, AlertCircle } from 'lucide-react';
import { FaceDetectionService } from '../services/faceDetection';
import { 
    calculateMetrics, 
    analyzeLighting, 
    averageMetrics, 
    isEyeOpen,
    checkForGlare,
    getStandardDeviation,
    calculateAccuracy,
    LEFT_IRIS_CENTER, 
    RIGHT_IRIS_CENTER, 
    MIN_DISTANCE_CM, 
    MAX_DISTANCE_CM
} from '../utils/calculations';
import { Metrics, Point } from '../types';

interface CameraViewProps {
    onMetricsUpdate: (metrics: Metrics) => void;
    onStatusUpdate: (status: { text: string; type: 'success' | 'warning' | 'error' }) => void;
    isModelReady: boolean;
    onCapture: (metrics: Metrics, samples: Metrics[]) => void;
    canCapture: boolean;
}

interface GuidanceState {
    pitch: 'ok' | 'up' | 'down';
    yaw: 'ok' | 'left' | 'right';
    roll: 'ok' | 'cw' | 'ccw';
    distance: 'ok' | 'near' | 'far';
    center: 'ok' | 'adjust';
    eyes: 'ok' | 'open';
    glasses: 'ok' | 'detected';
    stability: 'ok' | 'unstable';
    lighting: 'ok' | 'bad';
    hold: boolean;
}

// Configuration
const REQUIRED_MIN_SAMPLES = 45; // ~1.5 seconds of stable data
const MAX_SAMPLES = 200;
const STABILITY_THRESHOLD_MM = 0.6; // Strict variance threshold for "Pro" accuracy

const ROLL_THRESHOLD = 2.5;
const YAW_THRESHOLD = 0.05; // Strict head turn
const PITCH_MIN = -0.10;
const PITCH_MAX = 0.10; 
const CENTER_TOLERANCE = 0.15; 

// Rolling buffer size for smoothing UI
const UI_SMOOTHING_FACTOR = 0.2; 

const CONTOURS = {
    lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    rightEye: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    faceOval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
};

const CameraView: React.FC<CameraViewProps> = ({ 
    onMetricsUpdate, 
    onStatusUpdate, 
    isModelReady,
    onCapture,
    canCapture
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    
    // State for auto-capture logic
    const samplesRef = useRef<Metrics[]>([]);
    const recentMetricsBuffer = useRef<Metrics[]>([]); // For real-time stability calculation
    const [samplingProgress, setSamplingProgress] = useState(0);
    const [captureStatus, setCaptureStatus] = useState<'idle' | 'sampling' | 'complete'>('idle');
    const [hudMetrics, setHudMetrics] = useState<Metrics | null>(null);
    
    // Logs State
    const [systemLogs, setSystemLogs] = useState<string[]>([]);
    
    // Guidance
    const [guidanceState, setGuidanceState] = useState<GuidanceState>({
        pitch: 'ok', yaw: 'ok', roll: 'ok', distance: 'ok', center: 'ok', eyes: 'ok', glasses: 'ok', stability: 'ok', lighting: 'ok', hold: false
    });
    const [showGlassAlert, setShowGlassAlert] = useState(true); 

    const [faceDetected, setFaceDetected] = useState(false);
    const [currentVariance, setCurrentVariance] = useState(0);

    const addLog = useCallback((msg: string) => {
        setSystemLogs(prev => [msg, ...prev].slice(0, 5));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setShowGlassAlert(false), 8000);
        return () => clearTimeout(timer);
    }, []);

    const startCamera = async () => {
        if (!videoRef.current) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            // Try to set fixed focus if supported to prevent breathing
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities() as any; 
            if (capabilities && capabilities.focusMode) {
                try {
                     // 'continuous' is often better than nothing, but if we could lock it that would be ideal.
                     // Mobile browsers rarely allow locking.
                    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any });
                } catch (err) {}
            }
            videoRef.current.srcObject = stream;
            videoRef.current.oncanplay = () => {
                videoRef.current?.play();
                if (canvasRef.current && videoRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                }
            };
        } catch (error) {
            console.error(error);
            onStatusUpdate({ text: "Camera Error", type: "error" });
        }
    };

    useEffect(() => {
        if (isModelReady) startCamera();
    }, [isModelReady]);

    const drawDynamicOverlay = (ctx: CanvasRenderingContext2D, landmarks: Point[]) => {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        ctx.clearRect(0, 0, width, height);

        const hudColor = '#06b6d4'; 
        const successColor = '#22c55e';
        const currentColor = captureStatus === 'sampling' ? successColor : hudColor;

        const drawPath = (indices: number[], closePath = false) => {
            ctx.beginPath();
            for (let i = 0; i < indices.length; i++) {
                const p = landmarks[indices[i]];
                if (!p) continue;
                if (i === 0) ctx.moveTo(p.x * width, p.y * height);
                else ctx.lineTo(p.x * width, p.y * height);
            }
            if (closePath) ctx.closePath();
            ctx.stroke();
        };

        ctx.strokeStyle = captureStatus === 'sampling' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(6, 182, 212, 0.2)';
        ctx.lineWidth = captureStatus === 'sampling' ? 2 : 1;
        drawPath(CONTOURS.faceOval, true);
        
        // Eyes
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        drawPath(CONTOURS.leftEye, true);
        drawPath(CONTOURS.rightEye, true);

        // Landmarks
        const leftIris = landmarks[LEFT_IRIS_CENTER];
        const rightIris = landmarks[RIGHT_IRIS_CENTER];
        const lx = leftIris.x * width;
        const ly = leftIris.y * height;
        const rx = rightIris.x * width;
        const ry = rightIris.y * height;

        // Draw Iris Crosshairs
        const drawReticle = (x: number, y: number) => {
            ctx.beginPath();
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.arc(x, y, 15, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fillStyle = currentColor;
            ctx.fill();
        };

        drawReticle(lx, ly);
        drawReticle(rx, ry);

        // Connecting Line
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
        ctx.stroke();
    };

    const detect = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !isModelReady) return;

        if (videoRef.current.readyState < 2) {
            requestRef.current = requestAnimationFrame(detect);
            return;
        }

        const service = FaceDetectionService.getInstance();
        const startTime = performance.now();
        const results = service.detect(videoRef.current, startTime);
        const ctx = canvasRef.current.getContext('2d');

        if (ctx) {
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                if (!faceDetected) {
                    setFaceDetected(true);
                    addLog("FACE DETECTED");
                }
                const landmarks = results.faceLandmarks[0];

                let currentLighting = 80; // Default optimistic
                // Throttle lighting check to every 500ms
                if (startTime - lastTimeRef.current > 500) {
                    currentLighting = analyzeLighting(videoRef.current);
                    lastTimeRef.current = startTime;
                }

                const hasGlare = checkForGlare(ctx, landmarks, videoRef.current.videoWidth, videoRef.current.videoHeight);

                // 1. Calculate Raw Metrics
                const rawMetrics = calculateMetrics(
                    landmarks, 
                    videoRef.current.videoWidth, 
                    videoRef.current.videoHeight,
                    currentLighting
                );

                // 2. Buffer for Stability Calculation (Last 30 frames)
                recentMetricsBuffer.current.push(rawMetrics);
                if (recentMetricsBuffer.current.length > 30) recentMetricsBuffer.current.shift();

                // 3. Calculate Real-time Stability (Standard Deviation)
                const stabilityValues = recentMetricsBuffer.current.map(m => m.ipd);
                const stdDev = getStandardDeviation(stabilityValues);
                
                // 4. Map SD to Stability Score (0-100). SD > 1.0mm is unstable (0). SD 0.1mm is stable (100).
                const stabilityScore = Math.max(0, Math.min(100, 100 - (stdDev * 50))); // Steep curve
                
                // 5. Re-calculate Accuracy with stability knowledge
                const realTimeAccuracy = calculateAccuracy(
                    rawMetrics.distance, 
                    rawMetrics.lighting, 
                    rawMetrics.roll, 
                    rawMetrics.yaw, 
                    rawMetrics.pitch, 
                    stabilityScore
                );

                const finalMetrics = { ...rawMetrics, accuracy: realTimeAccuracy, stability: stabilityScore };
                
                // 6. Smooth HUD Display (Low pass filter)
                setHudMetrics(prev => {
                    if (!prev) return finalMetrics;
                    return {
                        ...finalMetrics,
                        ipd: prev.ipd * (1 - UI_SMOOTHING_FACTOR) + finalMetrics.ipd * UI_SMOOTHING_FACTOR,
                        leftPd: prev.leftPd * (1 - UI_SMOOTHING_FACTOR) + finalMetrics.leftPd * UI_SMOOTHING_FACTOR,
                        rightPd: prev.rightPd * (1 - UI_SMOOTHING_FACTOR) + finalMetrics.rightPd * UI_SMOOTHING_FACTOR,
                        distance: prev.distance * (1 - UI_SMOOTHING_FACTOR) + finalMetrics.distance * UI_SMOOTHING_FACTOR,
                    };
                });
                
                onMetricsUpdate(finalMetrics);
                onStatusUpdate({ text: captureStatus === 'sampling' ? "Measuring..." : "Tracking", type: "success" });
                drawDynamicOverlay(ctx, landmarks);
                setCurrentVariance(stdDev);

                // --- GUIDANCE & CAPTURE LOGIC ---
                
                const leftOpen = isEyeOpen(landmarks, 'left', videoRef.current.videoWidth, videoRef.current.videoHeight);
                const rightOpen = isEyeOpen(landmarks, 'right', videoRef.current.videoWidth, videoRef.current.videoHeight);
                const isCentered = Math.abs(finalMetrics.faceY - 0.5) < CENTER_TOLERANCE;

                const newGuidance: GuidanceState = {
                    pitch: 'ok', yaw: 'ok', roll: 'ok', distance: 'ok', center: 'ok', eyes: 'ok', glasses: 'ok', stability: 'ok', lighting: 'ok', hold: false
                };

                let isPerfect = true;

                if (finalMetrics.distance < MIN_DISTANCE_CM) { newGuidance.distance = 'near'; isPerfect = false; }
                else if (finalMetrics.distance > MAX_DISTANCE_CM) { newGuidance.distance = 'far'; isPerfect = false; }
                if (!isCentered) { newGuidance.center = 'adjust'; isPerfect = false; }
                if (!leftOpen || !rightOpen) { newGuidance.eyes = 'open'; isPerfect = false; }
                if (finalMetrics.pitch < PITCH_MIN) { newGuidance.pitch = 'up'; isPerfect = false; } 
                else if (finalMetrics.pitch > PITCH_MAX) { newGuidance.pitch = 'down'; isPerfect = false; } 
                if (Math.abs(finalMetrics.yaw) > YAW_THRESHOLD) { newGuidance.yaw = finalMetrics.yaw > 0 ? 'left' : 'right'; isPerfect = false; } 
                if (Math.abs(finalMetrics.roll) > ROLL_THRESHOLD) { newGuidance.roll = finalMetrics.roll > 0 ? 'cw' : 'ccw'; isPerfect = false; } 
                if (hasGlare) { newGuidance.glasses = 'detected'; isPerfect = false; }
                if (finalMetrics.lighting < 50) { newGuidance.lighting = 'bad'; isPerfect = false; }

                if (isPerfect && captureStatus !== 'complete') {
                    newGuidance.hold = true;
                    
                    if (captureStatus === 'idle') {
                        setCaptureStatus('sampling');
                        samplesRef.current = [];
                        addLog("STABILIZING...");
                    }

                    // --- STABILITY GATE ---
                    // Only add sample if current variance is acceptable. 
                    // If the user moves suddenly, pause sampling until stable again.
                    if (stdDev < 1.5) { // Looser threshold for *collecting* samples, strict for finishing
                        samplesRef.current.push(finalMetrics);
                    }
                    
                    const sampleCount = samplesRef.current.length;
                    
                    // Show progress based on sample count
                    let progress = (sampleCount / REQUIRED_MIN_SAMPLES) * 100;

                    // STRICT FINISH CONDITION:
                    // 1. Enough samples
                    // 2. Variance (StdDev) is VERY LOW (< 0.6mm)
                    if (progress >= 100 && stdDev > STABILITY_THRESHOLD_MM) {
                        progress = 95; // Hold at 95% until stable
                        newGuidance.stability = 'unstable'; // Trigger UI warning
                    }

                    setSamplingProgress(progress);

                    // Complete?
                    if (sampleCount >= REQUIRED_MIN_SAMPLES && stdDev <= STABILITY_THRESHOLD_MM) {
                        setCaptureStatus('complete');
                        addLog("LOCKED.");
                        const finalResult = averageMetrics(samplesRef.current, []);
                        onCapture(finalResult, [...samplesRef.current]);
                    } else if (sampleCount > MAX_SAMPLES) {
                         // Timeout - try to get result anyway or fail?
                         // If we are here, we have lots of samples but high variance.
                         // Force reset.
                         samplesRef.current = [];
                         setSamplingProgress(0);
                         setCaptureStatus('idle');
                         addLog("FAILED - UNSTABLE");
                    }

                } else {
                    // Reset if user moves out of position significantly
                    if (captureStatus === 'sampling') {
                         if (newGuidance.distance !== 'ok' || newGuidance.center !== 'ok' || newGuidance.yaw !== 'ok') {
                            samplesRef.current = [];
                            setSamplingProgress(0);
                            setCaptureStatus('idle');
                            addLog("RESET - MOVED");
                         }
                    }
                }
                
                setGuidanceState(newGuidance);

            } else {
                if (faceDetected) setFaceDetected(false);
                onStatusUpdate({ text: "No Face", type: "warning" });
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                setSamplingProgress(0);
                samplesRef.current = [];
                setCaptureStatus('idle');
                setHudMetrics(null);
            }
        }
        requestRef.current = requestAnimationFrame(detect);
    }, [isModelReady, onMetricsUpdate, onStatusUpdate, captureStatus, onCapture, faceDetected, addLog]);

    useEffect(() => {
        if (isModelReady) requestRef.current = requestAnimationFrame(detect);
        return () => cancelAnimationFrame(requestRef.current);
    }, [isModelReady, detect]);

    const resetCapture = () => {
        samplesRef.current = [];
        setSamplingProgress(0);
        setCaptureStatus('idle');
        setFaceDetected(false);
    };

    return (
        <div className="relative w-full aspect-[3/4] md:aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-cyan-900/50 mx-auto group">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1] opacity-80" playsInline muted autoPlay />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover z-10 scale-x-[-1]" />
            
            {/* --- GLASSES ALERT (Start) --- */}
            {showGlassAlert && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-500">
                    <div className="bg-white text-gray-900 p-8 rounded-2xl text-center max-w-sm mx-4 shadow-2xl">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Glasses size={32} className="text-blue-600" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Remove Glasses</h3>
                        <p className="text-gray-500 mb-6">
                            Glasses cause glare and refraction errors. For accurate results, please remove them now.
                        </p>
                        <button 
                            onClick={() => setShowGlassAlert(false)}
                            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
                        >
                            I've Removed My Glasses
                        </button>
                    </div>
                </div>
            )}

            {/* --- TOP HUD --- */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-none z-20">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono">
                        <Activity size={12} className={faceDetected ? "animate-pulse" : ""} />
                        <span>{faceDetected ? 'TRACKING' : 'SEARCHING'}</span>
                    </div>
                    {captureStatus === 'sampling' && (
                        <div className="flex items-center gap-2 text-green-400 text-[10px] font-mono animate-pulse">
                            <Target size={10} />
                            <span>STABILITY: {guidanceState.stability === 'ok' ? 'LOCKED' : 'WAITING'} ({currentVariance.toFixed(2)})</span>
                        </div>
                    )}
                </div>
            </div>

            {/* --- GUIDANCE WARNINGS --- */}
            {faceDetected && captureStatus !== 'complete' && !showGlassAlert && (
                <>
                    {/* Directional Arrows */}
                    <div className={`absolute top-8 left-1/2 -translate-x-1/2 ${guidanceState.pitch === 'down' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="flex flex-col items-center text-red-500 animate-bounce">
                            <span className="text-xs font-bold font-mono bg-black/50 px-2 py-0.5 rounded">CHIN DOWN</span>
                            <ChevronDown size={24} />
                        </div>
                    </div>
                    <div className={`absolute bottom-32 left-1/2 -translate-x-1/2 ${guidanceState.pitch === 'up' ? 'opacity-100' : 'opacity-0'}`}>
                         <div className="flex flex-col-reverse items-center text-red-500 animate-bounce">
                            <span className="text-xs font-bold font-mono bg-black/50 px-2 py-0.5 rounded">CHIN UP</span>
                            <ChevronUp size={24} />
                        </div>
                    </div>
                    <div className={`absolute top-1/2 left-4 ${guidanceState.yaw === 'left' ? 'opacity-100' : 'opacity-0'}`}>
                        <ChevronLeft size={40} className="text-red-500 animate-pulse" />
                    </div>
                    <div className={`absolute top-1/2 right-4 ${guidanceState.yaw === 'right' ? 'opacity-100' : 'opacity-0'}`}>
                        <ChevronRight size={40} className="text-red-500 animate-pulse" />
                    </div>

                    {/* Central Alerts */}
                    {(guidanceState.distance !== 'ok' || guidanceState.center !== 'ok' || guidanceState.glasses !== 'ok' || guidanceState.stability !== 'ok' || guidanceState.lighting !== 'ok') && (
                        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                            <div className="bg-black/80 text-white px-6 py-4 rounded-xl border border-red-500/50 flex flex-col items-center gap-2 shadow-lg backdrop-blur-sm">
                                {guidanceState.distance === 'near' && <><MoveVertical size={32} className="text-red-500"/><span>Move Back</span></>}
                                {guidanceState.distance === 'far' && <><MoveVertical size={32} className="text-red-500"/><span>Move Closer</span></>}
                                {guidanceState.center !== 'ok' && <><Activity size={32} className="text-red-500"/><span>Center Face</span></>}
                                {guidanceState.glasses === 'detected' && <><Glasses size={32} className="text-red-500"/><span>Remove Glasses</span></>}
                                {guidanceState.lighting === 'bad' && <><AlertCircle size={32} className="text-amber-500"/><span>Improve Lighting</span></>}
                                {guidanceState.stability === 'unstable' && <><Target size={32} className="text-amber-500"/><span>Hold Steady...</span></>}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* --- CAPTURE PROGRESS --- */}
            {guidanceState.hold && captureStatus !== 'complete' && !showGlassAlert && (
                 <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
                    <div className="relative w-64 h-64">
                        <div className="absolute inset-0 border-2 border-green-500/30 rounded-full animate-[spin_4s_linear_infinite]"></div>
                        <div className="absolute top-0 left-0 w-full h-1 bg-green-400/50 animate-[scan_2s_ease-in-out_infinite]" style={{ top: `${samplingProgress}%` }}></div>
                    </div>
                    <div className="absolute mt-32 bg-green-950/80 backdrop-blur-sm border border-green-500/50 text-green-400 px-6 py-2 rounded-full flex flex-col items-center">
                        <span className="text-xs font-mono font-bold">ANALYZING GEOMETRY</span>
                        <div className="w-32 bg-green-900/50 h-1.5 mt-1 rounded-full overflow-hidden">
                             <div className="h-full bg-green-400 transition-all duration-300" style={{ width: `${samplingProgress}%` }}></div>
                        </div>
                    </div>
                 </div>
            )}

            {/* --- MANUAL RESET --- */}
            {captureStatus === 'complete' && (
                 <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
                    <button 
                        onClick={resetCapture}
                        className="bg-cyan-900/90 hover:bg-cyan-800 border border-cyan-500 text-cyan-100 px-6 py-3 rounded-full font-bold flex items-center gap-2 shadow-lg"
                    >
                        <RotateCcw size={16} />
                        Retake Scan
                    </button>
                 </div>
            )}
        </div>
    );
};

export default CameraView;