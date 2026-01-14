export interface Point {
    x: number;
    y: number;
    z?: number;
}

export interface Metrics {
    ipd: number;
    leftPd: number;
    rightPd: number;
    distance: number;
    lighting: number;
    accuracy: number;
    roll: number;  // Head tilt (ear to shoulder) in degrees
    yaw: number;   // Head turn (left/right) - normalized score -1 to 1
    pitch: number; // Head inclination (chin up/down) - ratio score
    faceY: number; // Vertical position of face center (0-1)
    stability: number; // New: 0-100 score representing how stable the measurement is
}

export interface MeasurementHistoryItem {
    id: string;
    ipd: number;
    leftPd: number;
    rightPd: number;
    accuracy: number;
    timestamp: string;
}

export interface FaceLandmarkerResult {
    faceLandmarks: Point[][];
    faceBlendshapes: any[];
    facialTransformationMatrixes: any[];
}

export type LoadingState = 'idle' | 'loading' | 'ready' | 'error';