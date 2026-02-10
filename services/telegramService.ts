
import { AttendanceLog } from '../types';

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const generateLocalReportSummary = (logs: AttendanceLog[]): string => {
  if (!logs.length) return 'За выбранный период нет записей посещаемости.';

  const sorted = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const presentEmployees = new Set<string>();
  const firstEntryByEmployee = new Map<string, Date>();
  const insideState = new Map<string, boolean>();
  let anomalies = 0;

  for (const log of sorted) {
    const ts = new Date(log.timestamp);
    if (log.type === 'ENTRY') {
      presentEmployees.add(log.employeeId);
      if (!firstEntryByEmployee.has(log.employeeId)) {
        firstEntryByEmployee.set(log.employeeId, ts);
      }
      insideState.set(log.employeeId, true);
    } else {
      if (!insideState.get(log.employeeId)) {
        anomalies++;
      } else {
        insideState.set(log.employeeId, false);
      }
    }
  }

  for (const [, isInside] of insideState.entries()) {
    if (isInside) anomalies++;
  }

  const lateEmployees: string[] = [];
  for (const log of sorted) {
    if (log.type !== 'ENTRY') continue;
    const firstEntry = firstEntryByEmployee.get(log.employeeId);
    if (!firstEntry) continue;
    const isSame = firstEntry.getTime() === new Date(log.timestamp).getTime();
    if (!isSame) continue;
    const isLate = firstEntry.getHours() > 9 || (firstEntry.getHours() === 9 && firstEntry.getMinutes() > 0);
    if (isLate) {
      lateEmployees.push(log.employeeName);
    }
  }

  const dateLabel = formatDateKey(new Date(sorted[0].timestamp));
  const lateInfo = lateEmployees.length ? lateEmployees.join(', ') : 'нет';
  const anomaliesInfo = anomalies > 0 ? `${anomalies}` : 'нет';

  return `Дата: ${dateLabel}. Присутствовали: ${presentEmployees.size}. Опоздали: ${lateInfo}. Аномалии: ${anomaliesInfo}.`;
};

export const sendMessage = async (botToken: string, chatId: string, text: string) => {
  if (!botToken || !chatId) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return await response.json();
  } catch (error) {
    // Silently fail on network error
    return null;
  }
};

export const deleteWebhook = async (botToken: string) => {
  if (!botToken) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=true`);
    return await response.json();
  } catch (error) {
    return null;
  }
};

export const getUpdates = async (botToken: string, offset: number) => {
  if (!botToken) return [];
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=10`);
    
    if (response.status === 409) {
      // Conflict: Webhook is active. Try to delete it immediately to fix the loop.
      await deleteWebhook(botToken);
      return [];
    }

    if (!response.ok) return [];

    const data = await response.json();
    return data.ok ? data.result : [];
  } catch (error) {
    // Suppress "Failed to fetch" errors in console
    return [];
  }
};

export const sendTelegramReport = async (
  botToken: string, 
  chatId: string, 
  logs: AttendanceLog[],
  reportText: string
) => {
  if (!logs.length) {
    return { ok: false, description: 'Нет данных для отчета' };
  }

  try {
    const XLSX = await import('xlsx');
    const excelRows = logs.map((log) => ({
      ID: log.employeeId,
      Name: log.employeeName,
      Type: log.type === 'ENTRY' ? 'Пришел' : 'Ушел',
      Timestamp: new Date(log.timestamp).toLocaleString('ru-RU')
    }));

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['Отчет посещаемости'],
      ['Дата', new Date().toLocaleDateString('ru-RU')],
      ['Записей', logs.length.toString()],
      [],
      ['Комментарий'],
      [reportText || generateLocalReportSummary(logs)]
    ]);
    const logsSheet = XLSX.utils.json_to_sheet(excelRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, logsSheet, 'Logs');

    const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob(
      [workbookBuffer],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    );

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', `📊 Отчет посещаемости\n${new Date().toLocaleString('ru-RU')}`);
    formData.append('document', blob, `report_${new Date().toISOString().split('T')[0]}.xlsx`);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: formData
    });
    return await response.json();
  } catch (error) {
    return null;
  }
};

export const sendDeniedPhoto = async (
  botToken: string,
  chatId: string,
  photoBase64: string,
  timestamp: string
) => {
  const byteString = atob(photoBase64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: 'image/jpeg' });

  const formData = new FormData();
  formData.append('chat_id', chatId);
  const timeStr = new Date(timestamp).toLocaleString('ru-RU');
  formData.append('caption', `🚫 ДОСТУП ЗАПРЕЩЕН\n👤 Сотрудник не найден в базе\n⏰ Время: ${timeStr}`);
  formData.append('photo', blob, 'denied.jpg');

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: formData
    });
    return await response.json();
  } catch (error) {
    return null;
  }
};
