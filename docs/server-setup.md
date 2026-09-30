# Running your own game server

The game server is a small Cloudflare Worker in [`server/`](../server). It does two jobs:

1. It **serves the game** (the built files), so players just open its address.
2. It runs **rooms**: the host gets a five-letter code, everyone else types it, and the server introduces their browsers to each other so they can connect. It carries no game traffic (once two browsers are connected they talk directly), and a room only ever passes a few kilobytes.

You do not need a server to play: without one, the game falls back to swapping connection codes by hand (see [networking.md](networking.md)), which is fiddlier. With one, joining a friend is typing five letters. Everything below runs on Cloudflare's **free plan**.

## What you need

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
- This repository, and the Node.js version in [`.nvmrc`](../.nvmrc), then `npm ci`.
- Nothing else to install for the room server: Wrangler is pinned as a development dependency and comes down with `npm ci`.

## 1. Try it on your own computer

```bash
npm run server:dev
```

This builds the game and serves it, and the room server, at <http://localhost:8787>. Open that in two browser tabs: in one choose **Multiplayer**, then **Host Game**, then a map; in the other **Multiplayer**, then **Join Game**, and type the code. Press Ctrl+C to stop.

For an automated end-to-end check, install Playwright's Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`. It starts a local Wrangler room server and Vite app, connects two isolated browser contexts over real WebRTC, starts a match, and checks replicated movement with a 30-second test timeout.

## 2. Put it online

```bash
npx wrangler login
npm run server:deploy
```

`wrangler login` opens a Cloudflare page in your browser to approve; you only do it once per computer. `server:deploy` builds the game (stamping the current git commit as its build ID), uploads it, and prints the address, something like `https://zombonz.<your-subdomain>.workers.dev`. If Cloudflare asks you to choose a `workers.dev` subdomain, pick one: it becomes part of that address.

Check it worked: open `<your address>/signal/health` in a browser. It should show `{"ok":true,"service":"zombonz-rooms","version":1}`. Then open the address itself and play.

## 3. Use your own domain (optional)

The `workers.dev` address works for good; a name of your own is nicer to type. This needs the domain's DNS to be on Cloudflare (its nameservers pointed at Cloudflare), and the hostname must not already have a CNAME record.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages** and open **zombonz**.
2. **Settings**, then **Domains & Routes**, then **Add**, then **Custom domain**.
3. Type the hostname you want, such as `play.example.com`, and confirm. Cloudflare creates the DNS record and the certificate itself, so it works within a minute or two.

