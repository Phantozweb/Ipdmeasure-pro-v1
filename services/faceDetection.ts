import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class FaceDetectionService {
    private faceLandmarker: FaceLandmarker | null = null;
    private static instance: FaceDetectionService;
    private lastVideoTime = -1;
    private initPromise: Promise<void> | null = null;

    private constructor() {}

    public static getInstance(): FaceDetectionService {
        if (!FaceDetectionService.instance) {
            FaceDetectionService.instance = new FaceDetectionService();
        }
        return FaceDetectionService.instance;
    }

    public async initialize(useGpu: boolean = true): Promise<void> {
        if (this.faceLandmarker) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._initializeInternal(useGpu).catch((error) => {
            this.initPromise = null;
            throw error;
        });

        return this.initPromise;
    }

    private async _initializeInternal(useGpu: boolean): Promise<void> {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
            );

            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: useGpu ? 'GPU' : 'CPU'
                },
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: false,
                runningMode: 'VIDEO',
                numFaces: 1
            });
        } catch (error) {
            console.warn(`Failed to initialize FaceLandmarker with ${useGpu ? 'GPU' : 'CPU'}`, error);
            // Fallback to CPU if GPU fails
            if (useGpu) {
                console.log("Retrying initialization with CPU delegate...");
                return this._initializeInternal(false);
            } else {
                throw error;
            }
        }
    }

    public detect(video: HTMLVideoElement, startTimeMs: number) {
        if (!this.faceLandmarker) return null;
        
        // CRITICAL: Prevent MediaPipe crash on empty or unready frames
        if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
            return null;
        }

        // Ensure monotonic timestamps to prevent "WaitUntilIdle failed"
        if (startTimeMs <= this.lastVideoTime) {
            return null;
        }
        this.lastVideoTime = startTimeMs;

        try {
            return this.faceLandmarker.detectForVideo(video, startTimeMs);
        } catch (error) {
            console.warn("Frame detection failed:", error);
            return null;
        }
    }

    public close() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this.initPromise = null;
    }
}