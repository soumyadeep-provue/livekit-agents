import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';
import type { UpdateAgentConfigRequest } from '@studio/shared';
import { api } from '../lib/api';

interface KnowledgeBaseSettingsProps {
  userId: string;
  agentId: string;
  enableKnowledgeBase: boolean;
  onUpdate: (data: UpdateAgentConfigRequest) => Promise<void>;
}

interface Document {
  id: string;
  documentName: string;
  documentType: string;
  fileSizeBytes: number | null;
  chunkCount: number;
  createdAt: string;
}

// Error Boundary to catch rendering errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('KnowledgeBaseSettings Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1rem', color: 'red', border: '1px solid red', borderRadius: '0.5rem', margin: '1rem 0' }}>
          <h4>Knowledge Base Error</h4>
          <p>Something went wrong loading the knowledge base. Please refresh the page.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

function KnowledgeBaseSettingsInner({
  userId,
  agentId,
  enableKnowledgeBase,
  onUpdate,
}: KnowledgeBaseSettingsProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    if (!enableKnowledgeBase) {
      setDocuments([]);
      return;
    }

    if (!userId || !agentId) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await api.getKnowledgeBaseDocuments(userId, agentId);
      setDocuments(response.documents || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
      setError('Failed to load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [enableKnowledgeBase, userId, agentId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleEnableToggle = async (enabled: boolean) => {
    try {
      await onUpdate({ enableKnowledgeBase: enabled });
      if (!enabled) {
        setDocuments([]);
      }
    } catch (err) {
      console.error('Failed to toggle knowledge base:', err);
      setError('Failed to toggle knowledge base');
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/json',
    ];
    const validExtensions = ['.pdf', '.txt', '.md', '.json'];
    const isValidType = validTypes.includes(file.type) ||
                        validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!isValidType) {
      setError('Invalid file type. Only PDF, TXT, MD, and JSON files are allowed.');
      return;
    }

    // Validate file size (20MB limit)
    if (file.size > 20 * 1024 * 1024) {
      setError('File size exceeds 20MB limit');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      await api.uploadKnowledgeBaseDocument(userId, agentId, file);
      await loadDocuments();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await api.deleteKnowledgeBaseDocument(userId, agentId, documentId);
      await loadDocuments();
      setError(null);
    } catch (err) {
      console.error('Delete failed:', err);
      setError('Failed to delete document');
    }
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
      return 'Unknown';
    }
  };

  // Safety check
  if (!userId || !agentId) {
    return null;
  }

  return (
    <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
      <h3 style={{ marginBottom: '1rem' }}>Knowledge Base</h3>

      {/* Enable/Disable Toggle */}
      <div
        className="form-group"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem',
          background: 'var(--bg-tertiary)',
          borderRadius: '0.5rem',
        }}
      >
        <input
          type="checkbox"
          id="enableKnowledgeBase"
          checked={enableKnowledgeBase}
          onChange={(e) => handleEnableToggle(e.target.checked)}
          style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
        />
        <div>
          <label htmlFor="enableKnowledgeBase" style={{ cursor: 'pointer', fontWeight: 500 }}>
            Enable Knowledge Base
          </label>
          <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
            Upload documents (PDF, TXT, MD, JSON) that the agent can reference during conversations
          </small>
        </div>
      </div>

      {enableKnowledgeBase && (
        <div style={{ marginTop: '1rem' }}>
          {/* File Upload */}
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="file-upload"
              className="btn btn-primary"
              style={{
                display: 'inline-block',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? 'Uploading...' : 'Upload Document'}
            </label>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              accept=".pdf,.txt,.md,.json"
              onChange={handleFileSelect}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            <small
              style={{
                color: 'var(--text-secondary)',
                display: 'block',
                marginTop: '0.5rem',
              }}
            >
              Maximum file size: 20MB. Supported formats: PDF, TXT, MD, JSON
            </small>
          </div>

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgb(239, 68, 68)',
                borderRadius: '0.5rem',
                color: 'rgb(239, 68, 68)',
                marginBottom: '1rem',
              }}
            >
              {error}
            </div>
          )}

          {/* Documents List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              Loading documents...
            </div>
          ) : documents.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '0.5rem',
                color: 'var(--text-secondary)',
              }}
            >
              No documents uploaded yet. Upload a document to get started.
            </div>
          ) : (
            <div>
              <h4 style={{ marginBottom: '0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>
                Uploaded Documents ({documents.length})
              </h4>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '500px',
                overflowY: 'auto'
              }}>
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                        {doc.documentName || 'Unknown Document'}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          gap: '1rem',
                        }}
                      >
                        <span>Type: {doc.documentType?.toUpperCase() || 'UNKNOWN'}</span>
                        <span>Size: {formatFileSize(doc.fileSizeBytes)}</span>
                        <span>Chunks: {doc.chunkCount ?? 0}</span>
                        <span>Uploaded: {formatDate(doc.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(doc.id)}
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Export with error boundary
export function KnowledgeBaseSettings(props: KnowledgeBaseSettingsProps) {
  return (
    <ErrorBoundary>
      <KnowledgeBaseSettingsInner {...props} />
    </ErrorBoundary>
  );
}
