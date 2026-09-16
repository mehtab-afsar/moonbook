const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:56324";

/**
 * The sign-in link actually delivered to an inbox.
 *
 * Only `onboarding.spec.ts` uses this. It is the one place the email route is
 * the thing under test — that the link is sent, that it is redeemable, and
 * that redeeming it lands somewhere sensible. Everywhere else, waiting on SMTP
 * is a reliability cost with no coverage attached.
 */
export async function waitForSignInLink(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}&limit=1`,
    ).then((r) => r.json());

    if (search.messages?.length) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`).then((r) =>
        r.json(),
      );
      const match = /https?:\/\/[^\s)]*\/auth\/v1\/verify\?[^\s)]+/.exec(message.Text ?? "");
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No sign-in email for ${email} within ${timeoutMs}ms`);
}
