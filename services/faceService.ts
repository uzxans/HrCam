
import { Employee } from '../types';

// Access the global faceapi object loaded via script tag
declare const faceapi: any;

const MODELS_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

let isModelsLoaded = false;
let faceMatcher: any = null;

// Use Tiny Face Detector for maximum speed
const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 224, // Smaller size = faster but less accurate. 224 is a good sweet spot.
  scoreThreshold: 0.5
});

export const loadModels = async () => {
  if (isModelsLoaded) return;
  try {
    // Load TinyFaceDetector instead of SsdMobilenetv1
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
    ]);
    isModelsLoaded = true;
  } catch (e) {
    console.error("Error loading FaceAPI models:", e);
    throw new Error("Не удалось загрузить AI модели. Нужен интернет для первого запуска.");
  }
};

export const detectFace = async (input: HTMLVideoElement | HTMLCanvasElement): Promise<any> => {
    if (!isModelsLoaded) await loadModels();
    try {
        // Use tiny detector for quick check
        return await faceapi.detectSingleFace(input, detectorOptions);
    } catch (e) {
        return null;
    }
}

/**
 * Computes the face descriptor from a Base64 image.
 */
export const computeFaceDescriptor = async (base64Image: string): Promise<number[] | null> => {
  if (!isModelsLoaded) await loadModels();

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = base64Image;
    
    img.onload = async () => {
      try {
        // Use tiny detector for enrollment as well
        const detection = await faceapi.detectSingleFace(img, detectorOptions)
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (detection) {
          resolve(Array.from(detection.descriptor));
        } else {
          resolve(null);
        }
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
  });
};

/**
 * Initializes the matcher for real-time identification.
 */
export const initializeMatcher = (employees: Employee[]) => {
  if (!isModelsLoaded) return;

  const labeledDescriptors: any[] = [];
  employees.forEach(emp => {
    if (emp.descriptor && emp.descriptor.length > 0) {
      try {
        labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(
          emp.id,
          [new Float32Array(emp.descriptor)]
        ));
      } catch (e) {}
    }
  });

  if (labeledDescriptors.length > 0) {
    // 0.4 distance threshold for stricter match (better with tiny detector)
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.45); 
  } else {
    faceMatcher = null;
  }
};

/**
 * Real-time face recognition.
 */
export const recognizeFace = async (input: HTMLVideoElement | HTMLCanvasElement): Promise<string | null> => {
  if (!faceMatcher) return null;

  try {
    // Detect face landmarks and descriptor using TinyFaceDetector
    const detection = await faceapi.detectSingleFace(input, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();
      
    if (detection) {
      const match = faceMatcher.findBestMatch(detection.descriptor);
      return match.label !== 'unknown' ? match.label : null;
    }
  } catch (e) {}
  return null;
};
