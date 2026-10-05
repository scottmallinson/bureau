import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../server/config.js';
import { createBureau } from '../server/setup.js';
import { createMcpServer } from './server.js';

// stdout is the MCP channel, so nothing else may write to it.
const bureau = createBureau(loadConfig());
const server = createMcpServer(bureau);
await server.connect(new StdioServerTransport());
console.error('Bureau MCP server ready on stdio');
