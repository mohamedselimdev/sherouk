import { createServer, type Server } from "node:http";

export type StubIntention = {
  authorization: string | undefined;
  body: Record<string, unknown>;
  providerOrderId: number;
  clientSecret: string;
};

/**
 * Local stand-in for Paymob's intention API and hosted page (the dev server's PAYMOB_BASE_URL points here).
 * It checks nothing about real payment: it only lets the tests observe what our server sends and where it redirects.
 */
export function startPaymobStub(port = 5199): Promise<{ server: Server; intentions: StubIntention[] }> {
  const intentions: StubIntention[] = [];
  let counter = 700000;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/intention/") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        const intention = {
          authorization: req.headers.authorization,
          body,
          providerOrderId: ++counter,
          clientSecret: `cs_local_${counter}_abcdefgh`,
        };
        intentions.push(intention);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `int_${counter}`,
            client_secret: intention.clientSecret,
            intention_order_id: intention.providerOrderId,
          }),
        );
      });
      return;
    }
    if (req.url?.startsWith("/unifiedcheckout/")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>Stub checkout</title><h1>Stub hosted checkout</h1>");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, intentions })));
}
