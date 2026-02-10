
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeft, RefreshCw, Save, User, Loader2, Settings2, FolderOpen, 
  Users, CheckCircle2, Database, MessageSquare, SendHorizontal, 
  Globe, CloudCheck, Info, ScanFace, FileUp, Upload, Zap, DownloadCloud
} from 'lucide-react';
import { Employee, AttendanceLog, AttendanceType } from '../types';
import * as storage from '../services/storage';
import * as faceService from '../services/faceService';
import { syncAndSaveEmployees, DbConfig, syncAttendanceToCloud } from '../services/syncService';
import * as tg from '../services/telegramService';

interface AdminPanelProps {
  onBack: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onBack }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [activeTab, setActiveTab] = useState<'EMPLOYEES' | 'REPORT' | 'CONFIG' | 'TELEGRAM'>('EMPLOYEES');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, message: string} | null>(null);
  
  const configFileInputRef = useRef<HTMLInputElement>(null);
  const lastProgressUpdateRef = useRef(0);

  const [config, setConfig] = useState({
    host: localStorage.getItem('db_host') || '',
    name: localStorage.getItem('db_name') || '',
    user: localStorage.getItem('db_user') || '',
    pass: localStorage.getItem('db_pass') || '',
    table: localStorage.getItem('db_table') || 'hrapp',
    objectId: localStorage.getItem('db_object') || localStorage.getItem('db_objectId') || '41',
    status: localStorage.getItem('db_status') || '100',
    apiUrl: localStorage.getItem('sync_api_url') || '',
    syncTimeHr: localStorage.getItem('sync_time_hr') || '',
    botToken: localStorage.getItem('tg_bot_token') || '',
    chatId: localStorage.getItem('tg_chat_id') || ''
  });

  const refreshData = useCallback(async () => {
    const activeStatus = Number(config.status || '100');
    const allEmployees = await storage.getEmployees();
    setEmployees(allEmployees.filter((emp) => Number(emp.status ?? activeStatus) === activeStatus));
    setLogs(storage.getTodaysLogs().reverse());
  }, [config.status]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    const handleEmployeesUpdated = () => {
      void refreshData();
    };
    window.addEventListener('faceclock:employees-updated', handleEmployeesUpdated);
    return () => {
      window.removeEventListener('faceclock:employees-updated', handleEmployeesUpdated);
    };
  }, [refreshData]);

  const getConfigStorageKey = (key: string): string => {
    if (key === 'apiUrl') return 'sync_api_url';
    if (key === 'syncTimeHr') return 'sync_time_hr';
    if (key === 'botToken') return 'tg_bot_token';
    if (key === 'chatId') return 'tg_chat_id';
    if (key === 'objectId') return 'db_object';
    return `db_${key}`;
  };

  const handleSave = () => {
    Object.entries(config).forEach(([k, v]) => {
      const storageKey = getConfigStorageKey(k);
      localStorage.setItem(storageKey, v);
    });
    localStorage.removeItem('db_objectId');
    setSyncStatus('Настройки сохранены');
    setTimeout(() => setSyncStatus(null), 2000);
  };

  const handleConfigUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newConfig = { ...config };
      
      // Match both 'key' => 'value' (PHP) and key = value
      const phpRegex = /['"]?([\w_]+)['"]?\s*=>\s*['"]?([^'"]+)['"]?/g;
      const simpleRegex = /^([\w_]+)\s*=\s*(.+)$/gm;
      
      let found = false;
      let match;

      while ((match = phpRegex.exec(content)) !== null) {
        found = true;
        mapConfigKey(match[1].trim(), match[2].trim(), newConfig);
      }
      
      if (!found) {
        while ((match = simpleRegex.exec(content)) !== null) {
          mapConfigKey(match[1].trim(), match[2].trim(), newConfig);
        }
      }
      
      setConfig(newConfig);
      setSyncStatus('Конфигурация импортирована');
      setTimeout(() => setSyncStatus(null), 2000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const mapConfigKey = (key: string, val: string, cfg: any) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'db_host' || lowerKey === 'host') cfg.host = val;
    else if (lowerKey === 'db_name' || lowerKey === 'name') cfg.name = val;
    else if (lowerKey === 'db_user' || lowerKey === 'user') cfg.user = val;
    else if (lowerKey === 'db_pass' || lowerKey === 'pass') cfg.pass = val;
    else if (lowerKey === 'api_url' || lowerKey === 'apiurl') cfg.apiUrl = val;
    else if (lowerKey === 'sync_time_hr' || lowerKey === 'synctimehr') cfg.syncTimeHr = val;
    else if (lowerKey === 'db_object' || lowerKey === 'object' || lowerKey === 'objectid' || lowerKey === 'object_id') cfg.objectId = val;
    else if (lowerKey === 'db_status' || lowerKey === 'status') cfg.status = val;
    else if (lowerKey === 'bot_token' || lowerKey === 'bottoken') cfg.botToken = val;
    else if (lowerKey === 'chat_id' || lowerKey === 'chatid') cfg.chatId = val;
    else if (key in cfg) (cfg as any)[key] = val;
  };

  const handleSyncEmployees = async () => {
    if (!config.apiUrl) {
      setSyncStatus('Ошибка: укажите API URL');
      return;
    }
    setIsSyncing(true);
    setSyncStatus('Синхронизация...');
    try {
      const result = await syncAndSaveEmployees({
        host: config.host,
        name: config.name,
        user: config.user,
        pass: config.pass,
        table: config.table,
        apiUrl: config.apiUrl,
        objectId: config.objectId,
        activeStatus: config.status
      }, (curr, tot, msg) => {
        const now = Date.now();
        if (curr === tot || now - lastProgressUpdateRef.current > 180) {
          lastProgressUpdateRef.current = now;
          setProgress({ current: curr, total: tot, message: msg });
        }
      });
      
      await refreshData();
      setSyncStatus(`Готово: обновлено ${result.count}, удалено ${result.removed}`);
    } catch (e: any) {
      setSyncStatus(`Ошибка: ${e.message}`);
    } finally {
      setIsSyncing(false);
      setProgress(null);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  };

  const handleIndividualPhotoUpdate = async (empId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSyncing(true);
    setSyncStatus('Обработка...');
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const descriptor = await faceService.computeFaceDescriptor(base64);
      await storage.updateEmployee(empId, { photoUrl: base64, descriptor: descriptor || undefined });
      await refreshData();
      setSyncStatus('Обновлено');
    } catch (err) {
      setSyncStatus('Ошибка фото');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 2000);
    }
  };

  const manualCloudSync = async () => {
    setIsSyncing(true);
    try {
      const ok = await syncAttendanceToCloud({
        ...config,
        table: 'time_hr',
        syncTimeHrUrl: config.syncTimeHr || config.apiUrl,
      });
      if (ok) {
        setSyncStatus('SQL Синхронизация: OK');
        refreshData();
      }
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 2000);
    }
  };

  const handleSendTelegramReport = async () => {
    if (!config.botToken || !config.chatId) {
      setSyncStatus('Ошибка: заполните botToken и chatId');
      setTimeout(() => setSyncStatus(null), 2500);
      return;
    }

    setIsSyncing(true);
    setSyncStatus('Формирование отчета...');
    try {
      const todaysLogs = storage.getTodaysLogs();
      if (!todaysLogs.length) {
        setSyncStatus('За сегодня нет записей — отчет не отправлен');
        return;
      }
      const reportText = tg.generateLocalReportSummary(todaysLogs);
      const result = await tg.sendTelegramReport(config.botToken, config.chatId, todaysLogs, reportText);

      if (result?.ok) {
        setSyncStatus('Отчет отправлен в Telegram');
      } else {
        setSyncStatus(`Ошибка Telegram: ${result?.description || 'не удалось отправить'}`);
      }
    } catch (e: any) {
      setSyncStatus(`Ошибка отчета: ${e?.message || 'неизвестно'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 3500);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#030303] text-gray-100 overflow-hidden font-sans">
      <div className="p-4 md:p-8 bg-black/40 border-b border-white/5 flex flex-col gap-4 md:gap-0 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 md:gap-6">
          <button onClick={onBack} className="p-3 md:p-4 bg-white/5 rounded-3xl border border-white/10 hover:bg-white/10 transition-all"><ArrowLeft size={20} className="md:w-6 md:h-6" /></button>
          <div>
            <h1 className="text-lg md:text-2xl font-black uppercase tracking-tight flex items-center gap-2 md:gap-3"><Settings2 className="text-emerald-500 w-5 h-5 md:w-6 md:h-6" /> Админ-центр</h1>
            {syncStatus && <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-1 animate-pulse">{syncStatus}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:gap-4">
          <button onClick={manualCloudSync} className="px-4 md:px-6 py-3 md:py-4 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-blue-600/20 transition-all">
            <Globe size={16} /> Выгрузить в SQL
          </button>
          <button onClick={handleSave} className="px-5 md:px-8 py-3 md:py-4 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-all">
            <Save size={16} /> Сохранить
          </button>
        </div>
      </div>

      <div className="flex px-4 md:px-8 mt-4 md:mt-8 gap-2 md:gap-3 overflow-x-auto pb-4 custom-scrollbar">
        {[
          { id: 'EMPLOYEES', label: 'Персонал', icon: Users },
          { id: 'REPORT', label: 'Логи / SQL', icon: CheckCircle2 },
          { id: 'TELEGRAM', label: 'Telegram', icon: MessageSquare },
          { id: 'CONFIG', label: 'Сервер', icon: Database }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2 md:gap-3 px-5 md:px-8 py-3 md:py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-24 md:pb-40 custom-scrollbar">
        {activeTab === 'REPORT' && (
          <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest px-4">Журнал посещений</h3>
            <div className="bg-white/5 rounded-[1.8rem] md:rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl">
              {logs.map(log => (
                <div key={log.id} className="p-4 md:p-6 border-b border-white/5 last:border-0 flex items-center justify-between hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3 md:gap-5">
                    <div className={`w-3 h-3 rounded-full ${log.type === AttendanceType.ENTRY ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                    <div>
                      <p className="text-xs md:text-sm font-black uppercase text-white">{log.employeeName}</p>
                      <p className="text-[10px] text-gray-500 font-mono mt-1 uppercase">{new Date(log.timestamp).toLocaleTimeString()} — {log.type === AttendanceType.ENTRY ? 'Пришел' : 'Ушел'}</p>
                    </div>
                  </div>
                  {log.synced ? <CloudCheck size={18} className="text-emerald-500" /> : <div className="text-white/20 text-[9px] font-black uppercase tracking-widest">Wait</div>}
                </div>
              ))}
              {logs.length === 0 && <div className="p-20 text-center text-white/10 text-[10px] uppercase font-black tracking-widest">Логов нет</div>}
            </div>
          </div>
        )}

        {activeTab === 'EMPLOYEES' && (
          <div className="space-y-6 md:space-y-8 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center px-4">
              <h3 className="text-[10px] md:text-xs font-black text-gray-500 uppercase tracking-widest">Персонал ({employees.length})</h3>
              <button 
                onClick={handleSyncEmployees}
                disabled={isSyncing}
                className="flex items-center gap-3 px-6 py-3 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all disabled:opacity-50"
              >
                {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />} Синхронизировать базу
              </button>
            </div>
            
            {progress && (
              <div className="px-4 py-5 bg-white/5 rounded-3xl border border-white/10">
                <p className="text-[10px] font-black uppercase text-emerald-400 mb-3">{progress.message}</p>
                <div className="w-full bg-black h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
              {employees.map(emp => (
                <div key={emp.id} className="bg-white/5 p-4 md:p-6 rounded-[2rem] md:rounded-[2.5rem] border border-white/5 flex flex-col items-center group shadow-xl transition-all">
                  <div className="w-24 h-24 rounded-[2rem] bg-black border border-white/10 overflow-hidden mb-5 relative">
                    {emp.photoUrl ? <img src={emp.photoUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-gray-900"><User size={40} className="text-white/10" /></div>}
                    {emp.descriptor && <div className="absolute top-2 right-2 w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)] border-2 border-black" />}
                  </div>
                  <p className="text-xs font-black uppercase text-center truncate w-full tracking-tight">{emp.name}</p>
                  <p className="text-[9px] text-gray-500 font-mono mt-1">ID: {emp.id}</p>
                  <div className="mt-6 w-full">
                    <input type="file" accept="image/*" id={`up-${emp.id}`} className="hidden" onChange={(e) => handleIndividualPhotoUpdate(emp.id, e)} />
                    <label htmlFor={`up-${emp.id}`} className="flex items-center justify-center gap-2 w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 text-[9px] font-black uppercase tracking-widest cursor-pointer transition-all">
                      <Upload size={12} className="text-emerald-500" /> Обновить фото
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'CONFIG' && (
          <div className="space-y-6 md:space-y-8 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center px-4">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Настройки сервера</h3>
              <div className="flex gap-3">
                <input type="file" accept=".txt" ref={configFileInputRef} onChange={handleConfigUpload} className="hidden" />
                <button onClick={() => configFileInputRef.current?.click()} className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 text-[10px] font-black uppercase tracking-widest transition-all">
                  <FileUp size={14} className="text-emerald-500" /> Импорт .txt
                </button>
              </div>
            </div>
            <form onSubmit={(e) => e.preventDefault()} className="bg-white/5 p-5 md:p-10 rounded-[2rem] md:rounded-[3rem] border border-white/5 grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10 shadow-2xl">
              {Object.keys(config).map(key => (
                <div key={key} className="space-y-4">
                  <label className="text-[10px] text-gray-500 ml-5 uppercase font-black tracking-widest">{key}</label>
                  <input 
                    type={key === 'pass' || key === 'botToken' ? 'password' : 'text'}
                    autoComplete={key === 'pass' || key === 'botToken' ? 'new-password' : 'off'}
                    value={(config as any)[key]} 
                    onChange={e => setConfig({...config, [key]: e.target.value})}
                    className="w-full bg-black border border-white/10 focus:border-emerald-500/40 rounded-3xl p-5 text-sm font-mono text-emerald-400 outline-none transition-all"
                    placeholder={`Введите ${key}...`}
                  />
                </div>
              ))}
            </form>
          </div>
        )}

        {activeTab === 'TELEGRAM' && (
          <div className="space-y-6 md:space-y-8 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center px-4">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Telegram уведомления</h3>
            </div>

            <div className="bg-white/5 p-5 md:p-10 rounded-[2rem] md:rounded-[3rem] border border-white/5 shadow-2xl space-y-6">
              <p className="text-[11px] text-white/70 uppercase tracking-wider font-bold">
                Отправка сводного отчета по сегодняшним логам в Telegram.
              </p>
              <div className="text-[10px] text-emerald-400 uppercase tracking-widest font-black">
                Логов за сегодня: {logs.length}
              </div>

              <button
                onClick={handleSendTelegramReport}
                disabled={isSyncing || !config.botToken || !config.chatId}
                className="px-8 py-4 bg-emerald-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                Отправить Excel отчет
              </button>

              {(!config.botToken || !config.chatId) && (
                <p className="text-[10px] text-orange-400 uppercase tracking-wider font-bold">
                  Заполните botToken и chatId во вкладке «Сервер».
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
