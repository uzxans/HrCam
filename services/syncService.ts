
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

const SYSTEM_FACE_BASE_URL = 'https://systemreg.ru/skudSystems/face';
const SYSTEM_ROOT_URL = 'https://systemreg.ru';

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);
const isDataUrl = (value: string): boolean => /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);

const normalizeImageSource = (rawValue: string): string | null => {
  const value = rawValue.trim();
  if (!value) return null;

  if (isDataUrl(value)) return value;
  // Some backends return plain base64 without data URL prefix.
  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 256) {
    return `data:image/jpeg;base64,${value.replace(/\s/g, '')}`;
  }

  if (value.startsWith('//')) return `https:${value}`;
  if (isHttpUrl(value)) return value;

  const normalizedPath = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!normalizedPath) return null;

  if (/^skudsystems\/face\//i.test(normalizedPath)) {
    return `${SYSTEM_ROOT_URL}/${normalizedPath}`;
  }

  if (/^uploads\//i.test(normalizedPath)) {
    return `${SYSTEM_FACE_BASE_URL}/${normalizedPath}`;
  }

  return `${SYSTEM_ROOT_URL}/${normalizedPath}`;
};

const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const buildPhotoCandidates = (rawPhoto: unknown): string[] => {
  const candidates: string[] = [];
  const raw = typeof rawPhoto === 'string' ? rawPhoto.trim() : '';

  if (raw) {
    const normalized = normalizeImageSource(raw);
    if (normalized) {
      candidates.push(normalized);
    }

    if (!isDataUrl(raw) && !isHttpUrl(raw)) {
      const path = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
      if (path) {
        candidates.push(`${SYSTEM_FACE_BASE_URL}/${path}`);
        candidates.push(`${SYSTEM_ROOT_URL}/${path}`);
      }
    }
  }

  return unique(candidates);
};

const fetchImageAsBase64 = async (source: string): Promise<string | null> => {
  if (!source || source.length < 8) return null;
  if (isDataUrl(source)) return source;
  if (!isHttpUrl(source)) return null;

  // Using multiple proxies to bypass CORS when downloading staff photos.
  const proxies = [
    `https://wsrv.nl/?url=${encodeURIComponent(source)}&output=jpg&w=640&q=85`,
    `https://corsproxy.io/?${encodeURIComponent(source)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetchWithTimeout(proxyUrl, { method: 'GET' }, 8000);
      if (!res.ok) continue;

      const blob = await res.blob();
      if (!blob || blob.size === 0) continue;

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string) || '');
        reader.readAsDataURL(blob);
      });

      if (base64) return base64;
    } catch (e) {
      continue;
    }
  }
  return null;
};

const pickPhotoForDisplay = (rawSource: string | null, downloadedBase64: string | null): string => {
  if (downloadedBase64) return downloadedBase64;
  if (rawSource && isDataUrl(rawSource)) return rawSource;
  return '';
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
  if (!response.ok) throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('БД вернула некорректный формат или пустой список');
  const existingEmployees = await storage.getEmployees();
  const existingById = new Map(existingEmployees.map((emp) => [emp.id, emp]));

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const fullName = item.full_name || item.name || 'Без имени';
    const empId = item.id.toString();
    
    const objectId = config.objectId || '41';
    const existingEmployee = existingById.get(empId);
    const preferredPhotoSource = normalizeImageSource(typeof item.photo === 'string' ? item.photo : '');
    const photoCandidates = buildPhotoCandidates(item.photo);

    if (onProgress) onProgress(i + 1, data.length, `Обработка биометрии: ${fullName}`);
    
    try {
      // 1. Download image (or reuse existing base64 from the API response)
      let base64: string | null = null;
      for (const source of photoCandidates) {
        base64 = await fetchImageAsBase64(source);
        if (base64) break;
      }
      const photoForDisplay = pickPhotoForDisplay(preferredPhotoSource, base64);
      
      // 2. Extract Face Embeddings (Descriptor) using face-api.js
      let descriptor = null;
      if (base64) {
        descriptor = await faceService.computeFaceDescriptor(base64);
      } else if (photoForDisplay) {
        // Fallback: if we couldn't download image but URL is directly accessible in browser.
        descriptor = await faceService.computeFaceDescriptor(photoForDisplay);
      }
      
      // 3. Save to local IndexedDB
      const finalPhoto = photoForDisplay || existingEmployee?.photoUrl || '';
      const finalDescriptor = descriptor || existingEmployee?.descriptor;

      await storage.saveEmployee({
        id: empId,
        name: fullName,
        photoUrl: finalPhoto,
        descriptor: finalDescriptor || undefined,
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
        table: config.table,
        data: pairs.map(({ iduser, date, start, end }) => ({ iduser, date, start, end }))
      })
    });

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      if (payload?.ok === false) return false;
      const allLogIds = pairs.flatMap(p => p.logIds);
      storage.removeLogsByIds(allLogIds);
      storage.setLastSync();
      return true;
    }
  } catch (e) {
    console.error("Cloud Sync Failed", e);
  }
  return false;
};
