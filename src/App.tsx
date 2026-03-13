import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { floatTo16BitPCM, base64ToFloat32Array, downsampleTo16kHz, arrayBufferToBase64 } from './utils/audio-utils';
import { Mic, Video, User, Users, Play, Square, ShieldAlert, Brain, ChevronLeft, Activity, Eye, Radio, Bot } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const calculateSuspicion = (transcript: string): number => {
  const t = transcript.toLowerCase();
  let score = 15;
  const highRaise = ['inconsisten', 'plot hole', "doesn't add up", 'contradict', 'red flag', 'caught', 'gave yourself away', 'micro-expression', 'suspicious', "don't believe", 'fabricat', 'skeptical', "something's off", 'not buying', 'i suspect', 'you\'re lying', 'that\'s a lie'];
  const medRaise = ['i noticed', 'hesitat', 'you paused', 'your voice', 'tell me again', 'earlier you said', 'you changed', 'question 4', 'question 5', 'are you sure', 'really?', 'blinking', 'avoid eye', 'that\'s interesting'];
  const lower = ['consistent', 'believable', 'genuine', 'authentic', 'plausible', 'makes sense', 'very convincing', 'seems honest', 'question 1', 'question 2'];
  highRaise.forEach(s => { if (t.includes(s)) score += 12; });
  medRaise.forEach(s => { if (t.includes(s)) score += 5; });
  lower.forEach(s => { if (t.includes(s)) score -= 6; });
  return Math.max(5, Math.min(95, score));
};

let uiAudioCtx: AudioContext | null = null;

