import { Point, Metrics } from '../types';

// Constants
export const AVERAGE_IRIS_DIAMETER_MM = 11.7; // Human average (11.6 - 11.8mm)
export const IDEAL_DISTANCE_CM = 30; 
export const MIN_DISTANCE_CM = 20;   
export const MAX_DISTANCE_CM = 45;   

// Indices
export const LEFT_IRIS_CENTER = 468;
export const RIGHT_IRIS_CENTER = 473;
// Horizontal edges for diameter calculation
export const LEFT_IRIS_HORIZONTAL = [471, 469]; 
export const RIGHT_IRIS_HORIZONTAL = [476, 474];

export const NOSE_BRIDGE = 168;
export const NOSE_TIP = 1;
export const CHIN = 152;
export const FOREHEAD = 10;
export const LEFT_EYE_OUTER = 33;
export const RIGHT_EYE_OUTER = 263;
export const LEFT_EYE_TOP = 159;
export const LEFT_EYE_BOTTOM = 145;
export const RIGHT_EYE_TOP = 386;
export const RIGHT_EYE_BOTTOM = 374;
export const LEFT_EYE_INNER = 133;
export const RIGHT_EYE_INNER = 362;
export const LEFT_CHEEK = 454;
export const RIGHT_CHEEK = 234;

// Helper: Calculate Median
const getMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Helper: Standard Deviation
export const getStandardDeviation = (values: number[]): number => {
    if (values.length === 0) return 0;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    return Math.sqrt(avgSquareDiff);
};

export const calculateIrisDiameterPx = (landmarks: Point[], side: 'left' | 'right', width: number, height: number): number => {
    const indices = side === 'left' ? LEFT_IRIS_HORIZONTAL : RIGHT_IRIS_HORIZONTAL;
    const p1 = landmarks[indices[0]];
    const p2 = landmarks[indices[1]];
    const dx = (p1.x - p2.x) * width;
    const dy = (p1.y - p2.y) * height;
    return Math.sqrt(dx * dx + dy * dy);
};

export const isEyeOpen = (landmarks: Point[], side: 'left' | 'right', width: number, height: number): boolean => {
    const top = landmarks[side === 'left' ? LEFT_EYE_TOP : RIGHT_EYE_TOP];
    const bottom = landmarks[side === 'left' ? LEFT_EYE_BOTTOM : RIGHT_EYE_BOTTOM];
    const inner = landmarks[side === 'left' ? LEFT_EYE_INNER : RIGHT_EYE_INNER];
    const outer = landmarks[side === 'left' ? LEFT_EYE_OUTER : RIGHT_EYE_OUTER];

    const vDist = Math.hypot((top.x - bottom.x) * width, (top.y - bottom.y) * height);
    const hDist = Math.hypot((inner.x - outer.x) * width, (inner.y - outer.y) * height);

    return (vDist / hDist) > 0.20;
};

// Check for glare (common on glasses)
// UPDATED: Lower threshold and check for cluster of bright pixels
export const checkForGlare = (ctx: CanvasRenderingContext2D, landmarks: Point[], width: number, height: number): boolean => {
    const eye = landmarks[LEFT_IRIS_CENTER];
    const x = Math.floor(eye.x * width);
    const y = Math.floor(eye.y * height);
    
    if (x < 15 || y < 15 || x > width - 15 || y > height - 15) return false;

    try {
        // Sample slightly larger area
        const size = 12;
        const frame = ctx.getImageData(x - size/2, y - size/2, size, size);
        const data = frame.data;
        let brightPixels = 0;
        let veryBrightPixels = 0;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const brightness = (r + g + b) / 3;
            
            // Specular highlights on glasses are usually very bright
            if (brightness > 230) veryBrightPixels++;
            if (brightness > 200) brightPixels++;
        }
        
        // Glare usually results in a small concentrated cluster of white
        // If > 3% is pure white or > 15% is bright
        const totalPixels = (size * size);
        return (veryBrightPixels > totalPixels * 0.03) || (brightPixels > totalPixels * 0.15);
    } catch (e) {
        return false;
    }
};

