import { encode } from "gpt-3-encoder";
import { Configuration, OpenAIApi } from "openai";
import axios from "axios";
import MessageType from "../enums/message-type.js";
import AppDbContext from "./app-dbcontext.js";
import { randomUUID } from "crypto";
class OpenAI {
    db;
    options;
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
            model: options?.model || "text-davinci-003",
            temperature: options?.temperature || 0.7,
            max_tokens: options?.max_tokens || 512,
            top_p: options?.top_p || 0.9,
            frequency_penalty: options?.frequency_penalty || 0,
            presence_penalty: options?.presence_penalty || 0,
            instructions: options?.instructions || `You are ChatGPT, a language model developed by OpenAI. You are designed to respond to user input in a conversational manner, Answer as concisely as possible. Your training data comes from a diverse range of internet text and You have been trained to generate human-like responses to various questions and prompts. You can provide information on a wide range of topics, but your knowledge is limited to what was present in your training data, which has a cutoff date of 2021. You strive to provide accurate and helpful information to the best of your ability.\nKnowledge cutoff: 2021-09`,
            stop: options?.stop || "<|im_end|>",
            aiName: options?.aiName || "ChatGPT",
            moderation: options?.moderation || false,
            endpoint: options?.endpoint || "https://api.openai.com/v1/completions",
            price: options?.price || 0.02,
            max_conversation_tokens: options?.max_conversation_tokens || 4097,
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
        return `[START_INSTRUCTIONS]
${this.options.instructions}
Current date: ${this.getToday()}
Current time: ${this.getTime()}${username !== "User" ? `\nName of the user talking to: ${username}` : ""}
[END_INSTRUCTIONS]${this.options.stop}\n`;
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
        return await this.askStream((data) => { }, (data) => { }, prompt, conversationId, userName);
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
        let prompt_tokens = encode(promptStr).length;
        try {
            const response = await axios.post(this.options.endpoint, {
                model: this.options.model,
                prompt: promptStr,
                temperature: this.options.temperature,
                max_tokens: this.options.max_tokens,
                top_p: this.options.top_p,
                frequency_penalty: this.options.frequency_penalty,
                presence_penalty: this.options.presence_penalty,
                stop: [this.options.stop],
                stream: true,
            }, {
                responseType: "stream",
                headers: {
                    Accept: "text/event-stream",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${oAIKey.key}`,
                },
            });
            let responseStr = "";
            for await (const message of this.streamCompletion(response.data)) {
                try {
                    const parsed = JSON.parse(message);
                    const { text } = parsed.choices[0];
                    responseStr += text;
                    data(text);
                }
                catch (error) {
                    console.error("Could not JSON parse stream message", message, error);
                }
            }
            let completion_tokens = encode(responseStr).length;
            responseStr = responseStr
                .replace(new RegExp(`\n${conversation.userName}:.*`, "gs"), "")
                .replace(new RegExp(`${conversation.userName}:.*`, "gs"), "")
                .replace(/<\|im_end\|>/g, "")
                .replace(this.options.stop, "")
                .replace(`${this.options.aiName}: `, "")
                .trim();
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
                content: responseStr,
                type: MessageType.Assistant,
                date: Date.now(),
            });
            return responseStr;
        }
        catch (error) {
            try {
                if (error.response && error.response.data) {
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
            catch (e) {
                throw new Error(error.message);
            }
        }
    }
    generatePrompt(conversation, prompt) {
        prompt = [",", "!", "?", "."].includes(prompt[prompt.length - 1]) ? prompt : `${prompt}.`;
        conversation.messages.push({
            id: randomUUID(),
            content: prompt,
            type: MessageType.User,
            date: Date.now(),
        });
        let promptStr = this.convToString(conversation);
        let promptEncodedLength = encode(promptStr).length;
        let totalLength = promptEncodedLength + this.options.max_tokens;
        while (totalLength > this.options.max_conversation_tokens) {
            conversation.messages.shift();
            promptStr = this.convToString(conversation);
            promptEncodedLength = encode(promptStr).length;
            totalLength = promptEncodedLength + this.options.max_tokens;
        }
        conversation.lastActive = Date.now();
        return promptStr;
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
    convToString(conversation) {
        let messages = [];
        for (let i = 0; i < conversation.messages.length; i++) {
            let message = conversation.messages[i];
            if (i === 0) {
                messages.push(this.getInstructions(conversation.userName));
            }
            messages.push(`${message.type === MessageType.User ? conversation.userName : this.options.aiName}: ${conversation.messages[i].content}${this.options.stop}`);
        }
        messages.push(`${this.options.aiName}: `);
        let result = messages.join("\n");
        return result;
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
export default OpenAI;
//# sourceMappingURL=openai.js.map