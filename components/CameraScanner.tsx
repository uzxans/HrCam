
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { UserCheck, ScanFace, Moon, ShieldAlert, Loader2, Zap, CameraOff } from 'lucide-react';
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

const CameraScanner: React.FC<CameraScannerProps> = ({ 
  onScanComplete, onDenied, onError, powerMode, onWake
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isInitializingRef = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanStatus, setScanStatus] = useState<'loading' | 'searching' | 'detecting' | 'success' | 'cooldown' | 'error'>('loading');
  const [matchedEmployee, setMatchedEmployee] = useState<Employee | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  
  const lastScannedIdRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  const initSystem = useCallback(async () => {
    try {
      setScanStatus('loading');
      await faceService.loadModels();
      const data = await storage.getEmployees();
      employeesRef.current = data;
      faceService.initializeMatcher(data);
      setScanStatus('searching');
    } catch (e) {
      setScanStatus('error');
      onError("Ошибка AI моделей");
    }
  }, [onError]);

  useEffect(() => {
    initSystem();
  }, [initSystem]);

  useEffect(() => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Браузер блокирует доступ к камере. Убедитесь, что сайт открыт через HTTPS.");
        }

        const constraints = {
          video: { 
            facingMode: 'user', 
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          },
          audio: false
        };

        const s = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play();
        }
      } catch (e: any) {
        setScanStatus('error');
        onError(e.message || "Камера недоступна. Проверьте разрешения.");
      } finally {
        isInitializingRef.current = false;
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [onError]);

  useEffect(() => {
    if (!stream || scanStatus === 'loading' || scanStatus === 'error') return;
    let timer: any;
    let active = true;

    const loop = async () => {
      if (!active) return;
      if (powerMode === 'SLEEP') { timer = setTimeout(loop, 1000); return; }
      
      // Keep running loop but ignore results if in success state locally
      if (scanStatus === 'success' || scanStatus === 'cooldown') { timer = setTimeout(loop, 400); return; }

      if (videoRef.current && videoRef.current.readyState === 4) {
        const matchedId = await faceService.recognizeFace(videoRef.current);
        if (matchedId) {
          const emp = employeesRef.current.find(e => e.id === matchedId);
          const now = Date.now();
          
          if (emp) {
            // Check last scan time (local state check for UI responsiveness)
            const diff = now - lastScanTimeRef.current;
            
            if (lastScannedIdRef.current !== emp.id || diff > 15000) {
              lastScannedIdRef.current = emp.id;
              lastScanTimeRef.current = now;
              
              // Get last recorded log to determine Entry/Exit
              const lastLog = storage.getLastLogForEmployee(emp.id);
              const type = (!lastLog || lastLog.type === AttendanceType.EXIT) ? AttendanceType.ENTRY : AttendanceType.EXIT;
              
              // Only trigger completion if it's not a tiny-duplicate (handled in App.tsx as well)
              onScanComplete(emp, type);
              
              new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>{});
              setMatchedEmployee(emp);
              setScanStatus('success');
              onWake();
            }
          }
        } else {
            const now = Date.now();
            if (now - lastScanTimeRef.current > 30000) {
                 const detection = await faceService.detectFace(videoRef.current);
                 if (detection) {
                     lastScanTimeRef.current = now;
                     const canvas = document.createElement('canvas');
                     canvas.width = videoRef.current.videoWidth;
                     canvas.height = videoRef.current.videoHeight;
                     canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                     onDenied(canvas.toDataURL('image/jpeg', 0.7));
                 }
            }
        }
      }
      timer = setTimeout(loop, 100); 
    };

    loop();
    return () => { active = false; clearTimeout(timer); };
  }, [stream, scanStatus, powerMode, onScanComplete, onWake, onDenied]);

  useEffect(() => {
    if (scanStatus === 'success') {
      // Much faster reset to keep scan active
      const t = setTimeout(() => {
        setScanStatus('cooldown');
        setMatchedEmployee(null);
        setTimeout(() => setScanStatus('searching'), 300);
      }, 800);
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
      
      {scanStatus === 'loading' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-950">
           <Loader2 className="animate-spin text-emerald-500 w-16 h-16 mb-6" />
           <p className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500 animate-pulse">Биометрия: Загрузка нейросети...</p>
        </div>
      )}

      {/* Simplified detection frame */}
      <div className={`absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-30 transition-opacity duration-500 ${scanStatus === 'searching' ? 'opacity-100' : 'opacity-0'}`}>
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
    </div>
  );
};

export default CameraScanner;
