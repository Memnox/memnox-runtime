/**
 * The page a sign in comes back to in the browser, in the house design the cloud's own pages use,
 * with the Memnox mark. It says what happened in the person's terms and never claims a connection
 * the terminal has not proved, because that tab is the first thing somebody reads after approving.
 */

export const SIGN_IN_PAGE = {
  /** The server answered with the new sign in on it. */
  CONNECTED: 'connected',
  /** It did not, and why, with nothing changed. */
  FAILED: 'failed',
  /** The approval arrived and the terminal is still checking, which a slow server can take a moment over. */
  FINISHING: 'finishing',
} as const;

export type SignInPageKind = (typeof SIGN_IN_PAGE)[keyof typeof SIGN_IN_PAGE];

export interface SignInPage {
  kind: SignInPageKind;
  server: string;
  /** On FAILED: why, in a sentence. */
  detail?: string;
}

/** The Memnox mark, drawn in the ink colour so it follows light and dark as the page does. */
const MARK =
  '<svg class="mark" viewBox="0 0 445 272" aria-hidden="true"><path d="M392.8 271.9C392.3 271.8 390.8 271.6 389.4 271.4C372.8 268.9 357.8 255.0 353.4 237.7C351.7 230.9 351.7 231.3 351.5 179.4C351.2 124.5 351.4 128.6 348.4 119.8C335.5 82.1 293.9 66.6 259.3 86.6C245.1 94.8 233.9 110.8 231.4 126.8C230.8 131.0 231.2 144.2 232.1 147.5C237.6 167.4 251.7 180.9 273.6 187.2C278.8 188.7 278.8 188.6 278.8 199.2C278.8 227.8 269.7 246.4 248.8 260.4C235.1 269.6 215.2 272.0 198.9 266.4C174.5 258.0 156.8 235.4 154.8 210.3C154.6 207.7 154.4 193.0 154.4 173.5C154.4 132.3 154.3 131.4 147.0 123.5C131.3 106.6 104.0 110.4 94.6 130.8C92.2 136.0 92.3 133.1 92.1 184.4C91.9 235.6 92.0 232.2 89.6 239.7C81.4 265.1 53.7 278.0 28.9 268.1C13.6 262.0 2.9 247.4 0.6 229.5C-0.1 223.4 -0.2 109.9 0.6 101.4C2.3 83.3 6.7 70.9 17.8 53.1C33.8 27.4 63.0 7.0 90.8 1.9C118.1 -3.0 142.7 1.5 165.4 15.7C172.6 20.2 182.0 26.5 187.1 30.2C189.9 32.3 194.1 35.1 196.4 36.6C198.7 38.0 201.9 40.2 203.6 41.4C205.3 42.6 208.2 44.6 210.1 45.9C212.0 47.1 216.0 49.8 218.9 51.9C226.1 56.9 226.8 56.8 236.1 49.8C237.5 48.7 242.6 45.1 247.6 41.7C261.9 32.0 266.6 28.7 270.2 26.1C272.1 24.7 276.1 22.0 279.3 20.0C282.4 18.1 286.2 15.6 287.8 14.6C309.5 0.0 343.5 -4.1 369.8 4.7C400.6 15.0 424.0 36.7 436.4 66.6C440.6 76.8 443.5 89.7 444.4 103.1C445.1 112.4 444.7 226.3 444.0 230.7C440.4 251.6 425.4 267.9 406.4 271.3C403.7 271.8 394.4 272.2 392.8 271.9ZM281.9 169.7C270.3 168.3 258.9 160.2 254.1 150.1C247.1 135.4 251.4 117.2 264.1 107.9C280.8 95.7 302.1 98.6 314.1 114.8C322.9 126.6 322.7 144.3 313.7 155.6C305.4 166.1 293.8 171.2 281.9 169.7Z"/></svg>';

/** The house tokens as literal hex, since this page is served from this computer with no stylesheet. */
const STYLE = `
  :root { color-scheme: light dark; --ground: #fbfbfb; --panel: #ffffff; --border: #e2e2e2; --secondary: #333333; --muted: #6b6b6b; --ink: #0f0f0f; --primary: #1e86ee; --good: #1f9d55; --bad: #d93025; }
  @media (prefers-color-scheme: dark) {
    :root { --ground: #030303; --panel: #0f0f0f; --border: #313131; --secondary: #adadad; --muted: #8a8a8a; --ink: #fdfdfd; --good: #3ccf7b; --bad: #ff6b5e; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--ground); color: var(--ink); font: 400 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: -0.01em; }
  main { width: 100%; max-width: 440px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 32px 28px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .mark { width: 30px; height: auto; display: block; }
  .mark path { fill: var(--ink); }
  .word { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
  .state { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; margin-bottom: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); }
  .connected .dot { background: var(--good); }
  .failed .dot { background: var(--bad); }
  .connected .state { color: var(--good); }
  .failed .state { color: var(--bad); }
  .finishing .state { color: var(--primary); }
  h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; line-height: 1.3; }
  p { margin: 0 0 12px; color: var(--secondary); font-size: 15px; }
  p.next { margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; }
`;

interface Words {
  state: string;
  title: string;
  body: string;
  next: string;
}

function wordsFor(page: SignInPage): Words {
  const { server } = page;
  switch (page.kind) {
    case SIGN_IN_PAGE.CONNECTED:
      return {
        state: 'Connected',
        title: `${server} is connected`,
        body: `Memnox signed you in and keeps the sign in on this computer, renewing it when it runs out. Memnox still rules on what your agents do with ${server}.`,
        next: 'You can close this tab. Your terminal carries on from here.',
      };
    case SIGN_IN_PAGE.FAILED:
      return {
        state: 'Not connected',
        title: `${server} is not connected`,
        body: page.detail ?? 'The sign in did not finish.',
        next: 'Nothing was changed. Your terminal says what you can do next.',
      };
    default:
      return {
        state: 'Finishing',
        title: `Finishing the sign in to ${server}`,
        body: `You approved it. Memnox is checking that ${server} connects with it.`,
        next: 'You can close this tab. Your terminal shows the result.',
      };
  }
}

/** Text from a server or a refusal is somebody else's words, so it is escaped before it is drawn. */
function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function signInPage(page: SignInPage): string {
  const words = wordsFor(page);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escaped(words.state)} · Memnox</title>
<style>${STYLE}</style>
</head>
<body>
<main class="${page.kind}">
  <div class="brand">${MARK}<span class="word">Memnox</span></div>
  <div class="state"><span class="dot" aria-hidden="true"></span>${escaped(words.state)}</div>
  <h1>${escaped(words.title)}</h1>
  <p>${escaped(words.body)}</p>
  <p class="next">${escaped(words.next)}</p>
</main>
</body>
</html>
`;
}
