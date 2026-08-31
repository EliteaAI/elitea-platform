/**
 * EliteA Client Adapter for DeepWiki UI
 * Provides a configured SandboxClient instance for the DeepWiki plugin
 */

import { SandboxClient } from './sandbox_client.js';
import { getEnvVar } from './env.js';

let clientInstance = null;

/**
 * Get or create a singleton SandboxClient instance
 * Automatically handles iframe mode and session sharing from parent window
 * @returns {SandboxClient}
 */
export function getEliteAClient() {
  if (!clientInstance) {
    // Check if running in iframe and try to get session from parent
    const isIframe = window.self !== window.top;
    
    const config = {
      baseUrl: getEnvVar('VITE_API_BASE_URL', getEnvVar('base_url', window.location.origin)),
      projectId: parseInt(getEnvVar('VITE_PROJECT_ID', getEnvVar('project_id', '1'))),
      // Empty, and it stays empty. The bundle is served same-origin behind
      // elitea-main's authenticated handler, so the browser's own session
      // cookie authenticates every call; withCredentials below is what sends
      // it. A token injected into the page would be a credential in the DOM
      // for no gain.
      authToken: '',
      // NO XSECRET. The legacy shared-string header is retired (ADR-0022
      // decision 6): no surface of the ported service sends or honours it,
      // and a client that kept sending it would be sending the literal word
      // "secret" to a service that ignores it.
      withCredentials: true
    };

    clientInstance = new SandboxClient(config);
    
    // If in iframe, session cookies will be automatically shared via credentials: 'include'
    // No need for postMessage as cookies are sent with every request
    if (isIframe) {
      console.log('[EliteAClient] Running in iframe mode - session cookies will be shared automatically');
    }
  }

  return clientInstance;
}

/**
 * Reset the client instance (useful for testing or re-initialization)
 */
export function resetEliteAClient() {
  clientInstance = null;
}

/**
 * Update the auth token for the current client instance
 * Useful when session token changes or for iframe scenarios with explicit token passing
 * @param {string} token - New auth token
 */
export function updateClientAuthToken(token) {
  const client = getEliteAClient();
  client.updateAuthToken(token);
}

/**
 * Update client configuration dynamically
 * @param {Object} config - Configuration updates
 */
export function updateClientConfig(config) {
  const client = getEliteAClient();
  client.updateConfig(config);
}

/**
 * Create a new SandboxClient with custom configuration
 * @param {Object} config - Custom configuration
 * @returns {SandboxClient}
 */
export function createEliteAClient(config) {
  return new SandboxClient({
    baseUrl: config.baseUrl || window.location.origin,
    projectId: config.projectId || 1,
    authToken: config.authToken || '',
    apiExtraHeaders: config.headers || {},
    // No XSECRET here either — see getEliteAClient above.
    ...config
  });
}

/**
 * Helper to test a tool synchronously
 * @param {number} toolId - Tool ID
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>}
 */
export async function testTool(toolId, params) {
  const client = getEliteAClient();
  return await client.testToolSync(toolId, params);
}

/**
 * Helper to test a tool asynchronously and wait for results
 * @param {number} toolId - Tool ID
 * @param {Object} params - Tool parameters
 * @param {number} timeout - Timeout in seconds
 * @returns {Promise<Object>}
 */
export async function testToolAsync(toolId, params, timeout = 300) {
  const client = getEliteAClient();
  const { task_id } = await client.testToolAsync(toolId, params);
  return await client.waitForTask(task_id, timeout);
}

/**
 * Helper to get artifact manager for a bucket
 * @param {string} bucketName - Bucket name
 * @returns {Promise<SandboxArtifact>}
 */
export async function getArtifacts(bucketName) {
  const client = getEliteAClient();
  return await client.artifact(bucketName);
}

/**
 * Helper to list available MCP toolkits
 * @returns {Promise<Array>}
 */
export async function listMcpToolkits() {
  const client = getEliteAClient();
  return await client.getMcpToolkits();
}

/**
 * Helper to call an MCP tool
 * @param {Object} params - MCP tool parameters
 * @returns {Promise<Object>}
 */
export async function callMcpTool(params) {
  const client = getEliteAClient();
  return await client.mcpToolCall(params);
}

/**
 * Helper to list applications
 * @returns {Promise<Array>}
 */
export async function listApplications() {
  const client = getEliteAClient();
  return await client.getListOfApps();
}

/**
 * Helper to get application details
 * @param {number} appId - Application ID
 * @returns {Promise<Object>}
 */
export async function getApplication(appId) {
  const client = getEliteAClient();
  return await client.getAppDetails(appId);
}

export { SandboxClient };
