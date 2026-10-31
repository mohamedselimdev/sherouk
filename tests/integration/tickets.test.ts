import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError, loadPrincipal } from "../../server/auth/rbac";
import { TooManyRequestsError } from "../../server/security/throttle";
import { createTicket, listTickets, setTicketStatus } from "../../server/support/tickets";
import { closeDb, db, makeStaff, reset } from "./helpers";

beforeEach(reset);
afterAll(closeDb);

const valid = (over: Record<string, unknown> = {}) => ({
  name: "Mona",
  email: "mona@example.com",
  phone: "",
  orderRef: "",
  message: "Where is my order please?",
  locale: "en",
  ...over,
});

describe("contact tickets", () => {
  it("stores a valid message with a short reference and trims blanks to null", async () => {
    const { ref } = await createTicket(db, valid(), "1.1.1.1");
    expect(ref).toMatch(/^T-[A-Z2-9]{8}$/);
    const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
    const [t] = await listTickets(db, support);
    expect(t).toMatchObject({ ref, email: "mona@example.com", phone: null, orderRef: null, status: "open" });
  });

  it("needs a message of 10+ characters and an email or phone", async () => {
    for (const bad of [
      valid({ message: "short" }),
      valid({ name: "  " }),
      valid({ email: "", phone: "" }),
      valid({ email: "not-an-email" }),
      valid({ email: "", phone: "abc" }),
    ]) {
      await expect(createTicket(db, bad, "2.2.2.2")).rejects.toBeInstanceOf(ZodError);
    }
    await expect(
      createTicket(db, valid({ email: "", phone: "01012345678" }), "2.2.2.2"),
    ).resolves.toBeTruthy();
  });

  it("rate limits to 5 per address per hour but not other addresses", async () => {
    for (let i = 0; i < 5; i++) await createTicket(db, valid(), "3.3.3.3");
    await expect(createTicket(db, valid(), "3.3.3.3")).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(createTicket(db, valid(), "4.4.4.4")).resolves.toBeTruthy();
  });

  it("only support staff read and close them, and closing is audited via status", async () => {
    await createTicket(db, valid(), "5.5.5.5");
    const marketing = await loadPrincipal(db, await makeStaff("mk@shrouk.test", "marketing"));
    await expect(listTickets(db, marketing)).rejects.toBeInstanceOf(ForbiddenError);

    const support = await loadPrincipal(db, await makeStaff("sup@shrouk.test", "customer_support"));
    const [t] = await listTickets(db, support);
    await expect(setTicketStatus(db, marketing, t!.id, "closed")).rejects.toBeInstanceOf(ForbiddenError);
    await setTicketStatus(db, support, t!.id, "closed");
    expect(await listTickets(db, support, "open")).toHaveLength(0);
    expect(await listTickets(db, support, "closed")).toHaveLength(1);
    await setTicketStatus(db, support, t!.id, "open");
    expect(await listTickets(db, support, "open")).toHaveLength(1);
  });
});
