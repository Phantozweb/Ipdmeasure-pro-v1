import { Point, Metrics } from '../types';

// Constants
export const AVERAGE_IRIS_DIAMETER_MM = 11.7; // Human average (11.6 - 11.8mm)
export const IDEAL_DISTANCE_CM = 30; 
export const MIN_DISTANCE_CM = 15;   
export const MAX_DISTANCE_CM = 50;   

// Indices
export const LEFT_IRIS_CENTER = 468;
export const RIGHT_IRIS_CENTER = 473;
// Horizontal edges for diameter calculation (more stable than vertical due to eyelids)
export const LEFT_IRIS_HORIZONTAL = [471, 469]; // Left, Right (relative to face)
export const RIGHT_IRIS_HORIZONTAL = [476, 474]; // Left, Right

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

// Use horizontal diameter instead of average radius to avoid eyelid interference
export const calculateIrisDiameterPx = (landmarks: Point[], side: 'left' | 'right', width: number, height: number): number => {
    const indices = side === 'left' ? LEFT_IRIS_HORIZONTAL : RIGHT_IRIS_HORIZONTAL;
    const p1 = landmarks[indices[0]];
    const p2 = landmarks[indices[1]];

    // Euclidean distance in pixels
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

    const ratio = vDist / hDist;
    return ratio > 0.20;
};

export const calculateOrientation = (landmarks: Point[], width: number, height: number) => {
    // 1. ROLL (Tilt)
    const leftEye = landmarks[LEFT_EYE_OUTER];
    const rightEye = landmarks[RIGHT_EYE_OUTER];
    const rollDeg = Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width) * (180 / Math.PI); 

    // 2. YAW (Turn)
    const nose = landmarks[NOSE_BRIDGE];
    const leftCheek = landmarks[LEFT_CHEEK];
    const rightCheek = landmarks[RIGHT_CHEEK];
    const dLeft = Math.abs(nose.x - leftCheek.x);
    const dRight = Math.abs(nose.x - rightCheek.x);
    const yawScore = (dLeft - dRight) / (dLeft + dRight);

    // 3. PITCH (Chin Up/Down)
    const topHead = landmarks[FOREHEAD];
    const bottomHead = landmarks[CHIN];
    const faceHeight = Math.hypot(topHead.x - bottomHead.x, topHead.y - bottomHead.y);
    
    // Z-depth difference normalized by face height
    let pitchScore = 0;
    if (topHead.z !== undefined && bottomHead.z !== undefined) {
         pitchScore = (topHead.z - bottomHead.z) / (faceHeight || 0.5);
    } else {
        const noseTip = landmarks[NOSE_TIP];
        const dTop = Math.abs(nose.y - noseTip.y);
        const dBot = Math.abs(noseTip.y - bottomHead.y);
        pitchScore = (dTop / dBot) - 0.4;
    }

    return { roll: rollDeg, yaw: yawScore, pitch: pitchScore };
};

export const analyzeLighting = (video: HTMLVideoElement): number => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;

    canvas.width = 100; // Small sample
    canvas.height = 100;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let totalBrightness = 0;
    let minB = 255, maxB = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b); // Perceived brightness
        totalBrightness += brightness;
        if (brightness < minB) minB = brightness;
        if (brightness > maxB) maxB = brightness;
    }

    const avgBrightness = totalBrightness / (data.length / 4);
    
    // Evaluate distribution
    const dynamicRange = maxB - minB;
    const goodExposure = avgBrightness > 80 && avgBrightness < 200;
    const goodContrast = dynamicRange > 50;

    let score = 0;
    if (goodExposure) score += 60;
    else score += 30;
    if (goodContrast) score += 40;
    else score += 20;

    return Math.min(100, score);
};

