import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const draw = () => {
      if (!isActive) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw a dormant state
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, 20, 0, Math.PI * 2);
        ctx.fillStyle = '#94a3b8'; // slate-400
        ctx.fill();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Dynamic base radius based on volume
      const baseRadius = 30 + (volume * 50); 

      // Draw multiple rings
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const offset = (i * 20) + (Math.sin(time + i) * 5);
        const radius = baseRadius + offset;
        const opacity = Math.max(0, 0.6 - (i * 0.2) - (volume * 0.1));
        
        ctx.arc(centerX, centerY, Math.max(0, radius), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(37, 99, 235, ${opacity})`; // blue-600
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Center core
      ctx.beginPath();
      ctx.arc(centerX, centerY, 25 + (volume * 10), 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb'; // blue-600
      ctx.fill();

      time += 0.1;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isActive, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={300} 
      className="w-64 h-64 md:w-80 md:h-80 mx-auto"
    />
  );
};

export default Visualizer;