
export interface Employee {
  id: string;
  name: string;
  photoUrl: string; // Base64 or URL
  registeredAt: string;
  status?: number; 
  objectId?: string; // ID объекта, к которому привязан сотрудник
  descriptor?: number[]; // Массив чисел (вектор лица) для face-api.js
}

export enum AttendanceType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT'
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  employeeName: string;
  timestamp: string;
  type: AttendanceType;
  synced: boolean;
}

export interface AppState {
  view: 'SCAN' | 'ADMIN' | 'ENROLL';
}

export interface DailyStats {
  totalPresent: number;
  lastSync: string;
}
