/**
 * Custom footer component for little-coder.
 *
 * Replaces pi's default gray footer with:
 * - Honey-colored "lc▌" watermark on the left
 * - Context percentage color-coded (green <30%, amber 30-70%, red >70%)
 * - Token counts in honey accent instead of dim gray
 * - Model name right-aligned as before
 *
 * Uses ctx.ui.setFooter() — no source-level patches to pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateLineToWidth, visibleWidth } from "../_shared/width.ts";

// Honey accent (brand hex #E15A1F) as a 24-bit truecolor SGR.
const HONEY = "\x1b[38;2;225;90;31m";
const honeyFg = (s: string): string => `${HONEY}${s}\x1b[39m`;

// Color-coded context percentage helpers.
function ctxColor(pct: number): string {
  if (pct > 90) return "\x1b[38;2;204;102;102m";   // red
  if (pct > 70) return "\x1b[38;2;229;192;123m";   // amber
  return "\x1b[38;2;143;217;143m";                  // green
}
const ctxReset = "\x1b[39m";

// Format token counts the same way pi's FooterComponent does.
function fmtTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

// Sanitize text for single-line display.
function sanitize(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Capture session manager and context usage for use in render().
    const sm = ctx.sessionManager;
    const getCtxUsage = () => ctx.getContextUsage();

    // Store the footerData that pi passes to our factory.
    let capturedFd: any = null;

    ctx.ui.setFooter((_tui, theme, fd) => {
      capturedFd = fd;

      return {
        render(width: number): string[] {
          // --- Gather data from session manager ---
          let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
          let totalCost = 0;
          let latestCacheHitRate: number | undefined;

          const entries = sm.getEntries();
          for (const entry of entries) {
            if (entry.type === "message" && entry.message?.role === "assistant") {
              const u = entry.message.usage || {};
              totalInput += u.input ?? 0;
              totalOutput += u.output ?? 0;
              totalCacheRead += u.cacheRead ?? 0;
              totalCacheWrite += u.cacheWrite ?? 0;
              totalCost += u.cost?.total ?? 0;
              const latestPromptTokens = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
              if (latestPromptTokens > 0 && u.cacheRead !== undefined) {
                latestCacheHitRate = (u.cacheRead / latestPromptTokens) * 100;
              }
            }
          }

          const contextUsage = getCtxUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
          const contextTokens = contextUsage?.tokens ?? null;

          // --- Build left-side stats ---
          const statsParts: string[] = [];
          if (totalInput) statsParts.push(`↑${fmtTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`↓${fmtTokens(totalOutput)}`);
          if (totalCacheRead) statsParts.push(`R${fmtTokens(totalCacheRead)}`);
          if (totalCacheWrite) statsParts.push(`W${fmtTokens(totalCacheWrite)}`);
          if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
            statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
          }

          // Cost line
          const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
          if (totalCost || usingSubscription) {
            const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
            statsParts.push(costStr);
          }

          // Context percentage on its own line, color-coded
          let contextPctLine: string;
          if (contextTokens !== null) {
            contextPctLine = `${ctxColor(contextPercentValue)}${contextPercent}%${ctxReset}`;
          } else {
            contextPctLine = `${ctxColor(contextPercentValue)}?%${ctxReset}`;
          }

          // Context token fraction on its own line (below percentage)
          let contextTokenLine: string;
          if (contextTokens !== null) {
            contextTokenLine = `${ctxColor(contextPercentValue)}${fmtTokens(contextTokens)}/${fmtTokens(contextWindow)}${ctxReset}`;
          } else {
            contextTokenLine = `${ctxColor(contextPercentValue)}?/${fmtTokens(contextWindow)}${ctxReset}`;
          }

          statsParts.push(contextPctLine);
          statsParts.push(contextTokenLine);

          let statsLeft = statsParts.join(" ");
          if (visibleWidth(statsLeft) > width) {
            statsLeft = truncateLineToWidth(statsLeft, width, "...");
          }

          // --- Right side: model name + provider (honey-colored) + thinking level ---
          const modelName = ctx.model?.name || ctx.model?.id || "no-model";
          const modelProvider = ctx.model?.provider ? ` | ${ctx.model.provider}` : "";
          const coloredModel = honeyFg(`${modelName}${modelProvider}`);
          let rightSide = coloredModel;
          if (ctx.model?.reasoning) {
            try {
              const thinkingLevel = (ctx as any).thinkingLevel || "off";
              rightSide = thinkingLevel === "off"
                ? `${coloredModel} • thinking off`
                : `${coloredModel} • ${thinkingLevel}`;
            } catch { /* ignore */ }
          }

          // --- Assemble the line ---
          const statsLeftWidth = visibleWidth(statsLeft);
          const rightSideWidth = visibleWidth(rightSide);
          let statsLine: string;

          if (statsLeftWidth + 2 + rightSideWidth <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            statsLine = statsLeft + padding + rightSide;
          } else {
            const availForRight = Math.max(0, width - statsLeftWidth - 2);
            if (availForRight > 0) {
              const truncatedRight = truncateLineToWidth(rightSide, availForRight, "");
              const pad = " ".repeat(Math.max(0, width - visibleWidth(statsLeft) - visibleWidth(truncatedRight)));
              statsLine = statsLeft + pad + truncatedRight;
            } else {
              statsLine = statsLeft;
            }
          }

          // --- pwd line with honey watermark ---
          const cwd = sm.getCwd();
          let pwd = cwd.replace(process.env.HOME || "~", "~");
          const branch = capturedFd?.getGitBranch?.();
          if (branch) pwd = `${pwd} (${branch})`;
          const sessionName = sm.getSessionName();
          if (sessionName) pwd = `${pwd} • ${sessionName}`;
          const pwdLine = truncateLineToWidth(honeyFg("lc▌") + " " + theme.fg("dim", pwd), width, "");

          // --- Extension statuses ---
          const extStatuses: Map<string, string> = capturedFd?.getExtensionStatuses?.() ?? new Map();
          const lines: string[] = [pwdLine];

          // statsLeft has colored context % — keep as-is.
          // rightSide has honey-colored model name — keep as-is.
          // Only the padding between them gets dimmed.
          const paddingStart = statsLeft.length;
          const paddingEnd = width - visibleWidth(rightSide);
          const pad = statsLine.slice(paddingStart, paddingEnd);
          lines.push(statsLeft + theme.fg("dim", pad) + rightSide);

          if (extStatuses.size > 0) {
            const sorted = Array.from(extStatuses.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([, text]) => sanitize(text));
            lines.push(truncateLineToWidth(theme.fg("dim", sorted.join(" ")), width, theme.fg("dim", "...")));
          }

          return lines;
        },
        invalidate() { /* no cached state */ },
      };
    });
  });
}
