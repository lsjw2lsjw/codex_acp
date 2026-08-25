const form=document.getElementById("chat-form");
const input=document.getElementById("message");
const output=document.getElementById("answer");
const send=document.getElementById("send-button");
form.addEventListener("submit",handler);
 async function handler(e){
    e.preventDefault();

    const message=input.ariaValueMax.trim();
    if(!message)
}
