import fs from 'fs/promises';
import path from 'path';
import * as llamaindex from './llamaindex.js';

/**
 * Parse and index a document into LlamaIndex
 * @param filePath - Path to the uploaded file
 * @param fileName - Original filename
 * @param fileType - File type (pdf, txt, md, json)
 * @param agentConfigId - Agent config ID for filtering
 * @param documentId - Knowledge base document ID
 * @returns Number of chunks created
 */
export async function indexDocument(
  filePath: string,
  fileName: string,
  fileType: string,
  agentConfigId: string,
  documentId: string
): Promise<number> {
  console.log(`[KnowledgeBase] Indexing document: ${fileName} (${fileType})`);

  try {
    // Index with LlamaIndex (handles parsing, chunking, and embedding)
    const chunkCount = await llamaindex.indexDocument(
      filePath,
      fileName,
      fileType,
      agentConfigId,
      documentId
    );

    console.log(`[KnowledgeBase] Document indexed successfully with ${chunkCount} chunks`);

    return chunkCount;
  } catch (error) {
    console.error(`[KnowledgeBase] Error indexing document:`, error);
    throw error;
  }
}

/**
 * Query the knowledge base for an agent using LlamaIndex
 * @param query - Search query
 * @param agentConfigId - Agent config ID
 * @param topK - Number of results to return
 * @returns Array of relevant text chunks
 */
export async function queryKnowledgeBase(
  query: string,
  agentConfigId: string,
  topK: number = 3
): Promise<Array<{ text: string; score: number; metadata: any }>> {
  console.log(`[KnowledgeBase] Querying LlamaIndex for agent ${agentConfigId}: "${query}"`);

  try {
    // Query LlamaIndex for relevant chunks
    const results = await llamaindex.queryKnowledgeBase(
      query,
      agentConfigId,
      topK
    );

    console.log(`[KnowledgeBase] Found ${results.length} relevant chunks`);

    return results;
  } catch (error) {
    console.error(`[KnowledgeBase] Error querying knowledge base:`, error);
    return [];
  }
}

/**
 * Delete document from LlamaIndex
 * @param agentConfigId - Agent config ID
 * @param documentId - Knowledge base document ID
 * @param fileName - Document filename
 */
export async function deleteDocumentEmbeddings(
  agentConfigId: string,
  documentId: string,
  fileName: string
): Promise<void> {
  console.log(`[KnowledgeBase] Deleting document from LlamaIndex: ${documentId}/${fileName}`);

  try {
    await llamaindex.deleteDocumentEmbeddings(agentConfigId, documentId, fileName);
    console.log(`[KnowledgeBase] Document deleted from LlamaIndex`);
  } catch (error) {
    console.error(`[KnowledgeBase] Error deleting document:`, error);
    throw error;
  }
}
