import * as acp from "@agentclientprotocol/sdk";//acp的软件开发工具
import express from "express";//浏览器和服务器之间http通信
import { spawn } from "node:child_process";//spawn()是Node.js 用来启动子进程的函数（启动外部命令，如git python）
import { Readable, Writable } from "node:stream";//Readable:可读数据流 Writable：可写数据流

const app = express();//创建一个 Express Web 应用(能执行相应的处理逻辑的后端服务器)
const port = 3000;//空闲端口

let currentAnswer = "";//codex回答
let sessionId = "";//当前ACP会话的唯一编号
let busy = false;//codex是否正在处理消息

const command = process.platform === "win32" ?//通过判断此进程(process)的操作系统类型，选择正确的npx命令
    "npx.cmd" : "npx";

const adapter = spawn(//adapter是创建出的子进程（对象）
    command,//要运行的程序
    ["--no-install", "codex-acp"],//给程序传入的参数————> npx.cmd/npx --no-install codex-acp
    {//给子进程(adapter)做配置
        env: {
            ...process.env,//把父进程（process）的环境变量复制给子进程(adapter)
            INITIAL_AGENT_MODE: "read-only",//子进程(adapter)添加两个新环境变量
            NO_BROWSER: "1",
        },
        stdio: ["pipe", "pipe", "inherit"],//制子进程的输入和输出连接到哪里(stdin:标准输入流 stdout:标准输入流 stderr:标准错误流)
        //stdio: [stdin配置, stdout配置, stderr配置],pipe表示在父进程和子进程之间创建传输数据的通道，inherit表示子进程直接继承父进程对应的通道，相当于把子进程的输出接到父进程终端上
    },
);

if (!adapter.stdin || !adapter.stdout)//子进程没有可用的stdin和stdout
{
    throw new Error("无法连接 codex-acp");
}

const client = {
    async requestPermission()//async 让函数始终返回Promise对象
    {//retrun的是一个Promise对象
        return {
            outcome: {
                outcome: "cancelled",//当程序请求权限时，不询问用户，也不授予权限，直接返回“权限请求已取消”。
            },
        };
    },

    async sessionUpdate(params)//接收 Codex 在会话过程中不断发送的更新，并把其中的文本回答片段拼接到 currentAnswer。(流式)
    //params是会话的一个片段（json），接收的是agent的回答片段
    //       params 大致类似：
    //   {
    //       sessionId: "session-123",
    //       update: {
    //           sessionUpdate: "agent_message_chunk",
    //           content: {
    //               type: "text",
    //               text: "你好",    ---》 “我是”    ---》 “codex。”
    //           },
    //       },
    //   }

    {
        if (params.sessionId !== sessionId)//如果输入的会话编号不是当前会话编号
        {
            return;
        }

        const update = params.update;//会话片段具体的更新内容

        if (
            update.sessionUpdate === "agent_message_chunk"//确定这是一段 agent 回答
            &&
            update.content.type === "text"//片段内容是文本
        )
        {
            currentAnswer += update.content.text;//将agent的回答拼在currentAnswer之后，组成完整的一句话
        }
    },
};

const stream = acp.ndJsonStream(//把子进程(adapter)的标准输入和标准输出，转换成 ACP SDK 可以使用的双向 JSON 消息流（node.js和子进程adapter可以双向通信）。
    Writable.toWeb(adapter.stdin),
    Readable.toWeb(adapter.stdout),
);//stream是一个包含具体writale(input)和readable(output)内容的对象

const connection = new acp.ClientSideConnection(//创建了一个 ACP 客户端连接对象
    () => client,//相当于传入client，里面有1.拒绝codex任何获取权限的请求 2.接受来自codex的回答片段，并接在currentAnswer
    //相当于：
    //       function createClient()
    //   {
    //       return client;
    //   }
    stream,//包含具体writale(input)和readable(output)内容的对象
);

const initializeResponse = await
    connection.initialize({//将以下信息打包成初始化信息
        protocolVersion: acp.PROTOCOL_VERSION,//acp协议版本
        clientInfo: {//客户端信息
            name: "acp-web-demo",
            version: "1.0.0",
        },
    });

