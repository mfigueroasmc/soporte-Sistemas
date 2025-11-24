export interface TicketData {
  correo: string;
  municipalidad: string;
  sistema: string;
  descripcion: string;
  timestamp: string;
  ticketId?: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioVisualizerState {
  isSpeaking: boolean;
  volume: number;
}