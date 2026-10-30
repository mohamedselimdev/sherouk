import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { buildCsp, randomNonce, scriptHash } from "./lib/csp";
import { THEME_INIT_SCRIPT } from "./lib/theme";

export const streamTimeout = 5_000;

let themeHash: Promise<string> | undefined;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  // The dev server injects inline HMR scripts, so the policy is enforced on built output only.
  const nonce = randomNonce();
  if (!import.meta.env.DEV) {
    themeHash ??= scriptHash(THEME_INIT_SCRIPT);
    responseHeaders.set("Content-Security-Policy", buildCsp({ nonce, inlineHashes: [await themeHash] }));
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  // Crawlers wait for the full document.
  if (userAgent && isbot(userAgent)) await body.allReady;

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