export const calculateOrientation = (landmarks: Point[], width: number, height: number) => {
    const leftEye = landmarks[LEFT_EYE_OUTER];
    const rightEye = landmarks[RIGHT_EYE_OUTER];
    const rollDeg = Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width) * (180 / Math.PI); 

    const nose = landmarks[NOSE_BRIDGE];
    const leftCheek = landmarks[LEFT_CHEEK];
    const rightCheek = landmarks[RIGHT_CHEEK];
    const dLeft = Math.abs(nose.x - leftCheek.x);
    const dRight = Math.abs(nose.x - rightCheek.x);
    const yawScore = (dLeft - dRight) / (dLeft + dRight);

    const topHead = landmarks[FOREHEAD];
    const bottomHead = landmarks[CHIN];
    const faceHeight = Math.hypot(topHead.x - bottomHead.x, topHead.y - bottomHead.y);
    
    let pitchScore = 0;
    if (topHead.z !== undefined && bottomHead.z !== undefined) {
         pitchScore = (topHead.z - bottomHead.z) / (faceHeight || 0.5);
    }

    return { roll: rollDeg, yaw: yawScore, pitch: pitchScore };
};

// UPDATED: Center-weighted lighting analysis
export const analyzeLighting = (video: HTMLVideoElement): number => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;

    canvas.width = 60; 
    canvas.height = 60;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Analyze center 50% (where the face usually is) to avoid backlighting issues
    const margin = 15; 
    const scanSize = 30;
    const imageData = ctx.getImageData(margin, margin, scanSize, scanSize);
    const data = imageData.data;

    let totalBrightness = 0;
    let minB = 255, maxB = 0;

    for (let i = 0; i < data.length; i += 4) {
        const b = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        totalBrightness += b;
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;
    }

    const avgBrightness = totalBrightness / (data.length / 4);
    const contrast = maxB - minB;

    let score = 0;
    // Acceptable range extended: 40 - 220
    if (avgBrightness > 40 && avgBrightness < 220) {
        score = 100;
        // Penalize low contrast (washout or darkness)
        if (contrast < 40) score -= 30;
    } else {
        // Linear drop off
        if (avgBrightness <= 40) score = avgBrightness * 2.5;
        else score = Math.max(0, 100 - (avgBrightness - 220) * 3);
    }

    return Math.round(score);
};

// UPDATED: Accuracy now heavily weights stability (jitter)
export const calculateAccuracy = (distance: number, lighting: number, roll: number, yaw: number, pitch: number, stability: number = 100): number => {
    let accuracy = 100;

    // Distance penalty
    if (distance < MIN_DISTANCE_CM) accuracy -= (MIN_DISTANCE_CM - distance) * 5; 
    else if (distance > MAX_DISTANCE_CM) accuracy -= (distance - MAX_DISTANCE_CM) * 4;
    else accuracy -= Math.abs(distance - IDEAL_DISTANCE_CM) * 0.5;

    // Lighting penalty
    if (lighting < 60) accuracy -= (60 - lighting);

    // Head Pose penalties
    accuracy -= Math.abs(roll) * 3;
    accuracy -= Math.abs(yaw * 100); 
    accuracy -= Math.abs(pitch * 150);
    
    // Stability penalty - This is the "Values Change" fix
    // If stability (SD) is 1.0mm, that's bad. 0.1mm is good.
    // Penalty = (SD * 20). So 1mm SD = -20% accuracy.
    const stabilityPenalty = Math.max(0, (100 - stability) * 1.5);
    accuracy -= stabilityPenalty;

    return Math.round(Math.max(0, Math.min(100, accuracy)));
};

