import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { decodeAudioData, createPcmBlob, decodeBase64 } from './audioUtils';
import { TicketData, EmailDraft } from '../types';

// Function definition for the tool
const registerTicketTool: FunctionDeclaration = {
  name: 'registerSupportTicket',
  parameters: {
    type: Type.OBJECT,
    description: 'Registers a support ticket with the given details.',
    properties: {
      correo: { type: Type.STRING, description: 'Email address of the official.' },
      municipalidad: { type: Type.STRING, description: 'Name of the municipality.' },
      sistema: { type: Type.STRING, description: 'The system requiring support (e.g., contabilidad, bodega).' },
      descripcion: { type: Type.STRING, description: 'Detailed description of the error or requirement.' },
    },
    required: ['correo', 'municipalidad', 'sistema', 'descripcion'],
  },
};

const getSystemInstruction = (userEmail: string) => `
ROL DEL AGENTE
Eres Soporte Sistemas, el asistente virtual de soporte para sistemas de gestión municipal en Chile.
Tu objetivo es recibir requerimientos y errores de los funcionarios municipales, guiarlos cordialmente y generar un reporte formal.

CONTEXTO INICIAL
El usuario ya ha ingresado su correo electrónico en el sistema. El correo es: "${userEmail}".
IMPORTANTE: NO preguntes por el correo electrónico. Ya lo tienes.

FLUJO DE CONVERSACIÓN
1. Saluda de forma cordial y profesional como "Soporte Sistemas".
2. Solicita inmediatamente el nombre de la municipalidad.
3. Una vez obtenido, solicita el nombre del sistema (ej: contabilidad, bodega, adquisiciones).
4. Una vez obtenido, solicita la descripción del error o requerimiento, pidiendo precisión.

REGLAS
- Valida la información: Si falta algún dato (Municipalidad, Sistema, Descripción), pídelo nuevamente.
- Resume lo entregado para confirmar antes de enviar.
- Una vez recibidos todos los datos, llama a la herramienta 'registerSupportTicket' incluyendo el correo "${userEmail}" en el campo correspondiente.
- Indica que, al finalizar la llamada, se generará automáticamente el correo de reporte.

Estilo de comunicación: Cortés, profesional, claro, cercano. Adaptado a funcionarios municipales. Evita tecnicismos.
`;

export class LiveManager {
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private nextStartTime: number = 0;
  private cleanupFunctions: (() => void)[] = [];
  
  public onVolumeChange: (volume: number) => void = () => {};
  public onTicketCreated: (ticket: TicketData) => void = () => {};
  public onEmailReady: (draft: EmailDraft) => void = () => {};
  public onClose: () => void = () => {};

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async connect(userEmail: string) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const outputNode = this.audioContext.createGain();
    outputNode.connect(this.audioContext.destination);

    // Setup Microphone
    // Note: In a real app we would want 16kHz for input to save bandwidth, but context is 24k for output.
    // We will downsample/process in the ScriptProcessor.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
    
    // We use a separate context for input to ensure correct sample rate capture if browser allows, 
    // or just handle resampling. For simplicity in this demo, we rely on the processor logic.
    const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.inputSource = inputContext.createMediaStreamSource(this.stream);
    this.processor = inputContext.createScriptProcessor(4096, 1, 1);
    
    // Visualization Helper
    const analyzer = inputContext.createAnalyser();
    analyzer.fftSize = 256;
    this.inputSource.connect(analyzer);
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

    const systemInstruction = getSystemInstruction(userEmail);