export const calculateAccuracy = (distance: number, lighting: number, roll: number, yaw: number, pitch: number): number => {
    let accuracy = 100;

    // Strict Distance Penalty
    if (distance < MIN_DISTANCE_CM) accuracy -= (MIN_DISTANCE_CM - distance) * 4; 
    else if (distance > MAX_DISTANCE_CM) accuracy -= (distance - MAX_DISTANCE_CM) * 3;
    else accuracy -= Math.abs(distance - IDEAL_DISTANCE_CM) * 0.5;

    if (lighting < 50) accuracy -= (50 - lighting);

    accuracy -= Math.abs(roll) * 4;
    accuracy -= Math.abs(yaw * 100); 
    accuracy -= Math.abs(pitch * 200);

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

    // 1. Pixel IPD (Euclidean distance between iris centers)
    const dx = rx - lx;
    const dy = ry - ly;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);

    // 2. Iris Diameter in Pixels
    const leftDiameter = calculateIrisDiameterPx(landmarks, 'left', width, height);
    const rightDiameter = calculateIrisDiameterPx(landmarks, 'right', width, height);
    const avgIrisDiameterPx = (leftDiameter + rightDiameter) / 2;

    // 3. Scale Factor (mm per pixel)
    const mmPerPixel = AVERAGE_IRIS_DIAMETER_MM / avgIrisDiameterPx;

    // 4. Final Total IPD in mm
    const ipdMm = pixelDistance * mmPerPixel;

    // 5. Distance Estimation
    const estimatedFocalLengthPx = width * 0.85; 
    const distanceCm = (AVERAGE_IRIS_DIAMETER_MM * estimatedFocalLengthPx) / (avgIrisDiameterPx * 10);

    // 6. Monocular PDs using Vector Projection
    // Project the Nose Point (N) onto the line segment connecting Left Iris (L) and Right Iris (R).
    // This creates a T-junction ensuring exact geometric splitting of the IPD.
    
    // Vector LR (Left to Right Iris)
    const vLR_x = rx - lx;
    const vLR_y = ry - ly;
    
    // Vector LN (Left Iris to Nose)
    const vLN_x = nx - lx;
    const vLN_y = ny - ly;

    // Project LN onto LR
    const dot = (vLN_x * vLR_x) + (vLN_y * vLR_y);
    const len_sq = (vLR_x * vLR_x) + (vLR_y * vLR_y);
    const t = len_sq !== 0 ? dot / len_sq : 0.5;

    // Projected nose point on the eye-axis
    const px = lx + t * vLR_x;
    const py = ly + t * vLR_y;

    // Distances from Irises to Projected Nose Point
    const leftPdPx = Math.sqrt(Math.pow(px - lx, 2) + Math.pow(py - ly, 2));
    const rightPdPx = Math.sqrt(Math.pow(px - rx, 2) + Math.pow(py - ry, 2));

    const leftPd = leftPdPx * mmPerPixel;
    const rightPd = rightPdPx * mmPerPixel;

    const { roll, yaw, pitch } = calculateOrientation(landmarks, width, height);
    const faceY = landmarks[NOSE_TIP].y;
    const accuracy = calculateAccuracy(distanceCm, lightingScore, roll, yaw, pitch);

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
        faceY
    };
};

export const averageMetrics = (samples: Metrics[]): Metrics => {
    if (samples.length === 0) throw new Error("No samples");

    // Robust Statistical Averaging for Sample Counts (N=100)
    // We use Standard Deviation filtering to identify the stable cluster of measurements.

    // 1. Calculate Mean
    const sumIpd = samples.reduce((a, b) => a + b.ipd, 0);
    const meanIpd = sumIpd / samples.length;

    // 2. Calculate Standard Deviation (SD)
    const sqDiff = samples.map(s => Math.pow(s.ipd - meanIpd, 2));
    const avgSqDiff = sqDiff.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(avgSqDiff);

    // 3. Filter Outliers
    // Keep values within 1.0 SD (approx 68% of data in normal dist).
    // This removes blinks, micro-movements, and detection noise.
    const valid = samples.filter(s => Math.abs(s.ipd - meanIpd) <= (stdDev || 0.5));
    
    // Safety fallback: if dispersion is huge, revert to simple trimming
    const set = valid.length > (samples.length * 0.1) ? valid : samples;

    const sum = set.reduce((acc, curr) => ({
        ipd: acc.ipd + curr.ipd,
        leftPd: acc.leftPd + curr.leftPd,
        rightPd: acc.rightPd + curr.rightPd,
        distance: acc.distance + curr.distance,
        lighting: acc.lighting + curr.lighting,
        accuracy: acc.accuracy + curr.accuracy,
        roll: acc.roll + curr.roll,
        yaw: acc.yaw + curr.yaw,
        pitch: acc.pitch + curr.pitch,
        faceY: acc.faceY + curr.faceY
    }), { ipd: 0, leftPd: 0, rightPd: 0, distance: 0, lighting: 0, accuracy: 0, roll: 0, yaw: 0, pitch: 0, faceY: 0 });

    const n = set.length;
    
    // 4. Final Averages
    const avgIpd = sum.ipd / n;
    const avgLeftPd = sum.leftPd / n;
    const avgRightPd = sum.rightPd / n;

    // 5. Enforce Geometric Consistency
    // The Monocular PDs must sum exactly to the Total IPD.
    // We normalize them based on the Total IPD derived from direct eye-to-eye measurement (which is usually most stable).
    const totalMono = avgLeftPd + avgRightPd;
    const scaleCorrection = totalMono !== 0 ? avgIpd / totalMono : 1;

    return {
        ipd: avgIpd,
        leftPd: avgLeftPd * scaleCorrection,
        rightPd: avgRightPd * scaleCorrection,
        distance: sum.distance / n,
        lighting: sum.lighting / n,
        accuracy: sum.accuracy / n,
        roll: sum.roll / n,
        yaw: sum.yaw / n,
        pitch: sum.pitch / n,
        faceY: sum.faceY / n
    };
};