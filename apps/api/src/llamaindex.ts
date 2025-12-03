/**
 * LlamaCloud integration for document RAG
 * Uses LlamaCloud managed pipelines for indexing and retrieval
 * Docs: https://developers.llamaindex.ai/typescript/cloud/llamacloud/guides/api_sdk/
 */

import {
  uploadFileApiV1FilesPost,
  upsertPipelineApiV1PipelinesPut,
  addFilesToPipelineApiApiV1PipelinesPipelineIdFilesPut,
  runSearchApiV1PipelinesPipelineIdRetrievePost,
  getPipelineApiV1PipelinesPipelineIdGet,
} from 'llama-cloud-services/api';
import { Blob } from 'buffer';
import fs from 'fs/promises';

const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY;
const LLAMA_CLOUD_PROJECT_ID = process.env.LLAMA_CLOUD_PROJECT_ID; // We'll need to set this

if (!LLAMA_CLOUD_API_KEY) {
  console.error('[LlamaCloud] ERROR: LLAMA_CLOUD_API_KEY not set.');
  throw new Error('LLAMA_CLOUD_API_KEY is required');
}

if (!LLAMA_CLOUD_PROJECT_ID) {
  console.error('[LlamaCloud] ERROR: LLAMA_CLOUD_PROJECT_ID not set. Please get your project ID from https://cloud.llamaindex.ai');
  throw new Error('LLAMA_CLOUD_PROJECT_ID is required');
}

/**
 * Get pipeline name for an agent
 */
function getPipelineName(agentConfigId: string): string {
  return `agent-${agentConfigId}`;
}

// Store pipeline IDs in memory
const pipelineCache: Map<string, string> = new Map();

/**
 * Get or create a pipeline for an agent
 */
async function getOrCreatePipeline(agentConfigId: string): Promise<string> {
  const pipelineName = getPipelineName(agentConfigId);
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for LlamaCloud embeddings');
  }

  // Check cache first
  if (pipelineCache.has(pipelineName)) {
    return pipelineCache.get(pipelineName)!;
  }

  console.log(`[LlamaCloud] Getting/creating pipeline: ${pipelineName}`);

  try {
    // Try to create/update pipeline (upsert)
    const pipeline = await upsertPipelineApiV1PipelinesPut({
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
      query: {
        project_id: LLAMA_CLOUD_PROJECT_ID!,
      },
      body: {
        name: pipelineName,
        embedding_config: {
          type: 'OPENAI_EMBEDDING',
          component: {
            model_name: 'text-embedding-3-small',
            api_key: OPENAI_API_KEY,
          },
        },
        transform_config: {
          mode: 'auto',
          config_dict: {},
        },
      },
    });

    console.log('[LlamaCloud] Pipeline API response:', JSON.stringify(pipeline, null, 2));

    const pipelineId = pipeline.data?.id;
    if (!pipelineId) {
      console.error('[LlamaCloud] No pipeline ID in response. Full response:', pipeline);
      throw new Error('Failed to create/get pipeline - no ID returned');
    }

    console.log(`[LlamaCloud] Pipeline ready: ${pipelineName} (ID: ${pipelineId})`);
    pipelineCache.set(pipelineName, pipelineId);
    return pipelineId;
  } catch (error) {
    console.error(`[LlamaCloud] Error creating/getting pipeline:`, error);
    if (error instanceof Error) {
      console.error(`[LlamaCloud] Error details:`, {
        message: error.message,
        stack: error.stack,
        ...error,
      });
    }
    throw error;
  }
}

