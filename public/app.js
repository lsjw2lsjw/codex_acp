const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const output = document.getElementById("answer");
const send = document.getElementById("send-button");
form.addEventListener("submit", handler);

async function handler()
{
    e.preventDefault();

    const message = input.value.trim();
    if (!message)
    {
        return;
    }

    send.disabled = true;
    output.testContent = "Codex 正在处理......";
    try
    {
        const response = await fetch("/api/chat", {
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
        output.testContent = result.answer;
    } catch (err)
    {
        output instanceof Error ? error.message : "发生未知错误";
    } finally
    {
        input.disabled = false;
    }
}
