import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// R10.3: on-demand revalidation. Prerendered pages and "use cache" entries
// live in KV; cache TAGS live in D1 because tag invalidation must be strongly
// consistent — an owner marking an item sold out has to show within seconds
// (R6.3), which KV's eventual consistency cannot promise.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
});
