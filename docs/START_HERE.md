# Start here

You do not need to know anything technical to use this. Read the first two lines
and stop when it works.

## The very short version

**On a Mac:** open the `bin` folder and double-click **Start BioRegional OS.command**.
That is the whole thing. It sets itself up the first time, then opens your browser.

If a warning says the file is from an unidentified developer: right-click it,
choose **Open**, then **Open** again. macOS only asks once.

## The typing version

Open Terminal, then copy these two lines, one at a time:

```
cd "path/to/Bioregional-OS"
npm run setup
```

then:

```
npm run os -- --open
```

That's it. Your browser opens with the map.

## If you are ever lost

Inside the app, click the green **I'm lost** button in the bottom-right corner.
It explains whatever screen you're on and how to let other people in.

In the terminal:

| You want to | Type this |
|---|---|
| A menu of everything | `npm run help` |
| Help with the map | `npm run help map` |
| Let other people in | `npm run connect` |
| Something is broken | `npm run doctor -- --fix` |
| Start it again later | `npm run os -- --open` |

**You cannot break it by trying commands.** The only file that holds your work is
`data/commons.db`. Copy that file and you have a complete backup.

## Letting other people in

Run `npm run connect`. It prints every option, including a **QR code** — someone
points their phone camera at it and the commons opens in their browser. No app,
no account, no login.

That link only works for people already on your wifi. Nothing is published to the
internet unless you deliberately choose to.

## What you need, and what you don't

**You need:** a computer with [Node.js](https://nodejs.org) installed (the big
green LTS button).

**You do not need:** an account, a credit card, an internet connection after the
first setup, an API key, a server, or any cloud service.

**Optional:** an Anthropic API key, if you want the assistant to answer inside the
app. You can skip this entirely and talk to your commons through Claude Code
instead — see [CLAUDE_CODE.md](CLAUDE_CODE.md).

## If something goes wrong

Run `npm run doctor`. It checks everything and tells you in plain words what each
problem means and what to do. Add `--fix` and it fixes what it can by itself.

Nothing it does is destructive. It never deletes your data.
