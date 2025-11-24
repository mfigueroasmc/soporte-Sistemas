import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Server, FileText, CheckCircle, Radio, Mail, Ticket, Send } from 'lucide-react';
import { LiveManager } from './services/liveManager';
import Visualizer from './components/Visualizer';
import { TicketData, ConnectionState, EmailDraft } from './types';

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [volume, setVolume] = useState(0);
  const [latestTicket, setLatestTicket] = useState<TicketData | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [email, setEmail] = useState('');
  const liveManagerRef = useRef<LiveManager | null>(null);

  const handleConnect = async () => {
    if (!email) return;
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setLatestTicket(null);
      setEmailDraft(null);
      
      const manager = new LiveManager();
      liveManagerRef.current = manager;

      manager.onVolumeChange = (vol) => setVolume(vol);
      manager.onTicketCreated = (ticket) => setLatestTicket(ticket);
      manager.onEmailReady = (draft) => setEmailDraft(draft);
      manager.onClose = () => {
        setConnectionState(ConnectionState.DISCONNECTED);
        setVolume(0);
      };

      await manager.connect(email);
      setConnectionState(ConnectionState.CONNECTED);
    } catch (e) {
      console.error(e);
      setConnectionState(ConnectionState.ERROR);
      // Reset after a moment
      setTimeout(() => setConnectionState(ConnectionState.DISCONNECTED), 3000);
    }
  };

  const disconnectSession = () => {
    if (liveManagerRef.current) {
      liveManagerRef.current.disconnect();
      liveManagerRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
    setVolume(0);
  };

  const handleStop = () => {
    disconnectSession();
    if (emailDraft) {
        // Trigger mailto when user stops the call
        const mailtoLink = `mailto:soporte@sistemas.cl?subject=${encodeURIComponent(emailDraft.subject)}&body=${encodeURIComponent(emailDraft.body)}`;
        window.location.href = mailtoLink;
        setEmailDraft(null);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (liveManagerRef.current) {
        liveManagerRef.current.disconnect();
      }
    };
  }, []);

  const isInputDisabled = connectionState !== ConnectionState.DISCONNECTED && connectionState !== ConnectionState.ERROR;

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Server className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Soporte Sistemas</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Asistente Municipal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
            {connectionState === ConnectionState.CONNECTED && (
               <span className="flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full border border-green-200 animate-pulse">
                 <div className="w-2 h-2 rounded-full bg-green-600"></div>
                 EN VIVO
               </span>
            )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* Left Panel: Interaction */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 relative">
            
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>

            <div className="z-10 w-full max-w-md flex flex-col items-center">
              
              <div className="mb-6 relative">
                 {/* Visualizer Container */}
                 <div className="relative w-72 h-72 flex items-center justify-center">
                     <Visualizer 
                        isActive={connectionState === ConnectionState.CONNECTED} 
                        volume={volume} 
                     />
                     {/* Static Icon overlay when inactive */}
                     {connectionState !== ConnectionState.CONNECTED && (
                         <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <Radio className="w-24 h-24 text-slate-300" />
                         </div>
                     )}
                 </div>
              </div>

              {/* Email Input Section */}
              <div className="w-full mb-6">
                 <label htmlFor="email-input" className="block text-sm font-semibold text-slate-600 mb-2 pl-1">
                   Correo Institucional
                 </label>
                 <div className="relative">
                   <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                     <Mail className={`h-5 w-5 ${email ? 'text-blue-500' : 'text-slate-400'}`} />
                   </div>
                   <input
                     id="email-input"
                     type="email"
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     disabled={isInputDisabled}
                     placeholder="nombre@municipalidad.cl"
                     className={`
                       block w-full pl-10 pr-3 py-3 rounded-lg border 
                       ${isInputDisabled ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'} 
                       shadow-sm transition-all sm:text-sm
                     `}
                   />
                 </div>
                 {!email && connectionState === ConnectionState.DISCONNECTED && (
                   <p className="text-xs text-slate-400 mt-2 pl-1">* Ingrese su correo para comenzar</p>
                 )}
              </div>

              {/* Status Message */}
              <div className="h-6 mb-4 text-center">
                {connectionState === ConnectionState.CONNECTING && (
                  <p className="text-blue-600 font-medium animate-bounce">Conectando con el servidor...</p>
                )}
                {connectionState === ConnectionState.ERROR && (
                   <p className="text-red-500 font-medium">Error de conexión. Inténtelo de nuevo.</p>
                )}
                {connectionState === ConnectionState.CONNECTED && (
                    <p className="text-slate-600 font-medium">
                        {emailDraft ? "Borrador de correo listo. Finalice para enviar." : "Escuchando..."}
                    </p>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-4">
                {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
                   <button 
                     onClick={handleConnect}
                     disabled={!email}
                     className={`
                       flex items-center gap-3 px-8 py-4 rounded-full font-semibold text-lg shadow-lg transition-all transform 
                       ${!email 
                         ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                         : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white hover:shadow-xl hover:-translate-y-1'}
                     `}
                   >
                     <Mic className="w-6 h-6" />
                     <span>Iniciar Asistente</span>
                   </button>
                ) : (
                  <button 
                    onClick={handleStop}
                    className={`
                      flex items-center gap-3 px-8 py-4 rounded-full font-semibold text-lg shadow-lg hover:shadow-xl transition-all
                      ${emailDraft ? 'bg-green-600 hover:bg-green-700 active:bg-green-800' : 'bg-red-500 hover:bg-red-600 active:bg-red-700'} 
                      text-white
                    `}
                    disabled={connectionState === ConnectionState.CONNECTING}
                  >
                    {emailDraft ? <Send className="w-5 h-5" /> : <Square className="w-5 h-5 fill-current" />}
                    <span>{emailDraft ? 'Finalizar y Enviar' : 'Finalizar'}</span>
                  </button>
                )}
              </div>
            </div>
        </div>

        {/* Right Panel: Data Output */}
        <div className={`
          flex-col border-t md:border-t-0 md:border-l border-slate-200 bg-white w-full md:w-96 transition-all duration-300 ease-in-out
          ${latestTicket ? 'flex' : 'hidden md:flex'}
        `}>
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Último Ticket Generado
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!latestTicket ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center space-y-4">
                 <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                    <FileText className="w-8 h-8 text-slate-300" />
                 </div>
                 <p className="text-sm max-w-[200px]">La información capturada durante la llamada aparecerá aquí.</p>
              </div>
            ) : (
              <div className="space-y-6 animate-fade-in-up">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                   <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                   <div>
                     <h3 className="font-semibold text-green-800 text-sm">Información Capturada</h3>
                     <p className="text-green-700 text-xs mt-1">
                        Ticket ID: <span className="font-bold text-green-800">{latestTicket.ticketId}</span>
                     </p>
                     {emailDraft && (
                        <p className="text-green-600 text-[10px] mt-1 italic">
                          Borrador de correo listo para enviar
                        </p>
                     )}
                   </div>
                </div>

                <div className="space-y-4">
                  
                  {latestTicket.ticketId && (
                    <div className="group">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1 flex items-center gap-1">
                        <Ticket className="w-3 h-3" /> N° Ticket
                      </label>
                      <div className="text-slate-800 text-2xl font-bold border-b border-slate-100 pb-2">
                        {latestTicket.ticketId}
                      </div>
                    </div>
                  )}

                  <div className="group">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Municipalidad</label>
                    <div className="text-slate-800 text-lg font-medium border-b border-slate-100 pb-1">{latestTicket.municipalidad}</div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Sistema Afectado</label>
                    <div className="text-slate-800 font-medium border-b border-slate-100 pb-1">{latestTicket.sistema}</div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Solicitante</label>
                    <div className="text-blue-600 font-medium border-b border-slate-100 pb-1">{latestTicket.correo}</div>
                  </div>

                  <div className="group">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Descripción</label>
                    <div className="text-slate-600 bg-slate-50 p-3 rounded-lg text-sm leading-relaxed border border-slate-100">
                      {latestTicket.descripcion}
                    </div>
                  </div>
                  
                  <div className="pt-4 text-right">
                     <span className="text-xs text-slate-400">Generado: {new Date(latestTicket.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

export default App;