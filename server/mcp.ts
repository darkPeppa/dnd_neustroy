import { characterSchema, defaultCharacter, roll } from "../src/domain";
import { classIds, sourceClasses, sourceSpells } from "../src/rules";
import type { Env } from "./index";
import { readBytes } from "./http";
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const tools = [
  {
    name: "characters_list",
    description:
      "List the signed-in player’s character sheets, including edition and saved appearance.",
    inputSchema: object({}),
  },
  {
    name: "character_get",
    description: "Read one character owned by the player.",
    inputSchema: object({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "character_create",
    description:
      "Create a starter character with a selected D&D edition. Returns a complete editable sheet.",
    inputSchema: object(
      {
        name: { type: "string" },
        classId: { type: "string", enum: classIds },
        edition: { type: "string", enum: ["srd-2014", "srd-2024", "custom"] },
      },
      ["name", "classId", "edition"],
    ),
  },
  {
    name: "character_update",
    description:
      "Save a complete character sheet using its latest revision. Get the sheet first; preserve fields the player has not asked to change.",
    inputSchema: object(
      {
        id: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        data: characterSchema.toJSONSchema(),
      },
      ["id", "revision", "data"],
    ),
  },
  {
    name: "dice_roll",
    description:
      "Roll an explicit dice formula, such as 2d6+3. Does not change a sheet.",
    inputSchema: object({ formula: { type: "string" } }, ["formula"]),
  },
  {
    name: "rules_search",
    description:
      "Search openly licensed SRD classes, features, and spells, separated by 2014 and 2024 editions. Original text is English.",
    inputSchema: object(
      {
        query: { type: "string", maxLength: 120 },
        edition: { type: "string", enum: ["srd-2014", "srd-2024"] },
      },
      ["query", "edition"],
    ),
  },
  {
    name: "sessions_list",
    description:
      "Read sessions available to this player, with dates, votes and status.",
    inputSchema: object({}),
  },
  {
    name: "clues_list",
    description:
      "Read only campaign clues the master has revealed to this player.",
    inputSchema: object({ campaignId: { type: "string" } }, ["campaignId"]),
  },
  {
    name: "campaigns_list",
    description:
      "List campaigns available to the current user and their role in each game.",
    inputSchema: object({}),
  },
  {
    name: "journal_list",
    description:
      "Read the notes and log visible to the current player. Other players' private notes and chats are excluded.",
    inputSchema: object({ campaignId: { type: "string" } }, ["campaignId"]),
  },
  {
    name: "journal_add_note",
    description: "Save a private note to a campaign on the player's request.",
    inputSchema: object(
      {
        campaignId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      ["campaignId", "title", "body"],
    ),
  },
  {
    name: "mobile_login_token",
    description:
      "Issue a credential for this user's mobile app. Only call upon an explicit request for a neustroy mobile sign-in token. Keep it in this private conversation.",
    inputSchema: object({}),
  },
];
export async function mcp(
  r: Request,
  e: Env,
  ctx: ExecutionContext,
  api: (r: Request, e: Env, ctx: ExecutionContext) => Promise<Response>,
) {
  if (r.method !== "POST")
    return new Response(null, {
      status: r.method === "DELETE" ? 200 : 405,
      headers: { Allow: "POST" },
    });
  const text = new TextDecoder().decode(await readBytes(r, 150000));
  if (text.length > 150000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  let input: any;
  try {
    input = JSON.parse(text);
    if (!input || Array.isArray(input) || typeof input !== "object")
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request" },
        },
        { status: 400 },
      );
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }
  if (
    typeof input.method === "string" &&
    input.method.startsWith("notifications/")
  )
    return new Response(null, { status: 202 });
  let result: any;
  const invoke = async (path: string, method = "GET", data?: unknown) => {
    const headers = new Headers(r.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("content-length");
    const url = new URL("/api/" + path, r.url);
    const response = await api(
      new Request(url, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      e,
      ctx,
    );
    const body = await response.json();
    if (!response.ok) throw Error((body as any).error);
    return body as any;
  };
  try {
    switch (input.method) {
      case "server/discover":
        result = {
          supportedVersions: ["2026-07-28", "2025-03-26"],
          capabilities: { tools: {} },
        };
        break;
      case "initialize":
        result = {
          protocolVersion: input.params?.protocolVersion || "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "neustroy", version: "0.2.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools };
        break;
      case "tools/call": {
        await invoke("me");
        const a = input.params.arguments || {};
        let value: any;
        switch (input.params.name) {
          case "characters_list":
            value = await invoke("characters");
            break;
          case "character_get":
            value = (await invoke("characters")).find(
              (x: any) => x.id === a.id,
            );
            if (!value) throw Error("Character not found");
            break;
          case "character_create": {
            const c = characterSchema.parse({
              ...defaultCharacter(a.classId),
              name: a.name,
              edition: a.edition,
            });
            value = await invoke("characters", "POST", c);
            break;
          }
          case "character_update":
            value = await invoke(
              "characters/" + encodeURIComponent(a.id),
              "PUT",
              { data: a.data, revision: a.revision },
            );
            break;
          case "sessions_list":
            value = await invoke("sessions");
            break;
          case "campaigns_list":
            value = (await invoke("campaigns")).map(
              ({ invite, ...game }: any) => game,
            );
            break;
          case "journal_list": {
            const base = "campaigns/" + encodeURIComponent(a.campaignId);
            const [notes, log] = await Promise.all([
              invoke(base + "/notes"),
              invoke(base + "/log"),
            ]);
            value = { notes, log };
            break;
          }
          case "journal_add_note":
            value = await invoke(
              "campaigns/" + encodeURIComponent(a.campaignId) + "/notes",
              "POST",
              { title: a.title, body: a.body, visibility: "private" },
            );
            break;
          case "mobile_login_token":
            value = await invoke("native-token", "POST");
            break;
          case "clues_list":
            value = await invoke(
              "clues?campaign=" + encodeURIComponent(a.campaignId),
            );
            break;
          case "dice_roll":
            value = roll(a.formula);
            break;
          case "rules_search": {
            const query = String(a.query).slice(0, 120).toLowerCase();
            value = [...sourceClasses, ...sourceSpells]
              .filter(
                (x) =>
                  x.document.key === a.edition &&
                  (x.name + " " + x.desc).toLowerCase().includes(query),
              )
              .slice(0, 12)
              .map((x) => ({
                id: x.key,
                name: x.name,
                text: x.desc,
                source: x.document.name,
              }));
            break;
          }
          default:
            throw Error("Unknown tool");
        }
        result = { content: [{ type: "text", text: JSON.stringify(value) }] };
        break;
      }
      default:
        return Response.json({
          jsonrpc: "2.0",
          id: input.id ?? null,
          error: { code: -32601, message: "Method not found" },
        });
    }
  } catch (error) {
    result = {
      content: [{ type: "text", text: (error as Error).message }],
      isError: true,
    };
  }
  return Response.json(
    { jsonrpc: "2.0", id: input.id ?? null, result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
