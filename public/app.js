const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const output = document.getElementById("answer");
const send = document.getElementById("send-button");
form.addEventListener("submit", handler);

async function handler(e)
{
    e.preventDefault();

    const message = input.value.trim();
    if (!message)
    {
        return;
    }

    send.disabled = true;
    output.textContent = "Codex 正在处理......";
    try
    {
        const response = await fetch("/api/chat", {// /api/chat对应 http://localhost:3000/api/chat，及 当前网站地址+路由/api/chat
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message })
        });
        const result = await response.json();
        if (!response.ok)
        {
            throw new Error(result.error ?? "请求失败");
        }
        output.textContent = result.answer;
    } catch (err)
    {
        err instanceof Error ? err.message : "发生未知错误";
    } finally
    {
        send.disabled = false;
    }
}
