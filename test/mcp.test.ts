import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { demoBureau } from './helpers.js';

async function connect() {
  const server = createMcpServer(await demoBureau());
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

function parse(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text) as Record<string, unknown> & unknown[];
}

describe('MCP server', () => {
  it('lists read-only analysis tools and a review prompt', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_analytics_summary',
      'get_metrics_history',
      'get_platform_breakdown',
      'get_post_analytics',
      'get_schedule',
      'list_post_metrics',
      'list_stories',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['performance_review']);
  });

  it('summarises analytics', async () => {
    const client = await connect();
    const summary = parse(await client.callTool({ name: 'get_analytics_summary', arguments: {} }));
    expect(summary.totals).toMatchObject({ posts: expect.any(Number), views: expect.any(Number) });
    expect((summary.platforms as unknown[]).length).toBeGreaterThan(1);
  });

  it('lists post metrics for one platform, sorted', async () => {
    const client = await connect();
    const result = parse(
      await client.callTool({
        name: 'list_post_metrics',
        arguments: { platform: 'linkedin', sort_by: 'engagements', limit: 3 },
      }),
    );
    const posts = result.posts as Array<{ platform: string; engagements: number }>;
    expect(posts).toHaveLength(3);
    expect(posts.every((p) => p.platform === 'linkedin')).toBe(true);
    expect(posts[0]!.engagements).toBeGreaterThanOrEqual(posts[1]!.engagements);
  });

  it('explains one post with its related items', async () => {
    const client = await connect();
    const top = parse(
      await client.callTool({
        name: 'list_post_metrics',
        arguments: { platform: 'ghost', limit: 1 },
      }),
    );
    const id = (top.posts as Array<{ id: string }>)[0]!.id;
    const detail = parse(
      await client.callTool({ name: 'get_post_analytics', arguments: { item_id: id } }),
    );
    expect((detail.related as unknown[]).length).toBeGreaterThan(0);
    expect(detail.story).toMatchObject({ anchorId: id });
  });

  it('shows schedule warnings', async () => {
    const client = await connect();
    const schedule = parse(await client.callTool({ name: 'get_schedule', arguments: {} }));
    const warned = (schedule.items as Array<{ warnings: string[] }>).filter(
      (i) => i.warnings.length,
    );
    expect(warned).toHaveLength(2);
  });

  it('reports an unknown item as a tool error', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'get_post_analytics',
      arguments: { item_id: 'ghost:nope' },
    });
    expect(result.isError).toBe(true);
  });
});
