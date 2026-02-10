
import { AttendanceLog } from '../types';

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
      [reportText || 'Без комментария']
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
