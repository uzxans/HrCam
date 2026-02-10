
import { Employee, AttendanceLog, AttendanceType } from '../types';

const KEYS = {
  LOGS: 'faceclock_logs',
  LAST_SYNC: 'faceclock_last_sync',
  REPORTED_DAYS: 'faceclock_reported_days',
  DENIED_ATTEMPTS: 'faceclock_denied_attempts',
  TG_LAST_UPDATE_ID: 'faceclock_tg_last_id',
};

const DB_NAME = 'FaceClockDB';
const DB_VERSION = 1;
const STORE_EMPLOYEES = 'employees';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_EMPLOYEES)) {
        db.createObjectStore(STORE_EMPLOYEES, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const clearAppData = async (): Promise<void> => {
  localStorage.removeItem(KEYS.LOGS);
  localStorage.removeItem(KEYS.LAST_SYNC);
  localStorage.removeItem(KEYS.REPORTED_DAYS);
  localStorage.removeItem(KEYS.DENIED_ATTEMPTS);
  const db = await openDB();
  const transaction = db.transaction([STORE_EMPLOYEES], 'readwrite');
  transaction.objectStore(STORE_EMPLOYEES).clear();
};

export const getEmployees = async (): Promise<Employee[]> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction([STORE_EMPLOYEES], 'readonly');
    const store = transaction.objectStore(STORE_EMPLOYEES);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
  });
};

export const saveEmployee = async (employee: Employee): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction([STORE_EMPLOYEES], 'readwrite');
  transaction.objectStore(STORE_EMPLOYEES).put(employee);
};

export const updateEmployee = async (id: string, updates: Partial<Employee>): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction([STORE_EMPLOYEES], 'readwrite');
  const store = transaction.objectStore(STORE_EMPLOYEES);
  const request = store.get(id);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, ...updates });
  };
};

export const deleteEmployee = async (id: string): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction([STORE_EMPLOYEES], 'readwrite');
  transaction.objectStore(STORE_EMPLOYEES).delete(id);
};

export const getLogs = (): AttendanceLog[] => {
  const data = localStorage.getItem(KEYS.LOGS);
  return data ? JSON.parse(data) : [];
};

export const addLog = (employee: Employee, type: AttendanceType): AttendanceLog => {
  const logs = getLogs();
  const newLog: AttendanceLog = {
    id: crypto.randomUUID(),
    employeeId: employee.id,
    employeeName: employee.name,
    timestamp: new Date().toISOString(),
    type,
    synced: false
  };
  logs.push(newLog);
  localStorage.setItem(KEYS.LOGS, JSON.stringify(logs));
  return newLog;
};

export const markLogsAsSynced = (logIds: string[]) => {
  const logs = getLogs();
  const updated = logs.map(l => logIds.includes(l.id) ? { ...l, synced: true } : l);
  localStorage.setItem(KEYS.LOGS, JSON.stringify(updated));
};

export const getTodaysLogs = (): AttendanceLog[] => {
  const today = new Date().toISOString().split('T')[0];
  return getLogs().filter(log => log.timestamp.startsWith(today));
};

export const getLastLogForEmployee = (employeeId: string): AttendanceLog | undefined => {
  return getLogs().filter(l => l.employeeId === employeeId).pop();
};

export const getAttendancePairs = () => {
  const logs = getTodaysLogs();
  const users: Record<string, { iduser: string, date: string, start: string, end: string, logIds: string[] }> = {};

  logs.forEach(log => {
    const date = log.timestamp.split('T')[0];
    const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const key = `${log.employeeId}_${date}`;

    if (!users[key]) {
      users[key] = { iduser: log.employeeId, date, start: '', end: '', logIds: [] };
    }
    
    users[key].logIds.push(log.id);

    if (log.type === AttendanceType.ENTRY) {
      if (!users[key].start || time < users[key].start) users[key].start = time;
    } else {
      if (!users[key].end || time > users[key].end) users[key].end = time;
    }
  });

  return Object.values(users);
};

export const addDeniedAttempt = (photoBase64: string): void => {
  const attempts: any[] = JSON.parse(localStorage.getItem(KEYS.DENIED_ATTEMPTS) || '[]');
  attempts.push({ id: crypto.randomUUID(), photoBase64, timestamp: new Date().toISOString() });
  localStorage.setItem(KEYS.DENIED_ATTEMPTS, JSON.stringify(attempts.slice(-30)));
};

export const getLastTgUpdateId = (): number => parseInt(localStorage.getItem(KEYS.TG_LAST_UPDATE_ID) || '0');
export const setLastTgUpdateId = (id: number): void => localStorage.setItem(KEYS.TG_LAST_UPDATE_ID, id.toString());
export const setLastSync = (): void => localStorage.setItem(KEYS.LAST_SYNC, new Date().toISOString());
