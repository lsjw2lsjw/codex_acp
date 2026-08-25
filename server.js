import * as acp from "@agentclientprotocol/sdk";
import express from "express";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

const app = express();
const port = 3000;

let currentAnswer = "";
let sessionId = "";
let busy = false;

const command = process.platform === "win32" ?
    "npx.cmd" : "npx";

const adapter = spawn(
    command,
    ["--no-install", "codex-acp"],
    {
        env: {
            ...process.env,
            INITIAL_AGENT_MODE: "read-only",
            NO_BROWSER: "1",
        },
        stdio: ["pipe", "pipe", "inherit"],
    },
);

if (!adapter.stdin || !adapter.stdout)
{
    throw new Error("无法连接 codex-acp");
}

const client = {
    async requestPermission()
    {
        return {
            outcome: {
                outcome: "cancelled",
            },
        };
    },

    async sessionUpdate(params)
    {
        if (params.sessionId !== sessionId)
        {
            return;
        }

        const update = params.update;

        if (
            update.sessionUpdate === "agent_message_chunk"
            &&
            update.content.type === "text"
        )
        {
            currentAnswer += update.content.text;
        }
    },
};

const stream = acp.ndJsonStream(
    Writable.toWeb(adapter.stdin),
    Readable.toWeb(adapter.stdout),
);

const connection = new acp.ClientSideConnection(
    () => client,
    stream,
);

const initializeResponse = await
    connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: {
            name: "acp-web-demo",
            version: "1.0.0",
        },
    });

const apiKey =
    process.env.CODEX_API_KEY ??
    process.env.OPENAI_API_KEY;

if (
    apiKey &&
    initializeResponse.authMethods?.some(
        (method) => method.id === "api-key",
    )
)
{
    await connection.authenticate({
        methodId: "api-key",
        _meta: {
            "api-key": {
                apiKey,
            },
        },
    });
}

const session = await connection.newSession({
    cwd: process.cwd(),
    mcpServers: [],
});

sessionId = session.sessionId;

app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (request, response) =>
{
    const message = request.body?.message;

    if (typeof message !== "string" || !
        message.trim())
    {
        response.status(400).json({
            error: "请输入消息",
        });
        return;
    }

    if (busy)
    {
        response.status(409).json({
            error: "Codex 正在处理上一条消息",
        });
        return;
    }

    busy = true;
    currentAnswer = "";

    try
    {
        await connection.prompt({
            sessionId,
            prompt: [
                {
                    type: "text",
                    text: message.trim(),
                },
            ],
        });

        response.json({
            answer: currentAnswer || "Codex 没有返回文本",
        });
    } catch (error)
    {
        response.status(500).json({
            error:
                error instanceof Error
                    ? error.message
                    : "Codex 请求失败",
        });
    } finally
    {
        busy = false;
    }
});

app.listen(port, () =>
{
    console.log(`网站已启动：http://localhost:${port}
    `);
});