Nothing in the repository needs to know the address: the game talks to whatever address it was loaded from. A domain added this way was still attached after a later `npm run server:deploy` (checked once; if yours ever disappears, add it again). Wrangler can also attach one from its config (`routes` with `custom_domain`; see [Cloudflare's guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)), which was not tried here. Keep it out of the tracked `wrangler.jsonc` if you would rather not publish your address.

## 4. Updating

```bash
git pull
npm run server:deploy
```

You can have this happen on every push to `dev` instead: see [the next section](#5-deploy-automatically-from-github-optional). Everyone playing together must be on the same version, and needs to reload the page after a deploy (hard refresh, Ctrl+Shift+R, if it still looks old). The build ID is shown in **Multiplayer**, then **Test my connection**, and on the credits screen (F2); it is the git commit, so two players can compare.

## 5. Deploy automatically from GitHub (optional)

[`.github/workflows/server.yml`](../.github/workflows/server.yml) deploys the server on every push to `dev`, once the typecheck and tests pass. It is switched off until you give it what it needs, so a fork without a Cloudflare account just skips it.

1. **Make an API token.** In the Cloudflare dashboard, open your profile, **API Tokens**, **Create Token**, and use the **Edit Cloudflare Workers** template. Restrict it to your own account (Cloudflare recommends this), and copy the token when it is shown.
2. **Give the repository the token, your account ID and the switch.** The token is a secret, so paste it at the prompt rather than putting it in a command:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   gh variable set DEPLOY_SERVER --body true
   ```

   `npx wrangler whoami` prints your account ID (it is also in the dashboard). The same three can be added in GitHub under **Settings**, **Secrets and variables**, **Actions**.
3. **Push to `dev`,** or run **Deploy game server** from the repository's **Actions** tab. Open the run to watch it; when it finishes, the build ID shown in **Test my connection** is the commit you pushed.

Things to know:

- **Every push to `dev` goes live.** If you would rather have a step in between, change `branches: [dev]` in the workflow to a branch you merge into when you want a release.
- **Rolling back:** re-run the workflow from the Actions tab on an earlier commit, or run `npx wrangler rollback`, or use **Deployments** in the dashboard.
- **Nothing about your address is involved.** A custom domain added in the dashboard stays attached, and the token only needs to edit Workers.
- **The token is the only thing that can publish as you.** It lives in GitHub's secrets, never in the repository; if it leaks, delete it in the dashboard and make another.
- **Players in a game keep the version they loaded** until they reload; anyone who joins from a different version is told it does not match.

## What it costs, and the limits

On Cloudflare's free plan, as Cloudflare's documentation says (read on 2026-09-30; check it, as plans change):

- **The game's files are free and unlimited.** Requests for static assets do not use the daily allowance. The game is about 250 files, the biggest 7.5 MB; the limits are 20,000 files and 25 MiB each.
- **Rooms use the Worker:** 100,000 requests a day. A whole session of four players is a few dozen messages, so this is a lot of games. WebSocket messages into a room count 1 for every 20.
- **Rooms are Durable Objects**, which have their own daily allowance (13,000 GB-seconds of running time a day, which at the 128 MB Cloudflare bills for is about 28 hours of one room being open). Joining players use signalling for only a few seconds; the host keeps its room connection open for the match so a dropped player can reconnect.
- **Going over** makes room requests fail until midnight UTC; the game's files keep loading, and the room lobby's **Use connection codes instead** still works, because that does not need the server.

## Privacy and abuse

- **A room code is a name, not a secret.** Anyone with your address and a code can ask to join it, and there are about 28 million codes. A room holds four connections, closes when its host leaves, and has a 12-hour safety cap if the host never closes it.
- **What the server sees:** room codes and the messages that set connections up, which necessarily contain the players' network addresses. The server code keeps none of it (it lives in memory until the room ends and nothing is logged); Cloudflare's own request logging applies as it does to any site on Cloudflare.
- **Limits per connection** (in `server/roomLogic.ts`): messages up to 16 KB, at most 80 in 10 seconds, or the connection is closed. For more protection, Cloudflare's rate-limiting rules in the dashboard can sit in front of `/signal/*`.
- **The server accepts connections from any address**, so a copy of the game hosted elsewhere can use it (see the next section). If you want it to serve only your own address, add a check of the `Origin` header in `server/worker.ts`.

## Using it from a copy hosted elsewhere

The GitHub Pages copy of the game, or any other, can use your server instead of the code-swapping fallback. Build it with `VITE_SIGNAL_URL` set to your address, such as `https://play.example.com` (no path, no trailing slash). For GitHub Pages, add a repository variable of that name (**Settings**, then **Secrets and variables**, then **Actions**, then **Variables**); the Pages workflow passes it to the build if it exists.

## If something goes wrong

- **The game shows the copy-and-paste lobby, not the room lobby.** It could not reach the server: open `<address>/signal/health` in a browser and check it shows the JSON above. If you set `VITE_SIGNAL_URL`, check it is right and starts with `https://`.
- **"Could not reach the game server" when joining.** WebSockets may be blocked on that network. In the browser's developer console, `new WebSocket('wss://<your address>/signal/echo').onmessage = event => console.log(event.data)` prints `{"t":"echo","ok":true}` where they work. **Use connection codes instead** gets around it.
- **"No game with that code."** The host has to stay on the Host Game screen, and codes never contain 0, 1, I, L or O, so a typo is caught.
- **Both players reach the room but never connect to each other.** That is the players' networks not allowing a direct connection, not the server. **Test my connection** on both shows why (a "symmetric NAT" or blocked UDP is the usual cause); there is no relay server yet (see [networking.md](networking.md)). **Copy log** in the lobby gives a timeline to send along.
- **The automatic deploy fails at "Check the Cloudflare secrets are set".** The secret it names is empty or missing. `gh secret set` hides what you paste, so an empty paste is easy to miss: set it again in GitHub's web page instead (**Settings**, **Secrets and variables**, **Actions**, the secret, **Update**), where you can see the box fill, then re-run the failed run from the Actions tab.
- **The automatic deploy fails later with an error from Cloudflare** (authentication, or permission). The token is probably for another account, has expired, or was not made from the **Edit Cloudflare Workers** template: make a new one and set the secret again.
- **`wrangler` says you are not logged in.** Run `npx wrangler login` again.

## Taking it down

`npx wrangler delete` removes the Worker and its rooms. If you added a custom domain, remove it under **Domains & Routes** in the dashboard as well, if it is still listed.

## How it works

[networking.md](networking.md) describes the room protocol, the limits and the client side. In short: `server/worker.ts` routes requests; `server/room.ts` is a Durable Object per room code; `server/roomLogic.ts` holds the rules and is tested without Cloudflare; `wrangler.jsonc` describes the deployment; and `scripts/server.mjs` builds and runs Wrangler.