const apiKey =
    process.env.CODEX_API_KEY ??
    process.env.OPENAI_API_KEY;

if (
    apiKey &&
    //如果initializeResponse.authMethods存在，则调用initializeResponse.some(),不存在则整体返回undefined
    //       initializeResponse.authMethods = [
    //       {
    //           id: "oauth",
    //           name: "OAuth",
    //       },
    //       {
    //           id: "api-key",
    //           name: "API Key",
    //       },
    //   ];
    initializeResponse.authMethods?.some(//初始化信息中有authMethods方法进行认证
        (method) => method.id === "api-key",
        //.some()方法将.authMethods数组中的对象依次作为method参数传入，找到id==="api-key"时，返回true
    )
)
{
    //     connection.authenticate() 会创建一个 JSON-RPC 请求发给agent。简化后大致是：
    //   {
    //     "jsonrpc": "2.0",
    //     "id": 2,
    //     "method": "authenticate",
    //     "params": {
    //       "methodId": "api-key",
    //       "_meta": {
    //         "api-key": {
    //           "apiKey": "example-secret-key"
    //         }
    //       }
    //     }
    //   }
    await connection.authenticate({//通过参数设置协议内容
        methodId: "api-key",
        _meta: {
            "api-key": {
                apiKey,
            },
        },
    });
}
//agent收到这个JSON-RPC 请求后会：
//  1. 读取 methodId
//  2. 确定使用 API Key 认证
//  3. 从 _meta["api-key"] 读取密钥
//  4. 验证或保存认证信息
//  5. 返回成功结果或错误

//开始建立会话(session)
const session = await connection.newSession({//请求 Agent 创建一个新的独立对话会话
    cwd: process.cwd(),//以当前 Node.js 工作目录作为会话目录
    mcpServers: [],//不连接额外的 MCP 服务器
});

sessionId = session.sessionId;

app.use(express.json());//添加了一个请求处理器等待请求，让app(express服务器)自动解析HTTP请求中的JSON数据，解析完成后，JSON内容会保存到request.body
//解析的是浏览器发送给 Express 服务器的 HTTP JSON 请求
app.use(express.static("public"));//浏览器开始访问服务器地址时，浏览器会请求html js css等文件（GET），express服务器收到该请求后去public目录找并返回对应文件

app.post("/api/chat", async (request, response) =>//服务器注册一个处理 HTTP POST（发布） 请求的处理器
{//路由路径："/api/chat"表示由express服务器的接口处理（express自带）该请求
    const message = request.body?.message;//如果.body存在，则调用.message（messages是body里的内容）

    if (typeof message !== "string" || !
        message.trim())//如果message的类型不是string或是空字符串、全空格字符串
    {
        response.status(400).json({//把 JavaScript 对象:{error:"请输入消息"}转换成 JSON，并发送给浏览器
            error: "请输入消息",
        });
        return;
    }

    if (busy)//之前定义的全局变量
    {
        response.status(409).json({
            error: "Codex 正在处理上一条消息",
        });
        return;
    }

    busy = true;
    currentAnswer = "";//初始化

    try
    {
        await connection.prompt({//提示词connect中有之前定义的 currentAnswer += update.content.text逻辑
            sessionId,
            prompt: [
                {
                    type: "text",
                    text: message.trim(),//request.message
                },
            ],
        });

        response.json({
            answer: currentAnswer || "Codex 没有返回文本",//||表示在左边是假值时使用右边，不用 ?? 是因为它不能过滤 currentAnswer=""
        });
    } catch (error)//await connection.prompt内部会throw new Error()
    {
        response.status(500).json({//500 服务器内部错误：服务器遇到了意外情况
            error:
                error instanceof Error//判断error是否是Error类创建的对象
                    ? error.message
                    : "Codex 请求失败",
        });
    } finally
    {
        busy = false;
    }
});

app.listen(port, () =>//express服务器监听指定端口(port=3000)的http请求
{
    console.log(`网站已启动：http://localhost:${port}
    `);
});