export const calculateMetrics = (landmarks: Point[], width: number, height: number, lightingScore: number): Metrics => {
    const leftIris = landmarks[LEFT_IRIS_CENTER];
    const rightIris = landmarks[RIGHT_IRIS_CENTER];
    const nose = landmarks[NOSE_BRIDGE];

    const lx = leftIris.x * width;
    const ly = leftIris.y * height;
    const rx = rightIris.x * width;
    const ry = rightIris.y * height;
    const nx = nose.x * width;
    const ny = nose.y * height;

    // 1. Pixel IPD 
    const dx = rx - lx;
    const dy = ry - ly;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);

    // 2. Iris Diameter in Pixels
    const leftDiameter = calculateIrisDiameterPx(landmarks, 'left', width, height);
    const rightDiameter = calculateIrisDiameterPx(landmarks, 'right', width, height);
    const avgIrisDiameterPx = (leftDiameter + rightDiameter) / 2;

    // 3. Estimated Scale Factor
    const mmPerPixel = AVERAGE_IRIS_DIAMETER_MM / avgIrisDiameterPx;
    const ipdMm = pixelDistance * mmPerPixel;
    const estimatedFocalLengthPx = width * 0.85; 
    const distanceCm = (AVERAGE_IRIS_DIAMETER_MM * estimatedFocalLengthPx) / (avgIrisDiameterPx * 10);

    // 4. Monocular split
    const vLR_x = rx - lx;
    const vLR_y = ry - ly;
    const vLN_x = nx - lx;
    const vLN_y = ny - ly;
    const dot = (vLN_x * vLR_x) + (vLN_y * vLR_y);
    const len_sq = (vLR_x * vLR_x) + (vLR_y * vLR_y);
    const t = len_sq !== 0 ? dot / len_sq : 0.5;
    const px = lx + t * vLR_x;
    const py = ly + t * vLR_y;

    const leftPd = Math.sqrt(Math.pow(px - lx, 2) + Math.pow(py - ly, 2)) * mmPerPixel;
    const rightPd = Math.sqrt(Math.pow(px - rx, 2) + Math.pow(py - ry, 2)) * mmPerPixel;

    const { roll, yaw, pitch } = calculateOrientation(landmarks, width, height);
    const faceY = landmarks[NOSE_TIP].y;
    
    // Note: Stability passed here is default 100. It must be overwritten by the consumer (CameraView) 
    // using history buffer to be meaningful.
    const accuracy = calculateAccuracy(distanceCm, lightingScore, roll, yaw, pitch, 100);

    return {
        ipd: ipdMm,
        leftPd,
        rightPd,
        distance: distanceCm,
        lighting: lightingScore,
        accuracy,
        roll,
        yaw,
        pitch,
        faceY,
        stability: 100 
    };
};

// UPDATED: Weighted Average Logic
export const averageMetrics = (samples: Metrics[], landmarksHistory: any[]): Metrics => {
    if (samples.length === 0) throw new Error("No samples");

    // 1. Robust filtering: Reject samples far from median
    const ipdValues = samples.map(s => s.ipd);
    const medianIpd = getMedian(ipdValues);
    
    // Tighter tolerance (1.0mm) to reject blinks/glitches
    const validSamples = samples.filter(s => Math.abs(s.ipd - medianIpd) < 1.0);
    const set = validSamples.length > samples.length * 0.4 ? validSamples : samples;

    // 2. Weighted Average based on "Quality" (Head alignment)
    // Closer to center = higher weight
    let totalWeight = 0;
    let weightedIpd = 0;
    let weightedDist = 0;

    set.forEach(s => {
        // Weight: 1.0 is perfect. Reduce for yaw/pitch/roll.
        const poseError = Math.abs(s.yaw) + Math.abs(s.pitch) + (Math.abs(s.roll) / 100);
        const weight = 1 / (1 + poseError * 10); // * 10 makes errors punish weight heavily
        
        weightedIpd += s.ipd * weight;
        weightedDist += s.distance * weight;
        totalWeight += weight;
    });

    const finalIpd = totalWeight > 0 ? weightedIpd / totalWeight : medianIpd;
    const finalDistance = totalWeight > 0 ? weightedDist / totalWeight : getMedian(set.map(s => s.distance));

    // Monocular ratio
    const avgLeftRaw = set.reduce((a, b) => a + b.leftPd, 0) / set.length;
    const avgRightRaw = set.reduce((a, b) => a + b.rightPd, 0) / set.length;
    const totalRaw = avgLeftRaw + avgRightRaw;
    const scale = totalRaw > 0 ? finalIpd / totalRaw : 1;

    // Stability Score calculation for final result
    const stdDev = getStandardDeviation(set.map(s => s.ipd));
    const stabilityScore = Math.max(0, 100 - (stdDev * 30)); // Strong penalty for jitter

    // Recalculate mean accuracy
    const meanAccuracy = set.reduce((a, b) => a + b.accuracy, 0) / set.length;

    return {
        ipd: finalIpd,
        leftPd: avgLeftRaw * scale,
        rightPd: avgRightRaw * scale,
        distance: finalDistance,
        lighting: getMedian(set.map(s => s.lighting)),
        accuracy: meanAccuracy,
        roll: getMedian(set.map(s => s.roll)),
        yaw: getMedian(set.map(s => s.yaw)),
        pitch: getMedian(set.map(s => s.pitch)),
        faceY: getMedian(set.map(s => s.faceY)),
        stability: stabilityScore
    };
};