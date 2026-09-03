import type { VNode } from "preact";
import { Button } from "../components/Button.tsx";
import { Badge } from "../components/Badge.tsx";

export interface TokenManagerProps {
  origin?: string;
  currentToken?: string;
  lifetimeDays?: number;
  onGenerateToken?: () => void;
  onCopyToken?: () => void;
  onCopyCurlMcp?: () => void;
  onCopyCurlMe?: () => void;
  onCopyConfig?: () => void;
  onCopyStdioConfig?: () => void;
  class?: string;
  className?: string;
}

/**
 * Bearer API Token generation card with copyable token input,
 * lifetime display, and curl code snippet examples.
 */
export function TokenManager({
  origin = "https://workflow-mcp.deno.dev",
  currentToken = "",
  lifetimeDays = 365,
  onGenerateToken,
  onCopyToken,
  onCopyCurlMcp,
  onCopyCurlMe,
  onCopyConfig,
  onCopyStdioConfig,
  class: classProp,
  className,
}: TokenManagerProps): VNode {
  const customClass = classProp || className || "";

  const curlMcpSnippet = `curl -X POST "${origin}/mcp" \\
  -H "Authorization: Bearer ${currentToken || "YOUR_API_TOKEN"}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'`;

  const curlApiMeSnippet = `curl -X GET "${origin}/api/me" \\
  -H "Authorization: Bearer ${currentToken || "YOUR_API_TOKEN"}"`;

  const remoteConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        "workflow-mcp": {
          url: `${origin}/mcp`,
          headers: {
            Authorization: `Bearer ${currentToken || "YOUR_API_TOKEN"}`,
          },
        },
      },
    },
    null,
    2,
  );

  const stdioConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        "workflow-mcp": {
          command: "deno",
          args: [
            "run",
            "--unstable-kv",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "/path/to/workflow-builder-mcp/main.ts",
          ],
        },
      },
    },
    null,
    2,
  );

  return (
    <div
      id="tokenManagerCard"
      class={`bg-gray-800/80 backdrop-blur-sm border border-gray-700/80 rounded-xl p-6 shadow-lg flex flex-col gap-6 ${customClass}`
        .trim()}
    >
      {/* Card Header & Lifetime Display */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-700/60 pb-4">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-2xl" aria-hidden="true">🔑</span>
            <h2 class="text-lg font-semibold text-gray-100 tracking-tight">
              Bearer API Token Manager
            </h2>
            <Badge variant="medium" size="sm">Persistent Auth</Badge>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            Connect Claude Desktop, Cursor, CLI agents, and HTTP clients to your workflow workspace.
          </p>
        </div>

        {/* Token Lifetime Indicator */}
        <div class="flex items-center gap-2 self-start sm:self-auto bg-gray-900/80 border border-gray-700/80 px-3 py-1.5 rounded-lg">
          <span class="text-[11px] text-gray-400">Token Lifetime:</span>
          <Badge variant="open" size="sm" pill>
            {lifetimeDays} Days (1 Year)
          </Badge>
        </div>
      </div>

      {/* Action Button & Token Input Area */}
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <Button
            id="btnGenerateToken"
            variant="primary"
            size="md"
            onClick={onGenerateToken}
          >
            <span class="mr-1.5" aria-hidden="true">⚡</span>
            Generate New API Token
          </Button>
          <span class="text-xs text-gray-400">
            Generates a high-entropy secret token scoped to your user account.
          </span>
        </div>

        {/* Copyable Token Display Input */}
        <div
          id="tokenDisplay"
          class={currentToken ? "flex flex-col gap-2 mt-1" : "hidden flex flex-col gap-2 mt-1"}
        >
          <label
            htmlFor="tokenInput"
            class="text-xs font-semibold text-emerald-400 flex items-center justify-between"
          >
            <span>Active Bearer Token (Copy and store securely):</span>
            <span class="text-[11px] text-gray-400 font-normal">Valid for {lifetimeDays} days</span>
          </label>
          <div class="relative flex items-center gap-2">
            <input
              id="tokenInput"
              type="text"
              readOnly
              value={currentToken}
              placeholder="Your new token will appear here..."
              class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <Button
              id="btnCopyToken"
              variant="secondary"
              size="sm"
              onClick={onCopyToken}
              class="shrink-0"
            >
              📋 Copy Token
            </Button>
          </div>
          {/* Hidden anchor element for existing script compatibility */}
          <span id="tokenValue" class="hidden">{currentToken}</span>
        </div>
      </div>

      {/* Code Snippets Section */}
      <div class="flex flex-col gap-5 border-t border-gray-700/60 pt-5">
        <h3 class="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <span>💻</span> API Integration Examples
        </h3>

        {/* cURL Snippet: MCP JSON-RPC */}
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-sky-400">
              1. cURL — JSON-RPC MCP Tools Query:
            </span>
            <Button
              id="btnCopyCurlMcp"
              variant="ghost"
              size="sm"
              class="text-[11px] text-gray-400 hover:text-gray-100 py-0.5 px-2"
              onClick={onCopyCurlMcp}
            >
              Copy cURL
            </Button>
          </div>
          <pre class="bg-gray-950/90 border border-gray-800 rounded-lg p-3 text-[11px] font-mono text-gray-300 overflow-x-auto relative">
            <code id="curlMcpSnippet">{curlMcpSnippet}</code>
          </pre>
        </div>

        {/* cURL Snippet: User Profile / Health */}
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-indigo-400">
              2. cURL — Inspect Auth & User Context:
            </span>
            <Button
              id="btnCopyCurlMe"
              variant="ghost"
              size="sm"
              class="text-[11px] text-gray-400 hover:text-gray-100 py-0.5 px-2"
              onClick={onCopyCurlMe}
            >
              Copy cURL
            </Button>
          </div>
          <pre class="bg-gray-950/90 border border-gray-800 rounded-lg p-3 text-[11px] font-mono text-gray-300 overflow-x-auto relative">
            <code id="curlMeSnippet">{curlApiMeSnippet}</code>
          </pre>
        </div>

        {/* MCP Client Config Snippets */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
          {/* Option A: Remote Config */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-amber-400">
                Claude Desktop / Cursor (Remote):
              </span>
              <Button
                id="btnCopyConfig"
                variant="ghost"
                size="sm"
                class="text-[11px] text-gray-400 hover:text-gray-100 py-0.5 px-2"
                onClick={onCopyConfig}
              >
                Copy JSON
              </Button>
            </div>
            <pre class="bg-gray-950/90 border border-gray-800 rounded-lg p-3 text-[11px] font-mono text-gray-300 overflow-x-auto h-40">
              <code id="configSnippet">{remoteConfigSnippet}</code>
            </pre>
          </div>

          {/* Option B: Local CLI Config */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-purple-400">
                Local CLI / Stdio Mode:
              </span>
              <Button
                id="btnCopyStdioConfig"
                variant="ghost"
                size="sm"
                class="text-[11px] text-gray-400 hover:text-gray-100 py-0.5 px-2"
                onClick={onCopyStdioConfig}
              >
                Copy JSON
              </Button>
            </div>
            <pre class="bg-gray-950/90 border border-gray-800 rounded-lg p-3 text-[11px] font-mono text-gray-300 overflow-x-auto h-40">
              <code id="stdioConfigSnippet">{stdioConfigSnippet}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
