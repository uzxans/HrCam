
import { Employee } from '../types';
import * as storage from './storage';
import * as faceService from './faceService';

export interface DbConfig {
  host: string;
  name: string;
  user: string;
  pass: string;
  table: string;
  apiUrl: string;
  objectId?: string;
  activeStatus?: string;
}

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 25000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  if (!url || url.length < 10) return null;
  // Using multiple proxies to ensure we can bypass CORS and fetch the image
  const proxies = [
    `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=jpg&w=400&q=80`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url
  ];

  for (const p of proxies) {
    try {
      const res = await fetchWithTimeout(p, { method: 'GET' }, 8000);
      if (res.ok) {
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) { continue; }
  }
  return null;
};

export const syncAndSaveEmployees = async (
  config: DbConfig,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<{count: number, errors: number}> => {
  let count = 0;
  let errors = 0;
  if (onProgress) onProgress(0, 0, 'Инициализация нейросети...');
  await faceService.loadModels();

  // Fetch list of employees from the proxy
  const response = await fetchWithTimeout(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'get_employees',
      db_host: config.host,
      db_name: config.name,
      db_user: config.user,
      db_pass: config.pass,
      db_table: config.table,
      query_params: { object: config.objectId || '41', status: config.activeStatus || '100' },
      fields: ['id', 'full_name', 'photo', 'status']
    })
  });

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('БД вернула некорректный формат или пустой список');

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const fullName = item.full_name || item.name || 'Без имени';
    const empId = item.id.toString();
    
    // Use the specific path provided by the user: uploads/{objectId}/{id}.jpg
    const objectId = config.objectId || '41';
    const photoUrl = `https://systemreg.ru/skudSystems/face/uploads/${objectId}/${empId}.jpg`;

    if (onProgress) onProgress(i + 1, data.length, `Обработка биометрии: ${fullName}`);
    
    try {
      // 1. Download image
      const base64 = await fetchImageAsBase64(photoUrl);
      
      // 2. Extract Face Embeddings (Descriptor) using face-api.js
      let descriptor = null;
      if (base64) {
        descriptor = await faceService.computeFaceDescriptor(base64);
      }
      
      // 3. Save to local IndexedDB
      await storage.saveEmployee({
        id: empId,
        name: fullName,
        photoUrl: base64 || '',
        descriptor: descriptor || undefined,
        registeredAt: new Date().toISOString(),
        objectId: objectId,
        status: parseInt(item.status) || 100
      });
      count++;
    } catch (e) { 
      console.error(`Error syncing employee ${fullName}:`, e);
      errors++; 
    }
  }
  return { count, errors };
};

export const syncAttendanceToCloud = async (config: DbConfig): Promise<boolean> => {
  const pairs = storage.getAttendancePairs();
  if (pairs.length === 0) return true;

  try {
    const response = await fetchWithTimeout(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_time_hr',
        db_host: config.host,
        db_name: config.name,
        db_user: config.user,
        db_pass: config.pass,
        data: pairs // [{ iduser, date, start, end }]
      })
    });

    if (response.ok) {
      const allLogIds = pairs.flatMap(p => p.logIds);
      storage.markLogsAsSynced(allLogIds);
      return true;
    }
  } catch (e) {
    console.error("Cloud Sync Failed", e);
  }
  return false;
};
