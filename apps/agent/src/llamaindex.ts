/**
 * LlamaCloud integration for document RAG
 * Uses LlamaCloud managed pipelines for retrieval
 * Docs: https://developers.llamaindex.ai/typescript/cloud/llamacloud/guides/api_sdk/
 */

import {
  upsertPipelineApiV1PipelinesPut,
  runSearchApiV1PipelinesPipelineIdRetrievePost,
} from 'llama-cloud-services/api';

function getLlamaCloudConfig() {
  const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY;
  const LLAMA_CLOUD_PROJECT_ID = process.env.LLAMA_CLOUD_PROJECT_ID;

  if (!LLAMA_CLOUD_API_KEY) {
    console.error('[LlamaCloud] ERROR: LLAMA_CLOUD_API_KEY not set.');
    throw new Error('LLAMA_CLOUD_API_KEY is required');
  }

  if (!LLAMA_CLOUD_PROJECT_ID) {
    console.error('[LlamaCloud] ERROR: LLAMA_CLOUD_PROJECT_ID not set. Please get your project ID from https://cloud.llamaindex.ai');
    throw new Error('LLAMA_CLOUD_PROJECT_ID is required');
  }

  return { LLAMA_CLOUD_API_KEY, LLAMA_CLOUD_PROJECT_ID };
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
  const { LLAMA_CLOUD_API_KEY, LLAMA_CLOUD_PROJECT_ID } = getLlamaCloudConfig();
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
        project_id: LLAMA_CLOUD_PROJECT_ID,
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

    const pipelineId = pipeline.data?.id;
    if (!pipelineId) {
      throw new Error('Failed to create/get pipeline - no ID returned');
    }

    console.log(`[LlamaCloud] Pipeline ready: ${pipelineName} (ID: ${pipelineId})`);
    pipelineCache.set(pipelineName, pipelineId);
    return pipelineId;
  } catch (error) {
    console.error(`[LlamaCloud] Error creating/getting pipeline:`, error);
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
): Promise<Array<{ text: string; score: number }>> {
  const { LLAMA_CLOUD_API_KEY } = getLlamaCloudConfig();
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

    // Log each retrieved chunk for debugging
    results.forEach((nodeWithScore: any, index: number) => {
      const text = nodeWithScore.node?.text || '';
      console.log(`[LlamaCloud] Chunk ${index + 1}:`, {
        text: text.substring(0, 200) || '(empty)',
        textLength: text.length,
        score: nodeWithScore.score || 0,
        metadata: nodeWithScore.node?.extra_info,
      });
    });

    return results.map((nodeWithScore: any) => ({
      text: nodeWithScore.node?.text || '',
      score: nodeWithScore.score || 0,
    }));
  } catch (error) {
    console.error(`[LlamaCloud] Error querying knowledge base:`, error);
    return [];
  }
}
