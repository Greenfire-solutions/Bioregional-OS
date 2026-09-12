# Running the whole OS by talking to Claude Code

BioRegional OS ships an MCP server. Claude Code picks it up automatically from
`.mcp.json` in the project root, so there is nothing to configure.

## Setup

```
cd "path/to/Bioregional-OS"
claude
```

That's it. Claude Code now has every tool in the registry — the same set the app
itself runs on, and the same consent gates. `npm run connect` prints the count. Try:

> what is the state of the commons?

## Or without a terminal at all

The Assistant panel in the app is the same thing. It runs the Claude Code CLI on
your own subscription — no API key, nothing in `.env` — and reaches the commons
through this same MCP server, so an action taken from the panel meets the
protocol exactly as one taken from the terminal does. Ask it to file a council
decision without a Land Seat report and it comes back refused, with the
protocol's own sentence, in the panel.

It appears whenever `claude` is on your PATH. `/api/status` reports what it
found under `claude_code`; if the CLI is missing the panel says so and offers
the API-key route instead.

Two things about it are worth knowing, because they are deliberate:

**It answers only to this machine.** `npm start -- --share` binds `0.0.0.0` so a
phone at a gathering can reach `/join`, and there is no authentication anywhere
on this API — a fine trade for a page where somebody writes down what they
noticed, and a poor one for an endpoint that spawns a process and spends your
subscription. Requests that did not come from this computer are refused, and
told why.

**The file and network tools are denied, not merely unused.** The CLI is started
with `--disallowedTools`, which removes them, and `--mcp-config .mcp.json
--strict-mcp-config`, which loads this project's MCP server and nothing else —
without that second pair it also picks up whatever is in your global MCP config,
which on one machine meant the panel could read its steward's email. What
remains is every tool in this registry plus `ToolSearch`, and the panel checks
that list against an allowlist on every single run: if anything unrecognised
appears it abandons the exchange and names it, rather than trusting that the
model will decline to use it.

The number beside the composer is a **usage estimate, not a charge** — on a
subscription no money leaves an account for this; it is what the same work would
have cost through the API. Today's ground, what moved and what's next are all
computed on this machine and cost nothing at all.

## What you can ask for

| Ask | What happens |
|---|---|
| "What's the state of the commons?" | Chapter identity, seasonal dashboard, viability test, care gaps, benefit flow |
| "Which quests are blocked and by what?" | Reads every consent and safety gate, names the specific blockers |
| "Locate every place" | Resolves each place against EPA ecoregions and USGS watershed boundaries |
| "Pull the latest water data" | Ingests live USGS gage readings as Hydrological signals |
| "What ecoregions are in this bounding box?" | Queries the same layer the 3D map draws |
| "Find our neighbours" | Searches the Murmurations network and records peers |
| "Propose a decision about X" | Refuses without a Land Seat report — by design |
| "What should we do today?" | `whats_next` — every stage checked, ranked by what blocks other work |
| "Someone brought a need" | Records it, and tracks that they are owed an answer |
| "Close the land access gate on X" | Refuses without evidence and a named reviewer |
| "Advance that project to prototype" | Refuses, with the specific blockers, until it is ready |
| "Record this week's reading" | Says whether it moved toward or away from the target |
| "What can we fix first?" | Runs the Minimum Viable Chapter Test and ranks the failures |

## The guardrails are in the code, not the prompt

Claude cannot route around these, because they live in the engines, not the
system prompt:

- **A council item without a Land Seat report is refused.** Ecological
  observations, downstream effects, uncertainty and red flags are mandatory.
- **An irreversible decision cannot use a light decision method.** It gets
  bounced to supermajority/consensus with an affected-party process.
- **A decision with an open red flag cannot be finalised.**
- **A quest cannot reach the build stage with an open consent gate**, or without
  a named maintenance owner and a defined smallest experiment.
- **A gate closes only on evidence plus a named reviewer.** A boolean is refused.
- **Paid, apprentice, credit and work-trade contributions are refused without
  acknowledged terms.**
- **AI may not decide** membership worth, punishment, project legitimacy, funding
  winners, cultural permission, land rights, safety clearance, the truth of
  contested testimony, or who deserves care. `log_ai_use` rejects those purposes
  outright.
- **Restricted and sacred material is filtered by clearance**, and exports report
  what was withheld rather than silently dropping it.
- **Required fields are enforced centrally**, so a tool call that omits a
  mandatory field is refused the same way for Claude Code, the assistant, the
  REST API and the interface.
- **An indicator without a decision trigger is refused.** Measurement that cannot
  change a decision is decoration.
- **Declining an intake item without a reason is refused.**

Run `npm test` to see all 29 of these exercised.

## Logging

When Claude produces something the chapter will publish or act on, it should call
`log_ai_use` with a named human reviewer. That is a requirement of the protocol,
and the tool refuses an entry with no reviewer.

## Claude Desktop

```
npm run connect -- --install-desktop
```

Writes the server into `~/Library/Application Support/Claude/claude_desktop_config.json`.
Quit and reopen Claude Desktop.

## Any other MCP client

```json
{
  "mcpServers": {
    "bioregional-os": { "command": "node", "args": ["/full/path/to/Bioregional-OS/mcp/server.mjs"] }
  }
}
```

The server is plain JSON-RPC 2.0 over stdio with zero dependencies.