    // Connect to Gemini
    const sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstruction,
        tools: [{ functionDeclarations: [registerTicketTool] }],
        speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } // A gentle male voice
        }
      },
      callbacks: {
        onopen: () => {
          console.log('Gemini Live Connected');
          
          this.inputSource?.connect(this.processor!);
          this.processor?.connect(inputContext.destination);

          this.processor!.onaudioprocess = (e) => {
            // Volume visualization
            analyzer.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            this.onVolumeChange(avg / 255);

            // Send Audio
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBlob = createPcmBlob(inputData);
            sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
          };
        },
        onmessage: async (msg: LiveServerMessage) => {
          // Handle Tool Calls
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls) {
              if (fc.name === 'registerSupportTicket') {
                const args = fc.args as any;
                const timestamp = new Date().toISOString();
                const ticketId = 'T-' + Math.floor(10000 + Math.random() * 90000);

                // UI Data (includes ticketId)
                const uiTicket: TicketData = {
                  correo: args.correo || '',
                  municipalidad: args.municipalidad || '',
                  sistema: args.sistema || '',
                  descripcion: args.descripcion || '',
                  timestamp: timestamp,
                  ticketId: ticketId
                };
                
                // Trigger UI update
                this.onTicketCreated(uiTicket);

                console.log('Generating email summary for:', uiTicket);

                // Generate Professional Email Summary using Gemini Flash
                try {
                  const prompt = `
                    Analiza este requerimiento de soporte municipal y genera un resumen profesional para enviarlo por correo:

                    Correo: ${uiTicket.correo}
                    Municipalidad: ${uiTicket.municipalidad}
                    Sistema: ${uiTicket.sistema}
                    Descripción: ${uiTicket.descripcion}
                    Timestamp: ${uiTicket.timestamp}
                    ID Ticket: ${uiTicket.ticketId}

                    Instrucciones:
                    1. La primera línea debe ser SOLO el asunto sugerido, comenzando con "Asunto:".
                    2. El resto debe ser el cuerpo del correo, claro, estructurado y profesional.
                  `;

                  const response = await this.ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt
                  });

                  const fullText = response.text || '';
                  
                  // Extract Subject and Body
                  const subjectMatch = fullText.match(/^Asunto:\s*(.*)/i);
                  let subject = `Ticket ${uiTicket.ticketId} - Soporte ${uiTicket.municipalidad}`;
                  let body = fullText;

                  if (subjectMatch) {
                    subject = subjectMatch[1].trim();
                    // Remove the subject line from the body to avoid duplication
                    body = fullText.replace(/^Asunto:.*\n+/i, '').trim();
                  }

                  // Emit Email Ready event instead of opening immediately
                  this.onEmailReady({ subject, body });

                  sessionPromise.then(session => session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: { result: `Borrador de correo generado y listo para enviar al finalizar.` }
                    }
                  }));

                } catch (error) {
                  console.error('Error generating email content:', error);
                  sessionPromise.then(session => session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: { result: `Ticket ${ticketId} registrado, pero hubo un error generando el borrador.` }
                    }
                  }));
                }
              }
            }
          }

          // Handle Audio Output
          const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData && this.audioContext) {
            this.nextStartTime = Math.max(this.nextStartTime, this.audioContext.currentTime);
            const buffer = await decodeAudioData(decodeBase64(audioData), this.audioContext);
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(outputNode);
            source.start(this.nextStartTime);
            this.nextStartTime += buffer.duration;
          }

          // Handle Interruption
          if (msg.serverContent?.interrupted) {
            this.nextStartTime = this.audioContext ? this.audioContext.currentTime : 0;
            // In a robust app, we would stop currently playing nodes here.
          }
        },
        onclose: () => {
          this.disconnect();
          this.onClose();
        },
        onerror: (err) => {
          console.error("Gemini Error:", err);
          this.disconnect();
          this.onClose();
        }
      }
    });

    this.cleanupFunctions.push(() => {
        // cleanup logic
        sessionPromise.then(s => s.close()); // best effort close
    });
  }

  disconnect() {
    this.cleanupFunctions.forEach(fn => fn());
    this.cleanupFunctions = [];

    this.processor?.disconnect();
    this.inputSource?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close();

    this.processor = null;
    this.inputSource = null;
    this.stream = null;
    this.audioContext = null;
  }
}