const playHoverSound = (type: 'human' | 'robot') => {
  try {
    if (!uiAudioCtx) {
      uiAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (uiAudioCtx.state === 'suspended') {
      uiAudioCtx.resume();
    }
    
    const osc = uiAudioCtx.createOscillator();
    const gain = uiAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(uiAudioCtx.destination);
    
    const now = uiAudioCtx.currentTime;
    
    if (type === 'human') {
      // Warm, smooth sound (like a friendly "hmm")
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.1); // E4
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      // Robotic, sharp sound (beep-boop)
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.setValueAtTime(1318.51, now + 0.1); // E6
      osc.frequency.setValueAtTime(1046.50, now + 0.2); // C6
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.setValueAtTime(0, now + 0.3);
      
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

export default function App() {
  const [gameState, setGameState] = useState<'setup' | 'mode-select' | 'player-select' | 'topic' | 'live' | 'verdict' | 'disclaimer'>('mode-select');
  const [introStage, setIntroStage] = useState<'initial' | 'ready' | 'fading' | 'done'>('initial');
  const [gameMode, setGameMode] = useState<'detective' | 'storyteller'>('detective');
  const [isTrue, setIsTrue] = useState<boolean | null>(null);
  const [aiStoryTruth, setAiStoryTruth] = useState<boolean>(false);
  const [gameResult, setGameResult] = useState<'win' | 'loss' | null>(null);
  const [topic, setTopic] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const isConnectedRef = useRef(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [numPlayers, setNumPlayers] = useState(1);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [revealText, setRevealText] = useState<string | null>(null);
  const [trueStoryDetails, setTrueStoryDetails] = useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [suspicionLevel, setSuspicionLevel] = useState(15);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [cardImage, setCardImage] = useState<string | null>(null);
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const [userVerdictSelected, setUserVerdictSelected] = useState<boolean | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const activeSessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const aiTurnCountRef = useRef(0);
  const aiStoryTextRef = useRef("");
  const gameEndedRef = useRef(false);
  const detectiveTranscriptRef = useRef("");
  const verdictPhaseRef = useRef(false);
  const userVerdictTextRef = useRef("");
  const verdictPhaseTurnCountRef = useRef(0);
  const speechRecognitionRef = useRef<any>(null);
  const faceCamRef = useRef<HTMLVideoElement>(null);
  const faceCamStreamRef = useRef<MediaStream | null>(null);
  const userVerdictRef = useRef<boolean | null>(null);

  const startSetup = async (truth: boolean) => {
    setIsTrue(truth);
    if (!truth) {
      setGameState('topic');
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Give me a single vivid, specific, and unusual scenario for someone to fabricate a convincing lie about. Make it interesting and memorable — avoid boring generic everyday situations. It should be plausible but surprising. Examples of the quality I want: 'I accidentally sat next to a serial killer on a long-haul flight and didn't find out until we landed', 'I was mistaken for a famous chef at a Michelin-star restaurant and had to bluff my way through', 'I found a bag of cash buried under the floorboards when renovating my apartment'. Output ONLY the scenario sentence, nothing else."
        });
        setTopic(response.text || "I found a wallet on the street.");
      } catch (e) {
        console.error(e);
        setTopic("A mysterious encounter in a library.");
      }
    } else {
      setGameState('disclaimer');
    }
  };

  const startAiStoryMode = () => {
    setGameMode('storyteller');
    setAiStoryTruth(Math.random() < 0.5);
    setGameState('player-select');
  };

  const startGameWithPlayers = (count: number) => {
    setNumPlayers(count);
    setGameState('live');
    startLiveSession(count);
  };

  const startLiveSession = async (manualPlayerCount?: number | any) => {
    if (isConnecting || isConnected) return;
    setIsConnecting(true);
    setGameResult(null);
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    
    // Reset turn state
    aiTurnCountRef.current = 0;
    setCurrentPlayer(1);
    setRevealText(null);
    aiStoryTextRef.current = "";
    gameEndedRef.current = false;
    detectiveTranscriptRef.current = "";
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
    verdictPhaseRef.current = false;
    userVerdictTextRef.current = "";
    verdictPhaseTurnCountRef.current = 0;
    userVerdictRef.current = null;
    setUserVerdictSelected(null);
    setSuspicionLevel(15);
    setPendingConfirmation(false);
    setCardImage(null);
    setIsGeneratingCard(false);
    setShowFaceCapture(false);
    setTrueStoryDetails(null);
    setIsLoadingDetails(false);

    try {
      const constraints = { audio: true, video: gameMode === 'detective' };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      
      if (gameMode === 'detective' && videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const detectiveInstruction = `You are a highly sophisticated and perceptive human lie detector playing a friendly but competitive game.
          
          OBJECTIVE: Chat with the user and figure out if their story is True or False. You must be extremely thorough and smart in your analysis.

          CRITICAL INSTRUCTION: You are analyzing a LIVE VIDEO and AUDIO FEED. You must look for subtle cues that others might miss.

          1. ESTABLISHING A BASELINE:
             - The user has been instructed to start with a NEUTRAL expression. Use the first few seconds to establish this baseline.
             - Look for SUDDEN CHANGES from this neutral state. Sudden smiles, frowns, eye shifts, or muscle tension are major red flags.

          2. VISUAL OBSERVATION (EXPRESSIONS):
             - Be honest and thorough about what you see.
             - Look for micro-expressions that "give it away" - a flash of fear, guilt, or delight (duping delight).
             - Monitor eye contact, blinking rate, and facial symmetry.

          3. VOICE & SPEECH ANALYSIS:
             - Listen carefully to "the way they talk".
             - Look for voice changes: pitch shifts, sudden stuttering, or changes in talking speed.
             - Note if they become unusually formal or if their tone doesn't match the story's emotional content.

          4. CONTENT ANALYSIS (PLOT HOLES & INCONSISTENCIES):
             - Be extremely smart about the story's logic.
             - Actively look for plot holes and inconsistencies. If a detail contradicts a previous one, or if it's physically impossible, call it out.

          LIE SPOTTING SIGNS:
          1. Too Perfect: Is the story too rehearsed?
          2. TMI: Are they adding unnecessary details to sound more convincing?
          3. Sensory Gaps: Is the story missing smells, sounds, or specific feelings?
          4. Emotional Mismatch: Are they smiling while describing something stressful?

          GAMEPLAY:
          1. START: Greet the user and ask them to tell their story.
          2. LISTEN: Hear the story. Watch their face and listen to their voice intently.
          3. PROACTIVE QUESTIONING: When they pause or finish, jump in immediately with a sharp question.
          4. QUESTIONING (Strictly 5 Questions):
             - Ask EXACTLY ONE question per turn.
             - Start each question with "Question [N]/5:".
             - Mention a specific observation: "I noticed your voice pitched up when you mentioned the park..." or "You looked away when I asked about the time..."
             - Dig into potential plot holes or sensory details.
             - Naturally work in questions that extract verifiable specifics: exact location (city, neighborhood, venue name), dates or times, names of people or businesses, or public events mentioned. These help expose fabrications. Do NOT make every question about location — mix in emotional, sensory, and logical probes too.
          5. THE GUESS:
             - After Question 5/5, your NEXT response MUST be the verdict.
             - Say "VERDICT: TRUE" or "VERDICT: FALSE".
             - Provide a thorough explanation based on visual, vocal, and logical analysis.

          Be sharp, be thorough, and don't let any inconsistency slip by.`;

      const categories = [
        "Ancient Civilizations", "Modern Technology", "Animal Behavior", 
        "Space Exploration", "Medical History", "Art Heists", 
        "Extreme Weather", "Culinary History", "Sports Scandals", 
        "Maritime Mysteries", "The Victorian Era", "Cold War Espionage",
        "Botany", "Psychology Experiments", "Architecture", "Unsolved Mysteries",
        "Accidental Inventions", "Bizarre Laws", "Cryptids", "Famous Imposters"
      ];
      const randomCategory = categories[Math.floor(Math.random() * categories.length)];

      const activePlayerCount = typeof manualPlayerCount === 'number' ? manualPlayerCount : numPlayers;

      const storytellerInstruction = `You are the Storyteller in a Truth or Lie game. 
      
      OBJECTIVE: Tell a story about ${randomCategory} and let the user guess if it is TRUE or FALSE.
      
      PLAYERS: There are ${activePlayerCount} players in this game.
      
      CRITICAL START INSTRUCTION:
      - DO NOT wait for any user input before starting. Begin immediately.
      - DO NOT reply with "Okay", "Sure", or "Hello" to any opening noises.
      - Your VERY FIRST output MUST be the story itself — no preamble.
      - Once the story is told, ALWAYS respond to player questions. Never skip or ignore a player's question.
      
      1. SETUP: You MUST tell a ${aiStoryTruth ? 'TRUE' : 'FALSE'} story about ${randomCategory}.
         - If TRUE: Use a real, interesting fact or event. Be accurate.
         - If FALSE: Invent a plausible but fake story. Make it sound convincing.
      
      2. TELLING: Start immediately by saying "I have a story for you about ${randomCategory}." and then tell the story clearly and engagingly.
         - After telling the story, say: "Player 1, what is your question?"
      
      3. INTERACTION:
         - You will answer exactly ONE question per player, in order.
         - Answer their questions consistently with your story.
         - Keep answers concise.
         - The exact sequence you MUST follow:
         ${Array.from({length: activePlayerCount}, (_, i) => {
           const n = i + 1;
           return n < activePlayerCount
             ? `Step ${n}: Answer Player ${n}'s question, then say "Player ${n+1}, what is your question?"`
             : `Step ${n}: Answer Player ${n}'s question, then ask "So, what is the group's verdict? True or False?"`;
         }).join('\n         ')}

      4. THE VERDICT:
         - After completing all ${activePlayerCount} steps above, wait for the group's answer (True or False).
         - DO NOT ask any more player questions after Step ${activePlayerCount}.
      
      5. REVEAL: After they give their verdict (True or False), you must evaluate it.
         - If they guessed correctly, say "You guessed correctly!"
         - If they guessed incorrectly, say "You guessed incorrectly!"
         - If the story was TRUE, briefly explain the real historical event or fact.
         - If the story was FALSE, just gloat playfully.`;

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            isConnectedRef.current = true;
            setIsConnecting(false);
            console.log("Connected to Gemini Live");
            
            // Store active session for direct access
            sessionPromise.then(session => {
                activeSessionRef.current = session;
            });
            
            // Start audio capture
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (!isConnectedRef.current || !activeSessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const sampleRate = audioContextRef.current!.sampleRate;
              const downsampledData = downsampleTo16kHz(inputData, sampleRate);
              const pcmData = floatTo16BitPCM(downsampledData);
              const base64Audio = arrayBufferToBase64(pcmData);
              try {
                activeSessionRef.current.sendRealtimeInput({
                  media: { mimeType: "audio/pcm;rate=16000", data: base64Audio }
                });
              } catch (_) {}
            };
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
            processorRef.current = processor;

            // Start video capture loop ONLY for detective mode
            if (gameMode === 'detective') {
                let lastFrameTime = 0;
                const sendFrame = (time: number) => {
                  if (videoRef.current && canvasRef.current && isConnectedRef.current) {
                    // Ensure video is ready
                    if (videoRef.current.readyState >= 2) {
                        // Throttle to ~10 FPS (every 100ms) for better temporal resolution of expressions
                        if (time - lastFrameTime >= 100) {
                            lastFrameTime = time;
                            const ctx = canvasRef.current.getContext('2d');
                            if (ctx && videoRef.current.videoWidth > 0) {
                              // Increase resolution for better emotion detection (width 480px)
                              const targetWidth = 480;
                              const scale = targetWidth / videoRef.current.videoWidth;
                              canvasRef.current.width = targetWidth;
                              canvasRef.current.height = videoRef.current.videoHeight * scale;
                              
                              ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
                              const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
                              
                              if (activeSessionRef.current) {
                                try {
                                  activeSessionRef.current.sendRealtimeInput({
                                    media: { mimeType: "image/jpeg", data: base64Image }
                                  });
                                } catch (_) {}
                              }
                            }
                        }
                    }
                  }
                  if (isConnectedRef.current) requestAnimationFrame(sendFrame);
                };
                requestAnimationFrame(sendFrame);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const audioData = base64ToFloat32Array(base64Audio);
              audioQueueRef.current.push(audioData);
              if (!isPlayingRef.current) {
                playNextAudioChunk();
              }
            }

            // Collect text parts (model turn text — present when model uses text modality)
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text) {
                  if (gameMode === 'detective') detectiveTranscriptRef.current += part.text + " ";
                  else aiStoryTextRef.current += part.text + " ";
                }
              }
            }
            if (gameMode === 'detective') {
              setSuspicionLevel(calculateSuspicion(detectiveTranscriptRef.current));
            }

            // Check for game end triggers
            const checkVerdicts = () => {
              if (gameMode === 'detective' && !gameEndedRef.current) {
                const t = detectiveTranscriptRef.current.toUpperCase();
                if (t.includes("VERDICT: TRUE")) {
                  gameEndedRef.current = true;
                  setGameResult(isTrue === true ? 'loss' : 'win');
                  handleGameEnd();
                } else if (t.includes("VERDICT: FALSE")) {
                  gameEndedRef.current = true;
                  setGameResult(isTrue === false ? 'loss' : 'win');
                  handleGameEnd();
                }
              } else if (gameMode === 'storyteller' && !gameEndedRef.current && verdictPhaseRef.current) {
                const t = aiStoryTextRef.current.toUpperCase();
                if (t.includes("YOU GUESSED CORRECTLY")) {
                  gameEndedRef.current = true;
                  setGameResult('win');
                  handleGameEnd();
                } else if (t.includes("YOU GUESSED INCORRECTLY")) {
                  gameEndedRef.current = true;
                  setGameResult('loss');
                  handleGameEnd();
                }
              }
            };
            checkVerdicts();

            // Track turns and re-check on each complete turn
            if (message.serverContent?.turnComplete) {
                checkVerdicts();
                aiTurnCountRef.current += 1;

                if (aiTurnCountRef.current <= activePlayerCount) {
                    setCurrentPlayer(aiTurnCountRef.current);
                } else {
                    setCurrentPlayer(0);
                    if (!verdictPhaseRef.current) {
                        verdictPhaseRef.current = true;
                        verdictPhaseTurnCountRef.current = 0;
                    } else if (gameMode === 'storyteller' && !gameEndedRef.current) {
                        // AI responded to user's spoken verdict
                        verdictPhaseTurnCountRef.current += 1;
                        if (verdictPhaseTurnCountRef.current >= 1) {
                            gameEndedRef.current = true;
                            if (userVerdictRef.current !== null) {
                                // User pre-selected their verdict — auto-show result
                                setGameResult(userVerdictRef.current === aiStoryTruth ? 'win' : 'loss');
                                handleGameEnd();
                            } else {
                                // Fallback if user didn't tap before speaking
                                handleGameEnd();
                                setPendingConfirmation(true);
                            }
                        }
                    }
                }
            }
          },
          onclose: () => {
            isConnectedRef.current = false;
            activeSessionRef.current = null;
            setIsConnected(false);
            setIsConnecting(false);
          },
          onerror: (error) => {
            console.error("Gemini Live Error:", error);
            isConnectedRef.current = false;
            activeSessionRef.current = null;
            setIsConnected(false);
            setIsConnecting(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          tools: gameMode === 'detective' ? [{ googleSearch: {} }] : [],
          systemInstruction: gameMode === 'detective' ? detectiveInstruction : storytellerInstruction,
        },
      });
      
      sessionRef.current = sessionPromise;

    } catch (err) {
      console.error("Error accessing media devices or connecting:", err);
    }
  };

  const playNextAudioChunk = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift()!;
    const audioCtx = audioContextRef.current!;
    // Gemini Live output is typically 24kHz
    const buffer = audioCtx.createBuffer(1, audioData.length, 24000); 
    buffer.getChannelData(0).set(audioData);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    const currentTime = audioCtx.currentTime;
    // If we've fallen behind, reset the schedule to now to avoid "catch up" glitches
    if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
    
    source.onended = () => {
      playNextAudioChunk();
    };
  };

  const closeConnection = () => {
    isConnectedRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    activeSessionRef.current = null;
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => { try { session.close(); } catch (_) {} });
      sessionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const stopLiveSession = () => {
    closeConnection();
    setGameState('mode-select');
  };

  const generateAchievementCard = async () => {
    setShowFaceCapture(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      faceCamStreamRef.current = stream;
      if (faceCamRef.current) {
        faceCamRef.current.srcObject = stream;
        faceCamRef.current.play();
      }
    } catch (_) {
      // No camera — generate without face
      setShowFaceCapture(false);
      await buildCard(null);
    }
  };

  const stopFaceCam = () => {
    if (faceCamStreamRef.current) {
      faceCamStreamRef.current.getTracks().forEach(t => t.stop());
      faceCamStreamRef.current = null;
    }
    setShowFaceCapture(false);
  };

  const capturePhotoAndGenerate = async () => {
    let faceDataUrl: string | null = null;
    if (faceCamRef.current) {
      const snap = document.createElement('canvas');
      snap.width = faceCamRef.current.videoWidth;
      snap.height = faceCamRef.current.videoHeight;
      snap.getContext('2d')!.drawImage(faceCamRef.current, 0, 0);
      faceDataUrl = snap.toDataURL('image/jpeg', 0.9);
    }
    stopFaceCam();
    await buildCard(faceDataUrl);
  };

  const buildCard = async (faceDataUrl: string | null) => {
    setIsGeneratingCard(true);
    setCardImage(null);

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;

    const draw = (faceImg?: HTMLImageElement) => {
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1200, 800);

      // Light border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.roundRect(16, 16, 1168, 768, 24);
      ctx.stroke();

      // Top gradient accent bar
      const grad = ctx.createLinearGradient(16, 16, 1184, 16);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(16, 16, 1168, 8, [8, 8, 0, 0]);
      ctx.fill();

      // Title
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 50px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Truth or Li(v)e', 600, 105);

      // Thin divider
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, 125);
      ctx.lineTo(1140, 125);
      ctx.stroke();

      // "ACHIEVEMENT UNLOCKED" label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('ACHIEVEMENT UNLOCKED', 600, 160);

      const hasFace = !!faceImg;
      const centerX = hasFace ? 820 : 600;

      // Face circle (left side)
      if (faceImg) {
        const cx = 290, cy = 430, r = 190;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        // Cover-fit the image in the circle
        const aspect = faceImg.width / faceImg.height;
        let sw = r * 2, sh = r * 2;
        if (aspect > 1) { sw = sh * aspect; } else { sh = sw / aspect; }
        ctx.drawImage(faceImg, cx - sw / 2, cy - sh / 2, sw, sh);
        ctx.restore();
        // Circle ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 5;
        ctx.stroke();
      }

      // Trophy emoji
      ctx.font = '72px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🏆', centerX, 320);

      // Main achievement text
      const achievementText = gameMode === 'detective' ? 'I FOOLED THE AI!' : 'I SPOTTED THE LIE!';
      const maxTextWidth = hasFace ? 680 : 1060;
      let fs = 68;
      ctx.font = `bold ${fs}px Arial`;
      while (ctx.measureText(achievementText).width > maxTextWidth && fs > 36) {
        fs -= 4;
        ctx.font = `bold ${fs}px Arial`;
      }
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.fillText(achievementText, centerX, 430);

      // Subtitle
      const subtitle = gameMode === 'detective'
        ? 'Outsmarted the AI lie detector'
        : `Correctly identified the ${aiStoryTruth ? 'true' : 'false'} story`;
      ctx.fillStyle = '#64748b';
      ctx.font = '28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(subtitle, centerX, 490);

      // Date bottom right
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '20px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 1150, 765);

      setCardImage(canvas.toDataURL('image/png'));
      setIsGeneratingCard(false);
    };

    if (faceDataUrl) {
      const img = new Image();
      img.onload = () => draw(img);
      img.onerror = () => draw();
      img.src = faceDataUrl;
    } else {
      draw();
    }
  };

  const downloadGeneratedCard = () => {
    if (!cardImage) return;
    const link = document.createElement('a');
    link.download = 'truth-or-live-achievement.png';
    link.href = cardImage;
    link.click();
  };

  const handleGameEnd = async () => {
    // Disconnect processor immediately so onaudioprocess stops firing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    isConnectedRef.current = false;
    activeSessionRef.current = null;
    
    if (gameMode === 'storyteller' && aiStoryTruth) {
      setIsLoadingDetails(true);
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `The following is a transcript of a true story told by an AI: "${aiStoryTextRef.current}". Please identify the real historical event, scientific fact, or phenomenon it describes, and provide a concise, factual summary (2-3 paragraphs) with real names, dates, and details.`
        });
        setTrueStoryDetails(response.text || "Could not fetch details.");
      } catch (e) {
        console.error(e);
        setTrueStoryDetails("Failed to load event details.");
      } finally {
        setIsLoadingDetails(false);
      }
    }
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [gameState]);



  useEffect(() => {
    const timer1 = setTimeout(() => setIntroStage('ready'), 1000);
    return () => {
      clearTimeout(timer1);
      stopLiveSession();
    };
  }, []);

  const handlePlayClick = () => {
    if (!uiAudioCtx) {
      uiAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (uiAudioCtx.state === 'suspended') {
      uiAudioCtx.resume();
    }
    setIntroStage('fading');
    setTimeout(() => setIntroStage('done'), 1000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      {introStage !== 'done' && (
        <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50 transition-all duration-1000 ${introStage === 'fading' ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100 scale-100'}`}>
           <h1 className="text-7xl font-black tracking-tighter text-slate-800 mb-8">Truth or Li<span className="text-blue-600">(v)</span>e</h1>
           <button 
             onClick={handlePlayClick}
             className={`bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-12 rounded-full shadow-xl shadow-blue-500/20 transition-all duration-700 transform hover:scale-105 text-xl flex items-center gap-3 ${introStage === 'ready' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}
           >
             <Play className="w-6 h-6 fill-current" />
             Play Game
           </button>
        </div>
      )}

      {/* Background Pattern */}
      <div className="fixed inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-50" />
      
      <div className={`relative z-10 p-6 max-w-5xl mx-auto transition-opacity duration-1000 ${introStage === 'initial' ? 'opacity-0' : 'opacity-100'}`}>
        <header className="flex items-center justify-center mb-12 border-b border-slate-200 pb-6 relative">
          <div className="flex items-center justify-center">
            <h1 className="text-5xl font-black tracking-tighter text-slate-800">Truth or Li<span className="text-blue-600">(v)</span>e</h1>
          </div>
        </header>

        {gameState === 'mode-select' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in zoom-in duration-500">
            <h2 className="text-3xl font-bold mb-12 text-center text-slate-800">Choose Game Mode</h2>
            <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
              <button 
                onMouseEnter={() => playHoverSound('human')}
                onClick={() => { setGameMode('detective'); setGameState('setup'); }} 
                className="group relative h-80 bg-white border border-slate-200 hover:border-blue-400 rounded-3xl p-8 transition-all hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="relative z-10 h-full flex flex-col items-center justify-center transition-all duration-500 group-hover:-translate-y-4">
                  <User className="w-16 h-16 text-black mb-6 group-hover:scale-110 transition-transform duration-500" />
                  <h3 className="text-3xl font-bold text-slate-800 mb-2">I Tell a Story</h3>
                  
                  <div className="h-0 overflow-hidden group-hover:h-auto transition-all duration-500 opacity-0 group-hover:opacity-100">
                    <p className="text-slate-500 mt-4 text-center leading-relaxed px-4">
                      You tell a story to the AI. It tries to guess if you're lying by watching your face and listening to your voice.
                    </p>
                  </div>
                </div>
              </button>

              <button 
                onMouseEnter={() => playHoverSound('robot')}
                onClick={startAiStoryMode} 
                className="group relative h-80 bg-white border border-slate-200 hover:border-purple-400 rounded-3xl p-8 transition-all hover:shadow-xl hover:shadow-purple-500/10 hover:-translate-y-1 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="relative z-10 h-full flex flex-col items-center justify-center transition-all duration-500 group-hover:-translate-y-4">
                  <Bot className="w-16 h-16 text-black mb-6 group-hover:scale-110 transition-transform duration-500" />
                  <h3 className="text-3xl font-bold text-slate-800 mb-2">AI Tells a Story</h3>
                  
                  <div className="h-0 overflow-hidden group-hover:h-auto transition-all duration-500 opacity-0 group-hover:opacity-100">
                    <p className="text-slate-500 mt-4 text-center leading-relaxed px-4">
                      The AI tells a story. You and your friends ask questions to figure out if it's true or false.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {gameState === 'setup' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in slide-in-from-right duration-300">
            <button onClick={() => setGameState('mode-select')} className="absolute top-24 left-0 flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors font-medium">
              <ChevronLeft className="w-5 h-5" /> Back
            </button>
            <h2 className="text-3xl font-bold mb-12 text-slate-800">Pick a Story Type</h2>
            <div className="flex gap-6">
              <button 
                onClick={() => startSetup(true)} 
                className="w-64 h-48 bg-white border-2 border-emerald-100 hover:border-emerald-500 hover:bg-emerald-50 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all group shadow-sm hover:shadow-md"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Activity className="w-6 h-6 text-emerald-600" />
                </div>
                <span className="text-xl font-bold text-slate-700 group-hover:text-emerald-700">True Story</span>
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Tell the truth</span>
              </button>
              <button 
                onClick={() => startSetup(false)} 
                className="w-64 h-48 bg-white border-2 border-rose-100 hover:border-rose-500 hover:bg-rose-50 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all group shadow-sm hover:shadow-md"
              >
                <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <ShieldAlert className="w-6 h-6 text-rose-600" />
                </div>
                <span className="text-xl font-bold text-slate-700 group-hover:text-rose-700">Made-up Story</span>
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Tell a lie</span>
              </button>
            </div>
          </div>
        )}

        {gameState === 'player-select' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in slide-in-from-right duration-300">
            <button onClick={() => setGameState('mode-select')} className="absolute top-24 left-0 flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors font-medium">
              <ChevronLeft className="w-5 h-5" /> Back
            </button>
            <h2 className="text-3xl font-bold mb-12 text-slate-800">How many players?</h2>
            <div className="flex gap-4">
              {[1, 2, 3, 4, 5].map((count) => (
                <button 
                  key={count}
                  onClick={() => startGameWithPlayers(count)} 
                  className="w-16 h-16 rounded-2xl bg-white border-2 border-slate-200 hover:border-purple-500 hover:bg-purple-50 hover:text-purple-700 text-slate-400 text-2xl font-bold transition-all shadow-sm hover:shadow-md"
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        )}

        {gameState === 'topic' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
            <div className="w-full max-w-2xl bg-white border border-slate-200 p-12 rounded-3xl text-center relative overflow-hidden shadow-xl shadow-slate-200/50">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 to-purple-400" />
              <h2 className="text-sm font-bold text-slate-400 mb-6 tracking-widest uppercase">Your Topic</h2>
              <p className="text-4xl font-medium leading-tight mb-10 text-slate-800">"{topic || "Generating..."}"</p>
              <button 
                onClick={() => { setGameState('disclaimer'); }} 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-full transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 hover:-translate-y-0.5 flex items-center gap-2 mx-auto"
              >
                <Video className="w-5 h-5" />
                I'm Ready
              </button>
            </div>
          </div>
        )}

        {gameState === 'disclaimer' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
            <div className="w-full max-w-2xl bg-white border border-slate-200 p-12 rounded-3xl text-center relative overflow-hidden shadow-xl shadow-slate-200/50">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-rose-400 to-orange-400" />
              <ShieldAlert className="w-16 h-16 text-rose-500 mx-auto mb-6" />
              <h2 className="text-2xl font-black text-slate-800 mb-4 uppercase tracking-tight">Crucial Instructions</h2>
              
              <div className="text-left space-y-4 mb-10">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-slate-700 font-medium">
                    <span className="text-rose-600 font-bold">1. Keep a Neutral Expression:</span> Start with a plain, neutral face. The AI uses this as a baseline to detect sudden changes that might give you away.
                  </p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-slate-700 font-medium">
                    <span className="text-blue-600 font-bold">2. Watch Your Voice:</span> The AI is listening for changes in your pitch, talking speed, and speech patterns.
                  </p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-slate-700 font-medium">
                    <span className="text-purple-600 font-bold">3. Be Consistent:</span> The AI is highly intelligent and will actively look for plot holes and logical inconsistencies in your story.
                  </p>
                </div>
              </div>

              <button 
                onClick={() => { setGameState('live'); startLiveSession(); }} 
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 px-12 rounded-full transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center gap-2 mx-auto"
              >
                <Play className="w-5 h-5 fill-current" />
                Start Analysis
              </button>
            </div>
          </div>
        )}

        {showFaceCapture && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl mx-4">
              <h2 className="text-2xl font-black text-slate-800 mb-2">Take your victory photo</h2>
              <p className="text-slate-500 mb-6">Your face will appear on the achievement card</p>
              <video
                ref={faceCamRef}
                autoPlay
                muted
                playsInline
                className="w-full rounded-2xl mb-6 bg-slate-100 transform scale-x-[-1]"
                style={{ maxHeight: '300px', objectFit: 'cover' }}
              />
              <div className="flex gap-3 justify-center">
                <button
                  onClick={capturePhotoAndGenerate}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center gap-2"
                >
                  📸 Take Photo
                </button>
                <button
                  onClick={async () => { stopFaceCam(); await buildCard(null); }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 px-6 rounded-xl transition-all"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        )}

        {gameState === 'live' && (gameResult || pendingConfirmation) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-500 overflow-y-auto p-4">
            <div className="bg-white p-8 rounded-3xl max-w-2xl w-full text-center shadow-2xl animate-in zoom-in-95 duration-300 my-auto">

              {pendingConfirmation && !gameResult ? (
                <>
                  <Brain className="w-16 h-16 text-purple-500 mx-auto mb-4" />
                  {gameMode === 'detective' ? (
                    <>
                      <h2 className="text-3xl font-black mb-2 text-slate-800">What was the AI's verdict?</h2>
                      <p className="text-slate-500 mb-8">Tap what you heard</p>
                      <div className="flex gap-4 justify-center">
                        <button onClick={() => { setGameResult(isTrue === true ? 'loss' : 'win'); setPendingConfirmation(false); }} className="bg-blue-500 hover:bg-blue-600 text-white font-black py-4 px-8 rounded-2xl text-lg transition-all hover:scale-105">
                          It said TRUE
                        </button>
                        <button onClick={() => { setGameResult(isTrue === false ? 'loss' : 'win'); setPendingConfirmation(false); }} className="bg-slate-700 hover:bg-slate-800 text-white font-black py-4 px-8 rounded-2xl text-lg transition-all hover:scale-105">
                          It said FALSE
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-3xl font-black mb-2 text-slate-800">What was your verdict?</h2>
                      <p className="text-slate-500 mb-8">Tap what you said — we'll calculate if you won</p>
                      <div className="flex gap-4 justify-center">
                        <button onClick={() => { setGameResult(aiStoryTruth ? 'win' : 'loss'); setPendingConfirmation(false); }} className="bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 px-8 rounded-2xl text-lg transition-all hover:scale-105">
                          I said TRUE
                        </button>
                        <button onClick={() => { setGameResult(!aiStoryTruth ? 'win' : 'loss'); setPendingConfirmation(false); }} className="bg-slate-700 hover:bg-slate-800 text-white font-black py-4 px-8 rounded-2xl text-lg transition-all hover:scale-105">
                          I said FALSE
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-6 ${gameResult === 'win' ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                    {gameResult === 'win' ? <Activity className="w-10 h-10 text-emerald-600" /> : <ShieldAlert className="w-10 h-10 text-rose-600" />}
                  </div>
                  <h2 className={`text-4xl font-black mb-2 ${gameResult === 'win' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {gameResult === 'win' ? 'YOU WON!' : 'YOU LOST!'}
                  </h2>
                  <p className="text-slate-600 text-lg mb-8">
                    {gameMode === 'detective'
                      ? (gameResult === 'win' ? "The AI failed to catch you!" : "The AI caught you lying (or telling the truth)!")
                      : (gameResult === 'win' ? "You spotted the truth correctly!" : "The AI fooled you!")}
                  </p>
                  {gameMode === 'storyteller' && aiStoryTruth && (
                    <div className="mb-8 text-left bg-blue-50 p-6 rounded-2xl border border-blue-100">
                      <h3 className="text-xl font-bold text-blue-800 mb-3 flex items-center gap-2">
                        <Brain className="w-5 h-5" /> The Real Story
                      </h3>
                      {isLoadingDetails ? (
                        <div className="flex items-center gap-3 text-blue-600">
                          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                          <p className="font-medium">Fetching historical records...</p>
                        </div>
                      ) : (
                        <div className="prose prose-blue prose-sm max-w-none text-slate-700">
                          {trueStoryDetails ? <ReactMarkdown>{trueStoryDetails}</ReactMarkdown> : <p>Could not load details.</p>}
                        </div>
                      )}
                    </div>
                  )}
                  {gameResult === 'win' && (
                    <div className="mb-6">
                      {isGeneratingCard ? (
                        <div className="flex items-center justify-center gap-3 text-indigo-600 py-4">
                          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                          <span className="font-medium">Generating your achievement card with Nanobanana...</span>
                        </div>
                      ) : cardImage ? (
                        <div className="space-y-3">
                          <img src={cardImage} alt="Achievement card" className="rounded-2xl shadow-lg w-full" />
                          <button
                            onClick={downloadGeneratedCard}
                            className="w-full bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center justify-center gap-2"
                          >
                            ⬇️ Download Achievement Card
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={generateAchievementCard}
                          className="w-full bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                          🏆 Generate Achievement Card
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex gap-4 justify-center flex-wrap">
                    <button
                      onClick={() => { closeConnection(); setGameResult(null); setPendingConfirmation(false); setCardImage(null); setGameState('mode-select'); }}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-8 rounded-xl transition-all"
                    >
                      Play Again
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {gameState === 'live' && (
          <div className="flex flex-col items-center w-full animate-in fade-in duration-700">
            {gameMode === 'detective' ? (
              <div className="relative w-full max-w-4xl aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-2xl shadow-slate-300/50 mb-8 ring-4 ring-white">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  muted 
                  playsInline
                  className="w-full h-full object-cover transform scale-x-[-1]" 
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Friendly Overlay */}
                <div className="absolute top-6 left-6 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-sm flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
                  <span className="text-xs font-bold text-slate-700">{isConnected ? 'LIVE CAMERA' : 'CAMERA OFF'}</span>
                </div>

                {/* Suspicion Meter */}
                {isConnected && (
                  <div className="absolute bottom-6 right-6 bg-black/75 backdrop-blur-md rounded-2xl p-4 w-48">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white text-xs font-bold uppercase tracking-wider">Suspicion</span>
                      <span className={`text-xs font-black tabular-nums ${suspicionLevel > 60 ? 'text-red-400' : suspicionLevel > 35 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {suspicionLevel}%
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${suspicionLevel}%`,
                          background: suspicionLevel > 60
                            ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                            : suspicionLevel > 35
                              ? 'linear-gradient(90deg, #22c55e, #f59e0b)'
                              : '#22c55e',
                        }}
                      />
                    </div>
                    <p className="mt-2 text-center text-xs text-white/60">
                      {suspicionLevel > 65 ? '🔴 Very Suspicious' : suspicionLevel > 35 ? '🟡 Getting Suspicious' : '🟢 Seems Innocent'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
               <div className="relative w-full max-w-4xl aspect-video bg-white rounded-3xl overflow-hidden shadow-2xl shadow-slate-200/50 mb-8 ring-4 ring-white flex flex-col items-center justify-center border border-slate-100">
                  <div className="absolute inset-0 bg-[radial-gradient(#f1f5f9_1px,transparent_1px)] [background-size:20px_20px] opacity-50" />
                  
                  <div className={`relative z-10 w-48 h-48 rounded-full bg-gradient-to-tr from-purple-100 to-blue-100 flex items-center justify-center mb-6 transition-all duration-500 ${isConnected ? 'scale-105 shadow-xl shadow-purple-200' : 'scale-100'}`}>
                      <div className={`w-40 h-40 rounded-full bg-white flex items-center justify-center ${isConnected ? 'animate-pulse' : ''}`}>
                        <Brain className={`w-20 h-20 ${isConnected ? 'text-purple-600' : 'text-slate-300'}`} />
                      </div>
                  </div>
                  
                  <p className="relative z-10 text-2xl font-medium text-slate-700">
                    {isConnected ? "AI is speaking..." : "Connecting..."}
                  </p>
                   
                   {/* Turn Indicator - Removed small one, moving to main controls area */}
               </div>
            )}

            {/* Controls & Status */}
            {!isConnected && !isConnecting ? (
              <button 
                onClick={startLiveSession} 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-12 rounded-full shadow-xl shadow-blue-500/20 transition-all transform hover:scale-105 text-lg flex items-center gap-3"
              >
                {gameMode === 'detective' ? <Video className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                {gameMode === 'detective' ? "Start Camera" : "Start Audio"}
              </button>
            ) : isConnecting ? (
              <div className="flex items-center gap-3 text-slate-500 font-medium">
                <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                Connecting...
              </div>
            ) : (
              <div className="flex flex-col items-center gap-8 w-full max-w-2xl">
                
                {/* Prominent Status/Turn Indicator */}
                <div className={`w-full p-6 rounded-3xl border-2 text-center transition-all duration-500 shadow-lg ${
                  gameMode === 'detective' 
                    ? 'bg-white border-blue-100 shadow-blue-100' 
                    : currentPlayer > 0 
                      ? 'bg-purple-50 border-purple-200 shadow-purple-100 transform scale-105' 
                      : 'bg-slate-50 border-slate-200'
                }`}>
                  {gameMode === 'detective' ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2 text-blue-600 font-bold uppercase tracking-wider text-sm">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                        AI is Analyzing
                      </div>
                      <p className="text-2xl font-bold text-slate-800">Tell your story...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                       {currentPlayer > 0 ? (
                         <>
                           <span className="text-purple-500 font-bold uppercase tracking-widest text-xs">Current Turn</span>
                           <p className="text-4xl font-black text-purple-600">Player {currentPlayer}</p>
                           <p className="text-slate-500 font-medium">Ask your question now</p>
                         </>
                       ) : (
                         <>
                           <span className="text-slate-400 font-bold uppercase tracking-widest text-xs">Your Verdict</span>
                           <p className="text-2xl font-bold text-slate-700 mb-3">Tap your answer, then say it aloud</p>
                           <div className="flex gap-3">
                             <button
                               onClick={() => { userVerdictRef.current = true; setUserVerdictSelected(true); }}
                               className={`font-black py-3 px-8 rounded-2xl text-lg transition-all border-2 ${userVerdictSelected === true ? 'bg-emerald-500 border-emerald-500 text-white scale-105' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-400'}`}
                             >
                               TRUE
                             </button>
                             <button
                               onClick={() => { userVerdictRef.current = false; setUserVerdictSelected(false); }}
                               className={`font-black py-3 px-8 rounded-2xl text-lg transition-all border-2 ${userVerdictSelected === false ? 'bg-slate-700 border-slate-700 text-white scale-105' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'}`}
                             >
                               FALSE
                             </button>
                           </div>
                         </>
                       )}
                    </div>
                  )}
                </div>

                {gameMode === 'detective' && (
                  <button
                    onClick={() => {
                      if (!gameEndedRef.current) {
                        gameEndedRef.current = true;
                        const transcript = detectiveTranscriptRef.current.toUpperCase();
                        let r: 'win' | 'loss' = 'win';
                        if (transcript.includes("VERDICT: TRUE")) {
                          r = isTrue === true ? 'loss' : 'win';
                        } else if (transcript.includes("VERDICT: FALSE")) {
                          r = isTrue === false ? 'loss' : 'win';
                        }
                        setGameResult(r);
                        handleGameEnd();
                      }
                    }}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-8 rounded-full transition-all flex items-center gap-2 text-sm"
                  >
                    <Activity className="w-4 h-4" />
                    Reveal Verdict
                  </button>
                )}


                <button
                  onClick={stopLiveSession}
                  className="bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 font-bold py-3 px-8 rounded-full transition-all flex items-center gap-2 text-sm"
                >
                  <Square className="w-4 h-4 fill-current" />
                  End Game
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
