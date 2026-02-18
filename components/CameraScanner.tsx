
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { UserCheck, ScanFace, Loader2, Zap, CameraOff } from 'lucide-react';
import { Employee, AttendanceType } from '../types';
import * as storage from '../services/storage';
import * as faceService from '../services/faceService';

interface CameraScannerProps {
  onScanComplete: (employee: Employee, type: AttendanceType) => void;
  onDenied: (photoBase64: string) => void;
  onError: (msg: string) => void;
  powerMode: 'ACTIVE' | 'DIMMED' | 'SLEEP';
  onWake: () => void;
}

const SUCCESS_SOUND_DATA_KEY = 'faceclock_success_sound_data_url';

const CameraScanner: React.FC<CameraScannerProps> = ({ 
  onScanComplete, onDenied, onError, powerMode, onWake
}) => {
  const LOCAL_DUPLICATE_WINDOW_MS = 60000;
  const UNKNOWN_FACE_COOLDOWN_MS = 8000;
  const PROCESSING_VISIBILITY_MS = 250;
  const DUPLICATE_BANNER_COOLDOWN_MS = 15000;
  // Practical threshold for approximately <=30cm on a 640x480 front camera.
  const MIN_FACE_COVERAGE_RATIO = 0.2;
  const TOO_FAR_HINT_COOLDOWN_MS = 1500;
  const TOO_FAR_HINT_VISIBLE_MS = 1200;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const customSuccessAudioRef = useRef<HTMLAudioElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanStatus, setScanStatus] = useState<'loading' | 'searching' | 'success' | 'duplicate' | 'cooldown' | 'error'>('loading');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTooFarHintVisible, setIsTooFarHintVisible] = useState(false);
  const [matchedEmployee, setMatchedEmployee] = useState<Employee | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  
  const lastScannedIdRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastDeniedTimeRef = useRef<number>(0);
  const lastDuplicateShownRef = useRef<number>(0);
  const lastTooFarHintTimeRef = useRef<number>(0);
  const tooFarHintTimerRef = useRef<number | null>(null);

  const getAudioContext = useCallback((): AudioContext | null => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }
    return audioContextRef.current;
  }, []);

  const unlockAudio = useCallback(async () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        // Keep silent; next user interaction will retry.
      }
    }
  }, [getAudioContext]);

  const playSuccessTone = useCallback(async () => {
    try {
      const customSoundData = localStorage.getItem(SUCCESS_SOUND_DATA_KEY);
      if (customSoundData) {
        if (!customSuccessAudioRef.current || customSuccessAudioRef.current.src !== customSoundData) {
          customSuccessAudioRef.current = new Audio(customSoundData);
          customSuccessAudioRef.current.preload = 'auto';
          customSuccessAudioRef.current.volume = 1;
        }
        const customAudio = customSuccessAudioRef.current;
        if (customAudio) {
          customAudio.currentTime = 0;
          await customAudio.play();
          return;
        }
      }

      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (ctx.state === 'suspended') return;

      const startAt = ctx.currentTime + 0.01;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
      gain.connect(ctx.destination);

      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, startAt);
      oscillator.frequency.linearRampToValueAtTime(1320, startAt + 0.18);
      oscillator.connect(gain);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.22);
    } catch (e) {
      // Do not block recognition flow when audio cannot play.
    }
  }, [getAudioContext]);

  const refreshSuccessSound = useCallback(() => {
    const soundData = localStorage.getItem(SUCCESS_SOUND_DATA_KEY) || '';
    if (!soundData) {
      customSuccessAudioRef.current = null;
      return;
    }
    if (!customSuccessAudioRef.current || customSuccessAudioRef.current.src !== soundData) {
      const audio = new Audio(soundData);
      audio.preload = 'auto';
      audio.volume = 1;
      customSuccessAudioRef.current = audio;
    }
  }, []);

  const getFaceCoverageRatio = useCallback((detection: any, video: HTMLVideoElement): number => {
    if (!detection || !video.videoWidth || !video.videoHeight) return 0;
    const box = detection.box || detection.detection?.box || detection.alignedRect?.box;
    if (!box) return 0;
    const widthRatio = box.width / video.videoWidth;
    const heightRatio = box.height / video.videoHeight;
    return Math.max(widthRatio, heightRatio);
  }, []);

  const showTooFarHint = useCallback(() => {
    const now = Date.now();
    if (now - lastTooFarHintTimeRef.current < TOO_FAR_HINT_COOLDOWN_MS) return;
    lastTooFarHintTimeRef.current = now;
    setIsTooFarHintVisible(true);
    if (tooFarHintTimerRef.current) {
      window.clearTimeout(tooFarHintTimerRef.current);
    }
    tooFarHintTimerRef.current = window.setTimeout(() => setIsTooFarHintVisible(false), TOO_FAR_HINT_VISIBLE_MS);
  }, [TOO_FAR_HINT_COOLDOWN_MS, TOO_FAR_HINT_VISIBLE_MS]);

  const backfillDescriptorsFromPhotos = useCallback(async (employees: Employee[]) => {
    if (!employees.length) return;

    const updatedEmployees = [...employees];
    let matcherUpdated = false;

    for (let i = 0; i < updatedEmployees.length; i++) {
      const emp = updatedEmployees[i];
      if ((emp.descriptor && emp.descriptor.length > 0) || !emp.photoUrl) continue;

      try {
        const descriptor = await faceService.computeFaceDescriptor(emp.photoUrl);
        if (!descriptor || descriptor.length === 0) continue;

        updatedEmployees[i] = { ...emp, descriptor };
        matcherUpdated = true;
        employeesRef.current = updatedEmployees;
        faceService.initializeMatcher(updatedEmployees);
        void storage.updateEmployee(emp.id, { descriptor });
      } catch (e) {
        continue;
      }
    }

    if (matcherUpdated) {
      employeesRef.current = updatedEmployees;
      faceService.initializeMatcher(updatedEmployees);
    }
  }, []);

  const refreshEmployeesFromStorage = useCallback(async () => {
    const data = await storage.getEmployees();
    employeesRef.current = data;
    faceService.initializeMatcher(data);
    void backfillDescriptorsFromPhotos(data);
  }, [backfillDescriptorsFromPhotos]);

  const stopActiveStream = useCallback(() => {
    const currentStream = streamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
  }, []);

  const initSystem = useCallback(async () => {
    try {
      setScanStatus('loading');
      await faceService.loadModels();
      await refreshEmployeesFromStorage();
      setScanStatus('searching');
    } catch (e) {
      setScanStatus('error');
      onError("Ошибка AI моделей");
    }
  }, [onError, refreshEmployeesFromStorage]);

  useEffect(() => {
    initSystem();
  }, [initSystem]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active) return;
      await refreshEmployeesFromStorage();
    };

    const handleEmployeesUpdated = () => {
      void refresh();
    };

    window.addEventListener('faceclock:employees-updated', handleEmployeesUpdated);
    const timer = window.setInterval(() => {
      void refresh();
    }, 60000);

    return () => {
      active = false;
      window.removeEventListener('faceclock:employees-updated', handleEmployeesUpdated);
      window.clearInterval(timer);
    };
  }, [refreshEmployeesFromStorage]);

  useEffect(() => {
    if (isInitializingRef.current) return;
    let cancelled = false;
    isInitializingRef.current = true;

    const requestCameraStream = async (): Promise<MediaStream> => {
      const cameraOptions: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        { video: true, audio: false },
      ];

      let lastError: unknown = null;
      for (const constraints of cameraOptions) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error('Не удалось запустить камеру');
    };

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Браузер блокирует доступ к камере. Убедитесь, что сайт открыт через HTTPS.");
        }

        stopActiveStream();
        const s = await requestCameraStream();
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        if (cancelled) return;
        const errorName = String(e?.name || '');
        const message =
          errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError'
            ? 'Камера недоступна: дайте разрешение в настройках Android.'
            : errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError'
            ? 'Камера не найдена на устройстве.'
            : errorName === 'NotReadableError' || errorName === 'TrackStartError'
            ? 'Камера занята другим приложением.'
            : e.message || "Камера недоступна. Проверьте разрешения.";
        setScanStatus('error');
        onError(message);
      } finally {
        isInitializingRef.current = false;
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopActiveStream();
      isInitializingRef.current = false;
    };
  }, [onError, stopActiveStream]);

  useEffect(() => {
    const handleUnlock = () => {
      void unlockAudio();
    };

    window.addEventListener('pointerdown', handleUnlock, { passive: true });
    window.addEventListener('touchstart', handleUnlock, { passive: true });
    window.addEventListener('keydown', handleUnlock);
    void unlockAudio();

    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, [unlockAudio]);

  useEffect(() => {
    refreshSuccessSound();
    const handleSoundUpdated = () => {
      refreshSuccessSound();
      void unlockAudio();
    };
    window.addEventListener('faceclock:success-sound-updated', handleSoundUpdated);
    return () => {
      window.removeEventListener('faceclock:success-sound-updated', handleSoundUpdated);
    };
  }, [refreshSuccessSound, unlockAudio]);

  useEffect(() => {
    if (!stream || scanStatus === 'loading' || scanStatus === 'error') return;
    let timer: any;
    let active = true;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const loop = async () => {
      if (!active) return;
      if (powerMode === 'SLEEP') {
        // In sleep we run lightweight face presence checks to wake up automatically.
        if (videoRef.current && videoRef.current.readyState === 4) {
          const detection = await faceService.detectFace(videoRef.current);
          if (detection) {
            onWake();
          }
        }
        timer = setTimeout(loop, 1000);
        return;
      }
      
      // Keep running loop but ignore results if in success state locally
      if (scanStatus === 'success' || scanStatus === 'cooldown' || scanStatus === 'duplicate' || isProcessing) { timer = setTimeout(loop, 300); return; }

      if (videoRef.current && videoRef.current.readyState === 4) {
        const faceDetection = await faceService.detectFace(videoRef.current);
        if (faceDetection) {
          const faceCoverageRatio = getFaceCoverageRatio(faceDetection, videoRef.current);
          if (faceCoverageRatio < MIN_FACE_COVERAGE_RATIO) {
            showTooFarHint();
            timer = setTimeout(loop, 180);
            return;
          }
        }

        const matchedId = await faceService.recognizeFace(videoRef.current);
        if (matchedId) {
          const emp = employeesRef.current.find(e => e.id === matchedId);
          const now = Date.now();
          
          if (emp) {
            if (lastScannedIdRef.current === emp.id && now - lastScanTimeRef.current < LOCAL_DUPLICATE_WINDOW_MS) {
              if (now - lastDuplicateShownRef.current > DUPLICATE_BANNER_COOLDOWN_MS) {
                lastDuplicateShownRef.current = now;
                setMatchedEmployee(emp);
                setScanStatus('duplicate');
                onWake();
              }
            } else {
              setIsProcessing(true);
              setMatchedEmployee(emp);
              onWake();

              try {
                await sleep(PROCESSING_VISIBILITY_MS);

                // Hard duplicate guard: never record the same employee twice within 1 minute.
                const lastLog = storage.getLastLogForEmployee(emp.id);
                if (lastLog && now - new Date(lastLog.timestamp).getTime() < LOCAL_DUPLICATE_WINDOW_MS) {
                  lastScannedIdRef.current = emp.id;
                  lastScanTimeRef.current = now;
                  setScanStatus('duplicate');
                  return;
                }

                lastScannedIdRef.current = emp.id;
                lastScanTimeRef.current = now;

                const type = (!lastLog || lastLog.type === AttendanceType.EXIT) ? AttendanceType.ENTRY : AttendanceType.EXIT;
                onScanComplete(emp, type);
                
                void playSuccessTone();
                setScanStatus('success');
              } finally {
                setIsProcessing(false);
              }
            }
          }
        } else {
            const now = Date.now();
            if (now - lastDeniedTimeRef.current > UNKNOWN_FACE_COOLDOWN_MS && faceDetection) {
                     lastDeniedTimeRef.current = now;
                     const canvas = document.createElement('canvas');
                     canvas.width = videoRef.current.videoWidth;
                     canvas.height = videoRef.current.videoHeight;
                     canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                     onDenied(canvas.toDataURL('image/jpeg', 0.7));
            }
        }
      }
      timer = setTimeout(loop, 140); 
    };

    loop();
    return () => { active = false; clearTimeout(timer); };
  }, [stream, scanStatus, powerMode, onScanComplete, onWake, onDenied, isProcessing, getFaceCoverageRatio, showTooFarHint, playSuccessTone]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
      }
      if (customSuccessAudioRef.current) {
        customSuccessAudioRef.current.pause();
        customSuccessAudioRef.current.currentTime = 0;
      }
      if (tooFarHintTimerRef.current) {
        window.clearTimeout(tooFarHintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (scanStatus === 'success' || scanStatus === 'duplicate') {
      // Keep a longer success pause so one employee can move away before next scan.
      const holdMs = scanStatus === 'success' ? 3000 : 1200;
      const t = setTimeout(() => {
        setScanStatus('cooldown');
        setTimeout(() => {
          setMatchedEmployee(null);
          setScanStatus('searching');
        }, 350);
      }, holdMs);
      return () => clearTimeout(t);
    }
  }, [scanStatus]);

  if (scanStatus === 'error') {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-900 p-8 text-center">
        <CameraOff className="text-red-500 w-20 h-20 mb-6" />
        <h2 className="text-2xl font-black uppercase text-white mb-3">Камера заблокирована</h2>
        <p className="text-gray-500 text-xs mb-8 max-w-xs uppercase leading-relaxed font-bold tracking-widest">
          Необходим доступ к камере для биометрии.
        </p>
        <button onClick={() => window.location.reload()} className="px-10 py-4 bg-white text-black rounded-3xl font-black text-xs uppercase tracking-widest shadow-xl">
          Перезагрузить
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className={`w-full h-full object-cover transition-all duration-700 scale-x-[-1] ${scanStatus === 'success' ? 'opacity-60 grayscale' : 'opacity-100'} ${powerMode === 'SLEEP' ? 'opacity-5' : powerMode === 'DIMMED' ? 'opacity-30' : ''}`} 
      />
      
      <div className={`absolute inset-0 bg-black pointer-events-none transition-opacity duration-1000 z-40 ${powerMode === 'DIMMED' ? 'opacity-70' : powerMode === 'SLEEP' ? 'opacity-98' : 'opacity-0'}`} />
      
      {isProcessing && (
        <div className="absolute inset-0 z-[55] pointer-events-none flex items-center justify-center">
          <div className="bg-black/75 border border-emerald-500/40 rounded-3xl px-8 py-5 flex items-center gap-3 shadow-2xl">
            <Loader2 className="animate-spin text-emerald-400 w-5 h-5" />
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300">Идет обработка...</p>
          </div>
        </div>
      )}

      {/* Simplified detection frame */}
      <div className={`absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-30 transition-opacity duration-500 ${scanStatus === 'searching' || isProcessing ? 'opacity-100' : 'opacity-0'}`}>
         <div className="w-72 h-72 border-2 border-white/5 rounded-[4rem] relative flex items-center justify-center">
            <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-emerald-500 rounded-tl-3xl shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
            <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-emerald-500 rounded-tr-3xl shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-emerald-500 rounded-bl-3xl shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-emerald-500 rounded-br-3xl shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
            <ScanFace className="text-white/5 w-24 h-24" />
            <div className="absolute w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent top-0 animate-scan" />
         </div>
         <p className="mt-10 text-[9px] font-black uppercase tracking-[0.5em] text-white/40 flex items-center gap-2">
            <Zap size={12} className="text-emerald-500 fill-emerald-500/50" /> Авто-фокус на лицо
         </p>
      </div>

      {/* The Success State no longer closes the screen, just adds a glow/overlay effect */}
      {scanStatus === 'success' && (
         <div className="absolute inset-0 bg-emerald-500/10 z-[50] pointer-events-none animate-pulse" />
      )}

      {scanStatus === 'duplicate' && matchedEmployee && (
         <div className="absolute inset-0 z-[56] pointer-events-none flex items-center justify-center">
            <div className="bg-amber-500/90 text-white px-7 py-4 rounded-[2rem] shadow-[0_20px_50px_rgba(245,158,11,0.35)] border border-white/20 flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-full"><UserCheck size={18} /></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-90">Уже отмечен</p>
                <p className="text-sm font-black uppercase tracking-tight leading-none mt-0.5">{matchedEmployee.name}</p>
                <p className="text-[9px] uppercase tracking-wider mt-1 opacity-90">Повтор через 1 минуту</p>
              </div>
            </div>
         </div>
      )}

      {isTooFarHintVisible && scanStatus !== 'success' && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[56] pointer-events-none">
          <div className="bg-slate-900/90 text-white px-6 py-3 rounded-2xl border border-white/20 shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Подойдите ближе к камере (~30 см)</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraScanner;
