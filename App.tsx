
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Wifi, WifiOff, CloudSync, Lock, X, BatteryCharging, Zap, CheckCircle, Globe, ShieldAlert } from 'lucide-react';
import CameraScanner from './components/CameraScanner';
import AdminPanel from './components/AdminPanel';
import { Employee, AttendanceType, AppState } from './types';
import * as storage from './services/storage';
import { syncAttendanceToCloud } from './services/syncService';
import * as tg from './services/telegramService';

const ADMIN_PASSWORD = '6411131';
const HOURLY_REPORT_LAST_SLOT_KEY = 'faceclock_tg_last_hourly_slot';

const buildHourSlot = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}`;
};

const App: React.FC = () => {
  const [view, setView] = useState<AppState['view']>('SCAN');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  
  const [lastScanMessage, setLastScanMessage] = useState<{name: string, time: string, type: AttendanceType} | null>(null);
  const [lastDeniedMessage, setLastDeniedMessage] = useState<{ time: string } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const deniedToastTimerRef = useRef<number | null>(null);
  const isHourlyReportSendingRef = useRef(false);

  // Power Management
  const [powerMode, setPowerMode] = useState<'ACTIVE' | 'DIMMED' | 'SLEEP'>('ACTIVE');
  const [lastActivity, setLastActivity] = useState(Date.now());

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleUserActivity = useCallback(() => {
    setLastActivity(Date.now());
    if (powerMode !== 'ACTIVE') setPowerMode('ACTIVE');
  }, [powerMode]);

  const attemptCloudSync = useCallback(async () => {
    if (!navigator.onLine || isCloudSyncing) return;
    const apiUrl = localStorage.getItem('sync_api_url');
    if (!apiUrl) return;

    setIsCloudSyncing(true);
    try {
      await syncAttendanceToCloud({
        apiUrl,
        host: localStorage.getItem('db_host') || '',
        name: localStorage.getItem('db_name') || '',
        user: localStorage.getItem('db_user') || '',
        pass: localStorage.getItem('db_pass') || '',
        table: 'time_hr'
      });
    } finally {
      setIsCloudSyncing(false);
    }
  }, [isCloudSyncing]);

  const handleScanComplete = useCallback((employee: Employee, type: AttendanceType) => {
    handleUserActivity();
    setLastDeniedMessage(null);
    
    // 1-minute duplicate check
    const lastLog = storage.getLastLogForEmployee(employee.id);
    if (lastLog) {
      const diffMs = Date.now() - new Date(lastLog.timestamp).getTime();
      if (diffMs < 60000) return; 
    }

    storage.addLog(employee, type);
    setLastScanMessage({
      name: employee.name,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type
    });
    
    // Background sync to cloud
    setTimeout(attemptCloudSync, 2000);
    setTimeout(() => setLastScanMessage(null), 3000);
  }, [handleUserActivity, attemptCloudSync]);

  const handleDenied = useCallback(async (photo: string) => {
    handleUserActivity();
    storage.addDeniedAttempt(photo);
    setLastScanMessage(null);

    const timestamp = new Date().toISOString();
    setLastDeniedMessage({
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    if (deniedToastTimerRef.current) {
      window.clearTimeout(deniedToastTimerRef.current);
    }
    deniedToastTimerRef.current = window.setTimeout(() => setLastDeniedMessage(null), 3000);

    const botToken = localStorage.getItem('tg_bot_token');
    const chatId = localStorage.getItem('tg_chat_id');
    if (botToken && chatId) {
      await tg.sendDeniedPhoto(botToken, chatId, photo.split(',')[1] || photo, timestamp);
    }
  }, [handleUserActivity]);

  const attemptHourlyTelegramReport = useCallback(async () => {
    if (!navigator.onLine || isHourlyReportSendingRef.current) return;

    const botToken = localStorage.getItem('tg_bot_token');
    const chatId = localStorage.getItem('tg_chat_id');
    if (!botToken || !chatId) return;

    const logs = storage.getTodaysLogs();
    if (!logs.length) return; // Do not send empty reports.

    const slot = buildHourSlot(new Date());
    const lastSlot = localStorage.getItem(HOURLY_REPORT_LAST_SLOT_KEY);
    if (lastSlot === slot) return;

    isHourlyReportSendingRef.current = true;
    try {
      const reportText = tg.generateLocalReportSummary(logs);
      const result = await tg.sendTelegramReport(botToken, chatId, logs, reportText);
      if (result?.ok) {
        localStorage.setItem(HOURLY_REPORT_LAST_SLOT_KEY, slot);
      }
    } catch (e) {
      // Keep silent in scanner mode; next interval will retry.
    } finally {
      isHourlyReportSendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (deniedToastTimerRef.current) {
        window.clearTimeout(deniedToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Try once on startup and then once per minute.
    void attemptHourlyTelegramReport();
    const timer = window.setInterval(() => {
      void attemptHourlyTelegramReport();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [attemptHourlyTelegramReport]);

  return (
    <div className="h-screen w-screen bg-black relative overflow-hidden font-sans">
      {view === 'SCAN' && (
        <>
          <CameraScanner 
            onScanComplete={handleScanComplete} 
            onDenied={handleDenied}
            onError={() => {}}
            powerMode={powerMode}
            onWake={handleUserActivity}
          />
          
          <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-[60] pointer-events-none">
            <div className="flex flex-col space-y-2">
              <div className={`flex items-center space-x-2 px-4 py-2 rounded-full backdrop-blur-xl border ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span className="text-[10px] font-black tracking-widest uppercase">{isOnline ? 'СЕТЬ ОК' : 'ОФФЛАЙН'}</span>
              </div>
              {isCloudSyncing && (
                <div className="flex items-center space-x-2 px-4 py-2 rounded-full backdrop-blur-xl border bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse">
                  <Globe size={14} className="animate-spin" />
                  <span className="text-[10px] font-black tracking-widest uppercase">SQL SYNC</span>
                </div>
              )}
            </div>
            <button onClick={() => setIsPasswordModalOpen(true)} className="pointer-events-auto p-4 bg-gray-900/80 backdrop-blur-2xl rounded-3xl text-white border border-white/10 shadow-2xl"><Settings size={24} /></button>
          </div>

          <div className="absolute bottom-10 left-0 w-full text-center pointer-events-none z-[60]">
            <Clock />
          </div>

          {/* Compact Success Overlay */}
          {lastScanMessage && (
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
               <div className="bg-emerald-500 text-white px-8 py-4 rounded-[2rem] shadow-[0_20px_50px_rgba(16,185,129,0.4)] flex items-center gap-4 border border-white/20">
                 <div className="bg-white/20 p-2 rounded-full"><CheckCircle size={20} /></div>
                 <div>
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Успешно</p>
                    <p className="text-sm font-black uppercase tracking-tight leading-none mt-0.5">{lastScanMessage.name}</p>
                 </div>
               </div>
            </div>
          )}

          {lastDeniedMessage && (
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="bg-red-500 text-white px-8 py-4 rounded-[2rem] shadow-[0_20px_50px_rgba(239,68,68,0.4)] flex items-center gap-4 border border-white/20">
                <div className="bg-white/20 p-2 rounded-full"><ShieldAlert size={20} /></div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-90">Доступ запрещен</p>
                  <p className="text-sm font-black uppercase tracking-tight leading-none mt-0.5">Сотрудник не найден</p>
                </div>
              </div>
            </div>
          )}

          {isPasswordModalOpen && (
            <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6">
              <div className="w-full max-w-sm bg-gray-950 border border-white/10 rounded-[3rem] p-10 shadow-2xl relative">
                <button onClick={() => setIsPasswordModalOpen(false)} className="absolute top-8 right-8 text-white/30"><X size={24} /></button>
                <h3 className="text-xl font-black text-white mb-8 text-center uppercase">Админ-панель</h3>
                <form onSubmit={(e) => { e.preventDefault(); if (passwordInput === ADMIN_PASSWORD) { setView('ADMIN'); setIsPasswordModalOpen(false); setPasswordInput(''); } else { setPasswordError(true); setPasswordInput(''); } }} className="space-y-6">
                  <input autoFocus name="adminPassword" autoComplete="new-password" type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="••••" className={`w-full bg-black border-2 ${passwordError ? 'border-red-500' : 'border-white/10'} rounded-2xl p-4 text-center text-4xl font-mono text-white outline-none`} />
                  <button type="submit" className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl uppercase tracking-widest">Войти</button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
      {view === 'ADMIN' && <AdminPanel onBack={() => setView('SCAN')} />}
    </div>
  );
};

const Clock = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="space-y-1">
      <div className="text-7xl font-black text-white font-mono tracking-tighter">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="text-emerald-500 font-black text-[10px] uppercase tracking-[0.5em] opacity-60">{time.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  );
};

export default App;
