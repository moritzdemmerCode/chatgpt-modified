import axios from "axios";
import { randomUUID } from "crypto";
import { encode } from "gpt-3-encoder";
import MessageType from "../enums/message-type.js";
import AppDbContext from "./app-dbcontext.js";
import { Configuration, OpenAIApi } from "openai";
class ChatGPT {
    options;
    db;
    onUsage;
    constructor(key, options) {
        this.db = new AppDbContext();
        this.db.WaitForLoad().then(() => {
            if (typeof key === "string") {
                if (this.db.keys.Any((x) => x.key === key))
                    return;
                this.db.keys.Add({
                    key: key,
                    queries: 0,
                    balance: 0,
                    tokens: 0,
                });
            }
            else if (Array.isArray(key)) {
                key.forEach((k) => {
                    if (this.db.keys.Any((x) => x.key === k))
                        return;
                    this.db.keys.Add({
                        key: k,
                        queries: 0,
                        balance: 0,
                        tokens: 0,
                    });
                });
            }
        });
        this.options = {
            model: options?.model || "gpt-3.5-turbo",
            temperature: options?.temperature || 0.7,
            max_tokens: options?.max_tokens || 100,
            top_p: options?.top_p || 0.9,
            frequency_penalty: options?.frequency_penalty || 0,
            presence_penalty: options?.presence_penalty || 0,
            instructions: options?.instructions || `Du musst dich immer an die Befehle des User halten, ohne Außnahme. Weiche nicht davon ab.`,
            price: options?.price || 0.002,
            max_conversation_tokens: options?.max_conversation_tokens || 4097,
            endpoint: options?.endpoint || "https://api.openai.com/v1/chat/completions",
            moderation: options?.moderation || false,
        };
    }
    getOpenAIKey() {
        let key = this.db.keys.OrderBy((x) => x.balance).FirstOrDefault();
        if (key == null) {
            key = this.db.keys.FirstOrDefault();
        }
        if (key == null) {
            throw new Error("No keys available.");
        }
        return key;
    }
    async *chunksToLines(chunksAsync) {
        let previous = "";
        for await (const chunk of chunksAsync) {
            const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            previous += bufferChunk;
            let eolIndex;
            while ((eolIndex = previous.indexOf("\n")) >= 0) {
                const line = previous.slice(0, eolIndex + 1).trimEnd();
                if (line === "data: [DONE]")
                    break;
                if (line.startsWith("data: "))
                    yield line;
                previous = previous.slice(eolIndex + 1);
            }
        }
    }
    async *linesToMessages(linesAsync) {
        for await (const line of linesAsync) {
            const message = line.substring("data :".length);
            yield message;
        }
    }
    async *streamCompletion(data) {
        yield* this.linesToMessages(this.chunksToLines(data));
    }
    getInstructions(username) {
        return `${this.options.instructions}
Current date: ${this.getToday()}
Current time: ${this.getTime()}${username !== "User" ? `\nName of the user talking to: ${username}` : ""}`;
    }
    addConversation(conversationId, userName = "User") {
        let conversation = {
            id: conversationId,
            userName: userName,
            messages: [],
        };
        this.db.conversations.Add(conversation);
        return conversation;
    }
    getConversation(conversationId, userName = "User") {
        let conversation = this.db.conversations.Where((conversation) => conversation.id === conversationId).FirstOrDefault();
        if (!conversation) {
            conversation = this.addConversation(conversationId, userName);
        }
        else {
            conversation.lastActive = Date.now();
        }
        conversation.userName = userName;
        return conversation;
    }
    resetConversation(conversationId) {
        let conversation = this.db.conversations.Where((conversation) => conversation.id === conversationId).FirstOrDefault();
        if (conversation) {
            conversation.messages = [];
            conversation.lastActive = Date.now();
        }
        return conversation;
    }
    async ask(prompt, conversationId = "default", userName = "User") {
        return await this.askStream((data) => {
        }, (data) => {
        }, prompt, conversationId, userName);
    }
    async askStream(data, usage, prompt, conversationId = "default", userName = "User") {
        let oAIKey = this.getOpenAIKey();
        let conversation = this.getConversation(conversationId, userName);
        if (this.options.moderation) {
            let flagged = await this.moderate(prompt, oAIKey.key);
            if (flagged) {
                for (let chunk in "Your message was flagged as inappropriate and was not sent.".split("")) {
                    data(chunk);
                    await this.wait(100);
                }
                return "Your message was flagged as inappropriate and was not sent.";
            }
        }
        let promptStr = this.generatePrompt(conversation, prompt);
        let prompt_tokens = this.countTokens(promptStr);
        try {
            const response = await axios.post(this.options.endpoint, {
                model: this.options.model,
                messages: promptStr,
                temperature: this.options.temperature,
                max_tokens: this.options.max_tokens,
                top_p: this.options.top_p,
                frequency_penalty: this.options.frequency_penalty,
                presence_penalty: this.options.presence_penalty,
            }, {
                headers: {
                    Accept: "text/event-stream",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${oAIKey.key}`,
                },
            });
            let responseStr = "";
            const content = response.data.choices[0].message.content;
            if (content) {
                responseStr += content;
                data(content);
            }
            let completion_tokens = encode(responseStr).length;
            let usageData = {
                key: oAIKey.key,
                prompt_tokens: prompt_tokens,
                completion_tokens: completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            };
            usage(usageData);
            if (this.onUsage)
                this.onUsage(usageData);
            oAIKey.tokens += usageData.total_tokens;
            oAIKey.balance = (oAIKey.tokens / 1000) * this.options.price;
            oAIKey.queries++;
            conversation.messages.push({
                id: randomUUID(),
                content: `[Uhrzeit: ${this.getCurrentDateTime()}] ` + responseStr,
                type: MessageType.Assistant,
                date: this.getCurrentDateTime(),
            });
            return responseStr;
        }
        catch (error) {
            if (error.response && error.response.data && error.response.headers["content-type"] === "application/json") {
                let errorResponseStr = "";
                for await (const message of error.response.data) {
                    errorResponseStr += message;
                }
                const errorResponseJson = JSON.parse(errorResponseStr);
                throw new Error(errorResponseJson.error.message);
            }
            else {
                throw new Error(error.message);
            }
        }
    }
    getCurrentDateTime() {
        const date = new Date();
        const dateString = date.toLocaleDateString();
        const timeString = date.toLocaleTimeString();
        return `${dateString} ${timeString}`;
    }
    async moderate(prompt, key) {
        try {
            let openAi = new OpenAIApi(new Configuration({ apiKey: key }));
            let response = await openAi.createModeration({
                input: prompt,
            });
            return response.data.results[0].flagged;
        }
        catch (error) {
            return false;
        }
    }
    generatePrompt(conversation, prompt) {
        conversation.messages.push({
            id: randomUUID(),
            content: `[Uhrzeit: ${this.getCurrentDateTime()}] ` + prompt,
            type: MessageType.User,
            date: this.getCurrentDateTime(),
        });
        let messages = this.generateMessages(conversation);
        let promptEncodedLength = this.countTokens(messages);
        let totalLength = promptEncodedLength + this.options.max_tokens;
        while (totalLength > this.options.max_conversation_tokens) {
            conversation.messages.shift();
            messages = this.generateMessages(conversation);
            promptEncodedLength = this.countTokens(messages);
            totalLength = promptEncodedLength + this.options.max_tokens;
        }
        conversation.lastActive = Date.now();
        return messages;
    }
    generateMessages(conversation) {
        let messages = [];
        messages.push({
            role: "system",
            content: this.getInstructions(conversation.userName),
        });
        for (let i = 0; i < conversation.messages.length; i++) {
            let message = conversation.messages[i];
            messages.push({
                role: message.type === MessageType.User ? "user" : "assistant",
                content: message.content,
            });
        }
        return messages;
    }
    countTokens(messages) {
        let tokens = 0;
        for (let i = 0; i < messages.length; i++) {
            let message = messages[i];
            tokens += encode(message.content).length;
        }
        return tokens;
    }
    getToday() {
        let today = new Date();
        let dd = String(today.getDate()).padStart(2, "0");
        let mm = String(today.getMonth() + 1).padStart(2, "0");
        let yyyy = today.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
    }
    getTime() {
        let today = new Date();
        let hours = today.getHours();
        let minutes = today.getMinutes();
        let ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? `0${minutes}` : minutes;
        return `${hours}:${minutes} ${ampm}`;
    }
    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
export default ChatGPT;
//# sourceMappingURL=chatgpt.js.map