/**
 * Index a document into LlamaCloud
 * @param filePath - Path to the uploaded file
 * @param fileName - Original filename
 * @param fileType - File type (pdf, txt, md, json)
 * @param agentConfigId - Agent config ID
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
  const pipelineName = getPipelineName(agentConfigId);
  console.log(`[LlamaCloud] Indexing document: ${fileName} (${fileType}) into pipeline: ${pipelineName}`);

  try {
    // Get or create pipeline for this agent
    const pipelineId = await getOrCreatePipeline(agentConfigId);

    // Read file content
    const fileContent = await fs.readFile(filePath);
    console.log(`[LlamaCloud] Document size: ${fileContent.length} bytes`);

    // Create a blob from the file content
    const fileBlob = new Blob([fileContent]);

    // Upload file to LlamaCloud
    console.log(`[LlamaCloud] Uploading file to LlamaCloud...`);
    const uploadResult = await uploadFileApiV1FilesPost({
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
      query: {
        project_id: LLAMA_CLOUD_PROJECT_ID!,
      },
      body: {
        upload_file: fileBlob,
      },
    });

    const fileId = uploadResult.data?.id;
    if (!fileId) {
      throw new Error('Failed to upload file - no ID returned');
    }

    console.log(`[LlamaCloud] File uploaded successfully (ID: ${fileId})`);

    // Add file to pipeline
    console.log(`[LlamaCloud] Adding file to pipeline...`);
    await addFilesToPipelineApiApiV1PipelinesPipelineIdFilesPut({
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
      path: {
        pipeline_id: pipelineId,
      },
      body: [
        {
          file_id: fileId,
          custom_metadata: {
            fileName,
            fileType,
            documentId,
            agentConfigId,
            uploadedAt: new Date().toISOString(),
          },
        },
      ],
    });

    console.log(`[LlamaCloud] Document indexed successfully in pipeline: ${pipelineName}`);

    // Estimate chunk count (LlamaIndex default chunk size is ~1024 chars)
    const estimatedChunks = Math.max(1, Math.ceil(fileContent.length / 1024));
    return estimatedChunks;
  } catch (error) {
    console.error(`[LlamaCloud] Error indexing document:`, error);
    throw error;
  }
}

/**
 * Query the knowledge base for an agent using LlamaCloud
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
  const pipelineName = getPipelineName(agentConfigId);
  console.log(`[LlamaCloud] Querying pipeline ${pipelineName}: "${query}"`);

  try {
    // Get pipeline ID
    const pipelineId = await getOrCreatePipeline(agentConfigId);

    // Query the pipeline
    const response = await runSearchApiV1PipelinesPipelineIdRetrievePost({
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
      path: {
        pipeline_id: pipelineId,
      },
      body: {
        query,
        similarity_top_k: topK,
      },
    });

    console.log(`[LlamaCloud] Query completed`);

    // Extract retrieval nodes (chunks)
    const results = response.data?.retrieval_nodes || [];
    console.log(`[LlamaCloud] Found ${results.length} relevant chunks`);

    return results.map((node: any) => ({
      text: node.text || '',
      score: node.score || 0,
      metadata: node.metadata || {},
    }));
  } catch (error) {
    console.error(`[LlamaCloud] Error querying knowledge base:`, error);
    return [];
  }
}

/**
 * Delete document from LlamaCloud pipeline
 * @param agentConfigId - Agent config ID
 * @param documentId - Document ID
 * @param fileName - Original filename
 */
export async function deleteDocumentEmbeddings(
  agentConfigId: string,
  documentId: string,
  fileName: string
): Promise<void> {
  const pipelineName = getPipelineName(agentConfigId);
  console.log(`[LlamaCloud] Deleting document from pipeline: ${documentId}/${fileName}`);

  try {
    // Note: LlamaCloud doesn't have a direct delete by metadata API in the TypeScript SDK yet
    // This would require using the raw API to remove files from the pipeline
    // For now, log a warning - deletion will need to be done manually through the dashboard
    console.warn(`[LlamaCloud] Document deletion via API not implemented yet. Please use LlamaCloud dashboard to remove files from pipeline: ${pipelineName}`);
  } catch (error) {
    console.error(`[LlamaCloud] Error deleting document:`, error);
    throw error;
  }
}
