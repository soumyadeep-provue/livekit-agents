import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  useTrackToggle,
  useVoiceAssistant,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { useCallback } from 'react';

interface VoiceRoomProps {
  token: string;
  url: string;
  agentName: string;
  onDisconnect: () => void;
}

function VoiceControls({ agentName, onDisconnect }: { agentName: string; onDisconnect: () => void }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();

  const { buttonProps: micToggleProps } = useTrackToggle({
    source: Track.Source.Microphone,
  });

  const isMuted = !localParticipant?.isMicrophoneEnabled;
  const isConnected = connectionState === ConnectionState.Connected;

  const handleDisconnect = useCallback(() => {
    room.disconnect();
    onDisconnect();
  }, [room, onDisconnect]);

  const getStatusText = () => {
    if (connectionState === ConnectionState.Connecting) {
      return 'Connecting...';
    }
    if (connectionState === ConnectionState.Reconnecting) {
      return 'Reconnecting...';
    }
    if (!isConnected) {
      return 'Disconnected';
    }
    if (voiceAssistant.audioTrack) {
      return voiceAssistant.state === 'speaking' ? 'Speaking...' : 'Listening';
    }
    return 'Waiting for agent...';
  };

  return (
    <div className="voice-room">
      <div className="voice-room-header">
        <h2>{agentName}</h2>
        <span style={{ color: 'var(--text-secondary)' }}>
          {isConnected ? 'Connected' : getStatusText()}
        </span>
      </div>

      <div className="voice-room-content">
        <div className={`agent-avatar ${voiceAssistant.state === 'speaking' ? 'speaking' : ''}`}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
            />
          </svg>
        </div>

        <div className="voice-status">
          <h2>{agentName}</h2>
          <p>{getStatusText()}</p>
        </div>

        <div className="voice-controls">
          <button
            className={`voice-btn mute ${isMuted ? 'muted' : ''}`}
            {...micToggleProps}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                />
              </svg>
            )}
          </button>

          <button className="voice-btn end-call" onClick={handleDisconnect} title="End call">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z"
              />
            </svg>
          </button>
        </div>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

export function VoiceRoom({ token, url, agentName, onDisconnect }: VoiceRoomProps) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={url}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={onDisconnect}
    >
      <VoiceControls agentName={agentName} onDisconnect={onDisconnect} />
    </LiveKitRoom>
  );
}
