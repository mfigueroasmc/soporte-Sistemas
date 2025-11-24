import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { decodeAudioData, createPcmBlob, decodeBase64 } from './audioUtils';
import { TicketData, EmailDraft, SolutionData } from '../types';

// Tool to register the final ticket
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

// Tool to analyze problem and provide tips (Intermediate step)
const analyzeProblemTool: FunctionDeclaration = {
  name: 'analyzeProblem',
  parameters: {
    type: Type.OBJECT,
    description: 'CRITICAL: execute this tool ONLY after the user has explicitly described the error details. IT IS FORBIDDEN to call this if the user has only provided the system name. You MUST wait for the user to describe the actual problem.',
    properties: {
      sistema: { type: Type.STRING, description: 'The system related to the error.' },
      problemDescription: { type: Type.STRING, description: 'The specific error description provided by the user.' },
    },
    required: ['sistema', 'problemDescription'],
  },
};

const getSystemInstruction = (userEmail: string) => `
ROL DEL AGENTE
Eres Soporte Sistemas, el asistente virtual de soporte para sistemas de gestión municipal en Chile.
Tu objetivo es recibir requerimientos y errores de los funcionarios municipales, guiarlos cordialmente y generar un reporte formal.

CONTEXTO INICIAL
El usuario ya ha ingresado su correo electrónico en el sistema. El correo es: "${userEmail}".
IMPORTANTE: NO preguntes por el correo electrónico. Ya lo tienes.

FLUJO OBLIGATORIO DE CONVERSACIÓN (NO SALTES PASOS)
1. Saluda de forma cordial y profesional como "Soporte Sistemas".
2. Solicita el nombre de la municipalidad.
3. Solicita el nombre del sistema (ej: contabilidad, bodega, adquisiciones).
   - ALERTA: Cuando el usuario diga el sistema, NO OFREZCAS SOLUCIONES TODAVÍA.
   - Solo di: "Entendido, ¿cuál es el error o requerimiento específico que presenta el sistema?"
4. Escucha la descripción del error.
   - AHORA, y solo ahora que tienes la descripción, ejecuta 'analyzeProblem'.

REGLAS DE ORO:
- PROHIBIDO ejecutar 'analyzeProblem' si solo tienes el nombre del sistema. Debes tener la descripción del error.
- PROHIBIDO inventar soluciones. Usa las herramientas.

ACCIÓN TRAS RECIBIR EL ERROR (Una vez ejecutado analyzeProblem):
1. Dile al usuario: "He generado algunas posibles soluciones que puede ver en su pantalla. Por favor intente aplicarlas."
2. Luego, informa formalmente: "De todas formas, registraremos este caso. Revisaremos el sistema y le informaremos la solución definitiva a la brevedad."
3. Finalmente, ejecuta la herramienta 'registerSupportTicket'.
4. IMPORTANTE: Cuando la herramienta confirme el registro, LEE EL NÚMERO DE TICKET generado (ej: T-12345) al usuario para que lo anote y despídete cordialmente.

Estilo de comunicación: Cortés, profesional, claro, cercano. Adaptado a funcionarios municipales. Evita tecnicismos innecesarios.
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
  public onSolutionsReady: (solutions: SolutionData) => void = () => {};
  public onError: (message: string) => void = () => {}; // New error callback
  public onClose: () => void = () => {};

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async connect(userEmail: string) {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outputNode = this.audioContext.createGain();
      outputNode.connect(this.audioContext.destination);

      // Setup Microphone with specific error handling
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      } catch (err: any) {
        let msg = "No se pudo acceder al micrófono.";
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = "Permiso de micrófono denegado. Por favor actívelo en su navegador.";
        } else if (err.name === 'NotFoundError') {
          msg = "No se encontró ningún dispositivo de micrófono.";
        } else if (err.name === 'NotReadableError') {
          msg = "El micrófono está siendo usado por otra aplicación.";
        }
        this.onError(msg);
        throw err;
      }
      
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
          tools: [{ functionDeclarations: [registerTicketTool, analyzeProblemTool] }],
          speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
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
                
                // 1. Tool: Analyze Problem (Intermediate - Show Tips)
                if (fc.name === 'analyzeProblem') {
                  const args = fc.args as any;
                  console.log("Analyzing problem:", args);

                  // Send immediate response so audio conversation continues smoothly
                  sessionPromise.then(session => session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: { result: "Solutions generated and displayed on screen." }
                    }
                  }));

                  // Async: Generate tips using Flash model
                  this.generateTroubleshootingTips(args.sistema, args.problemDescription);
                }

                // 2. Tool: Register Ticket (Final Step)
                else if (fc.name === 'registerSupportTicket') {
                  const args = fc.args as any;
                  const timestamp = new Date().toISOString();
                  const ticketId = 'T-' + Math.floor(10000 + Math.random() * 90000);

                  const uiTicket: TicketData = {
                    correo: args.correo || '',
                    municipalidad: args.municipalidad || '',
                    sistema: args.sistema || '',
                    descripcion: args.descripcion || '',
                    timestamp: timestamp,
                    ticketId: ticketId
                  };
                  
                  this.onTicketCreated(uiTicket);
                  
                  // Async: Generate Email
                  this.generateEmailDraft(uiTicket, fc.id, fc.name, sessionPromise);
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
            }
          },
          onclose: () => {
            this.disconnect();
            this.onClose();
          },
          onerror: (err) => {
            console.error("Gemini Error:", err);
            this.onError("Error de conexión con el servidor de IA. Verifique su red.");
            this.disconnect();
            this.onClose();
          }
        }
      });

      this.cleanupFunctions.push(() => {
          sessionPromise.then(s => s.close());
      });

    } catch (error: any) {
       console.error("Connection setup failed:", error);
       if (!this.stream) {
          // If stream is null, error likely happened in getUserMedia and onError was already called with specific msg
       } else {
          this.onError(error.message || "No se pudo iniciar la sesión.");
       }
       this.disconnect();
       this.onClose(); // Ensure UI resets
    }
  }

  async generateTroubleshootingTips(system: string, description: string) {
    try {
      const prompt = `
        Genera 3 consejos de solución de problemas cortos y simples para un usuario municipal con el siguiente problema:
        Sistema: ${system}
        Error: ${description}
        
        Devuelve SOLO las 3 soluciones en formato de lista (bullet points), sin introducción ni conclusión.
        Ejemplo:
        - Reiniciar el servicio.
        - Verificar conexión.
        - Borrar caché.
      `;
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || '';
      const steps = text.split('\n')
        .map(line => line.replace(/^[-*•]\s*/, '').trim()) // remove bullets
        .filter(line => line.length > 0)
        .slice(0, 3); // max 3

      if (steps.length > 0) {
        this.onSolutionsReady({
          title: `Posibles Soluciones: ${system}`,
          steps: steps
        });
      }
    } catch (e) {
      console.error("Error generating tips", e);
    }
  }

  async generateEmailDraft(uiTicket: TicketData, toolId: string, toolName: string, sessionPromise: Promise<any>) {
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
      const subjectMatch = fullText.match(/^Asunto:\s*(.*)/i);
      let subject = `Ticket ${uiTicket.ticketId} - Soporte ${uiTicket.municipalidad}`;
      let body = fullText;

      if (subjectMatch) {
        subject = subjectMatch[1].trim();
        body = fullText.replace(/^Asunto:.*\n+/i, '').trim();
      }

      this.onEmailReady({ subject, body });

      sessionPromise.then(session => session.sendToolResponse({
        functionResponses: {
          id: toolId,
          name: toolName,
          response: { result: `Ticket registrado exitosamente. ID del Ticket: ${uiTicket.ticketId}. Borrador de correo generado.` }
        }
      }));

    } catch (error) {
      console.error('Error generating email content:', error);
      sessionPromise.then(session => session.sendToolResponse({
        functionResponses: {
          id: toolId,
          name: toolName,
          response: { result: `Error generando borrador, pero el ticket ${uiTicket.ticketId} fue registrado.` }
        }
      }));
    }
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