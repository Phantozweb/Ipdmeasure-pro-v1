import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Zap, Activity, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCw, RotateCcw, Check, MoveVertical, AlertCircle, Scan, Fingerprint, Aperture, Wifi, Target, Terminal } from 'lucide-react';
import { FaceDetectionService } from '../services/faceDetection';
import { 
    calculateMetrics, 
    analyzeLighting, 
    averageMetrics, 
    isEyeOpen,
    LEFT_IRIS_CENTER, 
    RIGHT_IRIS_CENTER, 
    MIN_DISTANCE_CM, 
    MAX_DISTANCE_CM,
    LEFT_EYE_OUTER,
    RIGHT_EYE_OUTER,
    NOSE_BRIDGE
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
    hold: boolean;
}

interface MonoStreamData {
    l: number;
    r: number;
    id: number;
}

// Precision Sampling (N=100)
const REQUIRED_SAMPLES = 100;
const ROLL_THRESHOLD = 2.5;
const YAW_THRESHOLD = 0.06;
const PITCH_MIN = -0.12;
const PITCH_MAX = 0.12; 
const CENTER_TOLERANCE = 0.15; 

// Contour Indices for Face Mesh
const CONTOURS = {
    lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    rightEye: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    leftEyebrow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    rightEyebrow: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
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
    const [isWebGPUSupported, setIsWebGPUSupported] = useState(false);
    const lastTimeRef = useRef<number>(0);
    
    // State for auto-capture logic
    const samplesRef = useRef<Metrics[]>([]);
    const [samplingProgress, setSamplingProgress] = useState(0);
    const [captureStatus, setCaptureStatus] = useState<'idle' | 'sampling' | 'complete'>('idle');
    const [currentAccuracy, setCurrentAccuracy] = useState(0); 
    const [hudMetrics, setHudMetrics] = useState<Metrics | null>(null);
    
    // Logs State
    const [systemLogs, setSystemLogs] = useState<string[]>([]);
    // Data stream for Matrix-like effect (Dual Monocular)
    const [monoStream, setMonoStream] = useState<MonoStreamData[]>([]);
    
    // Independent Guidance States
    const [guidanceState, setGuidanceState] = useState<GuidanceState>({
        pitch: 'ok',
        yaw: 'ok',
        roll: 'ok',
        distance: 'ok',
        center: 'ok',
        eyes: 'ok',
        hold: false
    });

    const [faceDetected, setFaceDetected] = useState(false);

    useEffect(() => {
        const checkGPU = async () => {
            if ('gpu' in navigator) {
                try {
                    const adapter = await (navigator as any).gpu.requestAdapter();
                    setIsWebGPUSupported(!!adapter);
                } catch {
                    setIsWebGPUSupported(false);
                }
            }
        };
        checkGPU();
    }, []);

    // Simulated Log Update
    const addLog = useCallback((msg: string) => {
        setSystemLogs(prev => {
            const newLogs = [msg, ...prev];
            return newLogs.slice(0, 5); // Keep last 5 logs
        });
    }, []);

    useEffect(() => {
        if (captureStatus === 'sampling') {
            const interval = setInterval(() => {
                const msgs = [
                    "ACQUIRING GEOMETRIC LOCK...",
                    "VECTOR PROJECTION ACTIVE...",
                    "TRIANGULATING NASAL BRIDGE...",
                    "RAPID SAMPLING STREAM...",
                    "CALCULATING VARIANCE..."
                ];
                addLog(msgs[Math.floor(Math.random() * msgs.length)]);
            }, 300);
            return () => clearInterval(interval);
        }
    }, [captureStatus, addLog]);

    useEffect(() => {
        const startCamera = async () => {
            if (!videoRef.current) return;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                });
                
                // --- AUTO FOCUS IMPLEMENTATION ---
                const track = stream.getVideoTracks()[0];
                const capabilities = track.getCapabilities() as any; 
                
                if (capabilities && capabilities.focusMode) {
                    try {
                        await track.applyConstraints({
                            advanced: [{ focusMode: 'continuous' }] as any
                        });
                        addLog("AUTO-FOCUS ENGAGED");
                    } catch (err) {
                        console.warn("Could not set continuous focus", err);
                    }
                }
                // ---------------------------------

                videoRef.current.srcObject = stream;
                videoRef.current.oncanplay = () => {
                    if (videoRef.current) {
                        videoRef.current.play().catch(e => console.error("Play error:", e));
                        if (canvasRef.current) {
                            canvasRef.current.width = videoRef.current.videoWidth;
                            canvasRef.current.height = videoRef.current.videoHeight;
                        }
                    }
                };
                addLog("CAMERA INITIALIZED");
            } catch (error) {
                console.error("Camera error:", error);
                onStatusUpdate({ text: "Camera Error", type: "error" });
                addLog("CAMERA INIT FAILED");
            }
        };

        if (isModelReady) {
            startCamera();
            addLog("AI MODEL READY");
        }
    }, [isModelReady, onStatusUpdate, addLog]);

    const drawDynamicOverlay = (ctx: CanvasRenderingContext2D, landmarks: Point[]) => {
        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        ctx.clearRect(0, 0, width, height);

        // Colors
        const hudColor = '#06b6d4'; // Cyan-500
        const hudColorDim = 'rgba(6, 182, 212, 0.3)';
        const accentColor = '#f472b6'; // Pink-400 for Monocular Lines
        const successColor = '#22c55e';

        const currentColor = captureStatus === 'sampling' ? successColor : hudColor;

        // --- FACE MESH VISUALIZATION ---
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

        ctx.strokeStyle = captureStatus === 'sampling' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(6, 182, 212, 0.2)';
        ctx.lineWidth = 1;
        
        drawPath(CONTOURS.faceOval, true);
        drawPath(CONTOURS.leftEyebrow);
        drawPath(CONTOURS.rightEyebrow);
        drawPath(CONTOURS.leftEye, true);
        drawPath(CONTOURS.rightEye, true);
        drawPath(CONTOURS.lips, true);

        // Draw faint dots for point cloud effect
        ctx.fillStyle = captureStatus === 'sampling' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(6, 182, 212, 0.4)';
        for (let i = 0; i < landmarks.length; i += 3) { 
            const p = landmarks[i];
            ctx.beginPath();
            ctx.rect(p.x * width, p.y * height, 1, 1);
            ctx.fill();
        }
        // -------------------------------

        // 1. Calculate Bounding Box
        let minX = width, minY = height, maxX = 0, maxY = 0;
        landmarks.forEach(p => {
            const px = p.x * width;
            const py = p.y * height;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        });

        // Face Corners
        const padX = (maxX - minX) * 0.2;
        const padY = (maxY - minY) * 0.3;
        const boxX = minX - padX;
        const boxY = minY - padY;
        const boxW = (maxX - minX) + 2 * padX;
        const boxH = (maxY - minY) + 2 * padY;
        const cornerLen = boxW * 0.15;

        ctx.strokeStyle = currentColor;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5;
        ctx.shadowColor = currentColor;

        ctx.beginPath();
        // TL
        ctx.moveTo(boxX, boxY + cornerLen);
        ctx.lineTo(boxX, boxY);
        ctx.lineTo(boxX + cornerLen, boxY);
        // TR
        ctx.moveTo(boxX + boxW - cornerLen, boxY);
        ctx.lineTo(boxX + boxW, boxY);
        ctx.lineTo(boxX + boxW, boxY + cornerLen);
        // BR
        ctx.moveTo(boxX + boxW, boxY + boxH - cornerLen);
        ctx.lineTo(boxX + boxW, boxY + boxH);
        ctx.lineTo(boxX + boxW - cornerLen, boxY + boxH);
        // BL
        ctx.moveTo(boxX + cornerLen, boxY + boxH);
        ctx.lineTo(boxX, boxY + boxH);
        ctx.lineTo(boxX, boxY + boxH - cornerLen);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 2. Key Landmarks
        const leftIris = landmarks[LEFT_IRIS_CENTER];
        const rightIris = landmarks[RIGHT_IRIS_CENTER];
        const noseBridge = landmarks[NOSE_BRIDGE]; // Key point for Monocular PD

        const lx = leftIris.x * width;
        const ly = leftIris.y * height;
        const rx = rightIris.x * width;
        const ry = rightIris.y * height;
        const nx = noseBridge.x * width;
        const ny = noseBridge.y * height;

        // 3. Monocular PD Lines (Nose to Eyes)
        if (captureStatus === 'sampling' || faceDetected) {
            ctx.beginPath();
            ctx.moveTo(nx, ny);
            ctx.lineTo(lx, ly);
            ctx.moveTo(nx, ny);
            ctx.lineTo(rx, ry);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([0]); // Solid line
            ctx.stroke();
            
            // Draw Nose Center Point
            ctx.beginPath();
            ctx.arc(nx, ny, 4, 0, 2 * Math.PI);
            ctx.fillStyle = accentColor;
            ctx.fill();
        }

        // 4. Iris Reticles
        const drawReticle = (x: number, y: number, label: string) => {
            const r = boxW * 0.08; 
            
            // Outer dashed circle
            ctx.beginPath();
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);

            // Inner solid circle
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fillStyle = currentColor;
            ctx.fill();

            // Crosshair
            ctx.beginPath();
            ctx.moveTo(x - r - 5, y);
            ctx.lineTo(x + r + 5, y);
            ctx.moveTo(x, y - r - 5);
            ctx.lineTo(x, y + r + 5);
            ctx.strokeStyle = hudColorDim;
            ctx.stroke();

            // Label (Flipped for mirrored view)
            ctx.save();
            ctx.translate(x + r + 5, y - r); 
            ctx.scale(-1, 1);
            
            ctx.font = '10px monospace';
            ctx.fillStyle = currentColor;
            ctx.fillText(label, 0, 0);
            
            ctx.restore();
        };

        // SWAPPED LABELS FOR MIRRORED HUD REQUEST
        // lx is anatomical Left Eye (visual left on mirror). Labeling it 'R_EYE' puts 'R_EYE' on Left.
        drawReticle(lx, ly, 'R_EYE'); 
        drawReticle(rx, ry, 'L_EYE');

        // 5. Connecting Line (Binocular)
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.strokeStyle = hudColorDim;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 6. Vertical Reference Line
        const noseBot = landmarks[1];   
        if (noseBridge && noseBot) {
            ctx.beginPath();
            ctx.moveTo(noseBridge.x * width, noseBridge.y * height);
            ctx.lineTo(noseBot.x * width, noseBot.y * height);
            ctx.strokeStyle = hudColorDim;
            ctx.stroke();
        }
    };

    const detect = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !isModelReady) return;

        if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
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
                    addLog("FACE DETECTED. TRACKING ENGAGED.");
                }
                const landmarks = results.faceLandmarks[0];

                let currentLighting = 50; 
                if (startTime - lastTimeRef.current > 500) {
                    currentLighting = analyzeLighting(videoRef.current);
                    lastTimeRef.current = startTime;
                }

                const metrics = calculateMetrics(
                    landmarks, 
                    videoRef.current.videoWidth, 
                    videoRef.current.videoHeight,
                    currentLighting
                );

                // Update HUD Metrics state for the UI layer
                setHudMetrics(metrics);

                onMetricsUpdate(metrics);
                onStatusUpdate({ text: "Tracking", type: "success" });
                drawDynamicOverlay(ctx, landmarks);
                
                setCurrentAccuracy(metrics.accuracy);

                // --- INDEPENDENT CHECKS ---
                const leftOpen = isEyeOpen(landmarks, 'left', videoRef.current.videoWidth, videoRef.current.videoHeight);
                const rightOpen = isEyeOpen(landmarks, 'right', videoRef.current.videoWidth, videoRef.current.videoHeight);
                const isCentered = Math.abs(metrics.faceY - 0.5) < CENTER_TOLERANCE;

                const newGuidance: GuidanceState = {
                    pitch: 'ok',
                    yaw: 'ok',
                    roll: 'ok',
                    distance: 'ok',
                    center: 'ok',
                    eyes: 'ok',
                    hold: false
                };

                let isPerfect = true;

                // 1. Distance
                if (metrics.distance < MIN_DISTANCE_CM) { newGuidance.distance = 'near'; isPerfect = false; }
                else if (metrics.distance > MAX_DISTANCE_CM) { newGuidance.distance = 'far'; isPerfect = false; }

                // 2. Center
                if (!isCentered) { newGuidance.center = 'adjust'; isPerfect = false; }

                // 3. Eyes
                if (!leftOpen || !rightOpen) { newGuidance.eyes = 'open'; isPerfect = false; }

                // 4. Pitch
                if (metrics.pitch < PITCH_MIN) { newGuidance.pitch = 'up'; isPerfect = false; } 
                else if (metrics.pitch > PITCH_MAX) { newGuidance.pitch = 'down'; isPerfect = false; } 

                // 5. Yaw
                if (metrics.yaw > YAW_THRESHOLD) { newGuidance.yaw = 'left'; isPerfect = false; } 
                else if (metrics.yaw < -YAW_THRESHOLD) { newGuidance.yaw = 'right'; isPerfect = false; } 

                // 6. Roll
                if (metrics.roll > ROLL_THRESHOLD) { newGuidance.roll = 'cw'; isPerfect = false; } 
                else if (metrics.roll < -ROLL_THRESHOLD) { newGuidance.roll = 'ccw'; isPerfect = false; } 

                // Capture Logic
                if (isPerfect && captureStatus !== 'complete') {
                    newGuidance.hold = true;
                    if (captureStatus === 'idle') {
                        setCaptureStatus('sampling');
                        addLog("ALIGNMENT PERFECT. STARTING CAPTURE.");
                    }
                    
                    samplesRef.current.push(metrics);
                    // Update data stream state with Monocular values
                    // Optimization: Slice to keep only last 25 for UI, but keep all in samplesRef
                    setMonoStream(prev => [
                        { l: metrics.leftPd, r: metrics.rightPd, id: Date.now() + Math.random() }, 
                        ...prev
                    ].slice(0, 25));

                    setSamplingProgress((samplesRef.current.length / REQUIRED_SAMPLES) * 100);

                    if (samplesRef.current.length >= REQUIRED_SAMPLES) {
                        setCaptureStatus('complete');
                        addLog("CAPTURE COMPLETE. PROCESSING.");
                        const finalMetrics = averageMetrics(samplesRef.current);
                        // PASS FULL SAMPLES ARRAY FOR LOGGING
                        onCapture(finalMetrics, [...samplesRef.current]);
                    }
                } else {
                    if (captureStatus === 'sampling') {
                         if (newGuidance.distance !== 'ok' || newGuidance.center !== 'ok') {
                            samplesRef.current = [];
                            setMonoStream([]);
                            setSamplingProgress(0);
                            setCaptureStatus('idle');
                            addLog("ALIGNMENT LOST. RESETTING.");
                         }
                    }
                }
                
                setGuidanceState(newGuidance);

            } else {
                if (faceDetected) {
                    setFaceDetected(false);
                    addLog("TARGET LOST.");
                }
                onStatusUpdate({ text: "No Face", type: "warning" });
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                setSamplingProgress(0);
                samplesRef.current = [];
                setMonoStream([]);
                setCaptureStatus('idle');
                setHudMetrics(null);
            }
        }

        requestRef.current = requestAnimationFrame(detect);
    }, [isModelReady, onMetricsUpdate, onStatusUpdate, captureStatus, onCapture, faceDetected, addLog]);

    useEffect(() => {
        if (isModelReady) {
            requestRef.current = requestAnimationFrame(detect);
        }
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [isModelReady, detect]);

    const resetCapture = () => {
        samplesRef.current = [];
        setMonoStream([]);
        setSamplingProgress(0);
        setCaptureStatus('idle');
        addLog("MANUAL RESET.");
    };

    return (
        <div className="relative w-full aspect-[3/4] md:aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-cyan-900/50 mx-auto group">
            {/* Video & Canvas (Mirrored) */}
            <video 
                ref={videoRef} 
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1] opacity-80" 
                playsInline 
                muted 
                autoPlay 
            />
            {/* Grid Overlay for Tech Look */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
            
            <canvas 
                ref={canvasRef} 
                className="absolute inset-0 w-full h-full object-cover z-10 scale-x-[-1]" 
            />
            
            {/* --- HUD OVERLAYS --- */}
            
            {/* Top Status Bar */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-none z-20">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono">
                        <Activity size={12} className={faceDetected ? "animate-pulse" : ""} />
                        <span>SYSTEM: {faceDetected ? 'TRACKING' : 'SEARCHING'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-cyan-400/70 text-[10px] font-mono">
                        <Wifi size={10} />
                        <span>LATENCY: 16ms</span>
                    </div>
                </div>
                
                {isWebGPUSupported && (
                    <div className="flex items-center gap-1 text-cyan-400/80 text-[10px] font-mono border border-cyan-500/30 px-2 py-1 rounded bg-cyan-950/30">
                        <Zap size={10} />
                        <span>GPU ACCEL</span>
                    </div>
                )}
            </div>

            {/* Gyro Data Panel */}
            {faceDetected && (
                <div className="absolute top-16 right-4 flex flex-col items-end pointer-events-none z-20">
                    <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 p-2 rounded-lg text-[10px] font-mono text-cyan-400 w-28 shadow-lg transition-all duration-300 animate-in fade-in slide-in-from-right-4">
                        <div className="flex justify-between items-center mb-1.5 border-b border-cyan-500/30 pb-1">
                            <span className="font-bold tracking-wider text-cyan-100">GYRO DATA</span>
                            <Activity size={10} className="animate-pulse" />
                        </div>
                        
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-cyan-500/70">ROLL</span>
                            <span className={`${Math.abs(hudMetrics?.roll || 0) > ROLL_THRESHOLD ? 'text-red-400 font-bold' : 'text-cyan-100'}`}>
                                {(hudMetrics?.roll || 0).toFixed(1)}°
                            </span>
                        </div>

                        <div className="flex justify-between items-center mb-1">
                            <span className="text-cyan-500/70">YAW</span>
                            <span className={`${Math.abs(hudMetrics?.yaw || 0) > YAW_THRESHOLD ? 'text-red-400 font-bold' : 'text-cyan-100'}`}>
                                {((hudMetrics?.yaw || 0) * 45).toFixed(1)}°
                            </span>
                        </div>

                        <div className="flex justify-between items-center">
                            <span className="text-cyan-500/70">PITCH</span>
                            <span className={`${hudMetrics?.pitch && (hudMetrics.pitch < PITCH_MIN || hudMetrics.pitch > PITCH_MAX) ? 'text-red-400 font-bold' : 'text-cyan-100'}`}>
                                {((hudMetrics?.pitch || 0) * 90).toFixed(1)}°
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Live MONOCULAR Data Stream (Left Side) */}
            {faceDetected && captureStatus === 'sampling' && (
                <div className="absolute top-16 left-4 flex flex-col items-start pointer-events-none z-20">
                    <div className="bg-black/40 backdrop-blur-[2px] border-l-2 border-green-500/50 pl-2 py-1 rounded-r-lg overflow-hidden h-64 w-32 mask-image-linear-gradient">
                        <div className="flex items-center gap-1 text-[9px] text-green-400/80 font-mono mb-1 border-b border-green-500/30 pb-1">
                            <Target size={9} />
                            {/* SWAPPED L/R Labels */}
                            <span className="tracking-tighter">RAW INPUT (R/L)</span>
                        </div>
                        <div className="flex flex-col gap-0.5 opacity-90">
                            {monoStream.map((val) => (
                                <div key={val.id} className="text-[10px] font-mono text-green-300/90 animate-in slide-in-from-left-2 fade-in duration-100 flex justify-between w-24">
                                    {/* SWAPPED DATA ORDER */}
                                    <span>R:{val.r.toFixed(1)}</span>
                                    <span className="text-green-500/50">|</span>
                                    <span>L:{val.l.toFixed(1)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom HUD Panels with Terminal */}
            {faceDetected && (
                <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col justify-end pointer-events-none z-20">
                    
                    {/* TERMINAL OVERLAY */}
                    <div className="self-center mb-4 w-64 md:w-80 bg-black/80 backdrop-blur-md rounded-lg p-2 border border-green-900/50 shadow-2xl animate-in slide-in-from-bottom-5 fade-in">
                        <div className="flex items-center justify-between border-b border-green-900/50 pb-1 mb-1">
                            <div className="flex items-center gap-1.5 text-green-500/70 text-[10px] font-mono">
                                <Terminal size={10} />
                                <span className="tracking-wider font-bold">SYSTEM_KERNEL</span>
                            </div>
                            <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-50 animate-pulse"></div>
                            </div>
                        </div>
                        <div className="h-12 overflow-y-hidden flex flex-col justify-end font-mono text-[9px] text-green-400/90 leading-tight">
                            {systemLogs.map((log, i) => (
                                <div key={i} className="animate-in slide-in-from-left-2 fade-in duration-100 truncate">
                                    <span className="text-green-700 mr-1">{`>`}</span>
                                    {log}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-between items-end w-full">
                        {/* SWAPPED: Right Eye Log (Now on Left) */}
                        <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 p-2 rounded-tl-lg w-32 md:w-40 transform transition-all duration-300">
                            <div className="flex items-center justify-between text-cyan-400 text-[10px] font-mono border-b border-cyan-500/30 pb-1 mb-1">
                                <span className="font-bold">RIGHT EYE</span>
                                <Scan size={10} />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/80 font-mono">
                                    <span>PD:</span>
                                    <span>{hudMetrics?.rightPd.toFixed(1)}mm</span>
                                </div>
                                <div className="h-1 bg-cyan-900/50 w-full rounded-full overflow-hidden">
                                    <div className={`h-full ${captureStatus === 'sampling' ? 'bg-cyan-400 animate-pulse' : 'bg-cyan-700'}`} style={{ width: captureStatus === 'sampling' ? '100%' : '30%' }}></div>
                                </div>
                            </div>
                        </div>

                        {/* SWAPPED: Left Eye Log (Now on Right) */}
                        <div className="bg-black/60 backdrop-blur-sm border border-cyan-500/30 p-2 rounded-tr-lg w-32 md:w-40 text-right">
                            <div className="flex items-center justify-between text-cyan-400 text-[10px] font-mono border-b border-cyan-500/30 pb-1 mb-1">
                                <Scan size={10} />
                                <span className="font-bold">LEFT EYE</span>
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/80 font-mono">
                                    <span>PD:</span>
                                    <span>{hudMetrics?.leftPd.toFixed(1)}mm</span>
                                </div>
                                <div className="h-1 bg-cyan-900/50 w-full rounded-full overflow-hidden">
                                    <div className={`h-full ${captureStatus === 'sampling' ? 'bg-cyan-400 animate-pulse' : 'bg-cyan-700'}`} style={{ width: captureStatus === 'sampling' ? '100%' : '30%' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- GUIDANCE ALERTS (Overlaid on top) --- */}
            {faceDetected && captureStatus !== 'complete' && (
                <>
                    {/* Pitch Arrows */}
                    <div className={`absolute top-8 left-1/2 -translate-x-1/2 transition-opacity duration-300 ${guidanceState.pitch === 'down' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="flex flex-col items-center text-red-500 animate-bounce">
                            <span className="text-xs font-bold font-mono bg-black/50 px-2 py-0.5 rounded">CHIN DOWN</span>
                            <ChevronDown size={24} />
                        </div>
                    </div>
                    <div className={`absolute bottom-32 left-1/2 -translate-x-1/2 transition-opacity duration-300 ${guidanceState.pitch === 'up' ? 'opacity-100' : 'opacity-0'}`}>
                         <div className="flex flex-col-reverse items-center text-red-500 animate-bounce">
                            <span className="text-xs font-bold font-mono bg-black/50 px-2 py-0.5 rounded">CHIN UP</span>
                            <ChevronUp size={24} />
                        </div>
                    </div>

                    {/* Yaw Guidance - Turn Left */}
                    <div className={`absolute top-1/2 left-4 -translate-y-1/2 transition-all duration-300 transform ${guidanceState.yaw === 'left' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}>
                        <div className="flex items-center gap-2 text-red-500 bg-black/70 px-4 py-2 rounded-r-xl border-l-4 border-red-500 backdrop-blur-sm shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                            <ChevronLeft size={28} className="animate-pulse" />
                            <span className="text-sm font-bold font-mono tracking-wider whitespace-nowrap">TURN LEFT</span>
                        </div>
                    </div>

                    {/* Yaw Guidance - Turn Right */}
                    <div className={`absolute top-1/2 right-4 -translate-y-1/2 transition-all duration-300 transform ${guidanceState.yaw === 'right' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}>
                        <div className="flex flex-row-reverse items-center gap-2 text-red-500 bg-black/70 px-4 py-2 rounded-l-xl border-r-4 border-red-500 backdrop-blur-sm shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                            <ChevronRight size={28} className="animate-pulse" />
                            <span className="text-sm font-bold font-mono tracking-wider whitespace-nowrap">TURN RIGHT</span>
                        </div>
                    </div>

                    {/* Warning Center Box */}
                    {(guidanceState.distance !== 'ok' || guidanceState.center !== 'ok' || guidanceState.eyes !== 'ok') && (
                        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                            <div className="bg-black/80 text-red-500 px-6 py-4 rounded border border-red-500/50 flex flex-col items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                                {guidanceState.distance === 'near' && <><MoveVertical size={32} /><span>DISTANCE: TOO CLOSE</span></>}
                                {guidanceState.distance === 'far' && <><MoveVertical size={32} /><span>DISTANCE: TOO FAR</span></>}
                                {guidanceState.center !== 'ok' && <><Activity size={32} /><span>ALIGN FACE TO CENTER</span></>}
                                {guidanceState.eyes !== 'ok' && <><AlertCircle size={32} /><span>EYES NOT DETECTED</span></>}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* HOLD STILL (Scanning Animation) */}
            {guidanceState.hold && captureStatus !== 'complete' && (
                 <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none">
                    {/* Ring Scanner */}
                    <div className="relative w-64 h-64">
                        <div className="absolute inset-0 border-2 border-green-500/30 rounded-full animate-[spin_4s_linear_infinite]"></div>
                        <div className="absolute inset-2 border border-green-500/20 rounded-full animate-[spin_3s_linear_infinite_reverse]"></div>
                        
                        {/* Scanning Line */}
                        <div className="absolute top-0 left-0 w-full h-1 bg-green-400/50 shadow-[0_0_15px_rgba(74,222,128,0.8)] animate-[scan_2s_ease-in-out_infinite]" style={{ top: `${samplingProgress}%` }}></div>
                    </div>
                    
                    <div className="absolute mt-32 bg-green-500/10 backdrop-blur-sm border border-green-500/50 text-green-400 px-8 py-2 rounded-full flex flex-col items-center shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                        <span className="text-lg font-black tracking-widest font-mono">HOLD STILL</span>
                        <div className="w-full bg-green-900/50 h-1 mt-1 rounded-full overflow-hidden">
                             <div className="h-full bg-green-400 transition-all duration-75" style={{ width: `${samplingProgress}%` }}></div>
                        </div>
                        <span className="text-[10px] font-mono mt-1">CAPTURING BIOMETRICS... {Math.round(samplingProgress)}%</span>
                    </div>
                 </div>
            )}

            {/* Idle State / No Face */}
            {!faceDetected && (
                 <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                    <div className="w-64 h-64 border-2 border-dashed border-cyan-500/30 rounded-3xl flex flex-col items-center justify-center relative bg-black/20 backdrop-blur-[2px]">
                        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400"></div>
                        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400"></div>
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400"></div>
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400"></div>
                        
                        <ScanFaceIcon />
                        <span className="mt-4 font-mono text-cyan-400/70 tracking-widest text-sm animate-pulse">INITIATE SCAN</span>
                    </div>
                 </div>
            )}
            
            {/* Manual Reset Button */}
            {captureStatus === 'complete' && (
                 <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
                    <button 
                        onClick={resetCapture}
                        className="bg-cyan-900/80 hover:bg-cyan-800 border border-cyan-500/50 text-cyan-100 px-6 py-2 rounded-full text-sm font-mono tracking-wider flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                    >
                        <RotateCcw size={14} />
                        RETAKE SCAN
                    </button>
                 </div>
            )}
        </div>
    );
};

const ScanFaceIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-500/50">
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <rect width="10" height="12" x="7" y="6" rx="2" />
        <path d="M9 10h.01" />
        <path d="M15 10h.01" />
        <path d="M10 14h4" />
    </svg>
);

export default CameraView;